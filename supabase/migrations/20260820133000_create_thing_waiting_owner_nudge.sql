-- Forward-only: every new assignee starts Waiting for Catch.
-- Manual Nudge is Owner → current Assignee only.
-- Public function signatures are unchanged.

CREATE OR REPLACE FUNCTION public.create_thing(
  p_title            text,
  p_assignee_actor_id uuid DEFAULT NULL,
  p_notes            text DEFAULT NULL,
  p_context          public.context_kind DEFAULT NULL,
  p_owner_importance public.importance DEFAULT NULL,
  p_personal_pace    public.pace DEFAULT NULL,
  p_due_at           timestamptz DEFAULT NULL,
  p_due_has_time     boolean DEFAULT false,
  p_list_id          uuid DEFAULT NULL
)
RETURNS public.things
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv
AS $$
DECLARE
  v_me         uuid := katalist_priv.current_actor_id();
  v_assignee   uuid;
  v_context    public.context_kind;
  v_self       boolean;
  v_thing      public.things;
  v_assignment uuid;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_title IS NULL OR length(btrim(p_title)) = 0 THEN
    RAISE EXCEPTION 'a Thing needs a title';
  END IF;

  IF NOT katalist_priv.can_create_thing_in_list(p_list_id) THEN
    RAISE EXCEPTION 'you cannot create a Thing in that List';
  END IF;

  v_assignee := COALESCE(p_assignee_actor_id, v_me);
  IF NOT EXISTS (SELECT 1 FROM public.actors a WHERE a.id = v_assignee) THEN
    RAISE EXCEPTION 'unknown assignee';
  END IF;

  -- Signature keeps p_personal_pace; Catch is the only normal pace transition.
  IF p_personal_pace IS NOT NULL THEN
    NULL;
  END IF;

  v_context := COALESCE(katalist_priv.list_context(p_list_id), p_context, katalist_priv.active_context());
  v_self := (v_assignee = v_me);

  INSERT INTO public.things (
    title, notes, creator_actor_id, owner_actor_id, current_assignee_actor_id,
    list_id, context, owner_importance, assignee_personal_pace,
    acknowledgement, work_status, caught_at, due_at, due_has_time
  ) VALUES (
    btrim(p_title), NULLIF(btrim(COALESCE(p_notes,'')), ''), v_me, v_me, v_assignee,
    p_list_id, v_context, COALESCE(p_owner_importance, 'next'),
    NULL,
    'waiting_for_catch'::public.acknowledgement_state,
    'not_started',
    NULL,
    p_due_at, COALESCE(p_due_has_time, false)
  )
  RETURNING * INTO v_thing;

  INSERT INTO public.thing_assignments (
    thing_id, assignee_actor_id, assigned_by_actor_id, acknowledgement, caught_at
  ) VALUES (
    v_thing.id, v_assignee, v_me,
    'waiting_for_catch'::public.acknowledgement_state,
    NULL
  )
  RETURNING id INTO v_assignment;

  UPDATE public.things SET current_assignment_id = v_assignment
  WHERE id = v_thing.id
  RETURNING * INTO v_thing;

  PERFORM katalist_priv.log_activity(v_thing.id, v_me, 'created',
    jsonb_build_object('context', v_context, 'owner_importance', v_thing.owner_importance));
  PERFORM katalist_priv.log_activity(v_thing.id, v_me, 'assigned',
    jsonb_build_object('assignee_actor_id', v_assignee, 'self', v_self));

  RETURN v_thing;
END;
$$;

