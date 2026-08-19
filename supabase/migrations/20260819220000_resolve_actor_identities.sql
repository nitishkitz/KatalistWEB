-- Safe identity lens: resolve display names for actors the caller may already see via Things/Lists.
CREATE OR REPLACE FUNCTION public.resolve_actor_identities(p_actor_ids uuid[])
RETURNS TABLE (actor_id uuid, display_name text, avatar_url text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, p.display_name, p.avatar_url
  FROM public.actors a
  JOIN public.profiles p ON p.id = a.profile_id
  WHERE a.id = ANY (p_actor_ids)
    AND a.kind = 'user'
    AND a.profile_id IS NOT NULL
    AND (
      a.profile_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.things t
        WHERE t.creator_actor_id = a.id
           OR t.owner_actor_id = a.id
           OR t.current_assignee_actor_id = a.id
      )
      OR EXISTS (
        SELECT 1 FROM public.list_members lm
        WHERE lm.profile_id = p.id
      )
    );
$$;

REVOKE ALL ON FUNCTION public.resolve_actor_identities(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_actor_identities(uuid[]) TO authenticated;
