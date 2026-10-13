-- Explicit, consent-based connections (Coey rebuild P2/P3).
--
-- * Either person may request; only the current recipient's explicit Accept
--   connects them. A reciprocal send never auto-accepts; it returns the one
--   pending request so the recipient sees Accept / Decline.
-- * Google Contacts is no longer a discovery condition and its tables go.
-- * One canonical request row per pair; katalist_priv.team_connections stays
--   the accepted-pair table every other feature already reads.
-- * Delegation and DMs/groups require an accepted, unblocked connection,
--   enforced by triggers so every RPC (old and new signatures) is covered.
-- * Accepting a List invitation grants List membership only, not a connection.

-- 1. Remove Google Contacts.
DROP FUNCTION IF EXISTS public.sync_google_contact_matches(uuid, jsonb);
DROP TABLE IF EXISTS public.google_contact_matches;
DROP TABLE IF EXISTS public.google_contact_syncs;

-- 2. Canonical request state.
ALTER TABLE public.contact_requests DROP CONSTRAINT IF EXISTS contact_requests_status_check;
ALTER TABLE public.contact_requests
  ADD CONSTRAINT contact_requests_status_check
  CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'disconnected'));

-- Keep the newest row per unordered pair before enforcing one row per pair.
DELETE FROM public.contact_requests r
 USING public.contact_requests newer
 WHERE least(r.requester_profile_id, r.addressee_profile_id) = least(newer.requester_profile_id, newer.addressee_profile_id)
   AND greatest(r.requester_profile_id, r.addressee_profile_id) = greatest(newer.requester_profile_id, newer.addressee_profile_id)
   AND (r.created_at, r.id) < (newer.created_at, newer.id);

CREATE UNIQUE INDEX IF NOT EXISTS contact_requests_one_per_pair
  ON public.contact_requests (least(requester_profile_id, addressee_profile_id), greatest(requester_profile_id, addressee_profile_id));

CREATE TABLE IF NOT EXISTS katalist_priv.connection_blocks (
  blocker_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (blocker_profile_id, blocked_profile_id),
  CONSTRAINT connection_blocks_not_self CHECK (blocker_profile_id <> blocked_profile_id)
);
REVOKE ALL ON katalist_priv.connection_blocks FROM PUBLIC, anon, authenticated;

-- 3. Helpers.
CREATE OR REPLACE FUNCTION katalist_priv.is_blocked_between(p_a uuid, p_b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM katalist_priv.connection_blocks b
     WHERE (b.blocker_profile_id = p_a AND b.blocked_profile_id = p_b)
        OR (b.blocker_profile_id = p_b AND b.blocked_profile_id = p_a)
  );
$$;