CREATE OR REPLACE FUNCTION public.nudge_thing(
  p_thing_id uuid,
  p_reason public.nudge_reason DEFAULT 'quiet',
  p_message text DEFAULT NULL
)
RETURNS public.nudges
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_me       uuid := katalist_priv.current_actor_id();
  v_thing    public.things;
  v_target   uuid;
  v_cooldown integer := katalist_priv.config_int('nudge_cooldown_minutes', 120);
  v_last     timestamptz;
  v_nudge    public.nudges;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_thing FROM public.things WHERE id = p_thing_id;
  IF NOT FOUND OR NOT katalist_priv.can_view_thing(p_thing_id) THEN
    RAISE EXCEPTION 'Thing not found';
  END IF;
  IF v_thing.work_status IN ('sorted','cancelled') THEN
    RAISE EXCEPTION 'a % Thing cannot be nudged', v_thing.work_status;
  END IF;

  IF v_me <> v_thing.owner_actor_id THEN
    RAISE EXCEPTION 'you don’t have permission to nudge';
  END IF;
  IF v_thing.current_assignee_actor_id = v_me THEN
    RAISE EXCEPTION 'you cannot nudge yourself';
  END IF;

  v_target := v_thing.current_assignee_actor_id;

  SELECT max(n.created_at) INTO v_last
    FROM public.nudges n
   WHERE n.thing_id = p_thing_id AND n.to_actor_id = v_target;

  IF v_last IS NOT NULL AND v_last > now() - make_interval(mins => v_cooldown) THEN
    RAISE EXCEPTION 'you nudged recently — try again later';
  END IF;

  INSERT INTO public.nudges (thing_id, from_actor_id, to_actor_id, reason, message)
  VALUES (p_thing_id, v_me, v_target, COALESCE(p_reason, 'quiet'),
          NULLIF(btrim(COALESCE(p_message, '')), ''))
  RETURNING * INTO v_nudge;

  PERFORM katalist_priv.log_activity(p_thing_id, v_me, 'nudged',
    jsonb_build_object('to_actor_id', v_target, 'reason', v_nudge.reason));

  RETURN v_nudge;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_nudgeable_things()
RETURNS TABLE(thing_id uuid, title text, to_actor_id uuid, reason public.nudge_reason, since timestamptz)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
  WITH me AS (SELECT katalist_priv.current_actor_id() AS actor_id),
  candidates AS (
    SELECT t.id,
           t.title,
           t.current_assignee_actor_id AS target,
           CASE
             WHEN t.acknowledgement = 'waiting_for_catch'
                  AND t.updated_at < now() - make_interval(hours => katalist_priv.config_int('nudge_waiting_hours', 4))
               THEN 'waiting_for_catch'
             WHEN t.due_at IS NOT NULL
                  AND t.due_at <= now() + make_interval(hours => katalist_priv.config_int('nudge_due_soon_hours', 3))
               THEN 'due_soon'
             WHEN t.updated_at < now() - make_interval(hours => katalist_priv.config_int('nudge_stale_hours', 48))
               THEN 'stale'
             WHEN t.updated_at < now() - make_interval(hours => katalist_priv.config_int('nudge_quiet_hours', 18))
               THEN 'quiet'
           END::public.nudge_reason AS reason,
           t.updated_at
      FROM public.things t, me
     WHERE t.work_status NOT IN ('sorted','cancelled')
       AND me.actor_id IS NOT NULL
       AND t.owner_actor_id = me.actor_id
       AND t.current_assignee_actor_id <> me.actor_id
       AND katalist_priv.can_view_thing(t.id)
  )
  SELECT c.id, c.title, c.target, c.reason, c.updated_at
    FROM candidates c, me
   WHERE c.reason IS NOT NULL
     AND c.target <> me.actor_id
     AND NOT EXISTS (
       SELECT 1 FROM public.nudges n
        WHERE n.thing_id = c.id
          AND n.to_actor_id = c.target
          AND n.created_at > now() - make_interval(mins => katalist_priv.config_int('nudge_cooldown_minutes', 120))
     )
   ORDER BY c.updated_at ASC;
$$;

REVOKE ALL ON FUNCTION public.create_thing(text, uuid, text, public.context_kind, public.importance, public.pace, timestamptz, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_thing(text, uuid, text, public.context_kind, public.importance, public.pace, timestamptz, boolean, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.nudge_thing(uuid, public.nudge_reason, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nudge_thing(uuid, public.nudge_reason, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.list_nudgeable_things() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_nudgeable_things() TO authenticated, service_role;
