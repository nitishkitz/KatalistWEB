-- A user's browser cannot read auth.sessions directly. These narrowly scoped
-- RPCs expose only that user's active session metadata and allow revoking one
-- of their other sessions. Supabase manages the auth schema; review this
-- migration against the project's Auth version before applying it remotely.

CREATE OR REPLACE FUNCTION public.list_my_sessions()
RETURNS TABLE (
  id uuid,
  user_agent text,
  created_at timestamptz,
  last_used_at timestamptz,
  is_current boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
  SELECT
    s.id,
    s.user_agent,
    s.created_at,
    COALESCE(s.refreshed_at AT TIME ZONE 'UTC', s.updated_at, s.created_at),
    s.id = NULLIF(auth.jwt() ->> 'session_id', '')::uuid
  FROM auth.sessions AS s
  WHERE s.user_id = auth.uid()
    AND (s.not_after IS NULL OR s.not_after > statement_timestamp())
  ORDER BY COALESCE(s.refreshed_at AT TIME ZONE 'UTC', s.updated_at, s.created_at) DESC NULLS LAST;
$$;

REVOKE ALL ON FUNCTION public.list_my_sessions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_sessions() TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_my_session(p_session_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_current_session_id uuid := NULLIF(auth.jwt() ->> 'session_id', '')::uuid;
  v_deleted_session_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'Session id is required' USING ERRCODE = '22023';
  END IF;

  IF p_session_id = v_current_session_id THEN
    RAISE EXCEPTION 'You cannot revoke the session you are using' USING ERRCODE = '22023';
  END IF;

  DELETE FROM auth.sessions AS s
  WHERE s.id = p_session_id
    AND s.user_id = v_user_id
    AND (s.not_after IS NULL OR s.not_after > statement_timestamp())
  RETURNING s.id INTO v_deleted_session_id;

  IF v_deleted_session_id IS NULL THEN
    RETURN false;
  END IF;

  -- auth.refresh_tokens has no cascading FK to auth.sessions in the linked
  -- project, so remove only tokens associated with this owned session.
  DELETE FROM auth.refresh_tokens AS rt
  WHERE rt.session_id = v_deleted_session_id
    AND rt.user_id = v_user_id::text;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_my_session(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_my_session(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
