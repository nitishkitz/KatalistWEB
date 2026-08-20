-- Forward-only: Owner handoff to someone outside Katalist is one transaction.
-- create_external_actor + reassign_thing + issue_bridge_grant on the SAME Thing.
-- Existing primitives are unchanged. No List membership. No second Thing.

CREATE OR REPLACE FUNCTION public.assign_outside_katalist(
  p_thing_id uuid,
  p_display_name text,
  p_phone_e164 text DEFAULT NULL,
  p_email text DEFAULT NULL
)
RETURNS TABLE(
  actor_id uuid,
  token text,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv
AS $$
DECLARE
  v_me      uuid := katalist_priv.current_actor_id();
  v_thing   public.things;
  v_actor   public.actors;
  v_token   text;
  v_expires timestamptz;
BEGIN
  IF v_me IS NULL OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_display_name IS NULL OR length(btrim(p_display_name)) = 0 THEN
    RAISE EXCEPTION 'a display name is required';
  END IF;
  IF num_nonnulls(
       NULLIF(btrim(COALESCE(p_phone_e164, '')), ''),
       NULLIF(btrim(COALESCE(p_email, '')), '')
     ) = 0 THEN
    RAISE EXCEPTION 'a phone number or an email is required';
  END IF;

  SELECT * INTO v_thing FROM public.things WHERE id = p_thing_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Thing not found';
  END IF;
  IF v_thing.owner_actor_id <> v_me THEN
    RAISE EXCEPTION 'only the Thing Owner can assign outside Katalist';
  END IF;
  IF v_thing.work_status IN ('sorted', 'cancelled') THEN
    RAISE EXCEPTION 'a % Thing cannot be assigned outside Katalist', v_thing.work_status;
  END IF;

  SELECT * INTO v_actor
    FROM public.create_external_actor(btrim(p_display_name), p_phone_e164, p_email);
  IF v_actor.id IS NULL THEN
    RAISE EXCEPTION 'Couldn’t create that external person.';
  END IF;

  PERFORM public.reassign_thing(p_thing_id, v_actor.id);

  SELECT g.token, g.expires_at
    INTO v_token, v_expires
    FROM public.issue_bridge_grant(p_thing_id) AS g;
  IF v_token IS NULL THEN
    RAISE EXCEPTION 'Couldn’t open a Bridge for this Thing.';
  END IF;

  RETURN QUERY SELECT v_actor.id, v_token, v_expires;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assign_outside_katalist(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_outside_katalist(uuid, text, text, text) TO authenticated, service_role;
