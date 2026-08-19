CREATE OR REPLACE FUNCTION public.bridge_redeem_token(p_token text)
RETURNS TABLE(session_token text, expires_at timestamp with time zone, thing_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $function$
DECLARE
  v_grant   public.bridge_grants;
  v_thing   public.things;
  v_session text;
  v_expires timestamptz;
BEGIN
  SELECT g.* INTO v_grant
    FROM public.bridge_grants g
   WHERE g.token_hash = katalist_priv.hash_token(p_token)
     AND g.revoked_at IS NULL
     AND g.expires_at > now();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'this link is no longer active';
  END IF;

  SELECT t.* INTO v_thing FROM public.things t WHERE t.id = v_grant.thing_id;
  IF NOT FOUND
     OR v_thing.current_assignment_id IS DISTINCT FROM v_grant.assignment_id
     OR v_thing.current_assignee_actor_id <> v_grant.actor_id
     OR v_thing.work_status IN ('sorted','cancelled') THEN
    RAISE EXCEPTION 'this link is no longer active';
  END IF;

  v_session := katalist_priv.new_token();
  v_expires := now() + make_interval(mins => katalist_priv.config_int('bridge_session_ttl_minutes', 120));

  INSERT INTO public.bridge_sessions (grant_id, session_hash, expires_at)
  VALUES (v_grant.id, katalist_priv.hash_token(v_session), v_expires);

  UPDATE public.bridge_grants g
     SET first_used_at = COALESCE(g.first_used_at, now())
   WHERE g.id = v_grant.id;

  RETURN QUERY SELECT v_session, v_expires, v_grant.thing_id;
END;
$function$;