-- Forward-only: Bridge guest read includes Owner Importance (read-only).
-- RETURNS TABLE change requires DROP + CREATE.

DROP FUNCTION IF EXISTS public.bridge_get_thing(text);

CREATE FUNCTION public.bridge_get_thing(p_session_token text)
RETURNS TABLE(
  id uuid,
  title text,
  notes text,
  due_at timestamptz,
  due_has_time boolean,
  acknowledgement public.acknowledgement_state,
  work_status public.work_status,
  owner_name text,
  owner_importance public.importance
)
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
           COALESCE(p.display_name, 'Katalist user'),
           t.owner_importance
      FROM public.things t
      LEFT JOIN public.actors  a ON a.id = t.owner_actor_id
      LEFT JOIN public.profiles p ON p.id = a.profile_id
     WHERE t.id = v_grant.thing_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bridge_get_thing(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bridge_get_thing(text) TO service_role;
