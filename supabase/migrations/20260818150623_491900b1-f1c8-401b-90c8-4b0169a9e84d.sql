-- Phase 8: Bridge

CREATE TABLE public.bridge_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thing_id uuid NOT NULL REFERENCES public.things(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL REFERENCES public.thing_assignments(id),
  actor_id uuid NOT NULL REFERENCES public.actors(id),
  issued_by_actor_id uuid NOT NULL REFERENCES public.actors(id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  first_used_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.bridge_grants TO service_role;
ALTER TABLE public.bridge_grants ENABLE ROW LEVEL SECURITY;
-- Deliberately no policy for anon/authenticated: reachable only through RPCs.

CREATE INDEX idx_bridge_grants_thing ON public.bridge_grants (thing_id, created_at DESC);
CREATE INDEX idx_bridge_grants_assignment ON public.bridge_grants (assignment_id) WHERE revoked_at IS NULL;

CREATE TABLE public.bridge_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id uuid NOT NULL REFERENCES public.bridge_grants(id) ON DELETE CASCADE,
  session_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.bridge_sessions TO service_role;
ALTER TABLE public.bridge_sessions ENABLE ROW LEVEL SECURITY;
-- Deliberately no policy for anon/authenticated.

CREATE INDEX idx_bridge_sessions_grant ON public.bridge_sessions (grant_id) WHERE revoked_at IS NULL;

-- One-way fingerprint for any bridge secret.
CREATE OR REPLACE FUNCTION katalist_priv.hash_token(_token text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $$
  SELECT encode(extensions.digest(convert_to(_token, 'UTF8'), 'sha256'), 'hex');
$$;
REVOKE EXECUTE ON FUNCTION katalist_priv.hash_token(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION katalist_priv.new_token()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $$
  SELECT encode(extensions.gen_random_bytes(32), 'hex');
$$;
REVOKE EXECUTE ON FUNCTION katalist_priv.new_token() FROM PUBLIC, anon, authenticated;

-- Real revocation (replaces the Phase 4 placeholder).
CREATE OR REPLACE FUNCTION katalist_priv.revoke_bridge_for_assignment(_assignment_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
BEGIN
  IF _assignment_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.bridge_sessions s
     SET revoked_at = now()
   WHERE s.revoked_at IS NULL
     AND s.grant_id IN (SELECT g.id FROM public.bridge_grants g WHERE g.assignment_id = _assignment_id);

  UPDATE public.bridge_grants g
     SET revoked_at = now(), revoked_reason = COALESCE(_reason, 'revoked')
   WHERE g.assignment_id = _assignment_id AND g.revoked_at IS NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION katalist_priv.revoke_bridge_for_assignment(uuid, text) FROM PUBLIC, anon, authenticated;

-- Create a guest person + stand-in participant, so a Thing can be handed outside Katalist.
CREATE OR REPLACE FUNCTION public.create_external_actor(
  p_display_name text,
  p_phone_e164 text DEFAULT NULL,
  p_email text DEFAULT NULL
)
RETURNS public.actors
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_identity public.external_identities;
  v_actor    public.actors;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF num_nonnulls(NULLIF(btrim(COALESCE(p_phone_e164,'')), ''),
                  NULLIF(btrim(COALESCE(p_email,'')), '')) = 0 THEN
    RAISE EXCEPTION 'a phone number or an email is required';
  END IF;

  INSERT INTO public.external_identities (phone_e164, email, display_name)
  VALUES (NULLIF(btrim(COALESCE(p_phone_e164,'')), ''),
          NULLIF(btrim(COALESCE(p_email,'')), ''),
          COALESCE(NULLIF(btrim(COALESCE(p_display_name,'')), ''), 'Guest'))
  RETURNING * INTO v_identity;

  INSERT INTO public.actors (kind, external_identity_id)
  VALUES ('external', v_identity.id)
  RETURNING * INTO v_actor;

  RETURN v_actor;
END;
$$;

-- Issue a magic-link grant for the guest currently holding the Thing.
CREATE OR REPLACE FUNCTION public.issue_bridge_grant(p_thing_id uuid)
RETURNS TABLE(grant_id uuid, token text, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_me      uuid := katalist_priv.current_actor_id();
  v_thing   public.things;
  v_token   text;
  v_expires timestamptz;
  v_grant   public.bridge_grants;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_thing FROM public.things WHERE id = p_thing_id;
  IF NOT FOUND OR NOT katalist_priv.can_view_thing(p_thing_id) THEN
    RAISE EXCEPTION 'Thing not found';
  END IF;
  IF v_thing.owner_actor_id <> v_me THEN
    RAISE EXCEPTION 'only the Thing Owner can open a Bridge';
  END IF;
  IF v_thing.work_status IN ('sorted','cancelled') THEN
    RAISE EXCEPTION 'a % Thing cannot open a Bridge', v_thing.work_status;
  END IF;
  IF NOT katalist_priv.actor_is_external(v_thing.current_assignee_actor_id) THEN
    RAISE EXCEPTION 'this Thing is held by a Katalist user — no Bridge is needed';
  END IF;

  -- One live grant per assignment.
  UPDATE public.bridge_sessions s SET revoked_at = now()
   WHERE s.revoked_at IS NULL
     AND s.grant_id IN (SELECT g.id FROM public.bridge_grants g
                         WHERE g.assignment_id = v_thing.current_assignment_id);
  UPDATE public.bridge_grants g
     SET revoked_at = now(), revoked_reason = 'reissued'
   WHERE g.assignment_id = v_thing.current_assignment_id AND g.revoked_at IS NULL;

  v_token := katalist_priv.new_token();
  v_expires := now() + make_interval(hours => katalist_priv.config_int('bridge_grant_ttl_hours', 336));

  INSERT INTO public.bridge_grants (
    thing_id, assignment_id, actor_id, issued_by_actor_id, token_hash, expires_at
  ) VALUES (
    p_thing_id, v_thing.current_assignment_id, v_thing.current_assignee_actor_id,
    v_me, katalist_priv.hash_token(v_token), v_expires
  )
  RETURNING * INTO v_grant;

  PERFORM katalist_priv.log_activity(p_thing_id, v_me, 'bridge_opened',
    jsonb_build_object('expires_at', v_expires));

  RETURN QUERY SELECT v_grant.id, v_token, v_grant.expires_at;
END;
$$;

-- Owner-visible grant status (never exposes the fingerprint).
CREATE OR REPLACE FUNCTION public.list_bridge_grants(p_thing_id uuid)
RETURNS TABLE(id uuid, actor_id uuid, expires_at timestamptz, first_used_at timestamptz,
              revoked_at timestamptz, revoked_reason text, created_at timestamptz)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
  SELECT g.id, g.actor_id, g.expires_at, g.first_used_at, g.revoked_at, g.revoked_reason, g.created_at
    FROM public.bridge_grants g
   WHERE g.thing_id = p_thing_id
     AND katalist_priv.is_thing_owner(p_thing_id)
   ORDER BY g.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.revoke_bridge_grant(p_grant_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_grant public.bridge_grants;
BEGIN
  SELECT * INTO v_grant FROM public.bridge_grants WHERE id = p_grant_id;
  IF NOT FOUND OR NOT katalist_priv.is_thing_owner(v_grant.thing_id) THEN
    RAISE EXCEPTION 'Bridge link not found';
  END IF;
  IF v_grant.revoked_at IS NOT NULL THEN
    RETURN false;
  END IF;

  UPDATE public.bridge_sessions SET revoked_at = now()
   WHERE grant_id = p_grant_id AND revoked_at IS NULL;
  UPDATE public.bridge_grants
     SET revoked_at = now(), revoked_reason = 'revoked_by_owner'
   WHERE id = p_grant_id;

  PERFORM katalist_priv.log_activity(v_grant.thing_id, katalist_priv.current_actor_id(),
    'bridge_revoked', jsonb_build_object('grant_id', p_grant_id));
  RETURN true;
END;
$$;

-- ---------- Guest side: called only by the trusted server route (service_role) ----------

CREATE OR REPLACE FUNCTION katalist_priv.bridge_session_grant(_session_token text)
RETURNS public.bridge_grants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_grant public.bridge_grants;
BEGIN
  SELECT g.* INTO v_grant
    FROM public.bridge_sessions s
    JOIN public.bridge_grants g ON g.id = s.grant_id
   WHERE s.session_hash = katalist_priv.hash_token(_session_token)
     AND s.revoked_at IS NULL
     AND s.expires_at > now()
     AND g.revoked_at IS NULL
     AND g.expires_at > now();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'this link is no longer active';
  END IF;

  UPDATE public.bridge_sessions
     SET last_seen_at = now()
   WHERE session_hash = katalist_priv.hash_token(_session_token);

  RETURN v_grant;
END;
$$;
REVOKE EXECUTE ON FUNCTION katalist_priv.bridge_session_grant(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bridge_redeem_token(p_token text)
RETURNS TABLE(session_token text, expires_at timestamptz, thing_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_grant   public.bridge_grants;
  v_session text;
  v_expires timestamptz;
BEGIN
  SELECT * INTO v_grant
    FROM public.bridge_grants
   WHERE token_hash = katalist_priv.hash_token(p_token)
     AND revoked_at IS NULL
     AND expires_at > now();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'this link is no longer active';
  END IF;

  v_session := katalist_priv.new_token();
  v_expires := now() + make_interval(mins => katalist_priv.config_int('bridge_session_ttl_minutes', 120));

  INSERT INTO public.bridge_sessions (grant_id, session_hash, expires_at)
  VALUES (v_grant.id, katalist_priv.hash_token(v_session), v_expires);

  UPDATE public.bridge_grants
     SET first_used_at = COALESCE(first_used_at, now())
   WHERE id = v_grant.id;

  RETURN QUERY SELECT v_session, v_expires, v_grant.thing_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.bridge_get_thing(p_session_token text)
RETURNS TABLE(id uuid, title text, notes text, due_at timestamptz, due_has_time boolean,
              acknowledgement public.acknowledgement_state, work_status public.work_status,
              owner_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_grant public.bridge_grants := katalist_priv.bridge_session_grant(p_session_token);
BEGIN
  RETURN QUERY
    SELECT t.id, t.title, t.notes, t.due_at, t.due_has_time,
           t.acknowledgement, t.work_status,
           COALESCE(p.display_name, 'Katalist user')
      FROM public.things t
      LEFT JOIN public.actors  a ON a.id = t.owner_actor_id
      LEFT JOIN public.profiles p ON p.id = a.profile_id
     WHERE t.id = v_grant.thing_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.bridge_act(p_session_token text, p_action text)
RETURNS public.work_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_grant public.bridge_grants := katalist_priv.bridge_session_grant(p_session_token);
  v_thing public.things;
BEGIN
  SELECT * INTO v_thing FROM public.things WHERE id = v_grant.thing_id FOR UPDATE;
  IF v_thing.current_assignee_actor_id <> v_grant.actor_id THEN
    RAISE EXCEPTION 'this link is no longer active';
  END IF;
  IF v_thing.work_status IN ('sorted','cancelled') THEN
    RAISE EXCEPTION 'this Thing is already %', v_thing.work_status;
  END IF;

  IF p_action = 'catch' THEN
    IF v_thing.acknowledgement <> 'caught' THEN
      UPDATE public.things
         SET acknowledgement = 'caught', caught_at = now()
       WHERE id = v_thing.id RETURNING * INTO v_thing;
      UPDATE public.thing_assignments
         SET acknowledgement = 'caught', caught_at = now()
       WHERE id = v_thing.current_assignment_id;
      PERFORM katalist_priv.log_activity(v_thing.id, v_grant.actor_id, 'caught',
        jsonb_build_object('via', 'bridge'));
    END IF;

  ELSIF p_action IN ('not_started','under_progress') THEN
    IF v_thing.acknowledgement <> 'caught' THEN
      RAISE EXCEPTION 'Catch the Thing before changing its status';
    END IF;
    UPDATE public.things SET work_status = p_action::public.work_status
     WHERE id = v_thing.id RETURNING * INTO v_thing;
    PERFORM katalist_priv.log_activity(v_thing.id, v_grant.actor_id, 'work_status_changed',
      jsonb_build_object('work_status', p_action, 'via', 'bridge'));

  ELSIF p_action = 'sorted' THEN
    IF v_thing.acknowledgement <> 'caught' THEN
      RAISE EXCEPTION 'Catch the Thing before marking it Sorted';
    END IF;
    UPDATE public.things SET work_status = 'sorted', sorted_at = now()
     WHERE id = v_thing.id RETURNING * INTO v_thing;
    UPDATE public.thing_assignments
       SET ended_at = now(), ended_reason = 'sorted'
     WHERE id = v_thing.current_assignment_id AND ended_at IS NULL;
    PERFORM katalist_priv.log_activity(v_thing.id, v_grant.actor_id, 'sorted',
      jsonb_build_object('via', 'bridge'));
    PERFORM katalist_priv.revoke_bridge_for_assignment(v_thing.current_assignment_id, 'sorted');

  ELSE
    RAISE EXCEPTION 'unsupported action';
  END IF;

  RETURN v_thing.work_status;
END;
$$;

-- Grants: owner-side RPCs to signed-in users; guest-side RPCs to the trusted server only.
REVOKE EXECUTE ON FUNCTION public.create_external_actor(text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.issue_bridge_grant(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_bridge_grants(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.revoke_bridge_grant(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_external_actor(text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_bridge_grant(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_bridge_grants(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_bridge_grant(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.bridge_redeem_token(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bridge_get_thing(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bridge_act(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bridge_redeem_token(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.bridge_get_thing(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.bridge_act(text, text) TO service_role;