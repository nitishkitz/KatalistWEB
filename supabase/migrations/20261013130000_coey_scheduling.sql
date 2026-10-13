-- Coey scheduling model persistence (spec §3; rebuild P4/P8).
--
-- Additive: things / thing_assignments stay the record of who holds a Thing
-- and its legacy status. thing_schedules carries the spec's scheduling
-- fields (raw text, pace, two anchors, promise, blocker, private wait, group,
-- chain, recurrence, cadence bookkeeping). Lanes and sender concern are
-- derived in application code from these fields; the stored values are the
-- last computed projection, for audit only. Every placement and move appends
-- a transition with its rule id (§1.4, §3.4).

-- 1. Holder calendars (§3.3). Own row writable through RPC; connections read
--    the fields needed to place and time a Thing they send.
CREATE TABLE IF NOT EXISTS public.profile_calendars (
  profile_id    uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  work_days     smallint[] NOT NULL DEFAULT '{1,2,3,4,5,6}',
  work_start    smallint NOT NULL DEFAULT 540,
  work_end      smallint NOT NULL DEFAULT 1110,
  off_saturdays smallint[] NOT NULL DEFAULT '{}',
  holidays      date[] NOT NULL DEFAULT '{}',
  festivals     date[] NOT NULL DEFAULT '{}',
  leave         jsonb NOT NULL DEFAULT '[]',
  home_start    smallint NOT NULL DEFAULT 420,
  home_end      smallint NOT NULL DEFAULT 1320,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profile_calendars_work_window CHECK (work_start >= 0 AND work_end <= 1440 AND work_start < work_end),
  CONSTRAINT profile_calendars_home_window CHECK (home_start >= 0 AND home_end <= 1440 AND home_start < home_end),
  CONSTRAINT profile_calendars_leave_array CHECK (jsonb_typeof(leave) = 'array')
);
ALTER TABLE public.profile_calendars ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.profile_calendars FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.profile_calendars TO authenticated;
GRANT ALL ON public.profile_calendars TO service_role;
DROP POLICY IF EXISTS "own calendar readable" ON public.profile_calendars;
CREATE POLICY "own calendar readable" ON public.profile_calendars FOR SELECT TO authenticated USING (profile_id = auth.uid());

CREATE OR REPLACE FUNCTION public.set_my_calendar(p_calendar jsonb)
RETURNS public.profile_calendars LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE v_row public.profile_calendars;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  INSERT INTO public.profile_calendars AS c (profile_id, work_days, work_start, work_end, off_saturdays, holidays, festivals, leave, home_start, home_end)
  VALUES (
    auth.uid(),
    COALESCE((SELECT array_agg(x::smallint) FROM jsonb_array_elements_text(p_calendar->'work_days') x), '{1,2,3,4,5,6}'),
    COALESCE((p_calendar->>'work_start')::smallint, 540),
    COALESCE((p_calendar->>'work_end')::smallint, 1110),
    COALESCE((SELECT array_agg(x::smallint) FROM jsonb_array_elements_text(p_calendar->'off_saturdays') x), '{}'),
    COALESCE((SELECT array_agg(x::date) FROM jsonb_array_elements_text(p_calendar->'holidays') x), '{}'),
    COALESCE((SELECT array_agg(x::date) FROM jsonb_array_elements_text(p_calendar->'festivals') x), '{}'),
    COALESCE(p_calendar->'leave', '[]'),
    COALESCE((p_calendar->>'home_start')::smallint, 420),
    COALESCE((p_calendar->>'home_end')::smallint, 1320)
  )
  ON CONFLICT (profile_id) DO UPDATE SET
    work_days = excluded.work_days, work_start = excluded.work_start, work_end = excluded.work_end,
    off_saturdays = excluded.off_saturdays, holidays = excluded.holidays, festivals = excluded.festivals,
    leave = excluded.leave, home_start = excluded.home_start, home_end = excluded.home_end, updated_at = now()
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

