-- Pinned messages and pinned files (Team Hub / List chat).
--
-- hub_files already has a generic owner-or-collaborator UPDATE policy (see
-- 20260918210000_team_hub.sql), the same one rename/move/remove already use
-- via direct client .update() — so pinning a file needs no new RPC, just the
-- column.
--
-- list_messages' UPDATE policy is author-only ("list messages edited by
-- author"), but pinning must work on *anyone's* message, not just your own —
-- that's the point of a shared pin. So messages get two SECURITY DEFINER
-- RPCs, mirroring create_list_meeting's owner-or-collaborator permission
-- check instead of a direct-update policy.

ALTER TABLE public.list_messages ADD COLUMN IF NOT EXISTS pinned_at timestamptz;
ALTER TABLE public.hub_files ADD COLUMN IF NOT EXISTS pinned_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_list_messages_pinned
  ON public.list_messages (list_id, pinned_at DESC)
  WHERE pinned_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_hub_files_pinned
  ON public.hub_files (list_id, pinned_at DESC)
  WHERE pinned_at IS NOT NULL;

-- Pin/unpin a message. Owner or collaborator only (not view_only) — anyone
-- who can write to the conversation can curate what stays pinned.
CREATE OR REPLACE FUNCTION public.pin_list_message(p_message_id uuid, p_pinned boolean)
RETURNS public.list_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_me   uuid := auth.uid();
  v_row  public.list_messages;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_row FROM public.list_messages WHERE id = p_message_id AND deleted_at IS NULL;
  IF v_row.id IS NULL OR NOT katalist_priv.can_view_list(v_row.list_id) THEN
    RAISE EXCEPTION 'Message not found';
  END IF;
  IF NOT (
    katalist_priv.is_list_owner(v_row.list_id)
    OR katalist_priv.is_list_member(v_row.list_id, ARRAY['collaborator']::public.list_role[])
  ) THEN
    RAISE EXCEPTION 'You don''t have permission to pin messages in this conversation.';
  END IF;

  UPDATE public.list_messages
  SET pinned_at = CASE WHEN p_pinned THEN now() ELSE NULL END
  WHERE id = p_message_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pin_list_message(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pin_list_message(uuid, boolean) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
