-- Rich descriptions are independent of legacy notes (which also carry attachment data).
ALTER TYPE public.activity_event ADD VALUE IF NOT EXISTS 'description_updated';
ALTER TABLE public.things
  ADD COLUMN description_document jsonb,
  ADD COLUMN description_revision integer NOT NULL DEFAULT 0,
  ADD COLUMN description_updated_at timestamptz,
  ADD COLUMN description_updated_by uuid REFERENCES public.profiles(id);

-- Accept a bounded, inert rich-text schema, never HTML or arbitrary editor extensions.
CREATE FUNCTION katalist_priv.valid_description_node(n jsonb, depth integer DEFAULT 0)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE child jsonb; mark jsonb; kind text := n->>'type';
BEGIN
  IF depth > 20 OR jsonb_typeof(n) IS DISTINCT FROM 'object'
    OR kind IS NULL OR kind NOT IN ('doc','paragraph','text','hardBreak','bulletList','orderedList','listItem')
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(n) k WHERE k NOT IN ('type','content','text','marks','attrs')) THEN RETURN false; END IF;
  IF kind = 'text' THEN
    IF jsonb_typeof(n->'text') IS DISTINCT FROM 'string' OR n ? 'content' OR n ? 'attrs' THEN RETURN false; END IF;
  ELSIF n ? 'text' OR n ? 'marks' THEN RETURN false; END IF;
  IF n ? 'attrs' THEN
    IF kind <> 'orderedList' OR jsonb_typeof(n->'attrs') IS DISTINCT FROM 'object'
      OR EXISTS (SELECT 1 FROM jsonb_object_keys(n->'attrs') k WHERE k <> 'start')
      OR COALESCE(n->'attrs'->>'start','') !~ '^[1-9][0-9]{0,5}$' THEN RETURN false; END IF;
  END IF;
  IF n ? 'marks' THEN
    IF jsonb_typeof(n->'marks') IS DISTINCT FROM 'array' OR jsonb_array_length(n->'marks') > 3 THEN RETURN false; END IF;
    FOR mark IN SELECT value FROM jsonb_array_elements(n->'marks') LOOP
      IF jsonb_typeof(mark) IS DISTINCT FROM 'object' OR COALESCE(mark->>'type','') NOT IN ('bold','italic','link')
        OR EXISTS (SELECT 1 FROM jsonb_object_keys(mark) k WHERE k NOT IN ('type','attrs')) THEN RETURN false; END IF;
      IF mark->>'type' = 'link' THEN
        IF jsonb_typeof(mark->'attrs') IS DISTINCT FROM 'object'
          OR EXISTS (SELECT 1 FROM jsonb_object_keys(mark->'attrs') k WHERE k <> 'href')
          OR COALESCE(mark->'attrs'->>'href','') !~* '^https?://[^[:space:]<>"@]+$'
          OR length(mark->'attrs'->>'href') > 2048 THEN RETURN false; END IF;
      ELSIF mark ? 'attrs' THEN RETURN false; END IF;
    END LOOP;
  END IF;
  IF n ? 'content' THEN
    IF kind IN ('text','hardBreak') OR jsonb_typeof(n->'content') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
    FOR child IN SELECT value FROM jsonb_array_elements(n->'content') LOOP
      IF NOT katalist_priv.valid_description_node(child, depth + 1) THEN RETURN false; END IF;
    END LOOP;
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION katalist_priv.valid_description_node(jsonb,integer) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.set_thing_description(p_thing_id uuid, p_document jsonb, p_expected_revision integer)
RETURNS public.things LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv AS $$
DECLARE t public.things; actor uuid := katalist_priv.current_actor_id();
BEGIN
  IF auth.uid() IS NULL OR actor IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO t FROM public.things WHERE id=p_thing_id FOR UPDATE;
  IF NOT FOUND OR NOT katalist_priv.can_view_thing(p_thing_id) THEN RAISE EXCEPTION 'Thing not found'; END IF;
  IF t.owner_actor_id IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Only the current Thing owner can edit the description'; END IF;
  IF p_expected_revision IS DISTINCT FROM t.description_revision THEN
    RAISE EXCEPTION 'Description changed in another session. Reload the saved description before editing again.';
  END IF;
  IF p_document IS NOT NULL AND (octet_length(p_document::text) > 50000
      OR p_document->>'type' IS DISTINCT FROM 'doc'
      OR NOT katalist_priv.valid_description_node(p_document)) THEN RAISE EXCEPTION 'Invalid description document'; END IF;
  -- NULL is an explicitly cleared description; revision distinguishes it from legacy notes.
  UPDATE public.things SET description_document=p_document, description_revision=description_revision+1,
    description_updated_at=clock_timestamp(), description_updated_by=auth.uid()
    WHERE id=p_thing_id RETURNING * INTO t;
  PERFORM katalist_priv.log_activity(p_thing_id, actor, 'description_updated', '{}'::jsonb);
  RETURN t;
END $$;
REVOKE ALL ON FUNCTION public.set_thing_description(uuid,jsonb,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_thing_description(uuid,jsonb,integer) TO authenticated;
NOTIFY pgrst, 'reload schema';