-- Self and accepted connections only.
CREATE OR REPLACE FUNCTION public.get_calendars(p_profile_ids uuid[])
RETURNS TABLE (profile_id uuid, timezone text, work_days smallint[], work_start smallint, work_end smallint, off_saturdays smallint[],
               holidays date[], festivals date[], leave jsonb, home_start smallint, home_end smallint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
  SELECT p.id, COALESCE(p.timezone, 'Asia/Kolkata'),
         COALESCE(c.work_days, '{1,2,3,4,5,6}'), COALESCE(c.work_start, 540), COALESCE(c.work_end, 1110),
         COALESCE(c.off_saturdays, '{}'), COALESCE(c.holidays, '{}'), COALESCE(c.festivals, '{}'),
         COALESCE(c.leave, '[]'), COALESCE(c.home_start, 420), COALESCE(c.home_end, 1320)
    FROM public.profiles p LEFT JOIN public.profile_calendars c ON c.profile_id = p.id
   WHERE p.id = ANY (p_profile_ids)
     AND (p.id = auth.uid() OR katalist_priv.are_connected(auth.uid(), p.id))
   LIMIT 200;
$$;

-- 2. Schedules.
CREATE TABLE IF NOT EXISTS public.thing_schedules (
  thing_id           uuid PRIMARY KEY REFERENCES public.things(id) ON DELETE CASCADE,
  text_raw           text NOT NULL CHECK (length(text_raw) <= 4000),
  kind               text NOT NULL DEFAULT 'task' CHECK (kind IN ('task', 'note', 'thought')),
  mode               public.context_kind NOT NULL,
  sender_profile_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  holder_profile_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  tracked_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  state              text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'caught', 'promised', 'snoozed', 'blocked', 'with_sender', 'sorted')),
  inbox_reason       text CHECK (inbox_reason IN ('thought', 'unresolved_person', 'wrong_person', 'unresolved_owner', 'unresolved_capture')),
  private_wait       boolean NOT NULL DEFAULT false,
  group_id           uuid,
  chain              uuid[] NOT NULL DEFAULT '{}',
  chain_index        smallint NOT NULL DEFAULT 0,
  pace               text CHECK (pace IN ('urgent', 'normal', 'chill')),
  pace_resolution    text CHECK (pace_resolution IN ('pace', 'anchor')),
  action_time        jsonb,
  event_time         jsonb,
  activity_type      text,
  recurrence         jsonb,
  series_id          uuid,
  promise_at         timestamptz,
  snooze_until       timestamptz,
  blocked_on         jsonb,
  lane_holder        text,
  lane_rule          text,
  concern_sender     text,
  wake_at            timestamptz,
  last_activity_at   timestamptz NOT NULL DEFAULT now(),
  last_nudge_at      timestamptz,
  nudge_count_cycle  smallint NOT NULL DEFAULT 0,
  breakthrough_used  boolean NOT NULL DEFAULT false,
  revision           integer NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT thing_schedules_private_wait_target CHECK (NOT private_wait OR tracked_profile_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS thing_schedules_holder ON public.thing_schedules (holder_profile_id, state);
CREATE INDEX IF NOT EXISTS thing_schedules_sender ON public.thing_schedules (sender_profile_id, state);
CREATE INDEX IF NOT EXISTS thing_schedules_group ON public.thing_schedules (group_id) WHERE group_id IS NOT NULL;

ALTER TABLE public.thing_schedules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.thing_schedules FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.thing_schedules TO authenticated;
GRANT ALL ON public.thing_schedules TO service_role;
DROP POLICY IF EXISTS "schedules follow thing visibility" ON public.thing_schedules;
-- A private wait is visible to its sender only: the tracked person never sees it (C6).
CREATE POLICY "schedules follow thing visibility" ON public.thing_schedules FOR SELECT TO authenticated
  USING (katalist_priv.can_view_thing(thing_id) AND (NOT private_wait OR sender_profile_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.thing_transitions (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  thing_id         uuid NOT NULL REFERENCES public.things(id) ON DELETE CASCADE,
  at               timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor_kind       text NOT NULL CHECK (actor_kind IN ('user', 'coey', 'scheduler')),
  actor_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  from_state       jsonb,
  to_state         jsonb NOT NULL,
  rule_id          text NOT NULL CHECK (rule_id ~ '^[A-Z][A-Za-z0-9.+:_-]{0,40}$'),
  inputs           jsonb NOT NULL DEFAULT '{}' CHECK (pg_column_size(inputs) <= 8192)
);
CREATE INDEX IF NOT EXISTS thing_transitions_thing ON public.thing_transitions (thing_id, at);
ALTER TABLE public.thing_transitions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.thing_transitions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.thing_transitions TO authenticated;
GRANT ALL ON public.thing_transitions TO service_role;
DROP POLICY IF EXISTS "transitions for sender and holder" ON public.thing_transitions;
CREATE POLICY "transitions for sender and holder" ON public.thing_transitions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.thing_schedules s WHERE s.thing_id = thing_transitions.thing_id
                  AND auth.uid() IN (s.sender_profile_id, s.holder_profile_id)));

CREATE TABLE IF NOT EXISTS public.coey_check_dismissals (
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  check_id   text NOT NULL CHECK (check_id ~ '^[A-Z][A-Za-z0-9.]{0,15}$'),
  count      integer NOT NULL DEFAULT 0,
  last_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, check_id)
);
ALTER TABLE public.coey_check_dismissals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.coey_check_dismissals FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.coey_check_dismissals TO authenticated;
DROP POLICY IF EXISTS "own dismissals" ON public.coey_check_dismissals;
CREATE POLICY "own dismissals" ON public.coey_check_dismissals FOR SELECT TO authenticated USING (profile_id = auth.uid());

