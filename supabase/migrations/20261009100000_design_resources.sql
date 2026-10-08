-- Designs (Stage 2): List-scoped Figma design links, single-level folders,
-- personal favorites, and design <-> Thing links. No Figma API is involved;
-- every row is a Katalist-authored reference to an official Figma link.
--
-- Authorization model (mirrors list_meetings / thing_snooze):
--   * Reads: any List viewer (owner or member) via RLS using katalist_priv.can_view_list.
--   * Writes: SECURITY DEFINER RPCs only; the authenticated role has no direct
--     INSERT/UPDATE/DELETE grant. Shared records need the List owner or a
--     'collaborator'; 'view_only' members may only read and keep favorites.
--   * Favorites are private: RLS limits reads to profile_id = auth.uid().
--   * Same-List integrity is enforced by composite foreign keys and triggers
--     that also bind service_role, not only by the RPCs.
--
-- URL trust boundary: the browser sends one URL. katalist_priv.parse_figma_url
-- (kept in parity with src/features/designs/figma-url.ts, verified by
-- scripts/design-resources-sql.test.mjs) validates it and a BEFORE trigger
-- derives kind / file key / node ids / identity key / canonical URL on every
-- write, overwriting anything the caller supplied. Embed URLs are never stored;
-- clients derive them from the stored canonical URL.
--
-- Archive / re-add: uniqueness (list_id, identity_key) applies to ACTIVE rows
-- only. Archiving frees the identity, so the same design can be added again as
-- a new row while the archived row keeps its history, favorites and links.
-- Restoring an archived row fails with hint 'duplicate_design' when an active
-- row with the same identity exists.

-- ============ URL parsing (trusted boundary) ============

