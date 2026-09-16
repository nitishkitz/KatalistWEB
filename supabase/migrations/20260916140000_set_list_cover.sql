-- Attach a cover image to a List after creation.
-- The lists_cover_private_path CHECK requires cover_storage_path to be
-- '<list_id>/<filename>', so the cover can only be set once the List exists.
-- This RPC lets the owner attach (or clear) the cover in that second step.

CREATE OR REPLACE FUNCTION public.set_list_cover(p_list_id uuid, p_cover_storage_path text)
RETURNS public.lists
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $function$
DECLARE
  v_me   uuid := auth.uid();
  v_list public.lists;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  UPDATE public.lists
     SET cover_storage_path = NULLIF(btrim(COALESCE(p_cover_storage_path, '')), '')
   WHERE id = p_list_id
     AND owner_profile_id = v_me
  RETURNING * INTO v_list;

  IF v_list.id IS NULL THEN
    RAISE EXCEPTION 'List not found';
  END IF;

  RETURN v_list;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.set_list_cover(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_list_cover(uuid, text) TO authenticated, service_role;
