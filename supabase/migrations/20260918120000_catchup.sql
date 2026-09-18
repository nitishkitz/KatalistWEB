-- Catch Up — a temporary, read-only review stack layered over the Court.
--
-- Catch Up surfaces "attention moments" derived from existing objects; it does
-- NOT introduce a new Thing status, list, lane or inbox, and viewing a moment
-- never mutates the underlying Thing (see Master Concept BRD v2.1 §20.3 Ghost
-- Card + §30.2 Same-Object Principle). Four moment sources are combined:
--   nudge        — a nudge received by the current actor (public.nudges)
--   snooze_ended — a personal snooze that has naturally woken (public.thing_snooze)
--   ghost        — an active Doorman breakthrough (public.doorman_state)
--   follow_up    — an owner-facing "Due Soon"/"Repeated Handoff" nudge reason
--                  (derived from public.list_nudgeable_things(); no dedicated model exists)
--
-- A per-profile receipt ledger records that a specific moment was shown so the
-- stack does not become a permanent inbox. A new nudge/snooze/breakthrough
-- produces a new moment key and can surface again.

-- ── 1. Wake tracking for personal snoozes ────────────────────────────────────
-- unsnooze_thing() deletes the row (an early wake leaves no trace), so only a
-- NATURAL expiry is a "snooze ended" moment. woke_at marks such an expiry as
-- consumed once surfaced, so it is not re-listed forever. Re-snoozing clears it.
ALTER TABLE public.thing_snooze
  ADD COLUMN IF NOT EXISTS woke_at timestamptz;

-- Re-snoozing a Thing must reset woke_at so a future expiry surfaces again.
CREATE OR REPLACE FUNCTION public.snooze_thing(p_thing_id uuid, p_snoozed_until timestamptz)
RETURNS public.thing_snooze
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_me    uuid := auth.uid();
  v_state public.thing_snooze;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT katalist_priv.can_view_thing(p_thing_id) THEN
    RAISE EXCEPTION 'Thing not found';
  END IF;
  IF p_snoozed_until IS NULL OR p_snoozed_until <= now() THEN
    RAISE EXCEPTION 'snooze must be in the future';
  END IF;

  INSERT INTO public.thing_snooze (profile_id, thing_id, snoozed_until)
  VALUES (v_me, p_thing_id, p_snoozed_until)
  ON CONFLICT (profile_id, thing_id)
  DO UPDATE SET snoozed_until = EXCLUDED.snoozed_until, woke_at = NULL
  RETURNING * INTO v_state;

  RETURN v_state;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.snooze_thing(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.snooze_thing(uuid, timestamptz) TO authenticated, service_role;

-- ── 2. Receipt ledger ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.catchup_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  moment_key text NOT NULL,
  surfaced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, moment_key)
);

GRANT SELECT ON public.catchup_receipts TO authenticated;
GRANT ALL ON public.catchup_receipts TO service_role;
ALTER TABLE public.catchup_receipts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'catchup_receipts'
      AND policyname = 'own catchup receipts are readable'
  ) THEN
    CREATE POLICY "own catchup receipts are readable"
      ON public.catchup_receipts FOR SELECT TO authenticated
      USING (profile_id = auth.uid());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_catchup_receipts_profile
  ON public.catchup_receipts (profile_id, moment_key);

