-- Edit a List's description after creation (owner only). Pairs with set_list_cover
-- so an owner can add or change the description and cover of an existing List.

CREATE OR REPLACE FUNCTION public.set_list_description(p_list_id uuid, p_description text)
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
     SET description = NULLIF(btrim(COALESCE(p_description, '')), '')
   WHERE id = p_list_id
     AND owner_profile_id = v_me
  RETURNING * INTO v_list;

  IF v_list.id IS NULL THEN
    RAISE EXCEPTION 'List not found';
  END IF;

  RETURN v_list;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.set_list_description(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_list_description(uuid, text) TO authenticated, service_role;
