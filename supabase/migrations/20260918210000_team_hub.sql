-- ============ Team Collaboration Hub ============
-- Reuses `lists` as the substrate for conversations. A `kind` column distinguishes
-- ordinary task lists from direct messages and group conversations. All chat,
-- call, membership and attachment infrastructure already keyed on list_id is
-- inherited unchanged. Adds a dedicated files-and-folders area (`hub_files`) plus
-- a private `hub-files` Storage bucket.
--
-- Conversations are MODE-INDEPENDENT: they still carry a work|home context to
-- satisfy the NOT NULL constraint, but the hub never filters by it, so a DM/group
-- appears in both modes. Canonical-DM lookup therefore ignores context.

-- 1. kind discriminator on lists. Existing rows backfill to 'list' via the default.
ALTER TABLE public.lists
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'list';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lists_kind_check'
  ) THEN
    ALTER TABLE public.lists
      ADD CONSTRAINT lists_kind_check CHECK (kind IN ('list', 'dm', 'group'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_lists_kind ON public.lists(kind);

-- The list-immutability trigger already guards id/owner/context; kind is allowed
-- to be set at insert only through the RPCs below and is never updated by clients.

-- 2. Allow attachment-only chat messages (empty body when an attachment exists).
--    The `attachment` column was added by 20260918100000; this widens the
--    not-blank guard accordingly.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'list_messages_body_not_blank'
  ) THEN
    ALTER TABLE public.list_messages DROP CONSTRAINT list_messages_body_not_blank;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'list_messages_body_or_attachment'
  ) THEN
    ALTER TABLE public.list_messages
      ADD CONSTRAINT list_messages_body_or_attachment
      CHECK (length(btrim(body)) > 0 OR attachment IS NOT NULL);
  END IF;
END $$;

-- 3. get_or_create_dm — canonical 1:1 conversation for the caller + one other
--    person. A DM is a kind='dm' list with exactly the two people (owner + one
--    member). Lookup is order-independent and ignores context (mode-independent).
CREATE OR REPLACE FUNCTION public.get_or_create_dm(p_other_profile_id uuid)
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

  -- Existing DM in either ownership direction.
  SELECT l.* INTO v_list
    FROM public.lists l
   WHERE l.kind = 'dm'
     AND l.archived_at IS NULL
     AND (
       (l.owner_profile_id = v_me
         AND EXISTS (SELECT 1 FROM public.list_members m
                      WHERE m.list_id = l.id AND m.profile_id = v_other))
       OR
       (l.owner_profile_id = v_other
         AND EXISTS (SELECT 1 FROM public.list_members m
                      WHERE m.list_id = l.id AND m.profile_id = v_me))
     )
   LIMIT 1;

  IF FOUND THEN
    RETURN v_list;
  END IF;

  SELECT COALESCE(NULLIF(btrim(p.display_name), ''), 'Direct message')
    INTO v_name
    FROM public.profiles p WHERE p.id = v_other;

  INSERT INTO public.lists (name, owner_profile_id, context, kind)
  VALUES (COALESCE(v_name, 'Direct message'), v_me, katalist_priv.active_context(), 'dm')
  RETURNING * INTO v_list;

  INSERT INTO public.list_members (list_id, profile_id, role, added_by_profile_id)
  VALUES (v_list.id, v_other, 'collaborator', v_me)
  ON CONFLICT (list_id, profile_id) DO NOTHING;

  RETURN v_list;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_or_create_dm(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_dm(uuid) TO authenticated, service_role;

-- 4. create_group — a named kind='group' conversation with the given members
--    added as collaborators. Owner is the caller (never a member row).
CREATE OR REPLACE FUNCTION public.create_group(p_name text, p_member_ids uuid[])
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

  INSERT INTO public.lists (name, owner_profile_id, context, kind)
  VALUES (btrim(p_name), v_me, katalist_priv.active_context(), 'group')
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

REVOKE EXECUTE ON FUNCTION public.create_group(text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_group(text, uuid[]) TO authenticated, service_role;

-- 5. hub_files — folder tree + file metadata per conversation. Access mirrors
--    list_messages: viewers read; owner/collaborators write. view_only cannot
--    modify. Physical bytes live in the private `hub-files` bucket.
CREATE TABLE IF NOT EXISTS public.hub_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.hub_files(id) ON DELETE CASCADE,
  is_folder boolean NOT NULL DEFAULT false,
  name text NOT NULL,
  storage_path text,
  mime text,
  size bigint,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT hub_files_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT hub_files_folder_no_path CHECK (NOT is_folder OR storage_path IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_hub_files_list_parent ON public.hub_files(list_id, parent_id);

DROP TRIGGER IF EXISTS trg_hub_files_updated_at ON public.hub_files;
CREATE TRIGGER trg_hub_files_updated_at BEFORE UPDATE ON public.hub_files
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hub_files TO authenticated;
GRANT ALL ON public.hub_files TO service_role;

ALTER TABLE public.hub_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hub files visible to list viewers" ON public.hub_files;
CREATE POLICY "hub files visible to list viewers" ON public.hub_files
  FOR SELECT TO authenticated USING (katalist_priv.can_view_list(list_id));

DROP POLICY IF EXISTS "hub files written by owner or collaborators" ON public.hub_files;
CREATE POLICY "hub files written by owner or collaborators" ON public.hub_files
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND (
      katalist_priv.is_list_owner(list_id)
      OR katalist_priv.is_list_member(list_id, ARRAY['collaborator']::public.list_role[])
    )
  );

DROP POLICY IF EXISTS "hub files updated by owner or collaborators" ON public.hub_files;
CREATE POLICY "hub files updated by owner or collaborators" ON public.hub_files
  FOR UPDATE TO authenticated
  USING (
    katalist_priv.is_list_owner(list_id)
    OR katalist_priv.is_list_member(list_id, ARRAY['collaborator']::public.list_role[])
  )
  WITH CHECK (
    katalist_priv.is_list_owner(list_id)
    OR katalist_priv.is_list_member(list_id, ARRAY['collaborator']::public.list_role[])
  );

DROP POLICY IF EXISTS "hub files deleted by owner or collaborators" ON public.hub_files;
CREATE POLICY "hub files deleted by owner or collaborators" ON public.hub_files
  FOR DELETE TO authenticated
  USING (
    katalist_priv.is_list_owner(list_id)
    OR katalist_priv.is_list_member(list_id, ARRAY['collaborator']::public.list_role[])
  );

-- 6. Private hub-files storage bucket + policies (modeled on list-chat).
INSERT INTO storage.buckets (id, name, public)
VALUES ('hub-files', 'hub-files', false)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'hub files readable by authenticated'
  ) THEN
    CREATE POLICY "hub files readable by authenticated"
      ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id = 'hub-files');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'hub files insertable by owner'
  ) THEN
    CREATE POLICY "hub files insertable by owner"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'hub-files' AND owner = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'hub files updatable by owner'
  ) THEN
    CREATE POLICY "hub files updatable by owner"
      ON storage.objects FOR UPDATE TO authenticated
      USING (bucket_id = 'hub-files' AND owner = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'hub files deletable by owner'
  ) THEN
    CREATE POLICY "hub files deletable by owner"
      ON storage.objects FOR DELETE TO authenticated
      USING (bucket_id = 'hub-files' AND owner = auth.uid());
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