-- ── 3. list_catchup_moments() ────────────────────────────────────────────────
-- Returns the current profile's un-surfaced moments, one row per Thing (highest
-- priority, then newest), newest-priority-first. A derived lens over existing
-- rows — it copies no Thing data beyond the id the client resolves against.
CREATE OR REPLACE FUNCTION public.list_catchup_moments()
RETURNS TABLE (
  moment_key  text,
  kind        text,
  thing_id    uuid,
  occurred_at timestamptz,
  actor_id    uuid,
  reason      text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_profile uuid := auth.uid();
  v_actor   uuid := katalist_priv.current_actor_id();
BEGIN
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  RETURN QUERY
  WITH candidate AS (
    -- Nudges received by me in the last 7 days, on still-active Things.
    SELECT
      'nudge:' || n.id::text                            AS moment_key,
      'nudge'::text                                      AS kind,
      n.thing_id                                         AS thing_id,
      n.created_at                                       AS occurred_at,
      n.from_actor_id                                    AS actor_id,
      n.reason::text                                     AS reason,
      1                                                  AS priority
    FROM public.nudges n
    JOIN public.things t ON t.id = n.thing_id
    WHERE v_actor IS NOT NULL
      AND n.to_actor_id = v_actor
      AND n.created_at > now() - interval '7 days'
      AND t.cancelled_at IS NULL
      AND t.sorted_at IS NULL

    UNION ALL

    -- Personal snoozes that naturally expired and have not been consumed.
    SELECT
      'snooze:' || s.id::text || ':' || floor(extract(epoch FROM s.snoozed_until))::bigint::text,
      'snooze_ended'::text,
      s.thing_id,
      s.snoozed_until,
      NULL::uuid,
      'snooze_ended'::text,
      2
    FROM public.thing_snooze s
    JOIN public.things t ON t.id = s.thing_id
    WHERE s.profile_id = v_profile
      AND s.snoozed_until <= now()
      AND s.snoozed_until > now() - interval '3 days'
      AND s.woke_at IS NULL
      AND t.cancelled_at IS NULL
      AND t.sorted_at IS NULL

    UNION ALL

    -- Active Doorman breakthroughs (ghost cards) not dismissed or snoozed.
    SELECT
      'ghost:' || d.thing_id::text || ':'
        || floor(extract(epoch FROM COALESCE(d.last_presented_at, d.updated_at, d.created_at)))::bigint::text,
      'ghost'::text,
      d.thing_id,
      COALESCE(d.last_presented_at, d.updated_at, d.created_at),
      NULL::uuid,
      COALESCE(NULLIF(btrim(d.breakthrough_reason), ''), 'ghost'),
      3
    FROM public.doorman_state d
    JOIN public.things t ON t.id = d.thing_id
    WHERE d.profile_id = v_profile
      AND d.dismissed_at IS NULL
      AND (d.snoozed_until IS NULL OR d.snoozed_until <= now())
      AND t.cancelled_at IS NULL
      AND t.sorted_at IS NULL

    UNION ALL

    -- Owner-facing follow-ups (no dedicated model): "Due Soon" / "Repeated
    -- Handoff" reasons from the existing nudgeable computation.
    SELECT
      'followup:' || f.thing_id::text || ':' || f.reason::text,
      'follow_up'::text,
      f.thing_id,
      COALESCE(f.since, now()),
      f.to_actor_id,
      f.reason::text,
      4
    FROM public.list_nudgeable_things() f
    WHERE f.reason IN ('due_soon', 'repeated_handoff')
  ),
  unseen AS (
    SELECT c.*
    FROM candidate c
    WHERE NOT EXISTS (
      SELECT 1 FROM public.catchup_receipts r
      WHERE r.profile_id = v_profile AND r.moment_key = c.moment_key
    )
  ),
  ranked AS (
    SELECT DISTINCT ON (u.thing_id)
      u.moment_key, u.kind, u.thing_id, u.occurred_at, u.actor_id, u.reason, u.priority
    FROM unseen u
    ORDER BY u.thing_id, u.priority ASC, u.occurred_at DESC
  )
  SELECT r.moment_key, r.kind, r.thing_id, r.occurred_at, r.actor_id, r.reason
  FROM ranked r
  ORDER BY r.priority ASC, r.occurred_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.list_catchup_moments() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_catchup_moments() TO authenticated, service_role;

-- ── 4. surface_catchup_moment() ──────────────────────────────────────────────
-- Records that a moment was shown to the caller. Never touches the Thing. For a
-- snooze moment it also stamps woke_at so that specific expiry stops surfacing.
CREATE OR REPLACE FUNCTION public.surface_catchup_moment(p_moment_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_me       uuid := auth.uid();
  v_snooze_id text;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_moment_key IS NULL OR btrim(p_moment_key) = '' THEN
    RETURN;
  END IF;

  INSERT INTO public.catchup_receipts (profile_id, moment_key)
  VALUES (v_me, p_moment_key)
  ON CONFLICT (profile_id, moment_key) DO NOTHING;

  IF p_moment_key LIKE 'snooze:%' THEN
    v_snooze_id := split_part(p_moment_key, ':', 2);
    IF v_snooze_id ~ '^[0-9a-fA-F-]{36}$' THEN
      UPDATE public.thing_snooze
         SET woke_at = now()
       WHERE profile_id = v_me
         AND id = v_snooze_id::uuid
         AND woke_at IS NULL;
    END IF;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.surface_catchup_moment(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.surface_catchup_moment(text) TO authenticated, service_role;