CREATE OR REPLACE FUNCTION katalist_priv.figma_query_param(p_query text, p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $$
  SELECT CASE WHEN position('=' IN kv) = 0 THEN '' ELSE substr(kv, position('=' IN kv) + 1) END
  FROM unnest(string_to_array(coalesce(p_query, ''), '&')) WITH ORDINALITY AS t(kv, ord)
  WHERE split_part(kv, '=', 1) = p_name
  ORDER BY ord
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION katalist_priv.parse_figma_url(
  p_url text,
  OUT kind text,
  OUT file_key text,
  OUT node_id text,
  OUT starting_point_node_id text,
  OUT version_id text,
  OUT page_id text,
  OUT original_url text,
  OUT identity_key text
)
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'pg_catalog', 'katalist_priv'
AS $$
DECLARE
  v_url      text := regexp_replace(coalesce(p_url, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_scheme   text[];
  v_m        text[];
  v_host     text;
  v_segs     text[];
  v_path     text;
  v_key      text;
  v_query    text;
  v_raw      text;
  v_scaling  text;
  v_content  text;
  v_params   text := '';
BEGIN
  IF v_url = '' THEN
    RAISE EXCEPTION 'Enter a Figma link.' USING ERRCODE = '22023', HINT = 'empty';
  END IF;
  IF length(v_url) > 2048 THEN
    RAISE EXCEPTION 'This link is too long to be a Figma link.' USING ERRCODE = '22023', HINT = 'too_long';
  END IF;
  IF v_url ~ '[[:space:][:cntrl:]\\]' THEN
    RAISE EXCEPTION 'This is not a valid link. Paste the full https link from Figma.' USING ERRCODE = '22023', HINT = 'malformed';
  END IF;

  v_scheme := regexp_match(v_url, '^([A-Za-z][A-Za-z0-9+.-]*):');
  IF v_scheme IS NULL THEN
    RAISE EXCEPTION 'This is not a valid link. Paste the full https link from Figma.' USING ERRCODE = '22023', HINT = 'malformed';
  END IF;
  IF lower(v_scheme[1]) <> 'https' THEN
    RAISE EXCEPTION 'Only https Figma links are supported.' USING ERRCODE = '22023', HINT = 'insecure_protocol';
  END IF;

  v_m := regexp_match(v_url, '^[Hh][Tt][Tt][Pp][Ss]://([^/?#]*)([^?#]*)(?:\?([^#]*))?(?:#.*)?$');
  IF v_m IS NULL THEN
    RAISE EXCEPTION 'This is not a valid link. Paste the full https link from Figma.' USING ERRCODE = '22023', HINT = 'malformed';
  END IF;

  IF position('@' IN v_m[1]) > 0 THEN
    RAISE EXCEPTION 'Links containing credentials are not accepted.' USING ERRCODE = '22023', HINT = 'credentials_not_allowed';
  END IF;
  IF position(':' IN v_m[1]) > 0 THEN
    RAISE EXCEPTION 'Links with a custom port are not accepted.' USING ERRCODE = '22023', HINT = 'port_not_allowed';
  END IF;
  v_host := lower(v_m[1]);
  IF v_host NOT IN ('figma.com', 'www.figma.com', 'embed.figma.com') THEN
    RAISE EXCEPTION 'Only links on figma.com are supported.' USING ERRCODE = '22023', HINT = 'unsupported_host';
  END IF;

  v_segs := array_remove(string_to_array(v_m[2], '/'), '');
  v_query := v_m[3];

  kind := CASE v_segs[1]
    WHEN 'design' THEN 'design'
    WHEN 'file' THEN 'design'
    WHEN 'board' THEN 'figjam'
    WHEN 'proto' THEN 'prototype'
    WHEN 'slides' THEN 'slides'
    WHEN 'deck' THEN 'deck'
    ELSE NULL
  END;
  IF kind IS NULL THEN
    RAISE EXCEPTION 'This Figma link type is not supported. Use a Design, FigJam, prototype, Slides, or deck link.'
      USING ERRCODE = '22023', HINT = 'unsupported_route';
  END IF;

  IF v_segs[3] = 'branch' THEN
    v_key := v_segs[4];
    IF v_segs[2] IS NULL OR v_segs[2] !~ '^[A-Za-z0-9_-]{1,128}$' THEN
      RAISE EXCEPTION 'The file key in this link is missing or invalid.' USING ERRCODE = '22023', HINT = 'invalid_file_key';
    END IF;
  ELSE
    v_key := v_segs[2];
  END IF;
  IF v_key IS NULL OR v_key !~ '^[A-Za-z0-9_-]{1,128}$' THEN
    RAISE EXCEPTION 'The file key in this link is missing or invalid.' USING ERRCODE = '22023', HINT = 'invalid_file_key';
  END IF;
  file_key := v_key;

  -- node-id
  v_raw := katalist_priv.figma_query_param(v_query, 'node-id');
  IF v_raw IS NOT NULL THEN
    v_raw := replace(replace(v_raw, '%3A', ':'), '%3a', ':');
    IF v_raw !~ '^[0-9]+[-:][0-9]+$' THEN
      RAISE EXCEPTION 'The frame (node-id) in this link is not supported. Nested or instance targets cannot be embedded; copy the link to the enclosing frame.'
        USING ERRCODE = '22023', HINT = 'invalid_node_id';
    END IF;
    node_id := replace(v_raw, ':', '-');
  END IF;

  -- starting-point-node-id (prototype only)
  IF kind = 'prototype' THEN
    v_raw := katalist_priv.figma_query_param(v_query, 'starting-point-node-id');
    IF v_raw IS NOT NULL THEN
      v_raw := replace(replace(v_raw, '%3A', ':'), '%3a', ':');
      IF v_raw !~ '^[0-9]+[-:][0-9]+$' THEN
        RAISE EXCEPTION 'The prototype starting point in this link is not valid.' USING ERRCODE = '22023', HINT = 'invalid_node_id';
      END IF;
      starting_point_node_id := replace(v_raw, ':', '-');
    END IF;
  END IF;

  -- version-id
  v_raw := katalist_priv.figma_query_param(v_query, 'version-id');
  IF v_raw IS NOT NULL THEN
    IF v_raw !~ '^[0-9]{1,32}$' THEN
      RAISE EXCEPTION 'The version in this link is not valid.' USING ERRCODE = '22023', HINT = 'invalid_version_id';
    END IF;
    version_id := v_raw;
  END IF;

  -- page-id
  v_raw := katalist_priv.figma_query_param(v_query, 'page-id');
  IF v_raw IS NOT NULL THEN
    v_raw := replace(replace(v_raw, '%3A', ':'), '%3a', ':');
    IF v_raw !~ '^[0-9]+[-:][0-9]+$' THEN
      RAISE EXCEPTION 'The page (page-id) in this link is not valid.' USING ERRCODE = '22023', HINT = 'invalid_parameter';
    END IF;
    page_id := replace(v_raw, ':', '-');
  END IF;

  -- prototype viewer options
  IF kind = 'prototype' THEN
    v_scaling := katalist_priv.figma_query_param(v_query, 'scaling');
    IF v_scaling IS NOT NULL AND v_scaling NOT IN ('scale-down', 'contain', 'min-zoom', 'scale-down-width', 'fit-width', 'free') THEN
      RAISE EXCEPTION 'The prototype scaling option in this link is not supported.' USING ERRCODE = '22023', HINT = 'invalid_parameter';
    END IF;
    v_content := katalist_priv.figma_query_param(v_query, 'content-scaling');
    IF v_content IS NOT NULL AND v_content NOT IN ('fixed', 'responsive') THEN
      RAISE EXCEPTION 'The prototype content scaling option in this link is not supported.' USING ERRCODE = '22023', HINT = 'invalid_parameter';
    END IF;
  END IF;

  v_path := CASE kind
    WHEN 'design' THEN 'design'
    WHEN 'figjam' THEN 'board'
    WHEN 'prototype' THEN 'proto'
    ELSE kind
  END;

  IF node_id IS NOT NULL THEN v_params := v_params || '&node-id=' || node_id; END IF;
  IF page_id IS NOT NULL THEN v_params := v_params || '&page-id=' || page_id; END IF;
  IF starting_point_node_id IS NOT NULL THEN v_params := v_params || '&starting-point-node-id=' || starting_point_node_id; END IF;
  IF version_id IS NOT NULL THEN v_params := v_params || '&version-id=' || version_id; END IF;
  IF v_scaling IS NOT NULL THEN v_params := v_params || '&scaling=' || v_scaling; END IF;
  IF v_content IS NOT NULL THEN v_params := v_params || '&content-scaling=' || v_content; END IF;

  original_url := 'https://www.figma.com/' || v_path || '/' || file_key
    || CASE WHEN v_params = '' THEN '' ELSE '?' || substr(v_params, 2) END;

  identity_key := kind || ':' || file_key || ':' || coalesce(node_id, '') || ':'
    || coalesce(starting_point_node_id, '') || ':' || coalesce(version_id, '')
    || CASE WHEN node_id IS NULL AND page_id IS NOT NULL THEN ':page=' || page_id ELSE '' END;
END;
$$;

REVOKE EXECUTE ON FUNCTION katalist_priv.figma_query_param(text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION katalist_priv.parse_figma_url(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION katalist_priv.figma_query_param(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION katalist_priv.parse_figma_url(text) TO service_role;

-- ============ Authorization helpers ============

-- Owner or collaborator of a non-archived List.
CREATE OR REPLACE FUNCTION katalist_priv.can_manage_designs(_list_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.lists l WHERE l.id = _list_id AND l.archived_at IS NULL)
    AND (
      katalist_priv.is_list_owner(_list_id)
      OR katalist_priv.is_list_member(_list_id, ARRAY['collaborator']::public.list_role[])
    );
$$;

-- Profile is the List owner or a member (any role). Not auth.uid() based.
CREATE OR REPLACE FUNCTION katalist_priv.is_list_participant(_list_id uuid, _profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.lists l WHERE l.id = _list_id AND l.owner_profile_id = _profile_id)
      OR EXISTS (SELECT 1 FROM public.list_members m WHERE m.list_id = _list_id AND m.profile_id = _profile_id);
$$;

CREATE OR REPLACE FUNCTION katalist_priv.valid_design_tags(_tags text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $$
  SELECT _tags IS NOT NULL
    AND coalesce(cardinality(_tags), 0) <= 20
    AND NOT EXISTS (
      SELECT 1 FROM unnest(_tags) AS t(tag)
      WHERE tag IS NULL OR length(btrim(tag)) = 0 OR length(tag) > 40
    );
$$;

REVOKE EXECUTE ON FUNCTION katalist_priv.can_manage_designs(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION katalist_priv.is_list_participant(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION katalist_priv.valid_design_tags(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION katalist_priv.can_manage_designs(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION katalist_priv.is_list_participant(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION katalist_priv.valid_design_tags(text[]) TO authenticated, service_role;

-- ============ Tables ============

CREATE TABLE IF NOT EXISTS public.design_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT design_folders_name_valid CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT design_folders_id_list_unique UNIQUE (id, list_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_design_folders_list_name ON public.design_folders (list_id, lower(name));

CREATE TABLE IF NOT EXISTS public.design_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  -- Derived by trg_design_resources_derive from original_url; callers cannot set them.
  kind text NOT NULL,
  file_key text NOT NULL,
  node_id text,
  starting_point_node_id text,
  version_id text,
  page_id text,
  identity_key text NOT NULL,
  original_url text NOT NULL,
  title text NOT NULL,
  notes text,
  tags text[] NOT NULL DEFAULT '{}',
  owner_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  folder_id uuid,
  cover_storage_key text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT design_resources_kind_valid CHECK (kind IN ('design', 'figjam', 'prototype', 'slides', 'deck')),
  CONSTRAINT design_resources_title_valid CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  CONSTRAINT design_resources_notes_valid CHECK (notes IS NULL OR length(notes) <= 4000),
  CONSTRAINT design_resources_tags_valid CHECK (katalist_priv.valid_design_tags(tags)),
  CONSTRAINT design_resources_cover_key_valid CHECK (cover_storage_key IS NULL OR length(cover_storage_key) BETWEEN 1 AND 512),
  CONSTRAINT design_resources_id_list_unique UNIQUE (id, list_id),
  -- Folder must be in the same List; deleting a folder only clears folder_id.
  CONSTRAINT design_resources_folder_fkey FOREIGN KEY (folder_id, list_id)
    REFERENCES public.design_folders (id, list_id) ON DELETE SET NULL (folder_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_design_resources_active_identity
  ON public.design_resources (list_id, identity_key) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_design_resources_list_created
  ON public.design_resources (list_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_design_resources_folder ON public.design_resources (folder_id) WHERE folder_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.design_favorites (
  resource_id uuid NOT NULL,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  list_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (resource_id, profile_id),
  CONSTRAINT design_favorites_resource_fkey FOREIGN KEY (resource_id, list_id)
    REFERENCES public.design_resources (id, list_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_design_favorites_profile_list ON public.design_favorites (profile_id, list_id);

CREATE TABLE IF NOT EXISTS public.design_thing_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id uuid NOT NULL,
  thing_id uuid NOT NULL REFERENCES public.things(id) ON DELETE CASCADE,
  list_id uuid NOT NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT design_thing_links_unique UNIQUE (resource_id, thing_id),
  CONSTRAINT design_thing_links_resource_fkey FOREIGN KEY (resource_id, list_id)
    REFERENCES public.design_resources (id, list_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_design_thing_links_thing ON public.design_thing_links (thing_id);

-- ============ Integrity triggers (bind every writer, including service_role) ============

CREATE OR REPLACE FUNCTION katalist_priv.design_resources_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_parsed record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.list_id IS DISTINCT FROM OLD.list_id THEN
      RAISE EXCEPTION 'A design cannot be moved to another List.' USING ERRCODE = '23514', HINT = 'cross_list';
    END IF;
    IF NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'Creation details are immutable.' USING ERRCODE = '23514';
    END IF;
  END IF;

  -- Re-derive identity only when the URL is new or changed.
  IF TG_OP = 'INSERT' OR NEW.original_url IS DISTINCT FROM OLD.original_url
     OR NEW.identity_key IS DISTINCT FROM OLD.identity_key OR NEW.file_key IS DISTINCT FROM OLD.file_key
     OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.node_id IS DISTINCT FROM OLD.node_id
     OR NEW.starting_point_node_id IS DISTINCT FROM OLD.starting_point_node_id
     OR NEW.version_id IS DISTINCT FROM OLD.version_id OR NEW.page_id IS DISTINCT FROM OLD.page_id THEN
    SELECT * INTO v_parsed FROM katalist_priv.parse_figma_url(NEW.original_url);
    NEW.kind := v_parsed.kind;
    NEW.file_key := v_parsed.file_key;
    NEW.node_id := v_parsed.node_id;
    NEW.starting_point_node_id := v_parsed.starting_point_node_id;
    NEW.version_id := v_parsed.version_id;
    NEW.page_id := v_parsed.page_id;
    NEW.original_url := v_parsed.original_url;
    NEW.identity_key := v_parsed.identity_key;
  END IF;

  IF NEW.owner_profile_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.owner_profile_id IS DISTINCT FROM OLD.owner_profile_id)
     AND NOT katalist_priv.is_list_participant(NEW.list_id, NEW.owner_profile_id) THEN
    RAISE EXCEPTION 'The owner must be a member of this List.' USING ERRCODE = '23514', HINT = 'owner_not_member';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_design_resources_guard ON public.design_resources;
CREATE TRIGGER trg_design_resources_guard BEFORE INSERT OR UPDATE ON public.design_resources
  FOR EACH ROW EXECUTE FUNCTION katalist_priv.design_resources_guard();
DROP TRIGGER IF EXISTS trg_design_resources_updated_at ON public.design_resources;
CREATE TRIGGER trg_design_resources_updated_at BEFORE UPDATE ON public.design_resources
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_design_folders_updated_at ON public.design_folders;
CREATE TRIGGER trg_design_folders_updated_at BEFORE UPDATE ON public.design_folders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION katalist_priv.design_folders_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $$
BEGIN
  IF NEW.list_id IS DISTINCT FROM OLD.list_id THEN
    RAISE EXCEPTION 'A folder cannot be moved to another List.' USING ERRCODE = '23514', HINT = 'cross_list';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_design_folders_guard ON public.design_folders;
CREATE TRIGGER trg_design_folders_guard BEFORE UPDATE ON public.design_folders
  FOR EACH ROW EXECUTE FUNCTION katalist_priv.design_folders_guard();

CREATE OR REPLACE FUNCTION katalist_priv.design_thing_links_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_thing_list uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Design links cannot be edited; unlink and link again.' USING ERRCODE = '23514';
  END IF;
  SELECT t.list_id INTO v_thing_list FROM public.things t WHERE t.id = NEW.thing_id;
  IF v_thing_list IS DISTINCT FROM NEW.list_id THEN
    RAISE EXCEPTION 'The Thing must belong to the same List as the design.' USING ERRCODE = '23514', HINT = 'cross_list';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_design_thing_links_guard ON public.design_thing_links;
CREATE TRIGGER trg_design_thing_links_guard BEFORE INSERT OR UPDATE ON public.design_thing_links
  FOR EACH ROW EXECUTE FUNCTION katalist_priv.design_thing_links_guard();

CREATE OR REPLACE FUNCTION katalist_priv.design_favorites_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  RAISE EXCEPTION 'Favorites cannot be edited.' USING ERRCODE = '23514';
END;
$$;
DROP TRIGGER IF EXISTS trg_design_favorites_guard ON public.design_favorites;
CREATE TRIGGER trg_design_favorites_guard BEFORE UPDATE ON public.design_favorites
  FOR EACH ROW EXECUTE FUNCTION katalist_priv.design_favorites_guard();

-- If a Thing is moved to another List (or out of Lists), its design links no longer apply.
CREATE OR REPLACE FUNCTION katalist_priv.design_links_on_thing_list_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
BEGIN
  DELETE FROM public.design_thing_links l
  WHERE l.thing_id = NEW.id AND l.list_id IS DISTINCT FROM NEW.list_id;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_things_design_links_list_change ON public.things;
CREATE TRIGGER trg_things_design_links_list_change AFTER UPDATE OF list_id ON public.things
  FOR EACH ROW WHEN (OLD.list_id IS DISTINCT FROM NEW.list_id)
  EXECUTE FUNCTION katalist_priv.design_links_on_thing_list_change();

REVOKE EXECUTE ON FUNCTION katalist_priv.design_resources_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION katalist_priv.design_folders_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION katalist_priv.design_thing_links_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION katalist_priv.design_favorites_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION katalist_priv.design_links_on_thing_list_change() FROM PUBLIC, anon, authenticated;

-- ============ Grants + RLS (reads only; writes go through RPCs) ============

-- Supabase's default privileges hand every new public table full DML (including TRUNCATE) to
-- anon and authenticated, so strip them first and grant back only what is intended.
REVOKE ALL ON public.design_folders, public.design_resources, public.design_favorites, public.design_thing_links
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.design_folders, public.design_resources, public.design_favorites, public.design_thing_links TO authenticated;
GRANT ALL ON public.design_folders, public.design_resources, public.design_favorites, public.design_thing_links TO service_role;

ALTER TABLE public.design_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.design_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.design_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.design_thing_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "design folders visible to list viewers" ON public.design_folders;
CREATE POLICY "design folders visible to list viewers" ON public.design_folders
  FOR SELECT TO authenticated USING (katalist_priv.can_view_list(list_id));

DROP POLICY IF EXISTS "design resources visible to list viewers" ON public.design_resources;
CREATE POLICY "design resources visible to list viewers" ON public.design_resources
  FOR SELECT TO authenticated USING (katalist_priv.can_view_list(list_id));

DROP POLICY IF EXISTS "design favorites are private" ON public.design_favorites;
CREATE POLICY "design favorites are private" ON public.design_favorites
  FOR SELECT TO authenticated
  USING (profile_id = auth.uid() AND katalist_priv.can_view_list(list_id));

DROP POLICY IF EXISTS "design thing links visible to list viewers" ON public.design_thing_links;
CREATE POLICY "design thing links visible to list viewers" ON public.design_thing_links
  FOR SELECT TO authenticated USING (katalist_priv.can_view_list(list_id));

-- ============ RPCs ============

CREATE OR REPLACE FUNCTION katalist_priv.normalize_design_tags(_tags text[])
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $$
  SELECT coalesce(array_agg(tag ORDER BY ord), '{}'::text[])
  FROM (
    SELECT DISTINCT ON (lower(btrim(t))) btrim(t) AS tag, ord
    FROM unnest(coalesce(_tags, '{}'::text[])) WITH ORDINALITY AS u(t, ord)
    WHERE t IS NOT NULL AND length(btrim(t)) > 0
    ORDER BY lower(btrim(t)), ord
  ) d;
$$;
REVOKE EXECUTE ON FUNCTION katalist_priv.normalize_design_tags(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION katalist_priv.normalize_design_tags(text[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_design_folder(p_list_id uuid, p_name text)
RETURNS public.design_folders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_me  uuid := auth.uid();
  v_row public.design_folders;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000'; END IF;
  IF NOT katalist_priv.can_view_list(p_list_id) THEN RAISE EXCEPTION 'List not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT katalist_priv.can_manage_designs(p_list_id) THEN
    RAISE EXCEPTION 'You don''t have permission to manage designs in this List.' USING ERRCODE = '42501';
  END IF;
  BEGIN
    INSERT INTO public.design_folders (list_id, name, created_by)
    VALUES (p_list_id, btrim(coalesce(p_name, '')), v_me)
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'A folder with that name already exists.' USING ERRCODE = '23505', HINT = 'duplicate_folder';
  END;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.rename_design_folder(p_folder_id uuid, p_name text)
RETURNS public.design_folders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_me  uuid := auth.uid();
  v_list uuid;
  v_row public.design_folders;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000'; END IF;
  SELECT list_id INTO v_list FROM public.design_folders WHERE id = p_folder_id;
  IF v_list IS NULL OR NOT katalist_priv.can_view_list(v_list) THEN RAISE EXCEPTION 'Folder not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT katalist_priv.can_manage_designs(v_list) THEN
    RAISE EXCEPTION 'You don''t have permission to manage designs in this List.' USING ERRCODE = '42501';
  END IF;
  BEGIN
    UPDATE public.design_folders SET name = btrim(coalesce(p_name, '')) WHERE id = p_folder_id RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'A folder with that name already exists.' USING ERRCODE = '23505', HINT = 'duplicate_folder';
  END;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_design_folder(p_folder_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_me   uuid := auth.uid();
  v_list uuid;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000'; END IF;
  SELECT list_id INTO v_list FROM public.design_folders WHERE id = p_folder_id;
  IF v_list IS NULL OR NOT katalist_priv.can_view_list(v_list) THEN RAISE EXCEPTION 'Folder not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT katalist_priv.can_manage_designs(v_list) THEN
    RAISE EXCEPTION 'You don''t have permission to manage designs in this List.' USING ERRCODE = '42501';
  END IF;
  -- Designs in the folder stay and become unfiled (FK ON DELETE SET NULL (folder_id)).
  DELETE FROM public.design_folders WHERE id = p_folder_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_design_resource(
  p_list_id uuid,
  p_url text,
  p_title text,
  p_notes text DEFAULT NULL,
  p_tags text[] DEFAULT '{}',
  p_owner_profile_id uuid DEFAULT NULL,
  p_folder_id uuid DEFAULT NULL
)
RETURNS public.design_resources
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_me       uuid := auth.uid();
  v_row      public.design_resources;
  v_existing uuid;
  v_parsed   record;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000'; END IF;
  IF NOT katalist_priv.can_view_list(p_list_id) THEN RAISE EXCEPTION 'List not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT katalist_priv.can_manage_designs(p_list_id) THEN
    RAISE EXCEPTION 'You don''t have permission to manage designs in this List.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_parsed FROM katalist_priv.parse_figma_url(p_url);  -- raises with HINT = error code

  INSERT INTO public.design_resources (list_id, original_url, title, notes, tags, owner_profile_id, folder_id, created_by)
  VALUES (
    p_list_id, p_url, btrim(coalesce(p_title, '')), nullif(btrim(coalesce(p_notes, '')), ''),
    katalist_priv.normalize_design_tags(p_tags), coalesce(p_owner_profile_id, v_me), p_folder_id, v_me
  )
  ON CONFLICT (list_id, identity_key) WHERE archived_at IS NULL DO NOTHING
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    SELECT id INTO v_existing FROM public.design_resources
    WHERE list_id = p_list_id AND identity_key = v_parsed.identity_key AND archived_at IS NULL;
    RAISE EXCEPTION 'This design is already saved in this List.'
      USING ERRCODE = '23505', HINT = 'duplicate_design', DETAIL = coalesce(v_existing::text, '');
  END IF;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_design_resource(
  p_resource_id uuid,
  p_title text,
  p_notes text DEFAULT NULL,
  p_tags text[] DEFAULT '{}',
  p_owner_profile_id uuid DEFAULT NULL,
  p_folder_id uuid DEFAULT NULL,
  p_url text DEFAULT NULL
)
RETURNS public.design_resources
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_me  uuid := auth.uid();
  v_cur public.design_resources;
  v_row public.design_resources;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000'; END IF;
  SELECT * INTO v_cur FROM public.design_resources WHERE id = p_resource_id FOR UPDATE;
  IF v_cur.id IS NULL OR NOT katalist_priv.can_view_list(v_cur.list_id) THEN
    RAISE EXCEPTION 'Design not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT katalist_priv.can_manage_designs(v_cur.list_id) THEN
    RAISE EXCEPTION 'You don''t have permission to manage designs in this List.' USING ERRCODE = '42501';
  END IF;
  IF v_cur.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Restore this design before editing it.' USING ERRCODE = '55000', HINT = 'archived';
  END IF;
  BEGIN
    UPDATE public.design_resources SET
      title = btrim(coalesce(p_title, '')),
      notes = nullif(btrim(coalesce(p_notes, '')), ''),
      tags = katalist_priv.normalize_design_tags(p_tags),
      owner_profile_id = coalesce(p_owner_profile_id, v_cur.owner_profile_id),
      folder_id = p_folder_id,
      original_url = coalesce(p_url, v_cur.original_url)
    WHERE id = p_resource_id
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'This design is already saved in this List.' USING ERRCODE = '23505', HINT = 'duplicate_design';
  END;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_design_resource_archived(p_resource_id uuid, p_archived boolean)
RETURNS public.design_resources
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_me  uuid := auth.uid();
  v_cur public.design_resources;
  v_row public.design_resources;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000'; END IF;
  SELECT * INTO v_cur FROM public.design_resources WHERE id = p_resource_id FOR UPDATE;
  IF v_cur.id IS NULL OR NOT katalist_priv.can_view_list(v_cur.list_id) THEN
    RAISE EXCEPTION 'Design not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT katalist_priv.can_manage_designs(v_cur.list_id) THEN
    RAISE EXCEPTION 'You don''t have permission to manage designs in this List.' USING ERRCODE = '42501';
  END IF;
  BEGIN
    UPDATE public.design_resources
    SET archived_at = CASE WHEN p_archived THEN coalesce(archived_at, now()) ELSE NULL END
    WHERE id = p_resource_id
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'An active design with the same link already exists in this List.'
      USING ERRCODE = '23505', HINT = 'duplicate_design';
  END;
  RETURN v_row;
END;
$$;

-- Favorites are personal and allowed for every List viewer, including view_only members.
CREATE OR REPLACE FUNCTION public.set_design_favorite(p_resource_id uuid, p_favorite boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_me  uuid := auth.uid();
  v_res public.design_resources;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000'; END IF;
  SELECT * INTO v_res FROM public.design_resources WHERE id = p_resource_id;
  IF v_res.id IS NULL OR NOT katalist_priv.can_view_list(v_res.list_id) THEN
    RAISE EXCEPTION 'Design not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_favorite THEN
    IF v_res.archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'Archived designs cannot be favorited.' USING ERRCODE = '55000', HINT = 'archived';
    END IF;
    INSERT INTO public.design_favorites (resource_id, profile_id, list_id)
    VALUES (p_resource_id, v_me, v_res.list_id)
    ON CONFLICT (resource_id, profile_id) DO NOTHING;
  ELSE
    DELETE FROM public.design_favorites WHERE resource_id = p_resource_id AND profile_id = v_me;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.link_design_thing(p_resource_id uuid, p_thing_id uuid)
RETURNS public.design_thing_links
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_me    uuid := auth.uid();
  v_res   public.design_resources;
  v_thing uuid;
  v_row   public.design_thing_links;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000'; END IF;
  SELECT * INTO v_res FROM public.design_resources WHERE id = p_resource_id;
  IF v_res.id IS NULL OR NOT katalist_priv.can_view_list(v_res.list_id) THEN
    RAISE EXCEPTION 'Design not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT katalist_priv.can_manage_designs(v_res.list_id) THEN
    RAISE EXCEPTION 'You don''t have permission to manage designs in this List.' USING ERRCODE = '42501';
  END IF;
  IF v_res.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Restore this design before linking Things.' USING ERRCODE = '55000', HINT = 'archived';
  END IF;
  -- A Thing in this List is visible to every List viewer (can_view_thing), so a
  -- same-List check is the authorization check; Things elsewhere read as not found.
  SELECT t.id INTO v_thing FROM public.things t WHERE t.id = p_thing_id AND t.list_id = v_res.list_id;
  IF v_thing IS NULL THEN
    RAISE EXCEPTION 'Thing not found in this List.' USING ERRCODE = 'P0002', HINT = 'cross_list';
  END IF;
  INSERT INTO public.design_thing_links (resource_id, thing_id, list_id, created_by)
  VALUES (p_resource_id, p_thing_id, v_res.list_id, v_me)
  ON CONFLICT (resource_id, thing_id) DO NOTHING
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN  -- already linked: idempotent
    SELECT * INTO v_row FROM public.design_thing_links WHERE resource_id = p_resource_id AND thing_id = p_thing_id;
  END IF;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.unlink_design_thing(p_resource_id uuid, p_thing_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_me  uuid := auth.uid();
  v_res public.design_resources;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000'; END IF;
  SELECT * INTO v_res FROM public.design_resources WHERE id = p_resource_id;
  IF v_res.id IS NULL OR NOT katalist_priv.can_view_list(v_res.list_id) THEN
    RAISE EXCEPTION 'Design not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT katalist_priv.can_manage_designs(v_res.list_id) THEN
    RAISE EXCEPTION 'You don''t have permission to manage designs in this List.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.design_thing_links WHERE resource_id = p_resource_id AND thing_id = p_thing_id;
END;
$$;

-- ============ RPC grants ============

REVOKE EXECUTE ON FUNCTION public.create_design_folder(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rename_design_folder(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_design_folder(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.add_design_resource(uuid, text, text, text, text[], uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_design_resource(uuid, text, text, text[], uuid, uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_design_resource_archived(uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_design_favorite(uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.link_design_thing(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.unlink_design_thing(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_design_folder(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rename_design_folder(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_design_folder(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.add_design_resource(uuid, text, text, text, text[], uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_design_resource(uuid, text, text, text[], uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_design_resource_archived(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_design_favorite(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.link_design_thing(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unlink_design_thing(uuid, uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
