ALTER TABLE katalist_priv.list_invitations
  ADD COLUMN IF NOT EXISTS phone_last4 text;

ALTER TABLE katalist_priv.list_invitations
  ADD CONSTRAINT list_invitations_phone_last4_format
  CHECK (phone_last4 IS NULL OR phone_last4 ~ '^\d{4}$');

CREATE OR REPLACE FUNCTION public.list_assignable_people()
RETURNS TABLE (actor_id uuid, display_name text, avatar_url text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  RETURN QUERY
  WITH visible AS (
    SELECT a.id AS actor_id
      FROM public.actors a
     WHERE a.kind = 'user' AND a.profile_id = auth.uid()

    UNION

    SELECT DISTINCT x.actor_id
      FROM (
        SELECT t.owner_actor_id AS actor_id, t.id AS thing_id FROM public.things t
        UNION ALL
        SELECT t.current_assignee_actor_id, t.id FROM public.things t
        UNION ALL
        SELECT t.creator_actor_id, t.id FROM public.things t
      ) x
     WHERE katalist_priv.can_view_thing(x.thing_id)

    UNION

    SELECT DISTINCT a.id
      FROM public.lists l
      JOIN public.actors a ON a.profile_id = l.owner_profile_id
     WHERE a.kind = 'user' AND katalist_priv.can_view_list(l.id)

    UNION

    SELECT DISTINCT a.id
      FROM public.list_members lm
      JOIN public.lists l ON l.id = lm.list_id
      JOIN public.actors a ON a.profile_id = lm.profile_id
     WHERE a.kind = 'user' AND katalist_priv.can_view_list(l.id)

    UNION

    SELECT a.id
      FROM katalist_priv.team_connections c
      JOIN public.actors a
        ON a.profile_id = CASE
          WHEN c.profile_a_id = auth.uid() THEN c.profile_b_id
          ELSE c.profile_a_id
        END
     WHERE auth.uid() IN (c.profile_a_id, c.profile_b_id)
       AND a.kind = 'user'
  )
  SELECT a.id, p.display_name, p.avatar_url
    FROM visible v
    JOIN public.actors a ON a.id = v.actor_id
    JOIN public.profiles p ON p.id = a.profile_id
   WHERE a.kind = 'user' AND a.profile_id IS NOT NULL
   ORDER BY p.display_name, a.id;
END;
$$;

DROP FUNCTION public.create_list_invitation_server(
  uuid, uuid, uuid, bytea, bytea, public.list_role, timestamptz
);

CREATE FUNCTION public.create_list_invitation_server(
  p_requester_profile_id uuid,
  p_list_id uuid,
  p_invitee_profile_id uuid,
  p_phone_hash bytea,
  p_phone_last4 text,
  p_token_hash bytea,
  p_role public.list_role,
  p_expires_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv'
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'server only';
  END IF;
  IF p_phone_last4 !~ '^\d{4}$' THEN
    RAISE EXCEPTION 'invalid phone suffix';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.lists
     WHERE id = p_list_id AND owner_profile_id = p_requester_profile_id
  ) THEN
    RAISE EXCEPTION 'only the List Owner can invite';
  END IF;

  WITH existing AS (
    SELECT id
      FROM katalist_priv.list_invitations
     WHERE list_id = p_list_id
       AND phone_hash = p_phone_hash
       AND accepted_at IS NULL
       AND revoked_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1
     FOR UPDATE
  )
  UPDATE katalist_priv.list_invitations i
     SET invitee_profile_id = p_invitee_profile_id,
         phone_last4 = p_phone_last4,
         token_hash = p_token_hash,
         role = p_role,
         expires_at = p_expires_at,
         created_at = clock_timestamp()
    FROM existing
   WHERE i.id = existing.id
  RETURNING i.id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO katalist_priv.list_invitations(
    list_id,
    inviter_profile_id,
    invitee_profile_id,
    phone_hash,
    phone_last4,
    token_hash,
    role,
    expires_at
  )
  VALUES (
    p_list_id,
    p_requester_profile_id,
    p_invitee_profile_id,
    p_phone_hash,
    p_phone_last4,
    p_token_hash,
    p_role,
    p_expires_at
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_pending_list_invitations(p_list_id uuid)
RETURNS TABLE (
  invitation_id uuid,
  phone_last4 text,
  role text,
  created_at timestamptz,
  expires_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv'
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT katalist_priv.is_list_owner(p_list_id) THEN
    RAISE EXCEPTION 'only the List Owner can view invitations';
  END IF;

  RETURN QUERY
  SELECT i.id, i.phone_last4, i.role::text, i.created_at, i.expires_at
    FROM katalist_priv.list_invitations i
   WHERE i.list_id = p_list_id
     AND i.accepted_at IS NULL
     AND i.revoked_at IS NULL
     AND i.expires_at > clock_timestamp()
   ORDER BY i.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_list_invitation(
  p_list_id uuid,
  p_invitation_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv'
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT katalist_priv.is_list_owner(p_list_id) THEN
    RAISE EXCEPTION 'only the List Owner can revoke invitations';
  END IF;

  UPDATE katalist_priv.list_invitations
     SET revoked_at = COALESCE(revoked_at, clock_timestamp())
   WHERE id = p_invitation_id
     AND list_id = p_list_id
     AND accepted_at IS NULL;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.replace_list_invitation_server(
  p_requester_profile_id uuid,
  p_list_id uuid,
  p_invitation_id uuid,
  p_token_hash bytea,
  p_expires_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv'
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'server only';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.lists
     WHERE id = p_list_id AND owner_profile_id = p_requester_profile_id
  ) THEN
    RAISE EXCEPTION 'only the List Owner can replace invitations';
  END IF;

  UPDATE katalist_priv.list_invitations
     SET token_hash = p_token_hash,
         expires_at = p_expires_at,
         created_at = clock_timestamp()
   WHERE id = p_invitation_id
     AND list_id = p_list_id
     AND inviter_profile_id = p_requester_profile_id
     AND accepted_at IS NULL
     AND revoked_at IS NULL
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'pending invitation not found';
  END IF;
  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.list_assignable_people() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_list_invitation_server(uuid,uuid,uuid,bytea,text,bytea,public.list_role,timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.list_pending_list_invitations(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.revoke_list_invitation(uuid,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.replace_list_invitation_server(uuid,uuid,uuid,bytea,timestamptz) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.list_assignable_people() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_list_invitation_server(uuid,uuid,uuid,bytea,text,bytea,public.list_role,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_pending_list_invitations(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_list_invitation(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_list_invitation_server(uuid,uuid,uuid,bytea,timestamptz) TO service_role;