CREATE OR REPLACE FUNCTION katalist_priv.are_connected(p_a uuid, p_b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
  SELECT p_a IS NOT NULL AND p_b IS NOT NULL AND p_a <> p_b
     AND EXISTS (
       SELECT 1 FROM katalist_priv.team_connections c
        WHERE c.profile_a_id = least(p_a, p_b) AND c.profile_b_id = greatest(p_a, p_b)
     )
     AND NOT katalist_priv.is_blocked_between(p_a, p_b);
$$;

CREATE OR REPLACE FUNCTION katalist_priv.resolve_profile_id(p_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
  SELECT COALESCE(
    (SELECT p.id FROM public.profiles p WHERE p.id = p_id),
    (SELECT a.profile_id FROM public.actors a WHERE a.id = p_id)
  );
$$;

REVOKE ALL ON FUNCTION katalist_priv.is_blocked_between(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION katalist_priv.are_connected(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION katalist_priv.resolve_profile_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION katalist_priv.are_connected(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION katalist_priv.is_blocked_between(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION katalist_priv.resolve_profile_id(uuid) TO authenticated, service_role;

-- 4. Request lifecycle.
CREATE OR REPLACE FUNCTION public.send_contact_request(p_addressee_profile_id uuid)
RETURNS public.contact_requests
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $function$
DECLARE
  v_me    uuid := auth.uid();
  v_other uuid := katalist_priv.resolve_profile_id(p_addressee_profile_id);
  v_row   public.contact_requests;
  v_name  text;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF v_other IS NULL THEN RAISE EXCEPTION 'unknown person'; END IF;
  IF v_other = v_me THEN RAISE EXCEPTION 'pick another person'; END IF;
  -- A block is never revealed; the request is simply not available.
  IF katalist_priv.is_blocked_between(v_me, v_other) THEN RAISE EXCEPTION 'this person cannot be added right now'; END IF;
  -- Serialise both directions of the same pair.
  PERFORM pg_advisory_xact_lock(hashtextextended(least(v_me, v_other)::text || greatest(v_me, v_other)::text, 0));

  SELECT * INTO v_row FROM public.contact_requests r
   WHERE least(r.requester_profile_id, r.addressee_profile_id) = least(v_me, v_other)
     AND greatest(r.requester_profile_id, r.addressee_profile_id) = greatest(v_me, v_other)
   FOR UPDATE;

  IF FOUND THEN
    -- Already connected, or one pending request already exists in either direction: idempotent.
    IF v_row.status = 'accepted' AND katalist_priv.are_connected(v_me, v_other) THEN RETURN v_row; END IF;
    IF v_row.status = 'pending' THEN RETURN v_row; END IF;
    UPDATE public.contact_requests
       SET requester_profile_id = v_me, addressee_profile_id = v_other, status = 'pending',
           created_at = clock_timestamp(), responded_at = NULL
     WHERE id = v_row.id
    RETURNING * INTO v_row;
  ELSE
    INSERT INTO public.contact_requests (requester_profile_id, addressee_profile_id, status)
    VALUES (v_me, v_other, 'pending')
    RETURNING * INTO v_row;
  END IF;

  SELECT display_name INTO v_name FROM public.profiles WHERE id = v_me;
  PERFORM katalist_priv.notify_profile(v_other, 'contact_request', 'New connection request',
    COALESCE(v_name, 'Someone') || ' wants to connect', v_me, NULL, NULL, '/team',
    jsonb_build_object('request_id', v_row.id));
  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.respond_contact_request(p_request_id uuid, p_accept boolean)
RETURNS public.contact_requests
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $function$
DECLARE
  v_me   uuid := auth.uid();
  v_row  public.contact_requests;
  v_name text;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO v_row FROM public.contact_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_me NOT IN (v_row.requester_profile_id, v_row.addressee_profile_id) THEN
    RAISE EXCEPTION 'that request is no longer pending';
  END IF;
  -- A repeated Accept by the recipient is harmless.
  IF v_row.status = 'accepted' AND v_row.addressee_profile_id = v_me AND p_accept THEN RETURN v_row; END IF;
  IF v_row.status <> 'pending' OR v_row.addressee_profile_id <> v_me THEN
    RAISE EXCEPTION 'that request is no longer pending';
  END IF;
  IF p_accept AND katalist_priv.is_blocked_between(v_row.requester_profile_id, v_me) THEN
    RAISE EXCEPTION 'that request is no longer pending';
  END IF;

  UPDATE public.contact_requests
     SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END, responded_at = clock_timestamp()
   WHERE id = p_request_id
  RETURNING * INTO v_row;

  IF p_accept THEN
    INSERT INTO katalist_priv.team_connections (profile_a_id, profile_b_id, created_by_profile_id)
    VALUES (least(v_row.requester_profile_id, v_me), greatest(v_row.requester_profile_id, v_me), v_me)
    ON CONFLICT DO NOTHING;
    SELECT display_name INTO v_name FROM public.profiles WHERE id = v_me;
    PERFORM katalist_priv.notify_profile(v_row.requester_profile_id, 'contact_request_accepted',
      'Connection accepted', COALESCE(v_name, 'Your contact') || ' accepted your request', v_me, NULL, NULL, '/team',
      jsonb_build_object('request_id', v_row.id));
  END IF;
  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_contact_request(p_request_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $function$
DECLARE v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  UPDATE public.contact_requests SET status = 'cancelled', responded_at = clock_timestamp()
   WHERE id = p_request_id AND requester_profile_id = v_me AND status = 'pending';
  RETURN FOUND;
END;
$function$;

-- Stops new direct interactions. Shared Lists, Things and history keep their
-- own membership rules; nothing is deleted.
CREATE OR REPLACE FUNCTION public.disconnect_contact(p_other_profile_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $function$
DECLARE
  v_me    uuid := auth.uid();
  v_other uuid := katalist_priv.resolve_profile_id(p_other_profile_id);
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF v_other IS NULL OR v_other = v_me THEN RAISE EXCEPTION 'unknown person'; END IF;
  DELETE FROM katalist_priv.team_connections
   WHERE profile_a_id = least(v_me, v_other) AND profile_b_id = greatest(v_me, v_other);
  UPDATE public.contact_requests SET status = 'disconnected', responded_at = clock_timestamp()
   WHERE least(requester_profile_id, addressee_profile_id) = least(v_me, v_other)
     AND greatest(requester_profile_id, addressee_profile_id) = greatest(v_me, v_other)
     AND status IN ('accepted', 'pending');
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.block_contact(p_other_profile_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $function$
DECLARE
  v_me    uuid := auth.uid();
  v_other uuid := katalist_priv.resolve_profile_id(p_other_profile_id);
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF v_other IS NULL OR v_other = v_me THEN RAISE EXCEPTION 'unknown person'; END IF;
  PERFORM public.disconnect_contact(v_other);
  INSERT INTO katalist_priv.connection_blocks (blocker_profile_id, blocked_profile_id)
  VALUES (v_me, v_other) ON CONFLICT DO NOTHING;
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.unblock_contact(p_other_profile_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $function$
DECLARE
  v_me    uuid := auth.uid();
  v_other uuid := katalist_priv.resolve_profile_id(p_other_profile_id);
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  DELETE FROM katalist_priv.connection_blocks WHERE blocker_profile_id = v_me AND blocked_profile_id = v_other;
  RETURN FOUND;
END;
$function$;

-- Own block list only.
CREATE OR REPLACE FUNCTION public.list_my_blocks()
RETURNS TABLE (profile_id uuid, display_name text, blocked_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
  SELECT b.blocked_profile_id, p.display_name, b.created_at
    FROM katalist_priv.connection_blocks b JOIN public.profiles p ON p.id = b.blocked_profile_id
   WHERE b.blocker_profile_id = auth.uid()
   ORDER BY b.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.disconnect_contact(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.block_contact(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unblock_contact(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_my_blocks() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.disconnect_contact(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.block_contact(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unblock_contact(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_my_blocks() TO authenticated, service_role;

-- 5. Close the legacy paths that bypassed consent.
--    Team requests duplicated contact requests and are unused by the app.
REVOKE EXECUTE ON FUNCTION public.request_team_connection(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.accept_team_request(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.remove_team_connection(uuid) FROM PUBLIC, anon, authenticated;
--    Outside-Katalist delivery (Bridge) is superseded (decision D10).
REVOKE EXECUTE ON FUNCTION public.assign_outside_katalist(uuid, text, text, text) FROM PUBLIC, anon, authenticated;

--    A List invitation grants List membership only.
CREATE OR REPLACE FUNCTION public.accept_list_invitation_server(p_token_hash bytea, p_accepting_profile_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv' AS $$
DECLARE v_invite katalist_priv.list_invitations; v_name text;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'server only'; END IF;
  SELECT * INTO v_invite FROM katalist_priv.list_invitations WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND OR v_invite.revoked_at IS NOT NULL OR v_invite.expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'invite is not available'; END IF;
  IF v_invite.accepted_at IS NOT NULL THEN RETURN v_invite.list_id; END IF;
  IF v_invite.invitee_profile_id IS NOT NULL AND v_invite.invitee_profile_id <> p_accepting_profile_id THEN RAISE EXCEPTION 'invite belongs to another person'; END IF;
  SELECT name INTO v_name FROM public.lists WHERE id = v_invite.list_id;
  IF v_invite.inviter_profile_id <> p_accepting_profile_id THEN
    INSERT INTO public.list_members(list_id, profile_id, role, added_by_profile_id)
    VALUES (v_invite.list_id, p_accepting_profile_id, v_invite.role, v_invite.inviter_profile_id)
    ON CONFLICT (list_id, profile_id) DO UPDATE SET role = excluded.role;
  END IF;
  UPDATE katalist_priv.list_invitations SET accepted_at = clock_timestamp(), accepted_by_profile_id = p_accepting_profile_id WHERE id = v_invite.id;
  PERFORM katalist_priv.notify_profile(v_invite.inviter_profile_id, 'list_invitation_accepted',
    COALESCE(v_name, 'List') || ' invitation accepted', 'Your invitation was accepted', p_accepting_profile_id,
    NULL, v_invite.list_id, '/lists/' || v_invite.list_id::text, jsonb_build_object('invitation_id', v_invite.id));
  PERFORM katalist_priv.notify_list_participants(v_invite.list_id, ARRAY[v_invite.inviter_profile_id, p_accepting_profile_id],
    'list_roster_changed', COALESCE(v_name, 'List') || ' members changed', 'A new member joined', p_accepting_profile_id,
    '/lists/' || v_invite.list_id::text, jsonb_build_object('change', 'accepted', 'profile_id', p_accepting_profile_id));
  RETURN v_invite.list_id;
END;
$$;

--    A Team invitation is a connection invitation: the invitee's acceptance is
--    their explicit consent. Record it in the canonical request row as well.
CREATE OR REPLACE FUNCTION public.accept_team_invitation_server(p_token_hash bytea, p_accepting_profile_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv' AS $$
DECLARE v_invite katalist_priv.team_invitations; v_name text; v_req uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'server only'; END IF;
  SELECT * INTO v_invite FROM katalist_priv.team_invitations WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND OR v_invite.revoked_at IS NOT NULL OR v_invite.expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'invite is not available'; END IF;
  IF v_invite.accepted_at IS NOT NULL THEN RETURN true; END IF;
  IF v_invite.inviter_profile_id = p_accepting_profile_id THEN RAISE EXCEPTION 'cannot invite yourself'; END IF;
  IF katalist_priv.is_blocked_between(v_invite.inviter_profile_id, p_accepting_profile_id) THEN RAISE EXCEPTION 'invite is not available'; END IF;
  INSERT INTO katalist_priv.team_connections(profile_a_id, profile_b_id, created_by_profile_id)
  VALUES (least(v_invite.inviter_profile_id, p_accepting_profile_id), greatest(v_invite.inviter_profile_id, p_accepting_profile_id), p_accepting_profile_id)
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_req FROM public.contact_requests r
   WHERE least(r.requester_profile_id, r.addressee_profile_id) = least(v_invite.inviter_profile_id, p_accepting_profile_id)
     AND greatest(r.requester_profile_id, r.addressee_profile_id) = greatest(v_invite.inviter_profile_id, p_accepting_profile_id);
  IF v_req IS NULL THEN
    INSERT INTO public.contact_requests (requester_profile_id, addressee_profile_id, status, responded_at)
    VALUES (v_invite.inviter_profile_id, p_accepting_profile_id, 'accepted', clock_timestamp());
  ELSE
    UPDATE public.contact_requests SET requester_profile_id = v_invite.inviter_profile_id, addressee_profile_id = p_accepting_profile_id,
      status = 'accepted', responded_at = clock_timestamp() WHERE id = v_req;
  END IF;
  UPDATE katalist_priv.team_invitations SET accepted_at = clock_timestamp(), accepted_by_profile_id = p_accepting_profile_id WHERE id = v_invite.id;
  SELECT display_name INTO v_name FROM public.profiles WHERE id = p_accepting_profile_id;
  PERFORM katalist_priv.notify_profile(v_invite.inviter_profile_id, 'team_invitation_accepted',
    'Team invitation accepted', COALESCE(v_name, 'Your contact') || ' joined your Team', p_accepting_profile_id,
    NULL, NULL, '/team', jsonb_build_object('invitation_id', v_invite.id));
  RETURN true;
END;
$$;

-- 6. Enforcement on every delegation path (create, reassign, hand on).
CREATE OR REPLACE FUNCTION katalist_priv.enforce_connected_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_assignee public.actors;
  v_by_profile uuid;
BEGIN
  SELECT * INTO v_assignee FROM public.actors WHERE id = NEW.assignee_actor_id;
  SELECT profile_id INTO v_by_profile FROM public.actors WHERE id = NEW.assigned_by_actor_id;
  IF v_assignee.kind = 'external' THEN
    RAISE EXCEPTION 'Things can only be sent to connected Katalist people' USING ERRCODE = '42501';
  END IF;
  IF v_assignee.profile_id IS NOT NULL AND v_by_profile IS NOT NULL AND v_assignee.profile_id <> v_by_profile
     AND NOT katalist_priv.are_connected(v_by_profile, v_assignee.profile_id) THEN
    RAISE EXCEPTION 'connect with this person before sending them a Thing' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_assignments_require_connection ON public.thing_assignments;
CREATE TRIGGER trg_assignments_require_connection
  BEFORE INSERT ON public.thing_assignments
  FOR EACH ROW EXECUTE FUNCTION katalist_priv.enforce_connected_assignment();

-- 7. Enforcement on direct messages and groups (calls ride on membership).
CREATE OR REPLACE FUNCTION katalist_priv.enforce_connected_conversation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE v_kind text;
BEGIN
  SELECT kind::text INTO v_kind FROM public.lists WHERE id = NEW.list_id;
  IF v_kind IN ('dm', 'group') AND NEW.added_by_profile_id IS NOT NULL AND NEW.profile_id <> NEW.added_by_profile_id
     AND NOT katalist_priv.are_connected(NEW.added_by_profile_id, NEW.profile_id) THEN
    RAISE EXCEPTION 'connect with this person before messaging them' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_conversation_members_require_connection ON public.list_members;
CREATE TRIGGER trg_conversation_members_require_connection
  BEFORE INSERT ON public.list_members
  FOR EACH ROW EXECUTE FUNCTION katalist_priv.enforce_connected_conversation();

REVOKE ALL ON FUNCTION katalist_priv.enforce_connected_assignment() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION katalist_priv.enforce_connected_conversation() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
