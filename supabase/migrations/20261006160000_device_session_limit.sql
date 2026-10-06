-- Limit each account to two signed-in devices. Called by the client right
-- after a new sign-in: the current session always survives, and only the
-- (p_max - 1) most recently used other sessions are kept. Older sessions and
-- their refresh tokens are removed, so those devices must sign in again.
CREATE OR REPLACE FUNCTION public.enforce_device_limit(p_max integer DEFAULT 2)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_current uuid := NULLIF(auth.jwt() ->> 'session_id', '')::uuid;
  v_keep    integer := GREATEST(COALESCE(p_max, 2), 1) - 1;
  v_removed uuid[];
BEGIN
  IF v_user_id IS NULL OR v_current IS NULL THEN
    RETURN 0;
  END IF;

  WITH ranked AS (
    SELECT s.id,
           row_number() OVER (
             ORDER BY COALESCE(s.refreshed_at AT TIME ZONE 'UTC', s.updated_at, s.created_at) DESC NULLS LAST
           ) AS position
      FROM auth.sessions AS s
     WHERE s.user_id = v_user_id
       AND s.id <> v_current
       AND (s.not_after IS NULL OR s.not_after > statement_timestamp())
  ), doomed AS (
    DELETE FROM auth.sessions AS s
     USING ranked r
     WHERE s.id = r.id AND r.position > v_keep
    RETURNING s.id
  )
  SELECT COALESCE(array_agg(id), '{}') INTO v_removed FROM doomed;

  DELETE FROM auth.refresh_tokens AS rt
   WHERE rt.session_id = ANY (v_removed)
     AND rt.user_id = v_user_id::text;

  RETURN COALESCE(array_length(v_removed, 1), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_device_limit(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enforce_device_limit(integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
