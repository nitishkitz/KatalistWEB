CREATE OR REPLACE FUNCTION public.add_to_bucket(
  p_bucket_id uuid,
  p_thing_id uuid DEFAULT NULL,
  p_list_id uuid DEFAULT NULL
)
RETURNS public.bucket_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv'
AS $$
DECLARE
  v_item public.bucket_items;
BEGIN
  IF NOT katalist_priv.is_bucket_owner(p_bucket_id) THEN
    RAISE EXCEPTION 'Bucket not found';
  END IF;
  IF num_nonnulls(p_thing_id, p_list_id) <> 1 THEN
    RAISE EXCEPTION 'add exactly one Thing or one List';
  END IF;
  IF p_thing_id IS NOT NULL AND NOT katalist_priv.can_view_thing(p_thing_id) THEN
    RAISE EXCEPTION 'Thing not found';
  END IF;
  IF p_list_id IS NOT NULL AND NOT katalist_priv.can_view_list(p_list_id) THEN
    RAISE EXCEPTION 'List not found';
  END IF;

  SELECT bi.*
    INTO v_item
    FROM public.bucket_items AS bi
   WHERE bi.bucket_id = p_bucket_id
     AND bi.thing_id IS NOT DISTINCT FROM p_thing_id
     AND bi.list_id IS NOT DISTINCT FROM p_list_id;

  IF FOUND THEN
    RETURN v_item;
  END IF;

  BEGIN
    INSERT INTO public.bucket_items (bucket_id, thing_id, list_id)
    VALUES (p_bucket_id, p_thing_id, p_list_id)
    RETURNING * INTO v_item;
  EXCEPTION WHEN unique_violation THEN
    SELECT bi.*
      INTO v_item
      FROM public.bucket_items AS bi
     WHERE bi.bucket_id = p_bucket_id
       AND bi.thing_id IS NOT DISTINCT FROM p_thing_id
       AND bi.list_id IS NOT DISTINCT FROM p_list_id;
    IF FOUND THEN
      RETURN v_item;
    END IF;
    RAISE;
  END;

  PERFORM katalist_priv.log_private(
    auth.uid(),
    'bucket_ref_added',
    CASE WHEN p_thing_id IS NOT NULL THEN 'thing' ELSE 'list' END::public.object_type,
    COALESCE(p_thing_id, p_list_id),
    jsonb_build_object('bucket_id', p_bucket_id)
  );

  RETURN v_item;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.add_to_bucket(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_to_bucket(uuid, uuid, uuid) TO authenticated;
