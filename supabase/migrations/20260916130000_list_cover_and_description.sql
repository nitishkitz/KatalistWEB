-- Create List dialog: optional Description and cover image.
-- The lists table already carries `description` and `cover_storage_path`; this
-- wires them through create_list and grants storage access to the private
-- `list-covers` bucket.

-- 1. Extend create_list to persist description + cover path. Context still
--    defaults to the caller's active mode, so the dialog no longer needs to ask.
DROP FUNCTION IF EXISTS public.create_list(text, public.context_kind);

CREATE OR REPLACE FUNCTION public.create_list(
  p_name text,
  p_context public.context_kind DEFAULT NULL::public.context_kind,
  p_description text DEFAULT NULL,
  p_cover_storage_path text DEFAULT NULL
)
RETURNS public.lists
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $function$
DECLARE
  v_list public.lists;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RAISE EXCEPTION 'a List needs a name';
  END IF;

  INSERT INTO public.lists (name, owner_profile_id, context, description, cover_storage_path)
  VALUES (
    btrim(p_name),
    auth.uid(),
    COALESCE(p_context, katalist_priv.active_context()),
    NULLIF(btrim(COALESCE(p_description, '')), ''),
    NULLIF(btrim(COALESCE(p_cover_storage_path, '')), '')
  )
  RETURNING * INTO v_list;

  RETURN v_list;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.create_list(text, public.context_kind, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_list(text, public.context_kind, text, text) TO authenticated, service_role;

-- 2. Storage policies for the private list-covers bucket.
--    Any authenticated user may read a cover (they are shown on list cards to
--    members); write/replace/delete are limited to the uploading owner.
CREATE POLICY "list covers readable by authenticated"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'list-covers');

CREATE POLICY "list covers insertable by owner"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'list-covers' AND owner = auth.uid());

CREATE POLICY "list covers updatable by owner"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'list-covers' AND owner = auth.uid());

CREATE POLICY "list covers deletable by owner"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'list-covers' AND owner = auth.uid());
