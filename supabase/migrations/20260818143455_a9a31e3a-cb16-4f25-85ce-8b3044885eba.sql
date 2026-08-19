-- =========================================================
-- KATALIST PHASE 4 — LIFECYCLE VALIDATION + CORE RPCs
-- =========================================================

-- Placeholder until Phase 5 introduces Lists.
CREATE OR REPLACE FUNCTION katalist_priv.can_create_thing_in_list(_list_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv
AS $$
  SELECT _list_id IS NULL;
$$;
REVOKE ALL ON FUNCTION katalist_priv.can_create_thing_in_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION katalist_priv.can_create_thing_in_list(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION katalist_priv.list_context(_list_id uuid)
RETURNS public.context_kind
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv
AS $$
  SELECT NULL::public.context_kind WHERE _list_id IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION katalist_priv.list_context(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION katalist_priv.list_context(uuid) TO authenticated, service_role;

-- Bridge revocation hook; Phase 8 replaces the body.
CREATE OR REPLACE FUNCTION katalist_priv.revoke_bridge_for_assignment(_assignment_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv
AS $$
BEGIN
  RETURN;
END;
$$;
REVOKE ALL ON FUNCTION katalist_priv.revoke_bridge_for_assignment(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION katalist_priv.revoke_bridge_for_assignment(uuid, text) TO service_role;

-- ---------- Activity logger ----------
CREATE OR REPLACE FUNCTION katalist_priv.log_activity(
  _thing_id uuid,
  _actor_id uuid,
  _event public.activity_event,
  _detail jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv
AS $$
BEGIN
  INSERT INTO public.thing_activity (thing_id, actor_id, event, detail)
  VALUES (_thing_id, _actor_id, _event, COALESCE(_detail, '{}'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION katalist_priv.log_activity(uuid, uuid, public.activity_event, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION katalist_priv.log_activity(uuid, uuid, public.activity_event, jsonb) TO service_role;

-- ---------- Lifecycle invariants ----------
CREATE OR REPLACE FUNCTION public.validate_thing_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, katalist_priv
AS $$
DECLARE
  v_assignee_external boolean;
BEGIN
  v_assignee_external := katalist_priv.actor_is_external(NEW.current_assignee_actor_id);

  IF TG_OP = 'INSERT' THEN
    IF NEW.work_status IN ('sorted','cancelled') THEN
      RAISE EXCEPTION 'a Thing cannot be created in a terminal state';
    END IF;
    IF v_assignee_external AND NEW.assignee_personal_pace IS NOT NULL THEN
      RAISE EXCEPTION 'Personal Pace is unavailable to an external (Bridge) assignee';
    END IF;
    IF NEW.acknowledgement = 'caught'
       AND NOT v_assignee_external
       AND NEW.assignee_personal_pace IS NULL THEN
      RAISE EXCEPTION 'a caught Thing held by a Katalist user must have a Personal Pace';
    END IF;
    RETURN NEW;
  END IF;

  -- Terminal states are absorbing.
  IF OLD.work_status IN ('sorted','cancelled') THEN
    IF NEW.work_status IS DISTINCT FROM OLD.work_status
       OR NEW.acknowledgement IS DISTINCT FROM OLD.acknowledgement
       OR NEW.current_assignee_actor_id IS DISTINCT FROM OLD.current_assignee_actor_id
       OR NEW.assignee_personal_pace IS DISTINCT FROM OLD.assignee_personal_pace
       OR NEW.owner_importance IS DISTINCT FROM OLD.owner_importance
       OR NEW.due_at IS DISTINCT FROM OLD.due_at
       OR NEW.context IS DISTINCT FROM OLD.context
       OR NEW.list_id IS DISTINCT FROM OLD.list_id
       OR NEW.title IS DISTINCT FROM OLD.title THEN
      RAISE EXCEPTION 'this Thing is % and can no longer change', OLD.work_status;
    END IF;
    RETURN NEW;
  END IF;

  -- Context and List association are fixed for a Thing in this baseline.
  IF NEW.context IS DISTINCT FROM OLD.context THEN
    RAISE EXCEPTION 'a Thing''s context cannot change';
  END IF;
  IF NEW.list_id IS DISTINCT FROM OLD.list_id THEN
    RAISE EXCEPTION 'moving a Thing between Lists is not supported';
  END IF;

  -- Handoff resets acknowledgement and clears the previous personal pace.
  IF NEW.current_assignee_actor_id IS DISTINCT FROM OLD.current_assignee_actor_id THEN
    IF NEW.acknowledgement <> 'waiting_for_catch'
       OR NEW.assignee_personal_pace IS NOT NULL
       OR NEW.caught_at IS NOT NULL THEN
      RAISE EXCEPTION 'a new assignee must begin at Waiting for Catch with no Personal Pace';
    END IF;
    IF NEW.work_status NOT IN ('not_started','under_progress') THEN
      RAISE EXCEPTION 'only an active Thing can be handed off';
    END IF;
  END IF;

  -- Acknowledgement may only move forward, and only for the same assignee.
  IF OLD.acknowledgement = 'caught'
     AND NEW.acknowledgement = 'waiting_for_catch'
     AND NEW.current_assignee_actor_id = OLD.current_assignee_actor_id THEN
    RAISE EXCEPTION 'acknowledgement cannot be undone';
  END IF;

  -- Execution requires acknowledgement.
  IF NEW.work_status = 'under_progress' AND NEW.acknowledgement <> 'caught' THEN
    RAISE EXCEPTION 'work cannot progress before the Thing is caught';
  END IF;
  IF NEW.work_status = 'sorted' AND NEW.acknowledgement <> 'caught' THEN
    RAISE EXCEPTION 'a Thing must be caught before it can be Sorted';
  END IF;

  -- Personal Pace rules.
  IF v_assignee_external AND NEW.assignee_personal_pace IS NOT NULL THEN
    RAISE EXCEPTION 'Personal Pace is unavailable to an external (Bridge) assignee';
  END IF;
  IF NEW.acknowledgement = 'caught'
     AND NOT v_assignee_external
     AND NEW.assignee_personal_pace IS NULL
     AND NEW.work_status <> 'cancelled' THEN
    RAISE EXCEPTION 'a caught Thing held by a Katalist user must have a Personal Pace';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_thing_transition() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_things_validate_transition
  BEFORE INSERT OR UPDATE ON public.things
  FOR EACH ROW EXECUTE FUNCTION public.validate_thing_transition();

-- =========================================================
-- RPCs
-- =========================================================

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
  v_external   boolean;
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

  v_context := COALESCE(katalist_priv.list_context(p_list_id), p_context, katalist_priv.active_context());
  v_self := (v_assignee = v_me);
  v_external := katalist_priv.actor_is_external(v_assignee);

  INSERT INTO public.things (
    title, notes, creator_actor_id, owner_actor_id, current_assignee_actor_id,
    list_id, context, owner_importance, assignee_personal_pace,
    acknowledgement, work_status, caught_at, due_at, due_has_time
  ) VALUES (
    btrim(p_title), NULLIF(btrim(COALESCE(p_notes,'')), ''), v_me, v_me, v_assignee,
    p_list_id, v_context, COALESCE(p_owner_importance, 'next'),
    CASE WHEN v_self AND NOT v_external THEN COALESCE(p_personal_pace, 'next') ELSE NULL END,
    CASE WHEN v_self THEN 'caught' ELSE 'waiting_for_catch' END::public.acknowledgement_state,
    'not_started',
    CASE WHEN v_self THEN now() ELSE NULL END,
    p_due_at, COALESCE(p_due_has_time, false)
  )
  RETURNING * INTO v_thing;

  INSERT INTO public.thing_assignments (
    thing_id, assignee_actor_id, assigned_by_actor_id, acknowledgement, caught_at
  ) VALUES (
    v_thing.id, v_assignee, v_me,
    CASE WHEN v_self THEN 'caught' ELSE 'waiting_for_catch' END::public.acknowledgement_state,
    CASE WHEN v_self THEN v_thing.created_at ELSE NULL END
  )
  RETURNING id INTO v_assignment;

  UPDATE public.things SET current_assignment_id = v_assignment
  WHERE id = v_thing.id
  RETURNING * INTO v_thing;

  PERFORM katalist_priv.log_activity(v_thing.id, v_me, 'created',
    jsonb_build_object('context', v_context, 'owner_importance', v_thing.owner_importance));
  PERFORM katalist_priv.log_activity(v_thing.id, v_me, 'assigned',
    jsonb_build_object('assignee_actor_id', v_assignee, 'self', v_self));
  IF v_self THEN
    PERFORM katalist_priv.log_activity(v_thing.id, v_me, 'caught',
      jsonb_build_object('auto', true, 'pace', v_thing.assignee_personal_pace));
  END IF;

  RETURN v_thing;
END;
$$;

CREATE OR REPLACE FUNCTION public.reassign_thing(
  p_thing_id uuid,
  p_new_assignee_actor_id uuid
)
RETURNS public.things
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv
AS $$
DECLARE
  v_me      uuid := katalist_priv.current_actor_id();
  v_thing   public.things;
  v_old_assignment uuid;
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
    NULL; -- Owner may hand off any active Thing.
  ELSIF v_thing.current_assignee_actor_id = v_me THEN
    IF v_thing.acknowledgement <> 'caught'
       OR v_thing.work_status NOT IN ('not_started','under_progress') THEN
      RAISE EXCEPTION 'catch the Thing before handing it on';
    END IF;
  ELSE
    RAISE EXCEPTION 'only the Thing Owner or the current assignee can reassign';
  END IF;

  v_old_assignment := v_thing.current_assignment_id;

  UPDATE public.thing_assignments
     SET ended_at = now(), ended_reason = 'reassigned'
   WHERE id = v_old_assignment AND ended_at IS NULL;

  PERFORM katalist_priv.revoke_bridge_for_assignment(v_old_assignment, 'reassigned');

  INSERT INTO public.thing_assignments (thing_id, assignee_actor_id, assigned_by_actor_id)
  VALUES (p_thing_id, p_new_assignee_actor_id, v_me)
  RETURNING id INTO v_new_assignment;

  UPDATE public.things
     SET current_assignee_actor_id = p_new_assignee_actor_id,
         current_assignment_id     = v_new_assignment,
         acknowledgement           = 'waiting_for_catch',
         assignee_personal_pace    = NULL,
         caught_at                 = NULL
   WHERE id = p_thing_id
  RETURNING * INTO v_thing;

  PERFORM katalist_priv.log_activity(p_thing_id, v_me, 'reassigned',
    jsonb_build_object('from_actor_id', v_old_assignment, 'to_actor_id', p_new_assignee_actor_id));
  PERFORM katalist_priv.log_activity(p_thing_id, v_me, 'assigned',
    jsonb_build_object('assignee_actor_id', p_new_assignee_actor_id));

  RETURN v_thing;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_thing(
  p_thing_id uuid,
  p_assignee_actor_id uuid
)
RETURNS public.things
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv
AS $$
  SELECT public.reassign_thing(p_thing_id, p_assignee_actor_id);
$$;

CREATE OR REPLACE FUNCTION public.catch_thing(
  p_thing_id uuid,
  p_personal_pace public.pace DEFAULT 'next'
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
         assignee_personal_pace = COALESCE(p_personal_pace, 'next')
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

CREATE OR REPLACE FUNCTION public.set_personal_pace(
  p_thing_id uuid,
  p_personal_pace public.pace
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
  SELECT * INTO v_thing FROM public.things WHERE id = p_thing_id FOR UPDATE;
  IF NOT FOUND OR NOT katalist_priv.can_view_thing(p_thing_id) THEN
    RAISE EXCEPTION 'Thing not found';
  END IF;
  IF v_thing.current_assignee_actor_id <> v_me THEN
    RAISE EXCEPTION 'only the current assignee sets Personal Pace';
  END IF;
  IF v_thing.acknowledgement <> 'caught' THEN
    RAISE EXCEPTION 'Catch the Thing before setting your pace';
  END IF;
  IF p_personal_pace IS NULL THEN
    RAISE EXCEPTION 'Personal Pace cannot be cleared once caught';
  END IF;

  UPDATE public.things SET assignee_personal_pace = p_personal_pace
   WHERE id = p_thing_id RETURNING * INTO v_thing;
  RETURN v_thing;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_work_status(
  p_thing_id uuid,
  p_work_status public.work_status
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
  IF p_work_status NOT IN ('not_started','under_progress') THEN
    RAISE EXCEPTION 'use sort_thing or cancel_thing for terminal outcomes';
  END IF;

  SELECT * INTO v_thing FROM public.things WHERE id = p_thing_id FOR UPDATE;
  IF NOT FOUND OR NOT katalist_priv.can_view_thing(p_thing_id) THEN
    RAISE EXCEPTION 'Thing not found';
  END IF;
  IF v_thing.current_assignee_actor_id <> v_me THEN
    RAISE EXCEPTION 'only the current assignee can change Work Status';
  END IF;
  IF v_thing.acknowledgement <> 'caught' THEN
    RAISE EXCEPTION 'Catch the Thing before changing Work Status';
  END IF;
  IF v_thing.work_status IN ('sorted','cancelled') THEN
    RAISE EXCEPTION 'a % Thing cannot change status', v_thing.work_status;
  END IF;

  UPDATE public.things SET work_status = p_work_status
   WHERE id = p_thing_id RETURNING * INTO v_thing;

  PERFORM katalist_priv.log_activity(p_thing_id, v_me, 'work_status_changed',
    jsonb_build_object('work_status', p_work_status));
  RETURN v_thing;
END;
$$;

CREATE OR REPLACE FUNCTION public.sort_thing(p_thing_id uuid)
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
  IF v_thing.current_assignee_actor_id <> v_me THEN
    RAISE EXCEPTION 'only the current assignee can mark this Sorted';
  END IF;
  IF v_thing.acknowledgement <> 'caught' THEN
    RAISE EXCEPTION 'Catch the Thing before marking it Sorted';
  END IF;
  IF v_thing.work_status IN ('sorted','cancelled') THEN
    RAISE EXCEPTION 'this Thing is already %', v_thing.work_status;
  END IF;

  UPDATE public.things SET work_status = 'sorted', sorted_at = now()
   WHERE id = p_thing_id RETURNING * INTO v_thing;

  UPDATE public.thing_assignments
     SET ended_at = now(), ended_reason = 'sorted'
   WHERE id = v_thing.current_assignment_id AND ended_at IS NULL;
  PERFORM katalist_priv.revoke_bridge_for_assignment(v_thing.current_assignment_id, 'sorted');

  PERFORM katalist_priv.log_activity(p_thing_id, v_me, 'sorted', '{}'::jsonb);
  RETURN v_thing;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_thing(p_thing_id uuid, p_reason text DEFAULT NULL)
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
    RAISE EXCEPTION 'only the Thing Owner can cancel this Thing';
  END IF;
  IF v_thing.work_status IN ('sorted','cancelled') THEN
    RAISE EXCEPTION 'this Thing is already %', v_thing.work_status;
  END IF;

  UPDATE public.things SET work_status = 'cancelled', cancelled_at = now()
   WHERE id = p_thing_id RETURNING * INTO v_thing;

  UPDATE public.thing_assignments
     SET ended_at = now(), ended_reason = 'cancelled'
   WHERE id = v_thing.current_assignment_id AND ended_at IS NULL;
  PERFORM katalist_priv.revoke_bridge_for_assignment(v_thing.current_assignment_id, 'cancelled');

  PERFORM katalist_priv.log_activity(p_thing_id, v_me, 'cancelled',
    jsonb_build_object('reason', NULLIF(btrim(COALESCE(p_reason,'')), '')));
  RETURN v_thing;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_owner_importance(
  p_thing_id uuid,
  p_owner_importance public.importance
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
  SELECT * INTO v_thing FROM public.things WHERE id = p_thing_id FOR UPDATE;
  IF NOT FOUND OR NOT katalist_priv.can_view_thing(p_thing_id) THEN
    RAISE EXCEPTION 'Thing not found';
  END IF;
  IF v_thing.owner_actor_id <> v_me THEN
    RAISE EXCEPTION 'only the Thing Owner sets Owner Importance';
  END IF;
  IF v_thing.work_status IN ('sorted','cancelled') THEN
    RAISE EXCEPTION 'a % Thing cannot change importance', v_thing.work_status;
  END IF;
  IF p_owner_importance IS NULL THEN
    RAISE EXCEPTION 'Owner Importance is required';
  END IF;

  UPDATE public.things SET owner_importance = p_owner_importance
   WHERE id = p_thing_id RETURNING * INTO v_thing;

  PERFORM katalist_priv.log_activity(p_thing_id, v_me, 'importance_changed',
    jsonb_build_object('owner_importance', p_owner_importance));
  RETURN v_thing;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_due(
  p_thing_id uuid,
  p_due_at timestamptz,
  p_due_has_time boolean DEFAULT false
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
  SELECT * INTO v_thing FROM public.things WHERE id = p_thing_id FOR UPDATE;
  IF NOT FOUND OR NOT katalist_priv.can_view_thing(p_thing_id) THEN
    RAISE EXCEPTION 'Thing not found';
  END IF;
  IF v_thing.owner_actor_id <> v_me THEN
    RAISE EXCEPTION 'only the Thing Owner can change Due';
  END IF;
  IF v_thing.work_status IN ('sorted','cancelled') THEN
    RAISE EXCEPTION 'a % Thing cannot change Due', v_thing.work_status;
  END IF;

  UPDATE public.things
     SET due_at = p_due_at,
         due_has_time = CASE WHEN p_due_at IS NULL THEN false ELSE COALESCE(p_due_has_time,false) END
   WHERE id = p_thing_id RETURNING * INTO v_thing;

  PERFORM katalist_priv.log_activity(p_thing_id, v_me, 'due_changed',
    jsonb_build_object('due_at', p_due_at));
  RETURN v_thing;
END;
$$;

-- ---------- RPC grants ----------
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.create_thing(text,uuid,text,public.context_kind,public.importance,public.pace,timestamptz,boolean,uuid)',
    'public.reassign_thing(uuid,uuid)',
    'public.assign_thing(uuid,uuid)',
    'public.catch_thing(uuid,public.pace)',
    'public.set_personal_pace(uuid,public.pace)',
    'public.set_work_status(uuid,public.work_status)',
    'public.sort_thing(uuid)',
    'public.cancel_thing(uuid,text)',
    'public.set_owner_importance(uuid,public.importance)',
    'public.set_due(uuid,timestamptz,boolean)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn);
  END LOOP;
END;
$$;