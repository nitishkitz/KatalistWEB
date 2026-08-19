-- 1. Work Status describes the Thing, not the holder ------------------------
CREATE OR REPLACE FUNCTION public.validate_thing_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $function$
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

  IF NEW.context IS DISTINCT FROM OLD.context THEN
    RAISE EXCEPTION 'a Thing''s context cannot change';
  END IF;
  IF NEW.list_id IS DISTINCT FROM OLD.list_id THEN
    RAISE EXCEPTION 'moving a Thing between Lists is not supported';
  END IF;

  -- Handoff: the person changes, the Thing's own progress does not.
  IF NEW.current_assignee_actor_id IS DISTINCT FROM OLD.current_assignee_actor_id THEN
    IF NEW.acknowledgement <> 'waiting_for_catch'
       OR NEW.assignee_personal_pace IS NOT NULL
       OR NEW.caught_at IS NOT NULL THEN
      RAISE EXCEPTION 'a new assignee must begin at Waiting for Catch with no Personal Pace';
    END IF;
    IF NEW.work_status NOT IN ('not_started','under_progress') THEN
      RAISE EXCEPTION 'only an active Thing can be handed off';
    END IF;
    IF NEW.work_status IS DISTINCT FROM OLD.work_status THEN
      RAISE EXCEPTION 'a handoff preserves the Thing''s Work Status';
    END IF;
  END IF;

  IF OLD.acknowledgement = 'caught'
     AND NEW.acknowledgement = 'waiting_for_catch'
     AND NEW.current_assignee_actor_id = OLD.current_assignee_actor_id THEN
    RAISE EXCEPTION 'acknowledgement cannot be undone';
  END IF;

  -- Progress may only ADVANCE while uncaught state persists: an already
  -- Under Progress Thing stays Under Progress across a handoff, but nobody
  -- can push it forward again until the new holder Catches it.
  IF NEW.work_status = 'under_progress'
     AND NEW.acknowledgement <> 'caught'
     AND OLD.work_status <> 'under_progress' THEN
    RAISE EXCEPTION 'work cannot progress before the Thing is caught';
  END IF;
  IF NEW.work_status = 'sorted' AND NEW.acknowledgement <> 'caught' THEN
    RAISE EXCEPTION 'a Thing must be caught before it can be Sorted';
  END IF;

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
$function$;

-- 2. Reassignment preserves the Thing's Work Status --------------------------
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

  -- Work Status belongs to the Thing and is preserved across the handoff.
  -- Acknowledgement, caught_at and Personal Pace are personal and reset.
  UPDATE public.things
     SET current_assignee_actor_id = p_new_assignee_actor_id,
         current_assignment_id     = v_new_assignment,
         acknowledgement           = 'waiting_for_catch',
         assignee_personal_pace    = NULL,
         caught_at                 = NULL
   WHERE id = p_thing_id
  RETURNING * INTO v_thing;

  PERFORM katalist_priv.log_activity(p_thing_id, v_me, 'reassigned',
    jsonb_build_object(
      'from_actor_id', v_old_assignee,
      'to_actor_id',   p_new_assignee_actor_id,
      'from_assignment_id', v_old_assignment,
      'to_assignment_id',   v_new_assignment,
      'work_status_preserved', v_thing.work_status,
      'by_actor_id',   v_me));
  PERFORM katalist_priv.log_activity(p_thing_id, v_me, 'assigned',
    jsonb_build_object('assignee_actor_id', p_new_assignee_actor_id, 'assignment_id', v_new_assignment));

  RETURN v_thing;
END;
$$;

-- 3. Bridge end-to-end test fixtures (service-role test infrastructure only) --
CREATE OR REPLACE FUNCTION katalist_priv.test_bridge_fixture()
RETURNS TABLE(owner_profile uuid, other_profile uuid, ext_actor uuid, other_actor uuid,
              thing_id uuid, other_thing_id uuid, list_id uuid, token text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_a_owner uuid; v_a_other uuid;
  v_ext public.actors;
  v_thing uuid; v_other_thing uuid; v_list uuid; v_token text;
  v_tag text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
BEGIN
  PERFORM katalist_priv.test_seed_user(v_owner, 'bridge-e2e-owner-'||v_tag||'@test.katalist', NULL, 'bridge-e2e Owner');
  PERFORM katalist_priv.test_seed_user(v_other, 'bridge-e2e-other-'||v_tag||'@test.katalist', NULL, 'bridge-e2e Other');
  SELECT id INTO v_a_owner FROM public.actors WHERE profile_id = v_owner;
  SELECT id INTO v_a_other FROM public.actors WHERE profile_id = v_other;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  v_ext := public.create_external_actor('bridge-e2e Guest '||v_tag, NULL,
                                        'bridge-e2e-guest-'||v_tag||'@test.katalist');
  v_thing := (public.create_thing(p_title => 'bridge-e2e Thing '||v_tag,
                                  p_assignee_actor_id => v_ext.id)).id;
  v_list := (public.create_list('bridge-e2e List '||v_tag, 'work')).id;
  v_other_thing := (public.create_thing(p_title => 'bridge-e2e Other Thing '||v_tag,
                                        p_assignee_actor_id => v_a_other,
                                        p_list_id => v_list)).id;
  SELECT g.token INTO v_token FROM public.issue_bridge_grant(v_thing) g;

  PERFORM set_config('request.jwt.claims', '', true);
  RETURN QUERY SELECT v_owner, v_other, v_ext.id, v_a_other, v_thing, v_other_thing, v_list, v_token;
END;
$$;

CREATE OR REPLACE FUNCTION katalist_priv.test_bridge_owner(
  p_profile uuid, p_action text, p_thing_id uuid, p_target uuid DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_out text := 'ok';
  v_grant uuid;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_profile, 'role', 'authenticated')::text, true);

  IF p_action = 'reassign' THEN
    PERFORM public.reassign_thing(p_thing_id, p_target);
  ELSIF p_action = 'cancel' THEN
    PERFORM public.cancel_thing(p_thing_id, 'bridge-e2e');
  ELSIF p_action = 'revoke_all' THEN
    FOR v_grant IN SELECT g.id FROM public.list_bridge_grants(p_thing_id) g WHERE g.revoked_at IS NULL LOOP
      PERFORM public.revoke_bridge_grant(v_grant);
    END LOOP;
  ELSIF p_action = 'issue' THEN
    SELECT g.token INTO v_out FROM public.issue_bridge_grant(p_thing_id) g;
  ELSE
    RAISE EXCEPTION 'unknown test action';
  END IF;

  PERFORM set_config('request.jwt.claims', '', true);
  RETURN v_out;
