-- Fixes from the independent review of the Coey rebuild (output/coey-code-review/review.md).
--   1. A private capture never gets a shared List (it would be readable by List members).
--   2. New DM messages need an accepted, unblocked connection; group messages need no block
--      with any member. History stays readable.
--   3. Moving the ball (wrong person, resolve holder, including "Keep it for me") moves the
--      legacy assignment too, so Catch/Sort authority matches the schedule holder.
--   5. Follow-up delivery rejects plans made against an older schedule revision, and every
--      cadence-affecting change bumps the revision.

-- 1. Private captures never carry a List: coey_create_things clears it before the Thing
--    exists (20261013130000). A later move into a List is refused here.
-- Buckets are personal, but a later Bucket link must never be the way a private Thing travels.
CREATE OR REPLACE FUNCTION katalist_priv.block_private_list_link()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
BEGIN
  IF NEW.list_id IS NOT NULL AND NEW.list_id IS DISTINCT FROM OLD.list_id AND EXISTS (
    SELECT 1 FROM public.thing_schedules s
     WHERE s.thing_id = NEW.id AND (s.private_wait OR s.inbox_reason = 'unresolved_capture')
  ) THEN
    RAISE EXCEPTION 'a private Thing cannot be moved into a shared List' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION katalist_priv.block_private_list_link() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_things_block_private_list ON public.things;
CREATE TRIGGER trg_things_block_private_list BEFORE UPDATE OF list_id ON public.things
  FOR EACH ROW EXECUTE FUNCTION katalist_priv.block_private_list_link();

-- 2. Message boundary.
CREATE OR REPLACE FUNCTION katalist_priv.enforce_connected_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE v_list public.lists;
BEGIN
  SELECT * INTO v_list FROM public.lists WHERE id = NEW.list_id;
  IF v_list.kind::text = 'dm' THEN
    IF EXISTS (
      SELECT 1 FROM (
        SELECT v_list.owner_profile_id AS p UNION SELECT m.profile_id FROM public.list_members m WHERE m.list_id = v_list.id
      ) x WHERE x.p <> NEW.author_profile_id AND NOT katalist_priv.are_connected(NEW.author_profile_id, x.p)
    ) THEN
      RAISE EXCEPTION 'you can message this person again once you are connected' USING ERRCODE = '42501';
    END IF;
  ELSIF v_list.kind::text = 'group' THEN
    IF EXISTS (
      SELECT 1 FROM (
        SELECT v_list.owner_profile_id AS p UNION SELECT m.profile_id FROM public.list_members m WHERE m.list_id = v_list.id
      ) x WHERE x.p <> NEW.author_profile_id AND katalist_priv.is_blocked_between(NEW.author_profile_id, x.p)
    ) THEN
      RAISE EXCEPTION 'this group includes someone you cannot message' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION katalist_priv.enforce_connected_message() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_messages_require_connection ON public.list_messages;
CREATE TRIGGER trg_messages_require_connection BEFORE INSERT ON public.list_messages
  FOR EACH ROW EXECUTE FUNCTION katalist_priv.enforce_connected_message();

