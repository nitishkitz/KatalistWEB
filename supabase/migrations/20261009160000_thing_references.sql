-- Thing references: a Thing (or later a message/comment) can point at other Things by ID.
-- A reference stores only IDs and order. It grants no access: display metadata is always read through the
-- viewer's own can_view_thing access, and an unreadable or deleted source simply renders as unavailable.

CREATE TABLE IF NOT EXISTS public.thing_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thing_id uuid NOT NULL REFERENCES public.things(id) ON DELETE CASCADE,
  source_thing_id uuid NOT NULL REFERENCES public.things(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0 CHECK (position >= 0 AND position < 10),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (thing_id, source_thing_id),
  CHECK (thing_id <> source_thing_id)
);

CREATE INDEX IF NOT EXISTS idx_thing_references_thing ON public.thing_references (thing_id, position);

GRANT SELECT ON public.thing_references TO authenticated;
GRANT ALL ON public.thing_references TO service_role;
ALTER TABLE public.thing_references ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='thing_references' AND policyname='references readable with the Thing') THEN
    CREATE POLICY "references readable with the Thing"
      ON public.thing_references FOR SELECT TO authenticated
      USING (katalist_priv.can_view_thing(thing_id));
  END IF;
END $$;

-- Attach references to a Thing the caller can already see. Every source must also be visible to the caller;
-- references are idempotent per (thing, source), so a retry after a partial failure never duplicates rows.
CREATE OR REPLACE FUNCTION public.add_thing_references(p_thing_id uuid, p_source_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_ids uuid[];
  v_count integer;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT katalist_priv.can_view_thing(p_thing_id) THEN
    RAISE EXCEPTION 'Thing not found';
  END IF;
  SELECT coalesce(array_agg(DISTINCT s), '{}') INTO v_ids FROM unnest(coalesce(p_source_ids, '{}')) AS s WHERE s <> p_thing_id;
  IF coalesce(array_length(v_ids, 1), 0) > 10 THEN
    RAISE EXCEPTION 'too many references';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_ids) AS s WHERE NOT katalist_priv.can_view_thing(s)) THEN
    RAISE EXCEPTION 'Referenced Thing not found';
  END IF;

  INSERT INTO public.thing_references (thing_id, source_thing_id, position, created_by)
  SELECT p_thing_id, s.id, (s.ord - 1)::integer, v_me
  FROM unnest(coalesce(p_source_ids, '{}')) WITH ORDINALITY AS s(id, ord)
  WHERE s.id = ANY (v_ids) AND s.ord <= 10
  ON CONFLICT (thing_id, source_thing_id) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Ordered source IDs for a Thing. IDs only: a source the viewer cannot read renders as unavailable on the client.
CREATE OR REPLACE FUNCTION public.get_thing_references(p_thing_id uuid)
RETURNS TABLE (source_thing_id uuid, "position" integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
  SELECT r.source_thing_id, r.position
  FROM public.thing_references r
  WHERE r.thing_id = p_thing_id AND katalist_priv.can_view_thing(p_thing_id)
  ORDER BY r.position;
$$;

REVOKE ALL ON FUNCTION public.add_thing_references(uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_thing_references(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_thing_references(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_thing_references(uuid) TO authenticated;
