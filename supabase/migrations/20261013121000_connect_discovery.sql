-- Minimal discovery for explicit connections (Coey rebuild P2).
--
-- * Each profile has a private, random connect handle to share as a link.
-- * find_person_for_connect returns at most one minimal identity for an exact
--   handle, email or phone: never a directory, never contact details.
-- * list_visible_identities replaces the all-profiles directory read: only
--   self, connections, request counterparts and people met through an
--   authorized List or Thing. Email is returned for self only.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS connect_handle text;

CREATE OR REPLACE FUNCTION katalist_priv.new_connect_handle()
RETURNS text LANGUAGE sql VOLATILE
AS $$ SELECT translate(substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 10), '01', 'xy') $$;

UPDATE public.profiles SET connect_handle = katalist_priv.new_connect_handle() WHERE connect_handle IS NULL;
ALTER TABLE public.profiles ALTER COLUMN connect_handle SET DEFAULT katalist_priv.new_connect_handle();
ALTER TABLE public.profiles ALTER COLUMN connect_handle SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_connect_handle_key ON public.profiles (connect_handle);

CREATE OR REPLACE FUNCTION public.my_connect_handle()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$ SELECT connect_handle FROM public.profiles WHERE id = auth.uid() $$;

CREATE OR REPLACE FUNCTION public.rotate_connect_handle()
RETURNS text LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$ UPDATE public.profiles SET connect_handle = katalist_priv.new_connect_handle() WHERE id = auth.uid() RETURNING connect_handle $$;

CREATE OR REPLACE FUNCTION public.find_person_for_connect(p_query text)
RETURNS TABLE (profile_id uuid, display_name text, avatar_url text, state text, request_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_me     uuid := auth.uid();
  v_q      text := btrim(coalesce(p_query, ''));
  v_handle text;
  v_digits text;
  v_target uuid;
  v_req    public.contact_requests;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF length(v_q) < 3 OR length(v_q) > 200 THEN RETURN; END IF;
  v_handle := lower(substring(v_q FROM '(?:/connect/)?([A-Za-z0-9]{6,32})/?$'));
  v_digits := regexp_replace(v_q, '[^0-9]', '', 'g');

  IF v_q ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    SELECT p.id INTO v_target FROM public.profiles p WHERE lower(p.email) = lower(v_q) AND p.email NOT LIKE '%@users.katalist.invalid' LIMIT 2;
  ELSIF v_q ~ '^\+?[0-9 ()-]{8,20}$' AND length(v_digits) BETWEEN 8 AND 15 THEN
    SELECT p.id INTO v_target FROM public.profiles p
     WHERE regexp_replace(coalesce(p.phone_e164, ''), '[^0-9]', '', 'g') = v_digits
        OR (length(v_digits) = 10 AND regexp_replace(coalesce(p.phone_e164, ''), '[^0-9]', '', 'g') = '91' || v_digits)
     LIMIT 1;
  ELSIF v_handle IS NOT NULL THEN
    SELECT p.id INTO v_target FROM public.profiles p WHERE p.connect_handle = v_handle;
  END IF;

  -- Not found and blocked look the same.
  IF v_target IS NULL OR katalist_priv.is_blocked_between(v_me, v_target) THEN RETURN; END IF;

  SELECT * INTO v_req FROM public.contact_requests r
   WHERE least(r.requester_profile_id, r.addressee_profile_id) = least(v_me, v_target)
     AND greatest(r.requester_profile_id, r.addressee_profile_id) = greatest(v_me, v_target);

  RETURN QUERY
  SELECT p.id, COALESCE(NULLIF(btrim(p.display_name), ''), 'Katalist member'), p.avatar_url,
         CASE
           WHEN p.id = v_me THEN 'self'
           WHEN katalist_priv.are_connected(v_me, p.id) THEN 'connected'
           WHEN v_req.status = 'pending' AND v_req.requester_profile_id = v_me THEN 'pending_out'
           WHEN v_req.status = 'pending' THEN 'pending_in'
           ELSE 'none'
         END,
         CASE WHEN v_req.status = 'pending' THEN v_req.id END
    FROM public.profiles p WHERE p.id = v_target;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_visible_identities()
RETURNS TABLE (profile_id uuid, actor_id uuid, display_name text, avatar_url text, email text, connected boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
  WITH me AS (SELECT auth.uid() AS id),
  my_actor AS (SELECT a.id FROM public.actors a, me WHERE a.profile_id = me.id),
  ids AS (
    SELECT me.id FROM me
    UNION SELECT CASE WHEN c.profile_a_id = me.id THEN c.profile_b_id ELSE c.profile_a_id END
      FROM katalist_priv.team_connections c, me WHERE me.id IN (c.profile_a_id, c.profile_b_id)
    UNION SELECT CASE WHEN r.requester_profile_id = me.id THEN r.addressee_profile_id ELSE r.requester_profile_id END
      FROM public.contact_requests r, me WHERE r.status = 'pending' AND me.id IN (r.requester_profile_id, r.addressee_profile_id)
    UNION SELECT l.owner_profile_id FROM public.lists l, me
      WHERE EXISTS (SELECT 1 FROM public.list_members m WHERE m.list_id = l.id AND m.profile_id = me.id)
    UNION SELECT m.profile_id FROM public.list_members m JOIN public.lists l ON l.id = m.list_id, me
      WHERE l.owner_profile_id = me.id OR EXISTS (SELECT 1 FROM public.list_members mm WHERE mm.list_id = l.id AND mm.profile_id = me.id)
    UNION SELECT a.profile_id FROM public.things t JOIN public.actors a ON a.id IN (t.owner_actor_id, t.current_assignee_actor_id)
      WHERE (t.owner_actor_id IN (SELECT id FROM my_actor) OR t.current_assignee_actor_id IN (SELECT id FROM my_actor))
        AND a.profile_id IS NOT NULL
  )
  SELECT p.id, a.id, COALESCE(NULLIF(btrim(p.display_name), ''), 'Katalist member'), p.avatar_url,
         CASE WHEN p.id = (SELECT id FROM me) THEN p.email END,
         katalist_priv.are_connected((SELECT id FROM me), p.id)
    FROM ids JOIN public.profiles p ON p.id = ids.id
    LEFT JOIN public.actors a ON a.profile_id = p.id
   WHERE ids.id IS NOT NULL
     AND NOT katalist_priv.is_blocked_between((SELECT id FROM me), p.id);
$$;

REVOKE ALL ON FUNCTION katalist_priv.new_connect_handle() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.my_connect_handle() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rotate_connect_handle() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.find_person_for_connect(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_visible_identities() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_connect_handle() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_connect_handle() TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_person_for_connect(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_visible_identities() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