-- 3. One authority for who holds a Thing.
CREATE OR REPLACE FUNCTION katalist_priv.move_assignment(p_thing uuid, p_to_profile uuid, p_by_profile uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_thing  public.things;
  v_to     uuid := katalist_priv.user_actor_of(p_to_profile);
  v_by     uuid := katalist_priv.user_actor_of(p_by_profile);
  v_new    uuid;
BEGIN
  SELECT * INTO v_thing FROM public.things WHERE id = p_thing FOR UPDATE;
  IF v_to IS NULL OR v_by IS NULL THEN RAISE EXCEPTION 'unknown person'; END IF;
  IF v_thing.current_assignee_actor_id = v_to THEN RETURN; END IF;
  UPDATE public.thing_assignments SET ended_at = now(), ended_reason = 'reassigned'
   WHERE id = v_thing.current_assignment_id AND ended_at IS NULL;
  PERFORM katalist_priv.revoke_bridge_for_assignment(v_thing.current_assignment_id, 'reassigned');
  -- The connection trigger on thing_assignments still applies.
  INSERT INTO public.thing_assignments (thing_id, assignee_actor_id, assigned_by_actor_id)
  VALUES (p_thing, v_to, v_by) RETURNING id INTO v_new;
  UPDATE public.things
     SET current_assignee_actor_id = v_to, current_assignment_id = v_new,
         acknowledgement = 'waiting_for_catch', assignee_personal_pace = NULL, caught_at = NULL
   WHERE id = p_thing;
  PERFORM katalist_priv.log_activity(p_thing, v_by, 'reassigned',
    jsonb_build_object('from_actor_id', v_thing.current_assignee_actor_id, 'to_actor_id', v_to, 'reason', p_reason));
END;
$$;
REVOKE ALL ON FUNCTION katalist_priv.move_assignment(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.coey_wrong_person(p_thing_id uuid)
RETURNS public.thing_schedules LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE v public.thing_schedules; v_from jsonb;
BEGIN
  v := katalist_priv.lock_schedule(p_thing_id);
  IF v.holder_profile_id IS DISTINCT FROM auth.uid() OR v.sender_profile_id = auth.uid() THEN RAISE EXCEPTION 'only the person a Thing was sent to can say it is the wrong person'; END IF;
  v_from := katalist_priv.schedule_snapshot(v);
  PERFORM katalist_priv.move_assignment(p_thing_id, v.sender_profile_id, auth.uid(), 'wrong_person');
  UPDATE public.thing_schedules
     SET inbox_reason = 'wrong_person', holder_profile_id = v.sender_profile_id, state = 'with_sender',
         promise_at = NULL, blocked_on = NULL, last_activity_at = now(), nudge_count_cycle = 0, revision = revision + 1, updated_at = now()
   WHERE thing_id = p_thing_id RETURNING * INTO v;
  PERFORM katalist_priv.log_transition(p_thing_id, 'user', auth.uid(), v_from, katalist_priv.schedule_snapshot(v), 'C14');
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.coey_resolve_holder(p_thing_id uuid, p_holder_profile_id uuid)
RETURNS public.thing_schedules LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE v public.thing_schedules; v_from jsonb; v_status text;
BEGIN
  v := katalist_priv.lock_schedule(p_thing_id);
  IF v.sender_profile_id <> auth.uid() THEN RAISE EXCEPTION 'only the sender can choose who takes this'; END IF;
  IF v.private_wait THEN RAISE EXCEPTION 'a private wait has no holder; use Ask instead'; END IF;
  SELECT work_status::text INTO v_status FROM public.things WHERE id = p_thing_id;
  IF v_status IN ('sorted', 'cancelled') THEN RAISE EXCEPTION 'this Thing is already closed'; END IF;
  IF p_holder_profile_id <> auth.uid() AND NOT katalist_priv.are_connected(auth.uid(), p_holder_profile_id) THEN
    RAISE EXCEPTION 'connect with this person before sending them a Thing' USING ERRCODE = '42501';
  END IF;
  v_from := katalist_priv.schedule_snapshot(v);
  PERFORM katalist_priv.move_assignment(p_thing_id, p_holder_profile_id, auth.uid(), 'resolve_holder');
  UPDATE public.thing_schedules
     SET holder_profile_id = p_holder_profile_id, inbox_reason = NULL, blocked_on = NULL, state = 'open', promise_at = NULL,
         last_activity_at = now(), nudge_count_cycle = 0, revision = revision + 1, updated_at = now()
   WHERE thing_id = p_thing_id RETURNING * INTO v;
  PERFORM katalist_priv.log_transition(p_thing_id, 'user', auth.uid(), v_from, katalist_priv.schedule_snapshot(v), 'C16');
  RETURN v;
END;
$$;

-- 5. Every cadence-affecting change bumps the revision.
CREATE OR REPLACE FUNCTION katalist_priv.sync_schedule_from_comment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
BEGIN
  UPDATE public.thing_schedules SET last_activity_at = now(), nudge_count_cycle = 0, revision = revision + 1, updated_at = now()
   WHERE thing_id = NEW.thing_id AND holder_profile_id = katalist_priv.profile_of_actor(NEW.author_actor_id)
     AND holder_profile_id <> sender_profile_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION katalist_priv.sync_schedule_from_snooze()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.thing_schedules SET snooze_until = NULL, revision = revision + 1, updated_at = now()
     WHERE thing_id = OLD.thing_id AND holder_profile_id = OLD.profile_id;
    RETURN OLD;
  END IF;
  UPDATE public.thing_schedules SET snooze_until = NEW.snoozed_until, last_activity_at = now(), nudge_count_cycle = 0, revision = revision + 1, updated_at = now()
   WHERE thing_id = NEW.thing_id AND holder_profile_id = NEW.profile_id;
  RETURN NEW;
END;
$$;

-- Any other direct schedule write that changes a cadence input also bumps the revision.
CREATE OR REPLACE FUNCTION katalist_priv.bump_schedule_revision()
RETURNS trigger LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.revision = OLD.revision AND (
       NEW.last_activity_at IS DISTINCT FROM OLD.last_activity_at OR NEW.promise_at IS DISTINCT FROM OLD.promise_at
    OR NEW.pace IS DISTINCT FROM OLD.pace OR NEW.state IS DISTINCT FROM OLD.state
    OR NEW.holder_profile_id IS DISTINCT FROM OLD.holder_profile_id OR NEW.snooze_until IS DISTINCT FROM OLD.snooze_until
    OR NEW.nudge_count_cycle IS DISTINCT FROM OLD.nudge_count_cycle) THEN
    NEW.revision := OLD.revision + 1;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION katalist_priv.bump_schedule_revision() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_schedules_bump_revision ON public.thing_schedules;
CREATE TRIGGER trg_schedules_bump_revision BEFORE UPDATE ON public.thing_schedules
  FOR EACH ROW EXECUTE FUNCTION katalist_priv.bump_schedule_revision();

-- Delivery: the plan must name the revision it was made against, and its kind must
-- still match the schedule (a cadence nudge never goes out once a promise exists).
CREATE OR REPLACE FUNCTION public.coey_apply_followups(p_holder uuid, p_local_date date, p_items jsonb, p_budget integer DEFAULT 3)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_item     jsonb;
  v          public.thing_schedules;
  v_step     integer;
  v_kind     text;
  v_ok       uuid[] := '{}';
  v_push     uuid[] := '{}';
  v_senders  uuid[] := '{}';
  v_used     integer;
  v_title    text;
  v_first    text;
  v_notif    uuid;
  v_skipped  jsonb := '[]';
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'server only'; END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) > 50 THEN RAISE EXCEPTION 'invalid batch'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('coey-followup:' || p_holder::text, 0));

  SELECT count(*) INTO v_used FROM katalist_priv.coey_followup_log WHERE holder_profile_id = p_holder AND local_date = p_local_date;
  IF v_used >= p_budget THEN RETURN jsonb_build_object('delivered', 0, 'deferred', true); END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_step := (v_item->>'step')::integer;
    v_kind := COALESCE(v_item->>'kind', 'cadence');
    SELECT * INTO v FROM public.thing_schedules WHERE thing_id = (v_item->>'thing_id')::uuid FOR UPDATE;
    IF NOT FOUND
       OR v_item->>'revision' IS NULL OR v.revision <> (v_item->>'revision')::integer
       OR v.holder_profile_id IS DISTINCT FROM p_holder
       OR v.holder_profile_id = v.sender_profile_id
       OR v.private_wait OR v.inbox_reason IS NOT NULL
       OR v.state NOT IN ('open', 'caught', 'promised')
       OR v.nudge_count_cycle <> v_step - 1
       OR (v_kind = 'cadence' AND v.promise_at IS NOT NULL)
       OR (v_kind IN ('promise_soon', 'promise_due') AND v.promise_at IS NULL)
       OR (v_kind = 'promise_due' AND v.promise_at > now())
       OR (v.snooze_until IS NOT NULL AND v.snooze_until > now())
       OR NOT katalist_priv.are_connected(v.sender_profile_id, v.holder_profile_id) THEN
      v_skipped := v_skipped || jsonb_build_object('thing_id', v_item->>'thing_id', 'reason', 'stale_or_not_eligible');
      CONTINUE;
    END IF;
    UPDATE public.thing_schedules SET nudge_count_cycle = v_step, last_nudge_at = now(), updated_at = now() WHERE thing_id = v.thing_id;
    PERFORM katalist_priv.log_transition(v.thing_id, 'scheduler', NULL, NULL,
      jsonb_build_object('nudge_step', v_step, 'channel', CASE WHEN v_step = 1 THEN 'in_app' ELSE 'push' END),
      'CADENCE', jsonb_build_object('step', v_step, 'kind', v_kind));
    v_ok := v_ok || v.thing_id;
    IF v_step >= 2 THEN
      v_push := v_push || v.thing_id;
      IF NOT v.sender_profile_id = ANY (v_senders) THEN v_senders := v_senders || v.sender_profile_id; END IF;
    END IF;
  END LOOP;

  IF array_length(v_ok, 1) IS NULL THEN RETURN jsonb_build_object('delivered', 0, 'skipped', v_skipped); END IF;

  IF array_length(v_push, 1) IS NOT NULL THEN
    SELECT title INTO v_first FROM public.things WHERE id = v_push[1];
    v_title := CASE
      WHEN array_length(v_push, 1) = 1 THEN 'A Thing is waiting in your court'
      ELSE format('%s Things from %s %s', array_length(v_push, 1), array_length(v_senders, 1), CASE WHEN array_length(v_senders, 1) = 1 THEN 'person' ELSE 'people' END)
    END;
    INSERT INTO public.notifications (profile_id, kind, title, body, thing_id, payload)
    VALUES (p_holder, 'coey_nudge', v_title,
            CASE WHEN array_length(v_push, 1) = 1 THEN format('“%s” is in your court whenever you are ready.', left(v_first, 120))
                 ELSE format('“%s” and %s more are in your court.', left(v_first, 120), array_length(v_push, 1) - 1) END,
            CASE WHEN array_length(v_push, 1) = 1 THEN v_push[1] END,
            jsonb_build_object('thing_ids', to_jsonb(v_push), 'source', 'coey_followup'))
    RETURNING id INTO v_notif;
  END IF;
  INSERT INTO katalist_priv.coey_followup_log (holder_profile_id, local_date, thing_ids, channel, notification_id)
  VALUES (p_holder, p_local_date, v_ok, CASE WHEN v_notif IS NULL THEN 'in_app' ELSE 'push' END, v_notif);
  RETURN jsonb_build_object('delivered', array_length(v_ok, 1), 'pushed', COALESCE(array_length(v_push, 1), 0), 'notification_id', v_notif, 'skipped', v_skipped);
END;
$$;
REVOKE ALL ON FUNCTION public.coey_apply_followups(uuid, date, jsonb, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coey_apply_followups(uuid, date, jsonb, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
