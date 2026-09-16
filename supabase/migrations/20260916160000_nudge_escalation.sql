-- Phase 1 of the Coey escalation ladder + frequency caps (in-app only).
-- A scheduled job (run_nudge_escalation) advances each waiting Thing through
-- staleness bands and emits ONE in-app nudge per band advance, gated by a
-- central frequency-cap guard (katalist_priv.can_send). No push/WhatsApp/email
-- yet — those are later phases.

-- 1. Staleness band ordering (fresh < warm < hot < on_fire < stale).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'nudge_staleness') THEN
    CREATE TYPE public.nudge_staleness AS ENUM ('fresh', 'warm', 'hot', 'on_fire', 'stale');
  END IF;
END $$;

-- 2. Per-(thing, recipient) escalation state.
CREATE TABLE IF NOT EXISTS public.thing_nudge_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thing_id uuid NOT NULL REFERENCES public.things(id) ON DELETE CASCADE,
  to_actor_id uuid NOT NULL,
  staleness_level public.nudge_staleness NOT NULL DEFAULT 'fresh',
  last_escalated_at timestamptz,
  snoozed_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (thing_id, to_actor_id)
);
GRANT SELECT ON public.thing_nudge_state TO authenticated;
GRANT ALL ON public.thing_nudge_state TO service_role;
ALTER TABLE public.thing_nudge_state ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='thing_nudge_state' AND policyname='nudge state visible to thing viewers') THEN
    CREATE POLICY "nudge state visible to thing viewers"
      ON public.thing_nudge_state FOR SELECT TO authenticated
      USING (katalist_priv.can_view_thing(thing_id));
  END IF;
END $$;
CREATE TRIGGER trg_thing_nudge_state_updated_at
  BEFORE UPDATE ON public.thing_nudge_state
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. Cross-channel cap ledger (source of truth for frequency caps).
CREATE TABLE IF NOT EXISTS public.notification_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type text NOT NULL,
  channel text NOT NULL DEFAULT 'in_app',
  thing_id uuid REFERENCES public.things(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.notification_log TO authenticated;
GRANT ALL ON public.notification_log TO service_role;
ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='notification_log' AND policyname='own notification log') THEN
    CREATE POLICY "own notification log"
      ON public.notification_log FOR SELECT TO authenticated
      USING (profile_id = auth.uid());
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_notification_log_lookup
  ON public.notification_log (profile_id, type, created_at DESC);

-- 3b. Quiet-hours preferences (per profile). No row = no quiet window.
CREATE TABLE IF NOT EXISTS public.notification_prefs (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  quiet_start smallint NOT NULL DEFAULT 21,
  quiet_end smallint NOT NULL DEFAULT 8,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.notification_prefs TO authenticated;
GRANT ALL ON public.notification_prefs TO service_role;
ALTER TABLE public.notification_prefs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='notification_prefs' AND policyname='own notification prefs read') THEN
    CREATE POLICY "own notification prefs read" ON public.notification_prefs FOR SELECT TO authenticated USING (profile_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='notification_prefs' AND policyname='own notification prefs write') THEN
    CREATE POLICY "own notification prefs write" ON public.notification_prefs FOR INSERT TO authenticated WITH CHECK (profile_id = auth.uid());
    CREATE POLICY "own notification prefs update" ON public.notification_prefs FOR UPDATE TO authenticated USING (profile_id = auth.uid());
  END IF;
END $$;

