-- Team Hub: split conversations by Work/Home mode.
--
-- Contacts stay shared across modes. DMs and groups now belong to the mode
-- they were created in (lists.context, which every conversation row already
-- carries). A pair of people can have one DM per mode.
--
-- Existing conversations are NOT modified: each keeps the context it was
-- created with. The previous signatures (get_or_create_dm(uuid),
-- create_group(text, uuid[]), get_hub_conversation_page(int, timestamptz,
-- uuid)) are left in place so older clients keep working; the web app calls
-- the new context-aware overloads below.

-- 1. get_or_create_dm(other, context) — canonical 1:1 conversation per mode.
CREATE OR REPLACE FUNCTION public.get_or_create_dm(
  p_other_profile_id uuid,
  p_context public.context_kind
)
RETURNS public.lists
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $function$
DECLARE
  v_me    uuid := auth.uid();
  v_other uuid := p_other_profile_id;
  v_list  public.lists;
  v_name  text;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_context IS NULL THEN
    RAISE EXCEPTION 'a direct message needs a mode' USING ERRCODE = '22023';
  END IF;
  -- Accept either a profile id or an actor id; resolve to the profile.
  IF v_other IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_other) THEN
    SELECT a.profile_id INTO v_other FROM public.actors a WHERE a.id = p_other_profile_id;
  END IF;
  IF v_other IS NULL OR v_other = v_me THEN
    RAISE EXCEPTION 'a direct message needs another person';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_other) THEN
    RAISE EXCEPTION 'unknown person';
  END IF;

  -- Existing DM for this mode, in either ownership direction.
  SELECT l.* INTO v_list
    FROM public.lists l
   WHERE l.kind = 'dm'
     AND l.archived_at IS NULL
     AND l.context = p_context
     AND (
       (l.owner_profile_id = v_me
         AND EXISTS (SELECT 1 FROM public.list_members m
                      WHERE m.list_id = l.id AND m.profile_id = v_other))
       OR
       (l.owner_profile_id = v_other
         AND EXISTS (SELECT 1 FROM public.list_members m
                      WHERE m.list_id = l.id AND m.profile_id = v_me))
     )
   ORDER BY l.created_at, l.id
   LIMIT 1;

  IF FOUND THEN
    RETURN v_list;
  END IF;

  SELECT COALESCE(NULLIF(btrim(p.display_name), ''), 'Direct message')
    INTO v_name
    FROM public.profiles p WHERE p.id = v_other;

  INSERT INTO public.lists (name, owner_profile_id, context, kind)
  VALUES (COALESCE(v_name, 'Direct message'), v_me, p_context, 'dm')
  RETURNING * INTO v_list;

  INSERT INTO public.list_members (list_id, profile_id, role, added_by_profile_id)
  VALUES (v_list.id, v_other, 'collaborator', v_me)
  ON CONFLICT (list_id, profile_id) DO NOTHING;

  RETURN v_list;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_or_create_dm(uuid, public.context_kind) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_dm(uuid, public.context_kind) TO authenticated, service_role;

-- 2. create_group(name, members, context) — group pinned to an explicit mode.
CREATE OR REPLACE FUNCTION public.create_group(
  p_name text,
  p_member_ids uuid[],
  p_context public.context_kind
)
RETURNS public.lists
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $function$
DECLARE
  v_me   uuid := auth.uid();
  v_list public.lists;
  v_id   uuid;
  v_prof uuid;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RAISE EXCEPTION 'a group needs a name';
  END IF;
  IF p_context IS NULL THEN
    RAISE EXCEPTION 'a group needs a mode' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.lists (name, owner_profile_id, context, kind)
  VALUES (btrim(p_name), v_me, p_context, 'group')
  RETURNING * INTO v_list;

  IF p_member_ids IS NOT NULL THEN
    FOREACH v_id IN ARRAY p_member_ids LOOP
      IF v_id IS NULL THEN CONTINUE; END IF;
      -- Accept either a profile id or an actor id.
      v_prof := v_id;
      IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_prof) THEN
        SELECT a.profile_id INTO v_prof FROM public.actors a WHERE a.id = v_id;
      END IF;
      IF v_prof IS NOT NULL
         AND v_prof <> v_me
         AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_prof) THEN
        INSERT INTO public.list_members (list_id, profile_id, role, added_by_profile_id)
        VALUES (v_list.id, v_prof, 'collaborator', v_me)
        ON CONFLICT (list_id, profile_id) DO NOTHING;
      END IF;
    END LOOP;
  END IF;

  RETURN v_list;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_group(text, uuid[], public.context_kind) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_group(text, uuid[], public.context_kind) TO authenticated, service_role;

-- 3. get_hub_conversation_page(..., context) — rail page for one mode.
CREATE OR REPLACE FUNCTION public.get_hub_conversation_page(
  p_limit integer,
  p_cursor_at timestamptz,
  p_cursor_id uuid,
  p_context public.context_kind
)
RETURNS TABLE (
  id uuid,
  name text,
  kind text,
  owner_profile_id uuid,
  updated_at timestamptz,
  last_body text,
  last_kind text,
  last_at timestamptz,
  last_author_profile_id uuid,
  last_has_attachment boolean,
  sort_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = 'pg_catalog','public' AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100
     OR (p_cursor_at IS NULL) <> (p_cursor_id IS NULL)
     OR p_context IS NULL THEN
    RAISE EXCEPTION 'invalid Hub page bounds' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT l.id, l.name, l.kind, l.owner_profile_id, l.updated_at,
      left(m.body, 240), m.kind, m.created_at, m.author_profile_id,
      (m.attachment IS NOT NULL), COALESCE(m.created_at, l.updated_at)
    FROM public.lists l
    LEFT JOIN LATERAL (
      SELECT lm.body, lm.kind, lm.created_at, lm.author_profile_id, lm.attachment
      FROM public.list_messages lm
      WHERE lm.list_id = l.id AND lm.deleted_at IS NULL
      ORDER BY lm.created_at DESC, lm.id DESC
      LIMIT 1
    ) m ON true
    WHERE l.kind IN ('dm', 'group') AND l.archived_at IS NULL
      AND l.context = p_context
      AND (p_cursor_at IS NULL OR (COALESCE(m.created_at, l.updated_at), l.id) < (p_cursor_at, p_cursor_id))
    ORDER BY COALESCE(m.created_at, l.updated_at) DESC, l.id DESC
    LIMIT p_limit + 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_hub_conversation_page(integer, timestamptz, uuid, public.context_kind) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_hub_conversation_page(integer, timestamptz, uuid, public.context_kind) TO authenticated;

NOTIFY pgrst, 'reload schema';
