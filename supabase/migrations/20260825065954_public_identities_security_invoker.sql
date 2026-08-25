-- public_identities was SECURITY DEFINER, so every authenticated user could
-- read every profile's display_name/avatar. Switch the view to invoker (RLS)
-- and expose related identities only through column-restricted RPCs.

ALTER VIEW public.public_identities SET (security_invoker = true);

REVOKE ALL ON public.public_identities FROM PUBLIC, anon;
GRANT SELECT ON public.public_identities TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_profile_identities(p_profile_ids uuid[])
RETURNS TABLE (id uuid, display_name text, avatar_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv
AS $$
  SELECT DISTINCT p.id, p.display_name, p.avatar_url
  FROM public.profiles p
  WHERE p.id = ANY (p_profile_ids)
    AND (
      p.id = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.actors a
        WHERE a.profile_id = p.id
          AND a.kind = 'user'
          AND (
            EXISTS (
              SELECT 1
              FROM public.things t
              WHERE (
                t.creator_actor_id = a.id
                OR t.owner_actor_id = a.id
                OR t.current_assignee_actor_id = a.id
              )
              AND katalist_priv.can_view_thing(t.id)
            )
            OR EXISTS (
              SELECT 1
              FROM public.lists l
              WHERE katalist_priv.can_view_list(l.id)
                AND (
                  l.owner_profile_id = p.id
                  OR EXISTS (
                    SELECT 1
                    FROM public.list_members lm
                    WHERE lm.list_id = l.id AND lm.profile_id = p.id
                  )
                )
            )
          )
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.list_visible_profile_identities()
RETURNS TABLE (id uuid, display_name text, avatar_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv
AS $$
  SELECT DISTINCT p.id, p.display_name, p.avatar_url
  FROM public.profiles p
  WHERE p.id = auth.uid()
     OR EXISTS (
       SELECT 1
       FROM public.actors a
       WHERE a.profile_id = p.id
         AND a.kind = 'user'
         AND (
           EXISTS (
             SELECT 1
             FROM public.things t
             WHERE (
               t.creator_actor_id = a.id
               OR t.owner_actor_id = a.id
               OR t.current_assignee_actor_id = a.id
             )
             AND katalist_priv.can_view_thing(t.id)
           )
           OR EXISTS (
             SELECT 1
             FROM public.lists l
             WHERE katalist_priv.can_view_list(l.id)
               AND (
                 l.owner_profile_id = p.id
                 OR EXISTS (
                   SELECT 1
                   FROM public.list_members lm
                   WHERE lm.list_id = l.id AND lm.profile_id = p.id
                 )
               )
           )
         )
     );
$$;

REVOKE ALL ON FUNCTION public.resolve_profile_identities(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_profile_identities(uuid[]) TO authenticated;

REVOKE ALL ON FUNCTION public.list_visible_profile_identities() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_visible_profile_identities() TO authenticated;
