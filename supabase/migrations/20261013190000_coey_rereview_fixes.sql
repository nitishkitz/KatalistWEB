-- Fixes from the re-review of 6437276e (output/coey-code-review/review-6437276e.md).
--   A. Calls: blocked or (for DMs) unconnected people are never rung, on the push path or
--      the in-app Realtime path. History and membership are untouched.
--   B. Follow-ups: a holder's calendar has its own revision (hours, days, holidays, leave,
--      timezone); a plan names it, and delivery also re-checks the holder's working time
--      at the moment of delivery.

-- A. Call authorization.
CREATE OR REPLACE FUNCTION katalist_priv.is_conversation_party(p_list uuid, p_profile uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.lists l WHERE l.id = p_list AND l.owner_profile_id = p_profile)
      OR EXISTS (SELECT 1 FROM public.list_members m WHERE m.list_id = p_list AND m.profile_id = p_profile);
$$;
REVOKE ALL ON FUNCTION katalist_priv.is_conversation_party(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION katalist_priv.may_call(p_list uuid, p_caller uuid, p_recipient uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
  SELECT p_caller IS NOT NULL AND p_recipient IS NOT NULL AND p_caller <> p_recipient
     AND katalist_priv.is_conversation_party(p_list, p_caller)
     AND katalist_priv.is_conversation_party(p_list, p_recipient)
     AND NOT katalist_priv.is_blocked_between(p_caller, p_recipient)
     AND ((SELECT kind::text FROM public.lists WHERE id = p_list) <> 'dm' OR katalist_priv.are_connected(p_caller, p_recipient));
$$;
REVOKE ALL ON FUNCTION katalist_priv.may_call(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Server push path: the subset of requested recipients the caller may ring.
CREATE OR REPLACE FUNCTION public.call_ring_recipients(p_list_id uuid, p_caller uuid, p_recipients uuid[])
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
  SELECT COALESCE(array_agg(r), '{}') FROM unnest(p_recipients) r WHERE katalist_priv.may_call(p_list_id, p_caller, r);
$$;
REVOKE ALL ON FUNCTION public.call_ring_recipients(uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.call_ring_recipients(uuid, uuid, uuid[]) TO service_role;

-- In-app receiver path: may this ring reach me?
CREATE OR REPLACE FUNCTION public.can_receive_call(p_list_id uuid, p_from_profile uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$ SELECT katalist_priv.may_call(p_list_id, p_from_profile, auth.uid()) $$;
REVOKE ALL ON FUNCTION public.can_receive_call(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_receive_call(uuid, uuid) TO authenticated;

-- B. Calendar revision.
ALTER TABLE public.profile_calendars ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION katalist_priv.bump_calendar_revision()
RETURNS trigger LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN NEW.revision := OLD.revision + 1; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION katalist_priv.bump_calendar_revision() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_calendars_bump_revision ON public.profile_calendars;
CREATE TRIGGER trg_calendars_bump_revision BEFORE UPDATE ON public.profile_calendars
  FOR EACH ROW EXECUTE FUNCTION katalist_priv.bump_calendar_revision();

-- A timezone change moves every working window, so it is a calendar change too.
CREATE OR REPLACE FUNCTION katalist_priv.bump_calendar_on_timezone()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
BEGIN
  IF NEW.timezone IS DISTINCT FROM OLD.timezone THEN
    INSERT INTO public.profile_calendars (profile_id) VALUES (NEW.id)
    ON CONFLICT (profile_id) DO UPDATE SET updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION katalist_priv.bump_calendar_on_timezone() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_profiles_timezone_calendar ON public.profiles;
CREATE TRIGGER trg_profiles_timezone_calendar AFTER UPDATE OF timezone ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION katalist_priv.bump_calendar_on_timezone();

-- The holder's working time right now, mirroring src/domain/coey/calendar.ts
-- (isWorkingDay / windowFor) and the planner's festival deferral.
CREATE OR REPLACE FUNCTION katalist_priv.in_holder_window(p_profile uuid, p_mode text, p_at timestamptz DEFAULT now())
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_tz   text;
  c      public.profile_calendars;
  v_loc  timestamp;
  v_day  date;
  v_min  int;
  v_dow  int;
BEGIN
  SELECT COALESCE(p.timezone, 'Asia/Kolkata') INTO v_tz FROM public.profiles p WHERE p.id = p_profile;
  BEGIN
    v_loc := p_at AT TIME ZONE v_tz;
  EXCEPTION WHEN invalid_parameter_value THEN
    v_loc := p_at AT TIME ZONE 'Asia/Kolkata';
  END;
  SELECT * INTO c FROM public.profile_calendars WHERE profile_id = p_profile;
  v_day := v_loc::date;
  v_min := extract(hour FROM v_loc)::int * 60 + extract(minute FROM v_loc)::int;
  v_dow := extract(dow FROM v_day)::int;
  IF v_day = ANY (COALESCE(c.festivals, '{}')) THEN RETURN false; END IF;
  IF p_mode = 'home' THEN
    RETURN v_min >= COALESCE(c.home_start, 420) AND v_min < COALESCE(c.home_end, 1320);
  END IF;
  IF NOT v_dow = ANY (COALESCE(c.work_days, '{1,2,3,4,5,6}')) THEN RETURN false; END IF;
  IF v_dow = 6 AND ceil(extract(day FROM v_day) / 7.0)::int = ANY (COALESCE(c.off_saturdays, '{}')) THEN RETURN false; END IF;
  IF v_day = ANY (COALESCE(c.holidays, '{}')) THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(c.leave, '[]')) l
              WHERE v_day BETWEEN (l->>'start')::date AND (l->>'end')::date) THEN RETURN false; END IF;
  RETURN v_min >= COALESCE(c.work_start, 540) AND v_min < COALESCE(c.work_end, 1110);
END;
$$;
REVOKE ALL ON FUNCTION katalist_priv.in_holder_window(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.coey_apply_followups(p_holder uuid, p_local_date date, p_items jsonb, p_budget integer DEFAULT 3)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_item     jsonb;
  v          public.thing_schedules;
  v_step     integer;
  v_kind     text;
  v_calrev   integer;
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
  -- Lock the calendar row too, so a calendar edit cannot interleave with this delivery.
  SELECT revision INTO v_calrev FROM public.profile_calendars WHERE profile_id = p_holder FOR SHARE;
  v_calrev := COALESCE(v_calrev, 0);

  SELECT count(*) INTO v_used FROM katalist_priv.coey_followup_log WHERE holder_profile_id = p_holder AND local_date = p_local_date;
  IF v_used >= p_budget THEN RETURN jsonb_build_object('delivered', 0, 'deferred', true); END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_step := (v_item->>'step')::integer;
    v_kind := COALESCE(v_item->>'kind', 'cadence');
    SELECT * INTO v FROM public.thing_schedules WHERE thing_id = (v_item->>'thing_id')::uuid FOR UPDATE;
    IF NOT FOUND
       OR v_item->>'revision' IS NULL OR v.revision <> (v_item->>'revision')::integer
       OR v_item->>'calendar_revision' IS NULL OR v_calrev <> (v_item->>'calendar_revision')::integer
       OR NOT katalist_priv.in_holder_window(p_holder, v.mode::text, now())
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
      'CADENCE', jsonb_build_object('step', v_step, 'kind', v_kind, 'calendar_revision', v_calrev));
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