CREATE TABLE IF NOT EXISTS katalist_priv.coey_submissions (
  profile_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 100),
  result          jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, idempotency_key)
);
REVOKE ALL ON katalist_priv.coey_submissions FROM PUBLIC, anon, authenticated;

-- 3. Helpers.
CREATE OR REPLACE FUNCTION katalist_priv.user_actor_of(p_profile_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$ SELECT a.id FROM public.actors a WHERE a.profile_id = p_profile_id AND a.kind = 'user' LIMIT 1 $$;

CREATE OR REPLACE FUNCTION katalist_priv.profile_of_actor(p_actor_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$ SELECT a.profile_id FROM public.actors a WHERE a.id = p_actor_id $$;

CREATE OR REPLACE FUNCTION katalist_priv.schedule_snapshot(s public.thing_schedules)
RETURNS jsonb LANGUAGE sql IMMUTABLE
AS $$ SELECT jsonb_build_object('state', s.state, 'holder', s.holder_profile_id, 'lane', s.lane_holder, 'inbox', s.inbox_reason) $$;

CREATE OR REPLACE FUNCTION katalist_priv.log_transition(p_thing uuid, p_actor_kind text, p_actor uuid, p_from jsonb, p_to jsonb, p_rule text, p_inputs jsonb DEFAULT '{}')
RETURNS void LANGUAGE sql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
  INSERT INTO public.thing_transitions (thing_id, actor_kind, actor_profile_id, from_state, to_state, rule_id, inputs)
  VALUES (p_thing, p_actor_kind, p_actor, p_from, p_to, p_rule, COALESCE(p_inputs, '{}'));
$$;

CREATE OR REPLACE FUNCTION katalist_priv.valid_anchor(p jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE
AS $$
  SELECT p IS NULL OR p = 'null'::jsonb OR (
    jsonb_typeof(p) = 'object'
    AND (p->>'at') ~ '^\d{4}-\d{2}-\d{2}T'
    AND (p->>'precision') IN ('date', 'time')
    AND (p->>'source') IN ('typed', 'inferred')
    AND jsonb_typeof(p->'accepted') = 'boolean'
  );
$$;

-- 4. Atomic, idempotent capture. Authorisation lives here: delegation needs an
--    accepted connection (also enforced by the assignment trigger), private
--    waits stay with the sender, and a repeated key returns the first result.
CREATE OR REPLACE FUNCTION public.coey_create_things(p_idempotency_key text, p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_me       uuid := auth.uid();
  v_prior    jsonb;
  v_item     jsonb;
  v_idx      int := 0;
  v_holder   uuid;
  v_tracked  uuid;
  v_actor    uuid;
  v_chain    uuid[];
  v_member   uuid;
  v_thing    public.things;
  v_sched    public.thing_schedules;
  v_groups   jsonb := '{}';
  v_group    uuid;
  v_kind     text;
  v_private  boolean;
  v_inbox    text;
  v_list     uuid;
  v_out      jsonb := '[]';
  v_lane     text;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 OR jsonb_array_length(p_items) > 25 THEN
    RAISE EXCEPTION 'between 1 and 25 Things can be created at once' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_me::text || coalesce(p_idempotency_key, ''), 0));
  SELECT result INTO v_prior FROM katalist_priv.coey_submissions WHERE profile_id = v_me AND idempotency_key = p_idempotency_key;
  IF FOUND THEN RETURN v_prior || jsonb_build_object('replayed', true); END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_kind := COALESCE(v_item->>'kind', 'task');
    IF v_kind NOT IN ('task', 'note', 'thought') THEN RAISE EXCEPTION 'unsupported kind' USING ERRCODE = '22023'; END IF;
    IF NOT katalist_priv.valid_anchor(v_item->'action_time') OR NOT katalist_priv.valid_anchor(v_item->'event_time') THEN
      RAISE EXCEPTION 'invalid time' USING ERRCODE = '22023';
    END IF;
    v_inbox := NULLIF(v_item->>'inbox_reason', '');
    v_private := COALESCE((v_item->>'private_wait')::boolean, false);
    v_holder := NULLIF(v_item->>'holder_profile_id', '')::uuid;
    v_tracked := NULLIF(v_item->>'tracked_profile_id', '')::uuid;
    v_list := NULLIF(v_item->>'list_id', '')::uuid;
    v_chain := COALESCE((SELECT array_agg(x::uuid) FROM jsonb_array_elements_text(v_item->'chain') x), '{}');

    -- An unresolved or private Thing never has another holder.
    IF v_inbox IS NOT NULL OR v_private OR v_kind <> 'task' THEN v_holder := NULL; END IF;
    IF array_length(v_chain, 1) > 0 THEN
      v_holder := v_chain[1];
      FOREACH v_member IN ARRAY v_chain LOOP
        IF v_member <> v_me AND NOT katalist_priv.are_connected(v_me, v_member) THEN
          RAISE EXCEPTION 'connect with everyone in the chain first' USING ERRCODE = '42501';
        END IF;
      END LOOP;
    END IF;
    IF v_holder = v_me THEN v_holder := NULL; END IF;
    IF v_holder IS NOT NULL AND NOT katalist_priv.are_connected(v_me, v_holder) THEN
      RAISE EXCEPTION 'connect with this person before sending them a Thing' USING ERRCODE = '42501';
    END IF;
    IF v_private THEN
      IF v_tracked IS NULL OR NOT katalist_priv.are_connected(v_me, v_tracked) THEN
        RAISE EXCEPTION 'a private wait needs a connected person' USING ERRCODE = '42501';
      END IF;
      v_list := NULL; -- List members would otherwise see a private wait.
    ELSE
      v_tracked := NULL;
    END IF;
    v_actor := CASE WHEN v_holder IS NULL THEN NULL ELSE katalist_priv.user_actor_of(v_holder) END;
    IF v_holder IS NOT NULL AND v_actor IS NULL THEN RAISE EXCEPTION 'unknown person'; END IF;

    v_lane := COALESCE(NULLIF(v_item->>'lane', ''), 'next');
    v_thing := public.create_thing(
      left(btrim(COALESCE(NULLIF(v_item->>'title', ''), v_item->>'text_raw')), 500),
      v_actor,
      NULLIF(v_item->>'notes', ''),
      COALESCE(NULLIF(v_item->>'mode', ''), 'work')::public.context_kind,
      (CASE WHEN v_lane IN ('now', 'next', 'later') THEN v_lane ELSE 'next' END)::public.importance,
      NULL,
      NULLIF(v_item->>'due_at', '')::timestamptz,
      COALESCE((v_item->>'due_has_time')::boolean, false),
      v_list
    );

    v_group := NULL;
    IF NULLIF(v_item->>'group', '') IS NOT NULL THEN
      v_group := (v_groups->>(v_item->>'group'))::uuid;
      IF v_group IS NULL THEN
        v_group := gen_random_uuid();
        v_groups := v_groups || jsonb_build_object(v_item->>'group', v_group);
      END IF;
    END IF;

    INSERT INTO public.thing_schedules (
      thing_id, text_raw, kind, mode, sender_profile_id, holder_profile_id, tracked_profile_id, state, inbox_reason,
      private_wait, group_id, chain, pace, pace_resolution, action_time, event_time, activity_type, recurrence,
      series_id, lane_holder, lane_rule, wake_at, last_activity_at
    ) VALUES (
      v_thing.id, left(COALESCE(v_item->>'text_raw', v_thing.title), 4000), v_kind, v_thing.context, v_me,
      COALESCE(v_holder, v_me), v_tracked, 'open', v_inbox, v_private, v_group, v_chain,
      NULLIF(v_item->>'pace', ''), NULLIF(v_item->>'pace_resolution', ''),
      NULLIF(v_item->'action_time', 'null'::jsonb), NULLIF(v_item->'event_time', 'null'::jsonb),
      NULLIF(v_item->>'activity_type', ''), NULLIF(v_item->'recurrence', 'null'::jsonb),
      CASE WHEN v_item ? 'recurrence' AND v_item->'recurrence' <> 'null'::jsonb THEN gen_random_uuid() END,
      v_lane, NULLIF(v_item->>'lane_rule', ''), NULLIF(v_item->>'wake_at', '')::timestamptz, now()
    ) RETURNING * INTO v_sched;

    PERFORM katalist_priv.log_transition(v_thing.id, 'user', v_me, NULL, katalist_priv.schedule_snapshot(v_sched),
      COALESCE(NULLIF(v_item->>'rule_id', ''), 'C1'), COALESCE(v_item->'inputs', '{}'));
    v_out := v_out || jsonb_build_object('index', v_idx, 'thing_id', v_thing.id, 'group_id', v_group);
    v_idx := v_idx + 1;
  END LOOP;

  v_prior := jsonb_build_object('things', v_out);
  INSERT INTO katalist_priv.coey_submissions (profile_id, idempotency_key, result) VALUES (v_me, p_idempotency_key, v_prior);
  RETURN v_prior;
END;
$$;

-- 5. Movement (§8). Holder and sender actions with rule ids.
CREATE OR REPLACE FUNCTION katalist_priv.lock_schedule(p_thing uuid)
RETURNS public.thing_schedules LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE v public.thing_schedules;
BEGIN
  SELECT * INTO v FROM public.thing_schedules WHERE thing_id = p_thing FOR UPDATE;
  IF NOT FOUND OR NOT katalist_priv.can_view_thing(p_thing) THEN RAISE EXCEPTION 'Thing not found'; END IF;
  RETURN v;
END;
$$;

-- M3: the holder promises a date (on Catch or later). The sender can never set it.
CREATE OR REPLACE FUNCTION public.coey_promise(p_thing_id uuid, p_promise_at timestamptz)
RETURNS public.thing_schedules LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE v public.thing_schedules; v_from jsonb;
BEGIN
  v := katalist_priv.lock_schedule(p_thing_id);
  IF v.holder_profile_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'only the person holding this Thing can promise a date'; END IF;
  IF v.state = 'sorted' THEN RAISE EXCEPTION 'this Thing is already sorted'; END IF;
  IF p_promise_at IS NOT NULL AND p_promise_at < now() - interval '1 minute' THEN RAISE EXCEPTION 'pick a time that has not passed'; END IF;
  v_from := katalist_priv.schedule_snapshot(v);
  UPDATE public.thing_schedules
     SET promise_at = p_promise_at, state = CASE WHEN p_promise_at IS NULL THEN 'caught' ELSE 'promised' END,
         last_activity_at = now(), nudge_count_cycle = 0, revision = revision + 1, updated_at = now()
   WHERE thing_id = p_thing_id RETURNING * INTO v;
  PERFORM katalist_priv.log_transition(p_thing_id, 'user', auth.uid(), v_from, katalist_priv.schedule_snapshot(v), 'M3', jsonb_build_object('promise_at', p_promise_at));
  RETURN v;
END;
$$;

-- C13 / C15 / M10: blocker on the sender (ball returns) or on a third party (parked).
CREATE OR REPLACE FUNCTION public.coey_flag_blocker(p_thing_id uuid, p_kind text, p_note text)
RETURNS public.thing_schedules LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE v public.thing_schedules; v_from jsonb;
BEGIN
  IF p_kind NOT IN ('sender', 'third_party') THEN RAISE EXCEPTION 'unknown blocker' USING ERRCODE = '22023'; END IF;
  v := katalist_priv.lock_schedule(p_thing_id);
  IF v.holder_profile_id IS DISTINCT FROM auth.uid() OR v.sender_profile_id = auth.uid() THEN RAISE EXCEPTION 'only the person holding a sent Thing can flag a blocker'; END IF;
  v_from := katalist_priv.schedule_snapshot(v);
  UPDATE public.thing_schedules
     SET blocked_on = jsonb_build_object('kind', p_kind, 'note', left(COALESCE(p_note, ''), 200), 'by', auth.uid()),
         state = CASE WHEN p_kind = 'sender' THEN 'with_sender' ELSE 'blocked' END,
         holder_profile_id = CASE WHEN p_kind = 'sender' THEN v.sender_profile_id ELSE v.holder_profile_id END,
         last_activity_at = now(), nudge_count_cycle = 0, revision = revision + 1, updated_at = now()
   WHERE thing_id = p_thing_id RETURNING * INTO v;
  PERFORM katalist_priv.log_transition(p_thing_id, 'user', auth.uid(), v_from, katalist_priv.schedule_snapshot(v),
    CASE WHEN p_kind = 'sender' THEN 'C13' ELSE 'C15' END, jsonb_build_object('kind', p_kind));
  RETURN v;
END;
$$;

-- M11: unblocked; C12 answered: the ball goes back to the person who flagged it.
CREATE OR REPLACE FUNCTION public.coey_unblock(p_thing_id uuid)
RETURNS public.thing_schedules LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE v public.thing_schedules; v_from jsonb; v_back uuid;
BEGIN
  v := katalist_priv.lock_schedule(p_thing_id);
  IF v.blocked_on IS NULL THEN RETURN v; END IF;
  IF auth.uid() NOT IN (v.sender_profile_id, (v.blocked_on->>'by')::uuid) THEN RAISE EXCEPTION 'only the sender or holder can clear this'; END IF;
  v_back := COALESCE((v.blocked_on->>'by')::uuid, v.holder_profile_id);
  v_from := katalist_priv.schedule_snapshot(v);
  UPDATE public.thing_schedules
     SET blocked_on = NULL, holder_profile_id = v_back,
         state = CASE WHEN promise_at IS NOT NULL THEN 'promised' ELSE 'caught' END,
         last_activity_at = now(), nudge_count_cycle = 0, revision = revision + 1, updated_at = now()
   WHERE thing_id = p_thing_id RETURNING * INTO v;
  PERFORM katalist_priv.log_transition(p_thing_id, 'user', auth.uid(), v_from, katalist_priv.schedule_snapshot(v), 'M11');
  RETURN v;
END;
$$;

-- C12 serve back with a question: the sender now holds the ball.
CREATE OR REPLACE FUNCTION public.coey_serve_back(p_thing_id uuid, p_question text)
RETURNS public.thing_schedules LANGUAGE sql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$ SELECT public.coey_flag_blocker(p_thing_id, 'sender', p_question) $$;

-- C14 wrong person: back to the sender's Inbox with "Who should take this?".
CREATE OR REPLACE FUNCTION public.coey_wrong_person(p_thing_id uuid)
RETURNS public.thing_schedules LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE v public.thing_schedules; v_from jsonb;
BEGIN
  v := katalist_priv.lock_schedule(p_thing_id);
  IF v.holder_profile_id IS DISTINCT FROM auth.uid() OR v.sender_profile_id = auth.uid() THEN RAISE EXCEPTION 'only the person a Thing was sent to can say it is the wrong person'; END IF;
  v_from := katalist_priv.schedule_snapshot(v);
  UPDATE public.thing_schedules
     SET inbox_reason = 'wrong_person', holder_profile_id = v.sender_profile_id, state = 'with_sender',
         promise_at = NULL, last_activity_at = now(), nudge_count_cycle = 0, revision = revision + 1, updated_at = now()
   WHERE thing_id = p_thing_id RETURNING * INTO v;
  PERFORM katalist_priv.log_transition(p_thing_id, 'user', auth.uid(), v_from, katalist_priv.schedule_snapshot(v), 'C14');
  RETURN v;
END;
$$;

-- M9: only the sender changes the pace they asked for.
CREATE OR REPLACE FUNCTION public.coey_set_pace(p_thing_id uuid, p_pace text)
RETURNS public.thing_schedules LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE v public.thing_schedules; v_from jsonb;
BEGIN
  IF p_pace IS NOT NULL AND p_pace NOT IN ('urgent', 'normal', 'chill') THEN RAISE EXCEPTION 'unknown pace' USING ERRCODE = '22023'; END IF;
  v := katalist_priv.lock_schedule(p_thing_id);
  IF v.sender_profile_id <> auth.uid() THEN RAISE EXCEPTION 'only the sender can change the pace'; END IF;
  v_from := katalist_priv.schedule_snapshot(v);
  UPDATE public.thing_schedules SET pace = p_pace, pace_resolution = 'pace', revision = revision + 1, updated_at = now()
   WHERE thing_id = p_thing_id RETURNING * INTO v;
  PERFORM katalist_priv.log_transition(p_thing_id, 'user', auth.uid(), v_from, katalist_priv.schedule_snapshot(v), 'M9', jsonb_build_object('pace', p_pace));
  RETURN v;
END;
$$;

-- C10 / C14 resolved: the sender picks the person; normal delegation rules apply.
CREATE OR REPLACE FUNCTION public.coey_resolve_holder(p_thing_id uuid, p_holder_profile_id uuid)
RETURNS public.thing_schedules LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE v public.thing_schedules; v_from jsonb; v_thing public.things; v_actor uuid;
BEGIN
  v := katalist_priv.lock_schedule(p_thing_id);
  IF v.sender_profile_id <> auth.uid() THEN RAISE EXCEPTION 'only the sender can choose who takes this'; END IF;
  IF v.private_wait THEN RAISE EXCEPTION 'a private wait has no holder; use Ask instead'; END IF;
  v_from := katalist_priv.schedule_snapshot(v);
  SELECT * INTO v_thing FROM public.things WHERE id = p_thing_id;
  v_actor := katalist_priv.user_actor_of(p_holder_profile_id);
  IF p_holder_profile_id <> auth.uid() THEN
    IF NOT katalist_priv.are_connected(auth.uid(), p_holder_profile_id) THEN RAISE EXCEPTION 'connect with this person before sending them a Thing' USING ERRCODE = '42501'; END IF;
    IF v_thing.current_assignee_actor_id IS DISTINCT FROM v_actor THEN PERFORM public.reassign_thing(p_thing_id, v_actor); END IF;
  END IF;
  UPDATE public.thing_schedules
     SET holder_profile_id = p_holder_profile_id, inbox_reason = NULL, blocked_on = NULL, state = 'open', promise_at = NULL,
         last_activity_at = now(), nudge_count_cycle = 0, revision = revision + 1, updated_at = now()
   WHERE thing_id = p_thing_id RETURNING * INTO v;
  PERFORM katalist_priv.log_transition(p_thing_id, 'user', auth.uid(), v_from, katalist_priv.schedule_snapshot(v), 'C16');
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_check_dismissal(p_check_id text)
RETURNS integer LANGUAGE sql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
  INSERT INTO public.coey_check_dismissals AS d (profile_id, check_id, count) VALUES (auth.uid(), p_check_id, 1)
  ON CONFLICT (profile_id, check_id) DO UPDATE SET count = d.count + 1, last_at = now()
  RETURNING count;
$$;

-- 6. Keep schedules in step with the existing Thing actions (D17: qualified
--    holder activity resets the follow-up clock; sender edits do not).
CREATE OR REPLACE FUNCTION katalist_priv.sync_schedule_from_thing()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE v public.thing_schedules; v_from jsonb; v_rule text; v_new_holder uuid;
BEGIN
  SELECT * INTO v FROM public.thing_schedules WHERE thing_id = NEW.id FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  v_from := katalist_priv.schedule_snapshot(v);
  IF NEW.current_assignee_actor_id IS DISTINCT FROM OLD.current_assignee_actor_id THEN
    v_new_holder := katalist_priv.profile_of_actor(NEW.current_assignee_actor_id);
    UPDATE public.thing_schedules SET holder_profile_id = v_new_holder, state = 'open', promise_at = NULL, blocked_on = NULL,
           inbox_reason = CASE WHEN inbox_reason = 'thought' THEN inbox_reason END,
           last_activity_at = now(), last_nudge_at = NULL, nudge_count_cycle = 0, revision = revision + 1, updated_at = now()
     WHERE thing_id = NEW.id;
    v_rule := 'C16';
  ELSIF NEW.work_status IN ('sorted', 'cancelled') AND OLD.work_status NOT IN ('sorted', 'cancelled') THEN
    UPDATE public.thing_schedules SET state = 'sorted', revision = revision + 1, updated_at = now() WHERE thing_id = NEW.id;
    v_rule := CASE WHEN NEW.work_status = 'sorted' THEN 'M15' ELSE 'CANCEL' END;
  ELSIF OLD.work_status IN ('sorted', 'cancelled') AND NEW.work_status NOT IN ('sorted', 'cancelled') THEN
    UPDATE public.thing_schedules SET state = CASE WHEN NEW.acknowledgement = 'caught' THEN 'caught' ELSE 'open' END,
           last_activity_at = now(), nudge_count_cycle = 0, revision = revision + 1, updated_at = now() WHERE thing_id = NEW.id;
    v_rule := 'M16';
  ELSIF NEW.acknowledgement = 'caught' AND OLD.acknowledgement <> 'caught' THEN
    UPDATE public.thing_schedules SET state = CASE WHEN promise_at IS NOT NULL THEN 'promised' ELSE 'caught' END,
           last_activity_at = now(), nudge_count_cycle = 0, revision = revision + 1, updated_at = now() WHERE thing_id = NEW.id;
    v_rule := 'M2';
  ELSIF NEW.work_status IS DISTINCT FROM OLD.work_status THEN
    UPDATE public.thing_schedules SET last_activity_at = now(), nudge_count_cycle = 0, updated_at = now() WHERE thing_id = NEW.id;
    v_rule := 'M7';
  ELSE
    RETURN NEW;
  END IF;
  SELECT * INTO v FROM public.thing_schedules WHERE thing_id = NEW.id;
  PERFORM katalist_priv.log_transition(NEW.id, 'user', katalist_priv.profile_of_actor(katalist_priv.current_actor_id()), v_from, katalist_priv.schedule_snapshot(v), v_rule);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_things_sync_schedule ON public.things;
CREATE TRIGGER trg_things_sync_schedule AFTER UPDATE ON public.things
  FOR EACH ROW EXECUTE FUNCTION katalist_priv.sync_schedule_from_thing();

-- M7: a comment by the holder is activity; a comment by the sender is not.
CREATE OR REPLACE FUNCTION katalist_priv.sync_schedule_from_comment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
BEGIN
  UPDATE public.thing_schedules SET last_activity_at = now(), nudge_count_cycle = 0, updated_at = now()
   WHERE thing_id = NEW.thing_id AND holder_profile_id = katalist_priv.profile_of_actor(NEW.author_actor_id)
     AND holder_profile_id <> sender_profile_id;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_comments_sync_schedule ON public.thing_comments;
CREATE TRIGGER trg_comments_sync_schedule AFTER INSERT ON public.thing_comments
  FOR EACH ROW EXECUTE FUNCTION katalist_priv.sync_schedule_from_comment();

-- M6: the holder's personal snooze hides the Thing until it wakes.
CREATE OR REPLACE FUNCTION katalist_priv.sync_schedule_from_snooze()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.thing_schedules SET snooze_until = NULL, updated_at = now()
     WHERE thing_id = OLD.thing_id AND holder_profile_id = OLD.profile_id;
    RETURN OLD;
  END IF;
  UPDATE public.thing_schedules SET snooze_until = NEW.snoozed_until, last_activity_at = now(), nudge_count_cycle = 0, updated_at = now()
   WHERE thing_id = NEW.thing_id AND holder_profile_id = NEW.profile_id;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_snooze_sync_schedule ON public.thing_snooze;
CREATE TRIGGER trg_snooze_sync_schedule AFTER INSERT OR UPDATE OR DELETE ON public.thing_snooze
  FOR EACH ROW EXECUTE FUNCTION katalist_priv.sync_schedule_from_snooze();

-- 7. Grants.
REVOKE ALL ON FUNCTION katalist_priv.user_actor_of(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION katalist_priv.profile_of_actor(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION katalist_priv.log_transition(uuid, text, uuid, jsonb, jsonb, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION katalist_priv.lock_schedule(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION katalist_priv.sync_schedule_from_thing() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION katalist_priv.sync_schedule_from_comment() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION katalist_priv.sync_schedule_from_snooze() FROM PUBLIC, anon, authenticated;
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.set_my_calendar(jsonb)', 'public.get_calendars(uuid[])', 'public.coey_create_things(text, jsonb)',
    'public.coey_promise(uuid, timestamptz)', 'public.coey_flag_blocker(uuid, text, text)', 'public.coey_unblock(uuid)',
    'public.coey_serve_back(uuid, text)', 'public.coey_wrong_person(uuid)', 'public.coey_set_pace(uuid, text)',
    'public.coey_resolve_holder(uuid, uuid)', 'public.record_check_dismissal(text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