-- 4. Central frequency-cap guard. Mirrors src/features/nudges/escalation-logic.ts
--    (unit-tested). Kept in lockstep with that module.
CREATE OR REPLACE FUNCTION katalist_priv.can_send(p_profile uuid, p_type text, p_thing uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
  SELECT CASE p_type
    WHEN 'auto_nudge' THEN NOT EXISTS (
      SELECT 1 FROM public.notification_log l
      WHERE l.profile_id = p_profile AND l.type = 'auto_nudge'
        AND l.thing_id IS NOT DISTINCT FROM p_thing
        AND l.created_at > now() - interval '24 hours')
    WHEN 'morning_brief' THEN NOT EXISTS (
      SELECT 1 FROM public.notification_log l
      WHERE l.profile_id = p_profile AND l.type = 'morning_brief'
        AND l.created_at > now() - interval '20 hours')
    WHEN 'spring_clean' THEN NOT EXISTS (
      SELECT 1 FROM public.notification_log l
      WHERE l.profile_id = p_profile AND l.type = 'spring_clean'
        AND l.created_at > now() - interval '7 days')
    WHEN 'upgrade' THEN NOT EXISTS (
      SELECT 1 FROM public.notification_log l
      WHERE l.profile_id = p_profile AND l.type = 'upgrade'
        AND l.created_at > now() - interval '7 days')
    WHEN 'reactivation' THEN (
      SELECT count(*) FROM public.notification_log l
      WHERE l.profile_id = p_profile AND l.type = 'reactivation'
        AND l.created_at > now() - interval '14 days') < 2
    ELSE true
  END;
$$;
REVOKE EXECUTE ON FUNCTION katalist_priv.can_send(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION katalist_priv.can_send(uuid, text, uuid) TO service_role;

-- Quiet-hours check for a profile, using its timezone. No prefs row = not quiet.
CREATE OR REPLACE FUNCTION katalist_priv.in_quiet_hours(p_profile uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
  SELECT COALESCE((
    SELECT CASE
      WHEN np.quiet_start = np.quiet_end THEN false
      WHEN np.quiet_start < np.quiet_end THEN h.hr >= np.quiet_start AND h.hr < np.quiet_end
      ELSE h.hr >= np.quiet_start OR h.hr < np.quiet_end
    END
    FROM public.notification_prefs np
    CROSS JOIN LATERAL (
      SELECT EXTRACT(hour FROM (now() AT TIME ZONE COALESCE(
        (SELECT timezone FROM public.profiles WHERE id = p_profile), 'UTC')))::int AS hr
    ) h
    WHERE np.profile_id = p_profile
  ), false);
$$;
REVOKE EXECUTE ON FUNCTION katalist_priv.in_quiet_hours(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION katalist_priv.in_quiet_hours(uuid) TO service_role;

-- 5. The escalation engine. Runs as service_role (via the scheduled route).
CREATE OR REPLACE FUNCTION public.run_nudge_escalation()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  t RECORD;
  v_band public.nudge_staleness;
  v_prev public.nudge_staleness;
  v_snoozed timestamptz;
  v_assignee_profile uuid;
  v_owner_profile uuid;
  v_reason public.nudge_reason;
  v_emitted integer := 0;
BEGIN
  FOR t IN
    SELECT th.id, th.title, th.owner_actor_id, th.current_assignee_actor_id, th.updated_at
    FROM public.things th
    WHERE th.acknowledgement = 'waiting_for_catch'
      AND th.cancelled_at IS NULL
      AND th.sorted_at IS NULL
      AND th.owner_actor_id <> th.current_assignee_actor_id
    FOR UPDATE OF th SKIP LOCKED
  LOOP
    v_band := CASE
      WHEN now() - t.updated_at < interval '12 hours' THEN 'fresh'
      WHEN now() - t.updated_at < interval '24 hours' THEN 'warm'
      WHEN now() - t.updated_at < interval '48 hours' THEN 'hot'
      WHEN now() - t.updated_at < interval '72 hours' THEN 'on_fire'
      ELSE 'stale'
    END::public.nudge_staleness;

    SELECT staleness_level, snoozed_until INTO v_prev, v_snoozed
    FROM public.thing_nudge_state
    WHERE thing_id = t.id AND to_actor_id = t.current_assignee_actor_id;

    IF v_snoozed IS NOT NULL AND v_snoozed > now() THEN
      CONTINUE;
    END IF;

    -- No advance since last run → nothing to do.
    IF v_prev IS NOT NULL AND v_band <= v_prev THEN
      CONTINUE;
    END IF;

    SELECT profile_id INTO v_assignee_profile FROM public.actors WHERE id = t.current_assignee_actor_id;
    SELECT profile_id INTO v_owner_profile FROM public.actors WHERE id = t.owner_actor_id;

    -- Respect quiet hours: skip this run without advancing state, so the same
    -- band retries on a later run once the recipient is out of quiet hours.
    IF v_band = 'stale' THEN
      IF v_owner_profile IS NOT NULL AND katalist_priv.in_quiet_hours(v_owner_profile) THEN CONTINUE; END IF;
    ELSIF v_band <> 'fresh' THEN
      IF v_assignee_profile IS NOT NULL AND katalist_priv.in_quiet_hours(v_assignee_profile) THEN CONTINUE; END IF;
    END IF;

    IF v_band = 'fresh' THEN
      -- Record baseline, never nudge a fresh item.
      INSERT INTO public.thing_nudge_state (thing_id, to_actor_id, staleness_level)
      VALUES (t.id, t.current_assignee_actor_id, v_band)
      ON CONFLICT (thing_id, to_actor_id) DO UPDATE SET staleness_level = EXCLUDED.staleness_level;
      CONTINUE;
    END IF;

    IF v_band = 'stale' THEN
      -- Top rung: alert the sender (owner) with reassign/cancel/escalate framing.
      IF v_owner_profile IS NOT NULL AND katalist_priv.can_send(v_owner_profile, 'auto_nudge', t.id) THEN
        INSERT INTO public.notifications (profile_id, kind, title, body, thing_id, payload)
        VALUES (v_owner_profile, 'auto_nudge_stale', 'This one''s gone cold',
                format('"%s" has been waiting 3+ days. Reassign, cancel, or escalate?', t.title),
                t.id, '{}'::jsonb);
        INSERT INTO public.notification_log (profile_id, type, channel, thing_id)
        VALUES (v_owner_profile, 'auto_nudge', 'in_app', t.id);
        v_emitted := v_emitted + 1;
      END IF;
    ELSE
      -- Warm/Hot/On Fire: gentle in-app paw tap to the assignee.
      IF v_assignee_profile IS NOT NULL AND katalist_priv.can_send(v_assignee_profile, 'auto_nudge', t.id) THEN
        v_reason := CASE WHEN v_band = 'on_fire' THEN 'stale' ELSE 'waiting_for_catch' END::public.nudge_reason;
        INSERT INTO public.notifications (profile_id, kind, title, body, thing_id, payload)
        VALUES (v_assignee_profile, 'auto_nudge', 'Just a gentle paw tap',
                format('"%s" is waiting for you. Keep the rally going?', t.title),
                t.id, '{}'::jsonb);
        INSERT INTO public.notification_log (profile_id, type, channel, thing_id)
        VALUES (v_assignee_profile, 'auto_nudge', 'in_app', t.id);
        INSERT INTO public.nudges (thing_id, from_actor_id, to_actor_id, reason, message)
        VALUES (t.id, t.owner_actor_id, t.current_assignee_actor_id, v_reason, 'Auto-nudge (staleness escalation)');
        v_emitted := v_emitted + 1;
      END IF;
    END IF;

    -- Advance state regardless of cap, so we don't re-emit the same band later.
    INSERT INTO public.thing_nudge_state (thing_id, to_actor_id, staleness_level, last_escalated_at)
    VALUES (t.id, t.current_assignee_actor_id, v_band, now())
    ON CONFLICT (thing_id, to_actor_id)
    DO UPDATE SET staleness_level = EXCLUDED.staleness_level, last_escalated_at = now();
  END LOOP;

  RETURN v_emitted;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.run_nudge_escalation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_nudge_escalation() TO service_role;

-- 6. Daily maintenance: in-app morning brief + weekly spring-cleaning prompt.
--    Streak milestones are surfaced client-side from the unit-tested computeStreak
--    (server-side milestone push is deferred to the push phase).
CREATE OR REPLACE FUNCTION public.run_daily_maintenance()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  r RECORD;
  v_emitted integer := 0;
BEGIN
  -- Morning brief: one per profile with active things in their court.
  FOR r IN
    SELECT a.profile_id AS profile_id, count(*) AS active_count
    FROM public.things th
    JOIN public.actors a ON a.id = th.current_assignee_actor_id
    WHERE th.cancelled_at IS NULL AND th.sorted_at IS NULL
      AND a.profile_id IS NOT NULL
    GROUP BY a.profile_id
  LOOP
    IF katalist_priv.can_send(r.profile_id, 'morning_brief', NULL)
       AND NOT katalist_priv.in_quiet_hours(r.profile_id) THEN
      INSERT INTO public.notifications (profile_id, kind, title, body, payload)
      VALUES (r.profile_id, 'morning_brief', 'Morning!',
              format('%s thing%s in your court today.', r.active_count, CASE WHEN r.active_count = 1 THEN '' ELSE 's' END),
              '{}'::jsonb);
      INSERT INTO public.notification_log (profile_id, type, channel) VALUES (r.profile_id, 'morning_brief', 'in_app');
      v_emitted := v_emitted + 1;
    END IF;
  END LOOP;

  -- Spring cleaning: one weekly prompt per owner with items untouched 30+ days.
  FOR r IN
    SELECT a.profile_id AS profile_id, count(*) AS stale_count
    FROM public.things th
    JOIN public.actors a ON a.id = th.owner_actor_id
    WHERE th.cancelled_at IS NULL AND th.sorted_at IS NULL
      AND th.updated_at < now() - interval '30 days'
      AND a.profile_id IS NOT NULL
    GROUP BY a.profile_id
  LOOP
    IF katalist_priv.can_send(r.profile_id, 'spring_clean', NULL)
       AND NOT katalist_priv.in_quiet_hours(r.profile_id) THEN
      INSERT INTO public.notifications (profile_id, kind, title, body, payload)
      VALUES (r.profile_id, 'spring_clean', 'A quick tidy-up?',
              format('%s item%s gathering dust. Shred or revive them?', r.stale_count, CASE WHEN r.stale_count = 1 THEN '' ELSE 's' END),
              '{}'::jsonb);
      INSERT INTO public.notification_log (profile_id, type, channel) VALUES (r.profile_id, 'spring_clean', 'in_app');
      v_emitted := v_emitted + 1;
    END IF;
  END LOOP;

  RETURN v_emitted;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.run_daily_maintenance() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_daily_maintenance() TO service_role;
