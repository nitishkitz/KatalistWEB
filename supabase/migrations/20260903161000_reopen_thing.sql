CREATE OR REPLACE FUNCTION public.reopen_thing(p_thing_id uuid)
RETURNS public.things
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv
AS $$
DECLARE
  v_me    uuid := katalist_priv.current_actor_id();
  v_thing public.things;
BEGIN
  SELECT * INTO v_thing FROM public.things WHERE id = p_thing_id FOR UPDATE;
  IF NOT FOUND OR NOT katalist_priv.can_view_thing(p_thing_id) THEN
    RAISE EXCEPTION 'Thing not found';
  END IF;
  IF v_thing.owner_actor_id <> v_me THEN
    RAISE EXCEPTION 'only the Thing Owner can reopen this Thing';
  END IF;

  UPDATE public.things
     SET work_status = 'not_started,
         cancelled_at = NULL,
         acknowledgement = 'waiting_for_catch,
         updated_at = now()
   WHERE id = p_thing_id
   RETURNING * INTO v_thing;

  PERFORM katalist_priv.log_activity(p_thing_id, v_me, 'reopened, '{}'::jsonb);
  RETURN v_thing;
END;
$$;

REVOKE ALL ON FUNCTION public.reopen_thing(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reopen_thing(uuid) TO authenticated;
