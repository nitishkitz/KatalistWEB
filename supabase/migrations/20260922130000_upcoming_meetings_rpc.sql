-- Cross-list "my upcoming meetings" — backs the global in-app call reminder
-- (AppShell). create_list_meeting/cancel_list_meeting (20260921120000) are
-- per-list; there was no query for "every meeting I can see, across every
-- list/conversation I belong to" until now.

CREATE OR REPLACE FUNCTION public.get_my_upcoming_meetings(p_within_hours integer DEFAULT 24)
RETURNS TABLE (
  id uuid,
  list_id uuid,
  list_kind text,
  list_name text,
  title text,
  starts_at timestamptz,
  ends_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
  SELECT m.id, m.list_id, l.kind, l.name, m.title, m.starts_at, m.ends_at
  FROM public.list_meetings m
  JOIN public.lists l ON l.id = m.list_id
  WHERE m.cancelled_at IS NULL
    AND m.ends_at > now()
    AND m.starts_at <= now() + make_interval(hours => greatest(p_within_hours, 0))
    AND katalist_priv.can_view_list(m.list_id)
  ORDER BY m.starts_at ASC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_upcoming_meetings(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_upcoming_meetings(integer) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
