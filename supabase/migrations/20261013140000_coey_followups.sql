-- Coey follow-up delivery (spec §9; rebuild P8).
--
-- The planner (src/domain/coey/followup.ts) decides what is due in each
-- holder's working time. coey_apply_followups delivers one holder's batch
-- atomically: it re-checks every Thing (still held by them, still open, not
-- private, sender still connected, same cadence step), enforces the daily
-- budget (F5), and writes at most one message. Nudge 1 is in-app only: a line
-- on the Thing, no notification row, so no push. Repeating a call for the
-- same step changes nothing.
--
-- The elapsed-hours escalation (20260916160000) is retired: it timed on row
-- age, sent blame/escalation copy to the sender, and would double-nudge Things
-- that the Coey scheduler owns (decision D19).

CREATE TABLE IF NOT EXISTS katalist_priv.coey_followup_log (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  holder_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  local_date        date NOT NULL,
  thing_ids         uuid[] NOT NULL,
  channel           text NOT NULL CHECK (channel IN ('in_app', 'push')),
  notification_id   uuid,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coey_followup_log_budget ON katalist_priv.coey_followup_log (holder_profile_id, local_date);
REVOKE ALL ON katalist_priv.coey_followup_log FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.coey_apply_followups(p_holder uuid, p_local_date date, p_items jsonb, p_budget integer DEFAULT 3)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_item     jsonb;
  v          public.thing_schedules;
  v_step     integer;
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
  IF v_used >= p_budget THEN
    -- Over budget: nothing is lost; the planner offers it again on the next working day (§9.4).
    RETURN jsonb_build_object('delivered', 0, 'deferred', true);
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_step := (v_item->>'step')::integer;
    SELECT * INTO v FROM public.thing_schedules WHERE thing_id = (v_item->>'thing_id')::uuid FOR UPDATE;
    IF NOT FOUND
       OR v.holder_profile_id IS DISTINCT FROM p_holder
       OR v.holder_profile_id = v.sender_profile_id
       OR v.private_wait OR v.inbox_reason IS NOT NULL
       OR v.state NOT IN ('open', 'caught', 'promised')
       OR v.nudge_count_cycle <> v_step - 1
       OR (v.snooze_until IS NOT NULL AND v.snooze_until > now())
       OR NOT katalist_priv.are_connected(v.sender_profile_id, v.holder_profile_id) THEN
      v_skipped := v_skipped || jsonb_build_object('thing_id', v_item->>'thing_id', 'reason', 'not_eligible');
      CONTINUE;
    END IF;
    UPDATE public.thing_schedules SET nudge_count_cycle = v_step, last_nudge_at = now(), updated_at = now() WHERE thing_id = v.thing_id;
    PERFORM katalist_priv.log_transition(v.thing_id, 'scheduler', NULL, NULL,
      jsonb_build_object('nudge_step', v_step, 'channel', CASE WHEN v_step = 1 THEN 'in_app' ELSE 'push' END),
      'CADENCE', jsonb_build_object('step', v_step, 'kind', v_item->>'kind'));
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

-- Retire the elapsed-hours escalation (D19). The signature stays so an old
-- deployment's scheduler gets a harmless 0 instead of an error.
CREATE OR REPLACE FUNCTION public.run_nudge_escalation()
RETURNS integer LANGUAGE sql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$ SELECT 0 $$;
REVOKE EXECUTE ON FUNCTION public.run_nudge_escalation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_nudge_escalation() TO service_role;

NOTIFY pgrst, 'reload schema';
