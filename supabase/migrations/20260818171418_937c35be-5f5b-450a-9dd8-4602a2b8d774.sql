CREATE OR REPLACE FUNCTION public.reassign_thing(p_thing_id uuid, p_new_assignee_actor_id uuid)
RETURNS things
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_me      uuid := katalist_priv.current_actor_id();
  v_thing   public.things;
  v_old_assignment uuid;
  v_old_assignee   uuid;
  v_new_assignment uuid;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_thing FROM public.things WHERE id = p_thing_id FOR UPDATE;
  IF NOT FOUND OR NOT katalist_priv.can_view_thing(p_thing_id) THEN
    RAISE EXCEPTION 'Thing not found';
  END IF;
  IF v_thing.work_status IN ('sorted','cancelled') THEN
    RAISE EXCEPTION 'a % Thing cannot be reassigned', v_thing.work_status;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.actors a WHERE a.id = p_new_assignee_actor_id) THEN
    RAISE EXCEPTION 'unknown assignee';
  END IF;
  IF p_new_assignee_actor_id = v_thing.current_assignee_actor_id THEN
    RAISE EXCEPTION 'this person already holds the Thing';
  END IF;

  IF v_thing.owner_actor_id = v_me THEN
    NULL;
  ELSIF v_thing.current_assignee_actor_id = v_me THEN
    IF v_thing.acknowledgement <> 'caught'
       OR v_thing.work_status NOT IN ('not_started','under_progress') THEN
      RAISE EXCEPTION 'catch the Thing before handing it on';
    END IF;
  ELSE
    RAISE EXCEPTION 'only the Thing Owner or the current assignee can reassign';
  END IF;

  v_old_assignment := v_thing.current_assignment_id;
  v_old_assignee   := v_thing.current_assignee_actor_id;

  UPDATE public.thing_assignments
     SET ended_at = now(), ended_reason = 'reassigned'
   WHERE id = v_old_assignment AND ended_at IS NULL;

  PERFORM katalist_priv.revoke_bridge_for_assignment(v_old_assignment, 'reassigned');

  INSERT INTO public.thing_assignments (thing_id, assignee_actor_id, assigned_by_actor_id)
  VALUES (p_thing_id, p_new_assignee_actor_id, v_me)
  RETURNING id INTO v_new_assignment;

  -- Execution progress belongs to an assignment: the new holder starts fresh.
  -- Owner Importance, Due, Context, List, Creator and Owner are preserved.
  UPDATE public.things
     SET current_assignee_actor_id = p_new_assignee_actor_id,
         current_assignment_id     = v_new_assignment,
         acknowledgement           = 'waiting_for_catch',
         assignee_personal_pace    = NULL,
         caught_at                 = NULL,
         work_status               = 'not_started'
   WHERE id = p_thing_id
  RETURNING * INTO v_thing;

  PERFORM katalist_priv.log_activity(p_thing_id, v_me, 'reassigned',
    jsonb_build_object(
      'from_actor_id', v_old_assignee,
      'to_actor_id',   p_new_assignee_actor_id,
      'from_assignment_id', v_old_assignment,
      'to_assignment_id',   v_new_assignment,
      'by_actor_id',   v_me));
  PERFORM katalist_priv.log_activity(p_thing_id, v_me, 'assigned',
    jsonb_build_object('assignee_actor_id', p_new_assignee_actor_id, 'assignment_id', v_new_assignment));

  RETURN v_thing;
END;
$$;