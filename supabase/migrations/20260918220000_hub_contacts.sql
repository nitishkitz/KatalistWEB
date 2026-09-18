-- ============ Team Hub — Contacts, connection requests & invitations ============
-- Curation-only model: anyone can still be found in search and messaged. These
-- tables add a curated "Contacts" list built through connection requests, plus
-- email invitations for people who are not yet on Katalist.

-- 1. Connection requests between two Katalist profiles.
CREATE TABLE IF NOT EXISTS public.contact_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  addressee_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  CONSTRAINT contact_requests_status_check CHECK (status IN ('pending', 'accepted', 'declined')),
  CONSTRAINT contact_requests_not_self CHECK (requester_profile_id <> addressee_profile_id),
  UNIQUE (requester_profile_id, addressee_profile_id)
);
CREATE INDEX IF NOT EXISTS idx_contact_requests_addressee ON public.contact_requests(addressee_profile_id, status);
CREATE INDEX IF NOT EXISTS idx_contact_requests_requester ON public.contact_requests(requester_profile_id, status);

-- 2. Email invitations for people not yet on Katalist.
CREATE TABLE IF NOT EXISTS public.invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  email text NOT NULL,
  token text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  CONSTRAINT invitations_status_check CHECK (status IN ('pending', 'accepted', 'revoked')),
  CONSTRAINT invitations_email_not_blank CHECK (length(btrim(email)) > 0)
);
CREATE INDEX IF NOT EXISTS idx_invitations_inviter ON public.invitations(inviter_profile_id);

GRANT SELECT ON public.contact_requests TO authenticated;
GRANT ALL ON public.contact_requests TO service_role;
GRANT SELECT ON public.invitations TO authenticated;
GRANT ALL ON public.invitations TO service_role;

ALTER TABLE public.contact_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contact requests visible to participants" ON public.contact_requests;
CREATE POLICY "contact requests visible to participants" ON public.contact_requests
  FOR SELECT TO authenticated
  USING (requester_profile_id = auth.uid() OR addressee_profile_id = auth.uid());

DROP POLICY IF EXISTS "invitations visible to inviter" ON public.invitations;
CREATE POLICY "invitations visible to inviter" ON public.invitations
  FOR SELECT TO authenticated
  USING (inviter_profile_id = auth.uid());

-- 3. send_contact_request — create (or auto-accept a reciprocal) request.
CREATE OR REPLACE FUNCTION public.send_contact_request(p_addressee_profile_id uuid)
RETURNS public.contact_requests
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $function$
DECLARE
  v_me    uuid := auth.uid();
  v_other uuid := p_addressee_profile_id;
  v_row   public.contact_requests;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  -- Accept either a profile id or an actor id.
  IF v_other IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_other) THEN
    SELECT a.profile_id INTO v_other FROM public.actors a WHERE a.id = p_addressee_profile_id;
  END IF;
  IF v_other IS NULL OR v_other = v_me THEN RAISE EXCEPTION 'pick another person'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_other) THEN RAISE EXCEPTION 'unknown person'; END IF;

  -- If they already requested me, accept it and we are connected.
  UPDATE public.contact_requests
     SET status = 'accepted', responded_at = now()
   WHERE requester_profile_id = v_other AND addressee_profile_id = v_me AND status <> 'accepted'
  RETURNING * INTO v_row;
  IF FOUND THEN RETURN v_row; END IF;

  INSERT INTO public.contact_requests (requester_profile_id, addressee_profile_id, status)
  VALUES (v_me, v_other, 'pending')
  ON CONFLICT (requester_profile_id, addressee_profile_id)
    DO UPDATE SET status = 'pending', responded_at = NULL
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;

-- 4. respond_contact_request — addressee accepts or declines.
CREATE OR REPLACE FUNCTION public.respond_contact_request(p_request_id uuid, p_accept boolean)
RETURNS public.contact_requests
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $function$
DECLARE
  v_me  uuid := auth.uid();
  v_row public.contact_requests;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  UPDATE public.contact_requests
     SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END,
         responded_at = now()
   WHERE id = p_request_id AND addressee_profile_id = v_me AND status = 'pending'
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'that request is no longer pending'; END IF;
  RETURN v_row;
END;
$function$;

-- 5. cancel_contact_request — requester withdraws a pending request.
CREATE OR REPLACE FUNCTION public.cancel_contact_request(p_request_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $function$
DECLARE v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  DELETE FROM public.contact_requests
   WHERE id = p_request_id AND requester_profile_id = v_me AND status = 'pending';
  RETURN FOUND;
END;
$function$;

-- 6. create_invitation — email invite for a non-Katalist person.
CREATE OR REPLACE FUNCTION public.create_invitation(p_email text)
RETURNS public.invitations
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $function$
DECLARE
  v_me  uuid := auth.uid();
  v_row public.invitations;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_email IS NULL OR length(btrim(p_email)) = 0 THEN RAISE EXCEPTION 'an email is required'; END IF;
  INSERT INTO public.invitations (inviter_profile_id, email, token, status)
  VALUES (v_me, btrim(lower(p_email)), replace(gen_random_uuid()::text, '-', ''), 'pending')
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;

-- 7. revoke_invitation
CREATE OR REPLACE FUNCTION public.revoke_invitation(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $function$
DECLARE v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  UPDATE public.invitations SET status = 'revoked'
   WHERE id = p_id AND inviter_profile_id = v_me AND status = 'pending';
  RETURN FOUND;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.send_contact_request(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.respond_contact_request(uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cancel_contact_request(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_invitation(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.revoke_invitation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_contact_request(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.respond_contact_request(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_contact_request(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_invitation(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_invitation(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
