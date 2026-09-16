-- Timed personal Snooze for Court Things.
-- June BRD v1.1, Home Court: "Swipe left triggers 'SNOOZE' (defer)."
-- The interval is chosen by the user (1 hr / 6 hr / next day); the Thing is
-- hidden from the snoozer's Court until snoozed_until passes.
--
-- Mirrors doorman_state: strictly private, per-profile, and it NEVER mutates the
-- shared Thing. This is deliberately distinct from snooze_breakthrough, which
-- remains exclusive to Doorman.

CREATE TABLE public.thing_snooze (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  thing_id uuid NOT NULL REFERENCES public.things(id) ON DELETE CASCADE,
  snoozed_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, thing_id)
);

GRANT SELECT ON public.thing_snooze TO authenticated;
GRANT ALL ON public.thing_snooze TO service_role;
ALTER TABLE public.thing_snooze ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own thing snooze is readable"
  ON public.thing_snooze FOR SELECT TO authenticated
  USING (profile_id = auth.uid());

CREATE INDEX idx_thing_snooze_profile ON public.thing_snooze (profile_id, snoozed_until);

CREATE TRIGGER trg_thing_snooze_updated_at
  BEFORE UPDATE ON public.thing_snooze
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Snooze a Thing privately until a future time.
CREATE OR REPLACE FUNCTION public.snooze_thing(p_thing_id uuid, p_snoozed_until timestamptz)
RETURNS public.thing_snooze
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_me    uuid := auth.uid();
  v_state public.thing_snooze;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT katalist_priv.can_view_thing(p_thing_id) THEN
    RAISE EXCEPTION 'Thing not found';
  END IF;
  IF p_snoozed_until IS NULL OR p_snoozed_until <= now() THEN
    RAISE EXCEPTION 'snooze must be in the future';
  END IF;

  INSERT INTO public.thing_snooze (profile_id, thing_id, snoozed_until)
  VALUES (v_me, p_thing_id, p_snoozed_until)
  ON CONFLICT (profile_id, thing_id)
  DO UPDATE SET snoozed_until = EXCLUDED.snoozed_until
  RETURNING * INTO v_state;

  RETURN v_state;
END;
$$;

-- Wake a Thing early (clear the snooze).
CREATE OR REPLACE FUNCTION public.unsnooze_thing(p_thing_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  DELETE FROM public.thing_snooze WHERE profile_id = v_me AND thing_id = p_thing_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.snooze_thing(uuid, timestamptz) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.unsnooze_thing(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.snooze_thing(uuid, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unsnooze_thing(uuid) TO authenticated, service_role;
