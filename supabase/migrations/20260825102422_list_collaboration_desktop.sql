ALTER TABLE public.lists
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS cover_storage_path text;

ALTER TABLE public.lists
  ADD CONSTRAINT lists_description_length CHECK (description IS NULL OR length(description) <= 500),
  ADD CONSTRAINT lists_cover_private_path CHECK (
    cover_storage_path IS NULL OR cover_storage_path ~ ('^' || id::text || '/[A-Za-z0-9._-]+$')
  );

CREATE TABLE katalist_priv.team_connections (
  profile_a_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  profile_b_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_by_profile_id uuid NOT NULL REFERENCES public.profiles(id),
  PRIMARY KEY (profile_a_id, profile_b_id),
  CONSTRAINT team_connections_canonical CHECK (profile_a_id < profile_b_id)
);

CREATE TABLE katalist_priv.team_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','cancelled')),
  expires_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '14 days'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  responded_at timestamptz,
  CONSTRAINT team_request_not_self CHECK (sender_profile_id <> recipient_profile_id)
);
CREATE UNIQUE INDEX team_requests_one_pending
  ON katalist_priv.team_requests(sender_profile_id, recipient_profile_id)
  WHERE status = 'pending';

CREATE TABLE katalist_priv.list_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  inviter_profile_id uuid NOT NULL REFERENCES public.profiles(id),
  invitee_profile_id uuid REFERENCES public.profiles(id),
  phone_hash bytea,
  token_hash bytea NOT NULL UNIQUE,
  role public.list_role NOT NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by_profile_id uuid REFERENCES public.profiles(id),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT list_invitation_target CHECK (invitee_profile_id IS NOT NULL OR phone_hash IS NOT NULL),
  CONSTRAINT list_invitation_expiry CHECK (expires_at > created_at)
);
CREATE INDEX list_invitations_list_pending
  ON katalist_priv.list_invitations(list_id, created_at DESC)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE TABLE katalist_priv.team_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  phone_hash bytea NOT NULL,
  phone_last4 text NOT NULL CHECK (phone_last4 ~ '^\d{4}$'),
  token_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by_profile_id uuid REFERENCES public.profiles(id),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE OR REPLACE FUNCTION public.create_list_v2(
  p_name text,
  p_context public.context_kind DEFAULT NULL,
  p_description text DEFAULT NULL
)
RETURNS public.lists LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv' AS $$
DECLARE v_list public.lists;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN RAISE EXCEPTION 'a List needs a name'; END IF;
  IF p_description IS NOT NULL AND length(p_description) > 500 THEN RAISE EXCEPTION 'description is too long'; END IF;
  INSERT INTO public.lists(name, owner_profile_id, context, description)
  VALUES (btrim(p_name), auth.uid(), COALESCE(p_context, katalist_priv.active_context()), nullif(btrim(p_description), ''))
  RETURNING * INTO v_list;
  RETURN v_list;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_list_metadata(
  p_list_id uuid,
  p_name text,
  p_description text DEFAULT NULL,
  p_cover_storage_path text DEFAULT NULL
)
RETURNS public.lists LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv' AS $$
DECLARE v_list public.lists;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT katalist_priv.is_list_owner(p_list_id) THEN RAISE EXCEPTION 'only the List Owner can edit it'; END IF;
  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN RAISE EXCEPTION 'a List needs a name'; END IF;
  UPDATE public.lists SET name=btrim(p_name), description=nullif(btrim(p_description), ''), cover_storage_path=p_cover_storage_path
   WHERE id=p_list_id RETURNING * INTO v_list;
  RETURN v_list;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_list_roster(p_list_id uuid)
