-- Recurring Things (spec L11): each occurrence is its own Thing placed by
-- its own date. Sorting an occurrence creates the next one, once, owned by
-- the original sender and held by the same person (still subject to the
-- connection rule). Dates are computed in the holder's timezone.

ALTER TABLE public.thing_schedules ADD COLUMN IF NOT EXISTS occurrence_of uuid REFERENCES public.things(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS thing_schedules_one_next_occurrence ON public.thing_schedules (occurrence_of) WHERE occurrence_of IS NOT NULL;

CREATE OR REPLACE FUNCTION katalist_priv.next_occurrence_date(p_recurrence jsonb, p_after date)
RETURNS date LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_freq text := p_recurrence->>'freq';
  v_days int[];
  v_d date;
  v_month_day int := NULLIF(p_recurrence->>'monthDay', '')::int;
BEGIN
  IF v_freq = 'daily' THEN RETURN p_after + 1; END IF;
  IF v_freq = 'weekly' THEN
    SELECT array_agg(CASE w WHEN 'sun' THEN 0 WHEN 'mon' THEN 1 WHEN 'tue' THEN 2 WHEN 'wed' THEN 3 WHEN 'thu' THEN 4 WHEN 'fri' THEN 5 WHEN 'sat' THEN 6 END)
      INTO v_days FROM jsonb_array_elements_text(COALESCE(p_recurrence->'weekdays', '[]')) w;
    IF v_days IS NULL THEN v_days := ARRAY[extract(dow FROM p_after)::int]; END IF;
    FOR i IN 1..7 LOOP
      v_d := p_after + i;
      IF extract(dow FROM v_d)::int = ANY (v_days) THEN RETURN v_d; END IF;
    END LOOP;
    RETURN p_after + 7;
  END IF;
  IF v_freq = 'monthly' THEN
    v_d := (date_trunc('month', p_after) + interval '1 month')::date;
    v_month_day := COALESCE(v_month_day, extract(day FROM p_after)::int);
    RETURN least(v_d + (v_month_day - 1), (v_d + interval '1 month' - interval '1 day')::date);
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION katalist_priv.spawn_next_occurrence(p_thing uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  s         public.thing_schedules;
  t         public.things;
  v_tz      text;
  v_end     int;
  v_base    date;
  v_next    date;
  v_today   date;
  v_minutes int;
  v_at      timestamptz;
  v_sender  uuid;
  v_holder  uuid;
  v_new     public.things;
  v_assign  uuid;
  v_anchor  jsonb;
BEGIN
  SELECT * INTO s FROM public.thing_schedules WHERE thing_id = p_thing;
  IF NOT FOUND OR s.recurrence IS NULL THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.thing_schedules WHERE occurrence_of = p_thing) THEN RETURN NULL; END IF;
  SELECT * INTO t FROM public.things WHERE id = p_thing;
  SELECT COALESCE(p.timezone, 'Asia/Kolkata'), COALESCE(c.work_end, 1110) INTO v_tz, v_end
    FROM public.profiles p LEFT JOIN public.profile_calendars c ON c.profile_id = p.id WHERE p.id = COALESCE(s.holder_profile_id, s.sender_profile_id);
  v_today := (now() AT TIME ZONE v_tz)::date;
  v_base := COALESCE((s.action_time->>'date')::date, v_today);
  v_next := katalist_priv.next_occurrence_date(s.recurrence, greatest(v_base, v_today - 1));
  IF v_next IS NULL THEN RETURN NULL; END IF;
  IF s.action_time->>'precision' = 'time' THEN
    v_minutes := extract(hour FROM ((s.action_time->>'at')::timestamptz AT TIME ZONE v_tz))::int * 60
               + extract(minute FROM ((s.action_time->>'at')::timestamptz AT TIME ZONE v_tz))::int;
  ELSE
    v_minutes := v_end;
  END IF;
  v_at := (v_next::timestamp + make_interval(mins => v_minutes)) AT TIME ZONE v_tz;
  v_anchor := jsonb_build_object('at', to_char(v_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'date', v_next::text,
    'precision', COALESCE(s.action_time->>'precision', 'date'), 'source', 'typed', 'accepted', true, 'phrase', s.recurrence->>'phrase');

  v_sender := katalist_priv.user_actor_of(s.sender_profile_id);
  v_holder := katalist_priv.user_actor_of(COALESCE(s.holder_profile_id, s.sender_profile_id));
  IF v_sender IS NULL OR v_holder IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.things (title, notes, creator_actor_id, owner_actor_id, current_assignee_actor_id, list_id, context,
                             owner_importance, acknowledgement, work_status, due_at, due_has_time)
  VALUES (t.title, NULL, v_sender, v_sender, v_holder, t.list_id, t.context, t.owner_importance,
          'waiting_for_catch', 'not_started', v_at, COALESCE(s.action_time->>'precision' = 'time', false))
  RETURNING * INTO v_new;
  -- The assignment trigger enforces the connection rule for the next occurrence too.
  INSERT INTO public.thing_assignments (thing_id, assignee_actor_id, assigned_by_actor_id) VALUES (v_new.id, v_holder, v_sender) RETURNING id INTO v_assign;
  UPDATE public.things SET current_assignment_id = v_assign WHERE id = v_new.id;
  PERFORM katalist_priv.log_activity(v_new.id, v_sender, 'created', jsonb_build_object('recurrence_of', p_thing));
  INSERT INTO public.thing_schedules (thing_id, text_raw, kind, mode, sender_profile_id, holder_profile_id, state, pace, pace_resolution,
    action_time, activity_type, recurrence, series_id, occurrence_of, lane_rule, last_activity_at)
  VALUES (v_new.id, s.text_raw, s.kind, s.mode, s.sender_profile_id, s.holder_profile_id, 'open', s.pace, s.pace_resolution,
    v_anchor, s.activity_type, s.recurrence, COALESCE(s.series_id, p_thing), p_thing, 'L11', now());
  PERFORM katalist_priv.log_transition(v_new.id, 'coey', NULL, NULL, jsonb_build_object('state', 'open', 'series', COALESCE(s.series_id, p_thing)), 'L11',
    jsonb_build_object('previous', p_thing, 'date', v_next));
  RETURN v_new.id;
END;
$$;
REVOKE ALL ON FUNCTION katalist_priv.spawn_next_occurrence(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION katalist_priv.next_occurrence_date(jsonb, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION katalist_priv.spawn_on_sort()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
BEGIN
  IF NEW.work_status = 'sorted' AND OLD.work_status <> 'sorted' THEN
    BEGIN
      PERFORM katalist_priv.spawn_next_occurrence(NEW.id);
    EXCEPTION WHEN insufficient_privilege THEN
      -- Disconnected since: the series stops quietly instead of blocking the Sort.
      NULL;
    END;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION katalist_priv.spawn_on_sort() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_things_spawn_occurrence ON public.things;
CREATE TRIGGER trg_things_spawn_occurrence AFTER UPDATE ON public.things
  FOR EACH ROW EXECUTE FUNCTION katalist_priv.spawn_on_sort();

NOTIFY pgrst, 'reload schema';
