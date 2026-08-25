CREATE OR REPLACE FUNCTION public.list_list_roster(p_list_id uuid)
RETURNS TABLE(profile_id uuid, display_name text, avatar_url text, role text, is_owner boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT katalist_priv.can_view_list(p_list_id) THEN
    RAISE EXCEPTION 'List not found';
  END IF;
  RETURN QUERY
    SELECT roster.profile_id, roster.display_name, roster.avatar_url, roster.role, roster.is_owner
      FROM (
        SELECT p.id AS profile_id, p.display_name, p.avatar_url, 'owner'::text AS role, true AS is_owner
          FROM public.lists l
          JOIN public.profiles p ON p.id = l.owner_profile_id
         WHERE l.id = p_list_id
        UNION ALL
        SELECT p.id AS profile_id, p.display_name, p.avatar_url, m.role::text AS role, false AS is_owner
          FROM public.list_members m
          JOIN public.profiles p ON p.id = m.profile_id
         WHERE m.list_id = p_list_id
      ) AS roster
     ORDER BY roster.is_owner DESC, roster.display_name;
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
       AND r.status='pending' AND r.expires_at>now()
     ORDER BY r.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_team_invitations()
RETURNS TABLE(invitation_id uuid, phone_last4 text, created_at timestamptz, expires_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  RETURN QUERY
    SELECT i.id,i.phone_last4,i.created_at,i.expires_at
      FROM katalist_priv.team_invitations i
     WHERE i.inviter_profile_id=auth.uid()
       AND i.accepted_at IS NULL
       AND i.revoked_at IS NULL
       AND i.expires_at>now()
     ORDER BY i.created_at DESC;
END;
$$;