RETURNS TABLE(profile_id uuid, display_name text, avatar_url text, role text, is_owner boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT katalist_priv.can_view_list(p_list_id) THEN RAISE EXCEPTION 'List not found'; END IF;
  RETURN QUERY
    SELECT p.id, p.display_name, p.avatar_url, 'owner'::text, true
      FROM public.lists l JOIN public.profiles p ON p.id=l.owner_profile_id WHERE l.id=p_list_id
    UNION ALL
    SELECT p.id, p.display_name, p.avatar_url, m.role::text, false
      FROM public.list_members m JOIN public.profiles p ON p.id=m.profile_id WHERE m.list_id=p_list_id
    ORDER BY is_owner DESC, display_name;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_team_directory()
RETURNS TABLE(profile_id uuid, display_name text, avatar_url text, phone_e164 text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  RETURN QUERY
    SELECT p.id, p.display_name, p.avatar_url, p.phone_e164
      FROM katalist_priv.team_connections c
      JOIN public.profiles p ON p.id = CASE WHEN c.profile_a_id=auth.uid() THEN c.profile_b_id ELSE c.profile_a_id END
     WHERE auth.uid() IN (c.profile_a_id, c.profile_b_id)
     ORDER BY p.display_name;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_team_connection(p_recipient_profile_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv' AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_recipient_profile_id=auth.uid() THEN RAISE EXCEPTION 'you are already on your Team'; END IF;
  INSERT INTO katalist_priv.team_requests(sender_profile_id, recipient_profile_id)
  VALUES(auth.uid(), p_recipient_profile_id)
  ON CONFLICT (sender_profile_id, recipient_profile_id) WHERE status='pending'
  DO UPDATE SET expires_at=clock_timestamp()+interval '14 days'
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_team_request(p_request_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv' AS $$
DECLARE v_request katalist_priv.team_requests;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO v_request FROM katalist_priv.team_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.recipient_profile_id<>auth.uid() OR v_request.status<>'pending' OR v_request.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'request is not available'; END IF;
  INSERT INTO katalist_priv.team_connections(profile_a_id,profile_b_id,created_by_profile_id)
  VALUES(least(v_request.sender_profile_id,auth.uid()),greatest(v_request.sender_profile_id,auth.uid()),auth.uid()) ON CONFLICT DO NOTHING;
  UPDATE katalist_priv.team_requests SET status='accepted',responded_at=clock_timestamp() WHERE id=p_request_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_team_requests()
RETURNS TABLE(request_id uuid, direction text, profile_id uuid, display_name text, avatar_url text, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  RETURN QUERY
    SELECT r.id,
           CASE WHEN r.sender_profile_id=auth.uid() THEN 'sent' ELSE 'received' END,
           p.id,p.display_name,p.avatar_url,r.created_at
      FROM katalist_priv.team_requests r
      JOIN public.profiles p ON p.id=CASE WHEN r.sender_profile_id=auth.uid() THEN r.recipient_profile_id ELSE r.sender_profile_id END
     WHERE auth.uid() IN (r.sender_profile_id,r.recipient_profile_id)
       AND r.status='pending' AND r.expires_at>clock_timestamp()
     ORDER BY r.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_team_connection(p_profile_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  DELETE FROM katalist_priv.team_connections
   WHERE profile_a_id=least(auth.uid(),p_profile_id) AND profile_b_id=greatest(auth.uid(),p_profile_id);
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_team_invitations()
RETURNS TABLE(invitation_id uuid, phone_last4 text, created_at timestamptz, expires_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  RETURN QUERY SELECT i.id,i.phone_last4,i.created_at,i.expires_at
    FROM katalist_priv.team_invitations i
   WHERE i.inviter_profile_id=auth.uid() AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>clock_timestamp()
   ORDER BY i.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_connected_list_member(p_list_id uuid, p_profile_id uuid, p_role public.list_role DEFAULT 'collaborator')
RETURNS public.list_members LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv' AS $$
DECLARE v_member public.list_members; v_owner uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT katalist_priv.is_list_owner(p_list_id) THEN RAISE EXCEPTION 'only the List Owner can add members'; END IF;
  SELECT owner_profile_id INTO v_owner FROM public.lists WHERE id=p_list_id;
  IF p_profile_id=v_owner THEN RAISE EXCEPTION 'Owner is not a member row'; END IF;
  IF NOT EXISTS (SELECT 1 FROM katalist_priv.team_connections c WHERE least(v_owner,p_profile_id)=c.profile_a_id AND greatest(v_owner,p_profile_id)=c.profile_b_id) THEN RAISE EXCEPTION 'connect in Team before adding this member'; END IF;
  INSERT INTO public.list_members(list_id,profile_id,role,added_by_profile_id)
  VALUES(p_list_id,p_profile_id,COALESCE(p_role,'collaborator'),auth.uid())
  ON CONFLICT(list_id,profile_id) DO UPDATE SET role=excluded.role
  RETURNING * INTO v_member;
  RETURN v_member;
END;
$$;

CREATE OR REPLACE FUNCTION public.change_list_role(p_list_id uuid, p_profile_id uuid, p_role public.list_role)
RETURNS public.list_members LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv' AS $$
DECLARE v_member public.list_members;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT katalist_priv.is_list_owner(p_list_id) THEN RAISE EXCEPTION 'only the List Owner can change roles'; END IF;
  IF EXISTS(SELECT 1 FROM public.lists WHERE id=p_list_id AND owner_profile_id=p_profile_id) THEN RAISE EXCEPTION 'Owner is not a member row'; END IF;
  UPDATE public.list_members SET role=p_role WHERE list_id=p_list_id AND profile_id=p_profile_id RETURNING * INTO v_member;
  IF NOT FOUND THEN RAISE EXCEPTION 'that person is not a member of this List'; END IF;
  RETURN v_member;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_list_member(p_list_id uuid, p_profile_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT katalist_priv.is_list_owner(p_list_id) AND p_profile_id<>auth.uid() THEN RAISE EXCEPTION 'only the List Owner can remove other members'; END IF;
  IF EXISTS(SELECT 1 FROM public.lists WHERE id=p_list_id AND owner_profile_id=p_profile_id) THEN RAISE EXCEPTION 'Owner is not a member row'; END IF;
  DELETE FROM public.list_members WHERE list_id=p_list_id AND profile_id=p_profile_id;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_list_invitation_server(
  p_requester_profile_id uuid, p_list_id uuid, p_invitee_profile_id uuid,
  p_phone_hash bytea, p_token_hash bytea, p_role public.list_role, p_expires_at timestamptz
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv' AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'server only'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.lists WHERE id=p_list_id AND owner_profile_id=p_requester_profile_id) THEN RAISE EXCEPTION 'only the List Owner can invite'; END IF;
  INSERT INTO katalist_priv.list_invitations(list_id,inviter_profile_id,invitee_profile_id,phone_hash,token_hash,role,expires_at)
  VALUES(p_list_id,p_requester_profile_id,p_invitee_profile_id,p_phone_hash,p_token_hash,p_role,p_expires_at) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_list_invitation_server(p_token_hash bytea, p_accepting_profile_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv' AS $$
DECLARE v_invite katalist_priv.list_invitations;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'server only'; END IF;
  SELECT * INTO v_invite FROM katalist_priv.list_invitations WHERE token_hash=p_token_hash FOR UPDATE;
  IF NOT FOUND OR v_invite.revoked_at IS NOT NULL OR v_invite.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'invite is not available'; END IF;
  IF v_invite.accepted_at IS NOT NULL THEN RETURN v_invite.list_id; END IF;
  IF v_invite.invitee_profile_id IS NOT NULL AND v_invite.invitee_profile_id<>p_accepting_profile_id THEN RAISE EXCEPTION 'invite belongs to another person'; END IF;
  IF v_invite.inviter_profile_id<>p_accepting_profile_id THEN
    INSERT INTO katalist_priv.team_connections(profile_a_id,profile_b_id,created_by_profile_id)
    VALUES(least(v_invite.inviter_profile_id,p_accepting_profile_id),greatest(v_invite.inviter_profile_id,p_accepting_profile_id),p_accepting_profile_id) ON CONFLICT DO NOTHING;
    INSERT INTO public.list_members(list_id,profile_id,role,added_by_profile_id)
    VALUES(v_invite.list_id,p_accepting_profile_id,v_invite.role,v_invite.inviter_profile_id)
    ON CONFLICT(list_id,profile_id) DO UPDATE SET role=excluded.role;
  END IF;
  UPDATE katalist_priv.list_invitations SET accepted_at = clock_timestamp(),accepted_by_profile_id=p_accepting_profile_id WHERE id=v_invite.id;
  RETURN v_invite.list_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_team_invitation_server(
  p_requester_profile_id uuid, p_phone_hash bytea, p_phone_last4 text,
  p_token_hash bytea, p_expires_at timestamptz
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv' AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'server only'; END IF;
  INSERT INTO katalist_priv.team_invitations(inviter_profile_id,phone_hash,phone_last4,token_hash,expires_at)
  VALUES(p_requester_profile_id,p_phone_hash,p_phone_last4,p_token_hash,p_expires_at) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_team_invitation_server(p_token_hash bytea, p_accepting_profile_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv' AS $$
DECLARE v_invite katalist_priv.team_invitations;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'server only'; END IF;
  SELECT * INTO v_invite FROM katalist_priv.team_invitations WHERE token_hash=p_token_hash FOR UPDATE;
  IF NOT FOUND OR v_invite.revoked_at IS NOT NULL OR v_invite.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'invite is not available'; END IF;
  IF v_invite.accepted_at IS NOT NULL THEN RETURN true; END IF;
  IF v_invite.inviter_profile_id=p_accepting_profile_id THEN RAISE EXCEPTION 'cannot invite yourself'; END IF;
  INSERT INTO katalist_priv.team_connections(profile_a_id,profile_b_id,created_by_profile_id)
  VALUES(least(v_invite.inviter_profile_id,p_accepting_profile_id),greatest(v_invite.inviter_profile_id,p_accepting_profile_id),p_accepting_profile_id) ON CONFLICT DO NOTHING;
  UPDATE katalist_priv.team_invitations SET accepted_at=clock_timestamp(),accepted_by_profile_id=p_accepting_profile_id WHERE id=v_invite.id;
  RETURN true;
END;
$$;

DROP POLICY IF EXISTS "list messages written by owner or collaborators" ON public.list_messages;
CREATE POLICY "list messages written by List viewers" ON public.list_messages
  FOR INSERT TO authenticated WITH CHECK(author_profile_id=auth.uid() AND katalist_priv.can_view_list(list_id));

REVOKE EXECUTE ON FUNCTION public.create_list_invitation_server(uuid,uuid,uuid,bytea,bytea,public.list_role,timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.accept_list_invitation_server(bytea,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_team_invitation_server(uuid,bytea,text,bytea,timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.accept_team_invitation_server(bytea,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_list_invitation_server(uuid,uuid,uuid,bytea,bytea,public.list_role,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.accept_list_invitation_server(bytea,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_team_invitation_server(uuid,bytea,text,bytea,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.accept_team_invitation_server(bytea,uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.create_list_v2(text,public.context_kind,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_list_metadata(uuid,text,text,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_list_roster(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_team_directory() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.request_team_connection(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.accept_team_request(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_team_requests() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.remove_team_connection(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_team_invitations() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.add_connected_list_member(uuid,uuid,public.list_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_list_v2(text,public.context_kind,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_list_metadata(uuid,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_list_roster(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_team_directory() TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_team_connection(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_team_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_team_requests() TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_team_connection(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_team_invitations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_connected_list_member(uuid,uuid,public.list_role) TO authenticated;
