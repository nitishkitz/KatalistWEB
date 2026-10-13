-- Profile privacy (found in production acceptance): the policy
-- "profiles select all authenticated" let every signed-in user read every
-- profile, including other people's mobile numbers and email addresses.
--
-- After this: profiles returns only your own row (the only place your phone
-- and email appear). Other people's name, avatar and occupation come from
-- public_identities, limited to people you already share something with:
-- yourself, accepted connections, pending request counterparts, List/DM/group
-- co-participants and Thing counterparts. Blocked pairs see nothing new.

DROP POLICY IF EXISTS "profiles select all authenticated" ON public.profiles;

CREATE OR REPLACE FUNCTION katalist_priv.visible_profile_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
  WITH me AS (SELECT auth.uid() AS id),
  my_actor AS (SELECT a.id FROM public.actors a, me WHERE a.profile_id = me.id)
  SELECT me.id FROM me WHERE me.id IS NOT NULL
  UNION SELECT CASE WHEN c.profile_a_id = me.id THEN c.profile_b_id ELSE c.profile_a_id END
    FROM katalist_priv.team_connections c, me WHERE me.id IN (c.profile_a_id, c.profile_b_id)
  UNION SELECT CASE WHEN r.requester_profile_id = me.id THEN r.addressee_profile_id ELSE r.requester_profile_id END
    FROM public.contact_requests r, me WHERE r.status IN ('pending', 'accepted') AND me.id IN (r.requester_profile_id, r.addressee_profile_id)
  UNION SELECT l.owner_profile_id FROM public.lists l, me
    WHERE EXISTS (SELECT 1 FROM public.list_members m WHERE m.list_id = l.id AND m.profile_id = me.id)
  UNION SELECT m.profile_id FROM public.list_members m JOIN public.lists l ON l.id = m.list_id, me
    WHERE l.owner_profile_id = me.id OR EXISTS (SELECT 1 FROM public.list_members mm WHERE mm.list_id = l.id AND mm.profile_id = me.id)
  UNION SELECT a.profile_id FROM public.things t JOIN public.actors a ON a.id IN (t.owner_actor_id, t.current_assignee_actor_id, t.creator_actor_id)
    WHERE (t.owner_actor_id IN (SELECT id FROM my_actor) OR t.current_assignee_actor_id IN (SELECT id FROM my_actor))
      AND a.profile_id IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION katalist_priv.visible_profile_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION katalist_priv.visible_profile_ids() TO authenticated, service_role;

-- Runs as its owner (not security_invoker) so it can read the names it is allowed
-- to show, and nothing else: no phone, no email.
DROP VIEW IF EXISTS public.public_identities;
CREATE VIEW public.public_identities WITH (security_barrier = true) AS
  SELECT p.id, p.display_name, p.avatar_url, p.occupation
    FROM public.profiles p
   WHERE p.id IN (SELECT katalist_priv.visible_profile_ids())
     AND (p.id = auth.uid() OR NOT katalist_priv.is_blocked_between(auth.uid(), p.id));
REVOKE ALL ON public.public_identities FROM PUBLIC, anon;
GRANT SELECT ON public.public_identities TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
