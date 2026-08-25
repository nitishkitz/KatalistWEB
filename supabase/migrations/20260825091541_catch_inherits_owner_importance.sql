-- Forward-only: first Catch copies Owner Importance into Personal Pace
-- unless an explicit Pace is supplied. Signature stays catch_thing(uuid, pace).

CREATE OR REPLACE FUNCTION public.catch_thing(
  p_thing_id uuid,
  p_personal_pace public.pace DEFAULT NULL
)
RETURNS public.things
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv
AS $$
DECLARE
  v_me    uuid := katalist_priv.current_actor_id();
  v_thing public.things;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_thing FROM public.things WHERE id = p_thing_id FOR UPDATE;
  IF NOT FOUND OR NOT katalist_priv.can_view_thing(p_thing_id) THEN
    RAISE EXCEPTION 'Thing not found';
  END IF;
  IF v_thing.current_assignee_actor_id <> v_me THEN
    RAISE EXCEPTION 'only the current assignee can Catch this Thing';
  END IF;
  IF v_thing.work_status IN ('sorted','cancelled') THEN
    RAISE EXCEPTION 'a % Thing cannot be caught', v_thing.work_status;
  END IF;
  IF v_thing.acknowledgement = 'caught' THEN
    RETURN v_thing;
  END IF;

  UPDATE public.things
     SET acknowledgement        = 'caught',
         caught_at              = now(),
         assignee_personal_pace = COALESCE(
           p_personal_pace,
           v_thing.owner_importance::text::public.pace,
           'next'::public.pace
         )
   WHERE id = p_thing_id
  RETURNING * INTO v_thing;

  UPDATE public.thing_assignments
     SET acknowledgement = 'caught', caught_at = now()
   WHERE id = v_thing.current_assignment_id;

  PERFORM katalist_priv.log_activity(p_thing_id, v_me, 'caught',
    jsonb_build_object('pace', v_thing.assignee_personal_pace));

  RETURN v_thing;
END;
$$;

REVOKE ALL ON FUNCTION public.catch_thing(uuid, public.pace) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.catch_thing(uuid, public.pace) TO authenticated, service_role;
