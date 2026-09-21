-- List Meetings — "Schedule Meeting" / "Upcoming Meetings" (Figma parity).
-- Keyed by list_id, so this works for both ordinary task Lists and Team-Hub
-- conversations alike (a DM/group is itself a row in `public.lists` with
-- kind='dm'/'group' — see 20260918210000_team_hub.sql). No separate model
-- needed for the two surfaces.

CREATE TABLE IF NOT EXISTS public.list_meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  title text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT list_meetings_title_not_blank CHECK (length(btrim(title)) > 0),
  CONSTRAINT list_meetings_time_order CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_list_meetings_list_starts
  ON public.list_meetings (list_id, starts_at)
  WHERE cancelled_at IS NULL;

DROP TRIGGER IF EXISTS trg_list_meetings_updated_at ON public.list_meetings;
CREATE TRIGGER trg_list_meetings_updated_at BEFORE UPDATE ON public.list_meetings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT ON public.list_meetings TO authenticated;
GRANT ALL ON public.list_meetings TO service_role;

ALTER TABLE public.list_meetings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "list meetings visible to list viewers" ON public.list_meetings;
CREATE POLICY "list meetings visible to list viewers" ON public.list_meetings
  FOR SELECT TO authenticated USING (katalist_priv.can_view_list(list_id));

-- Writes happen only through the RPCs below (SECURITY DEFINER), so no
-- direct INSERT/UPDATE policy is needed — mirrors thing_snooze/hub_files.

-- Schedule a meeting. Owner or collaborator only (not view_only).
CREATE OR REPLACE FUNCTION public.create_list_meeting(
  p_list_id uuid,
  p_title text,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
RETURNS public.list_meetings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_me   uuid := auth.uid();
  v_row  public.list_meetings;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT katalist_priv.can_view_list(p_list_id) THEN
    RAISE EXCEPTION 'List not found';
  END IF;
  IF NOT (
    katalist_priv.is_list_owner(p_list_id)
    OR katalist_priv.is_list_member(p_list_id, ARRAY['collaborator']::public.list_role[])
  ) THEN
    RAISE EXCEPTION 'You don''t have permission to schedule a meeting on this list.';
  END IF;
  IF p_title IS NULL OR length(btrim(p_title)) = 0 THEN
    RAISE EXCEPTION 'A meeting needs a title.';
  END IF;
  IF p_starts_at IS NULL OR p_ends_at IS NULL OR p_ends_at <= p_starts_at THEN
    RAISE EXCEPTION 'A meeting needs a valid start and end time.';
  END IF;

  INSERT INTO public.list_meetings (list_id, title, starts_at, ends_at, created_by)
  VALUES (p_list_id, btrim(p_title), p_starts_at, p_ends_at, v_me)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_list_meeting(uuid, text, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_list_meeting(uuid, text, timestamptz, timestamptz) TO authenticated, service_role;

-- Cancel a meeting. The creator or the list owner may cancel.
CREATE OR REPLACE FUNCTION public.cancel_list_meeting(p_meeting_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_me   uuid := auth.uid();
  v_row  public.list_meetings;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_row FROM public.list_meetings WHERE id = p_meeting_id;
  IF v_row.id IS NULL OR NOT katalist_priv.can_view_list(v_row.list_id) THEN
    RAISE EXCEPTION 'Meeting not found';
  END IF;
  IF v_row.created_by <> v_me AND NOT katalist_priv.is_list_owner(v_row.list_id) THEN
    RAISE EXCEPTION 'Only the organizer or list owner can cancel this meeting.';
  END IF;

  UPDATE public.list_meetings SET cancelled_at = now() WHERE id = p_meeting_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_list_meeting(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_list_meeting(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
