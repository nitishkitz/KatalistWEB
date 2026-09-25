-- Allow list names to be resolved for users who have Things in those lists (as assignee, owner, or creator)
CREATE OR REPLACE FUNCTION public.resolve_list_names(p_list_ids uuid[])
RETURNS TABLE (id uuid, name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv
AS $$
  SELECT DISTINCT l.id, l.name
  FROM public.lists l
  WHERE l.id = ANY (p_list_ids)
    AND (
      katalist_priv.can_view_list(l.id)
      OR EXISTS (
        SELECT 1
        FROM public.things t
        JOIN public.actors a ON a.id = t.current_assignee_actor_id
                             OR a.id = t.owner_actor_id
                             OR a.id = t.creator_actor_id
        WHERE t.list_id = l.id
          AND a.profile_id = auth.uid()
      )
    );
$$;

REVOKE ALL ON FUNCTION public.resolve_list_names(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_list_names(uuid[]) TO authenticated;

-- Deliberately do not broaden katalist_priv.can_view_list here. A Thing
-- participant may resolve the containing List's name through the narrowly
-- scoped RPC above, but owner/member access remains required for the List,
-- its other Things, chat, files and meetings.
