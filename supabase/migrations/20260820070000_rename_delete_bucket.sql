-- Owner-only rename/delete for private Buckets.
-- Does not mutate underlying Things or Lists.
-- bucket_items cascade on bucket delete (private references only).
-- Ownership is checked against buckets.owner_profile_id = auth.uid()
-- (same owner-only rule as existing Bucket RPCs; no extra helper required).

CREATE OR REPLACE FUNCTION public.rename_bucket(p_bucket_id uuid, p_name text)
RETURNS public.buckets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv
AS $$
DECLARE
  v_bucket public.buckets;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RAISE EXCEPTION 'a Bucket needs a name';
  END IF;

  UPDATE public.buckets
     SET name = btrim(p_name)
   WHERE id = p_bucket_id
     AND owner_profile_id = auth.uid()
  RETURNING * INTO v_bucket;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bucket not found';
  END IF;
  RETURN v_bucket;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_bucket(p_bucket_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  DELETE FROM public.buckets
   WHERE id = p_bucket_id
     AND owner_profile_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bucket not found';
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.rename_bucket(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rename_bucket(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.delete_bucket(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_bucket(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.rename_bucket(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_bucket(uuid) TO authenticated;