END;
$$;

CREATE OR REPLACE FUNCTION katalist_priv.test_bridge_state(p_thing_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
  SELECT jsonb_build_object(
    'work_status', t.work_status,
    'acknowledgement', t.acknowledgement,
    'personal_pace', t.assignee_personal_pace,
    'comments', (SELECT count(*) FROM public.thing_comments c WHERE c.thing_id = t.id),
    'live_grants', (SELECT count(*) FROM public.bridge_grants g
                     WHERE g.thing_id = t.id AND g.revoked_at IS NULL),
    'live_sessions', (SELECT count(*) FROM public.bridge_sessions s
                       JOIN public.bridge_grants g ON g.id = s.grant_id
                      WHERE g.thing_id = t.id AND s.revoked_at IS NULL))
  FROM public.things t WHERE t.id = p_thing_id;
$$;

CREATE OR REPLACE FUNCTION katalist_priv.test_bridge_cleanup()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'auth', 'katalist_priv'
AS $$
BEGIN
  ALTER TABLE public.thing_activity    DISABLE TRIGGER trg_thing_activity_append_only;
  ALTER TABLE public.thing_assignments DISABLE TRIGGER trg_thing_assignments_immutable;
  ALTER TABLE public.thing_comments    DISABLE TRIGGER trg_thing_comments_immutable;
  ALTER TABLE public.things            DISABLE TRIGGER trg_things_immutable;
  ALTER TABLE public.things            DISABLE TRIGGER trg_things_validate_transition;

  DELETE FROM public.things WHERE title LIKE 'bridge-e2e%';
  DELETE FROM public.lists  WHERE name  LIKE 'bridge-e2e%';
  DELETE FROM public.external_identities WHERE display_name LIKE 'bridge-e2e%';
  DELETE FROM auth.users WHERE email LIKE 'bridge-e2e%';

  ALTER TABLE public.things            ENABLE TRIGGER trg_things_validate_transition;
  ALTER TABLE public.things            ENABLE TRIGGER trg_things_immutable;
  ALTER TABLE public.thing_comments    ENABLE TRIGGER trg_thing_comments_immutable;
  ALTER TABLE public.thing_assignments ENABLE TRIGGER trg_thing_assignments_immutable;
  ALTER TABLE public.thing_activity    ENABLE TRIGGER trg_thing_activity_append_only;
END;
$$;

-- 4. Test infrastructure is service-role only, and documented as such --------
REVOKE ALL ON FUNCTION public.run_backend_tests()                      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION katalist_priv.run_backend_tests()               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION katalist_priv.test_seed_user(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION katalist_priv.test_bridge_fixture()             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION katalist_priv.test_bridge_owner(uuid, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION katalist_priv.test_bridge_state(uuid)           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION katalist_priv.test_bridge_cleanup()             FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.run_backend_tests()                      TO service_role;
GRANT EXECUTE ON FUNCTION katalist_priv.run_backend_tests()               TO service_role;
GRANT EXECUTE ON FUNCTION katalist_priv.test_seed_user(uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION katalist_priv.test_bridge_fixture()             TO service_role;
GRANT EXECUTE ON FUNCTION katalist_priv.test_bridge_owner(uuid, text, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION katalist_priv.test_bridge_state(uuid)           TO service_role;
GRANT EXECUTE ON FUNCTION katalist_priv.test_bridge_cleanup()             TO service_role;

COMMENT ON FUNCTION public.run_backend_tests() IS
  'TEST INFRASTRUCTURE — service_role only. Never grant to anon or authenticated.';
COMMENT ON FUNCTION katalist_priv.run_backend_tests() IS
  'TEST INFRASTRUCTURE — service_role only. Runs the backend permission/lifecycle suite in a rolled-back subtransaction.';
COMMENT ON FUNCTION katalist_priv.test_seed_user(uuid, text, text, text) IS
  'TEST INFRASTRUCTURE — service_role only. Seeds an auth user for the test suite.';
COMMENT ON FUNCTION katalist_priv.test_bridge_fixture() IS
  'TEST INFRASTRUCTURE — service_role only. Creates bridge-e2e fixtures; remove with katalist_priv.test_bridge_cleanup().';
COMMENT ON FUNCTION katalist_priv.test_bridge_owner(uuid, text, uuid, uuid) IS
  'TEST INFRASTRUCTURE — service_role only. Performs an owner action as a fixture user.';
COMMENT ON FUNCTION katalist_priv.test_bridge_state(uuid) IS
  'TEST INFRASTRUCTURE — service_role only. Reads fixture Thing/Bridge state.';
COMMENT ON FUNCTION katalist_priv.test_bridge_cleanup() IS
  'TEST INFRASTRUCTURE — service_role only. Deletes all bridge-e2e fixture data.';