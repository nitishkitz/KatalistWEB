-- Tighten identity RPCs so callers only see actors through relationships they can view.
-- Returns only actor_id / display_name / avatar_url (no email/phone).

CREATE OR REPLACE FUNCTION public.resolve_actor_identities(p_actor_ids uuid[])
RETURNS TABLE (actor_id uuid, display_name text, avatar_url text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv
AS $$
  SELECT DISTINCT a.id, p.display_name, p.avatar_url
  FROM public.actors a
  JOIN public.profiles p ON p.id = a.profile_id
  WHERE a.id = ANY (p_actor_ids)
    AND a.kind = 'user'
    AND a.profile_id IS NOT NULL
    AND (
      a.profile_id = auth.uid()
      OR EXISTS (
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
            EXISTS (
              SELECT 1 FROM public.actors oa
              WHERE oa.profile_id = l.owner_profile_id AND oa.id = a.id
            )
            OR EXISTS (
              SELECT 1 FROM public.list_members lm
              WHERE lm.list_id = l.id AND lm.profile_id = p.id
            )
          )
      )
    );
$$;

REVOKE ALL ON FUNCTION public.resolve_actor_identities(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_actor_identities(uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_assignable_people()
RETURNS TABLE (actor_id uuid, display_name text, avatar_url text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv
AS $$
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
  )
  SELECT a.id, p.display_name, p.avatar_url
  FROM visible v
  JOIN public.actors a ON a.id = v.actor_id
  JOIN public.profiles p ON p.id = a.profile_id
  WHERE a.kind = 'user' AND a.profile_id IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.list_assignable_people() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_assignable_people() TO authenticated;
