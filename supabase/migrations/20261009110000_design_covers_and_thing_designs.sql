-- Designs (Stage 5): optional manual cover images and "designs linked to a Thing" reads.
--
-- Covers are uploaded by a person (no screenshot capture of embeds) into the PRIVATE
-- `design-covers` bucket at `{list_id}/{design_resource_id}/{file}.{png|jpg|jpeg|webp}`.
-- Storage policies derive the List from the object path, so access follows List
-- membership rather than a bucket-wide grant:
--   read   -> any List viewer          (signed URLs are authorized by this policy)
--   upload -> owner/collaborator of the List, for an ACTIVE design in that List
--   delete -> owner/collaborator of the List
-- There is deliberately no UPDATE policy: a replacement is a new object, so an
-- upload can never overwrite another design's cover.
--
-- The bucket enforces a 5 MiB limit and png/jpeg/webp only. Clients validate too, but
-- this is the authoritative check. The database row is only changed through
-- set_design_cover / clear_design_cover, which return the PREVIOUS key so the client
-- can delete the replaced object (best effort; a failed delete leaves an orphan
-- object but never a wrong cover).

ALTER TABLE public.design_resources
  DROP CONSTRAINT IF EXISTS design_resources_cover_key_scope;
ALTER TABLE public.design_resources
  ADD CONSTRAINT design_resources_cover_key_scope
  CHECK (cover_storage_key IS NULL OR cover_storage_key LIKE (list_id::text || '/' || id::text || '/%'));

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('design-covers', 'design-covers', false, 5242880, ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = false, file_size_limit = 5242880, allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp'];

-- Splits `{list_id}/{resource_id}/{file}` into its ids; NULLs unless the whole path is well formed.
CREATE OR REPLACE FUNCTION katalist_priv.design_cover_parts(_name text, OUT list_id uuid, OUT resource_id uuid)
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $$
  SELECT CASE WHEN m IS NULL THEN NULL ELSE m[1]::uuid END,
         CASE WHEN m IS NULL THEN NULL ELSE m[2]::uuid END
  FROM (
    SELECT regexp_match(
      coalesce(_name, ''),
      '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/[A-Za-z0-9][A-Za-z0-9_-]{0,80}\.(png|jpg|jpeg|webp)$'
    ) AS m
  ) p;
$$;

-- True when `_name` is a well-formed cover path for an ACTIVE design in the path's List.
CREATE OR REPLACE FUNCTION katalist_priv.design_cover_target_active(_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM katalist_priv.design_cover_parts(_name) p
    JOIN public.design_resources r ON r.id = p.resource_id AND r.list_id = p.list_id
    WHERE p.list_id IS NOT NULL AND r.archived_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION katalist_priv.design_cover_list(_name text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog', 'katalist_priv'
AS $$
  SELECT list_id FROM katalist_priv.design_cover_parts(_name);
$$;

REVOKE EXECUTE ON FUNCTION katalist_priv.design_cover_parts(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION katalist_priv.design_cover_target_active(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION katalist_priv.design_cover_list(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION katalist_priv.design_cover_parts(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION katalist_priv.design_cover_target_active(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION katalist_priv.design_cover_list(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "design covers readable by list viewers" ON storage.objects;
CREATE POLICY "design covers readable by list viewers"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'design-covers'
    AND katalist_priv.design_cover_list(name) IS NOT NULL
    AND katalist_priv.can_view_list(katalist_priv.design_cover_list(name))
  );

DROP POLICY IF EXISTS "design covers insertable by list managers" ON storage.objects;
CREATE POLICY "design covers insertable by list managers"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'design-covers'
    AND katalist_priv.design_cover_list(name) IS NOT NULL
    AND katalist_priv.can_manage_designs(katalist_priv.design_cover_list(name))
    AND katalist_priv.design_cover_target_active(name)
  );

DROP POLICY IF EXISTS "design covers deletable by list managers" ON storage.objects;
CREATE POLICY "design covers deletable by list managers"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'design-covers'
    AND katalist_priv.design_cover_list(name) IS NOT NULL
    AND katalist_priv.can_manage_designs(katalist_priv.design_cover_list(name))
  );

-- ============ RPCs ============

-- Points a design at an already-uploaded cover object. Returns the PREVIOUS key (or NULL)
-- so the caller can delete the replaced object.
CREATE OR REPLACE FUNCTION public.set_design_cover(p_resource_id uuid, p_storage_key text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_me  uuid := auth.uid();
  v_cur public.design_resources;
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
    RAISE EXCEPTION 'Restore this design before changing its cover.' USING ERRCODE = '55000', HINT = 'archived';
  END IF;
  IF p_storage_key IS NULL
     OR p_storage_key NOT LIKE (v_cur.list_id::text || '/' || v_cur.id::text || '/%')
     OR (SELECT list_id FROM katalist_priv.design_cover_parts(p_storage_key)) IS DISTINCT FROM v_cur.list_id THEN
    RAISE EXCEPTION 'That cover does not belong to this design.' USING ERRCODE = '23514', HINT = 'cross_list';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'design-covers' AND o.name = p_storage_key) THEN
    RAISE EXCEPTION 'The cover image was not uploaded.' USING ERRCODE = 'P0002', HINT = 'cover_missing';
  END IF;
  IF v_cur.cover_storage_key IS NOT DISTINCT FROM p_storage_key THEN
    RETURN NULL;  -- already current: nothing to clean up
  END IF;
  UPDATE public.design_resources SET cover_storage_key = p_storage_key WHERE id = p_resource_id;
  RETURN v_cur.cover_storage_key;
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_design_cover(p_resource_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_me  uuid := auth.uid();
  v_cur public.design_resources;
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
    RAISE EXCEPTION 'Restore this design before changing its cover.' USING ERRCODE = '55000', HINT = 'archived';
  END IF;
  UPDATE public.design_resources SET cover_storage_key = NULL WHERE id = p_resource_id;
  RETURN v_cur.cover_storage_key;
END;
$$;

-- Designs linked to a Thing. SECURITY INVOKER: both tables' RLS applies, so only List
-- viewers see anything, and links to Things in other Lists cannot exist (Stage 2 guard).
CREATE OR REPLACE FUNCTION public.get_thing_designs(p_thing_id uuid)
RETURNS SETOF public.design_resources
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT r.*
  FROM public.design_thing_links l
  JOIN public.design_resources r ON r.id = l.resource_id
  WHERE l.thing_id = p_thing_id
  ORDER BY l.created_at DESC, r.id DESC
  LIMIT 50;
$$;

REVOKE EXECUTE ON FUNCTION public.set_design_cover(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.clear_design_cover(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_thing_designs(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_design_cover(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.clear_design_cover(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_thing_designs(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
