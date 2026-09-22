-- Fix: snoozing a Thing from Catch Up did not exclude it from Catch Up.
--
-- list_catchup_moments()'s `snooze_ended` branch reads thing_snooze, but only
-- for *past* expiries (s.snoozed_until <= now()) — it treats "snoozed" as a
-- moment *source*, not an exclusion filter. The nudge/ghost/follow_up
-- branches never consulted thing_snooze at all. So snoozing a Thing wrote a
-- future snoozed_until and a receipt for exactly one moment_key, but a Thing
-- with more than one eligible moment (e.g. both a nudge and a follow_up
-- reason) surfaced its next-highest-priority, differently-keyed moment on
-- the very next fetch — snoozing never actually hid the Thing from Catch Up.
--
-- Fix: exclude any Thing currently under an active (future) personal snooze
-- from the nudge/ghost/follow_up branches. The snooze_ended branch is
-- intentionally left alone — it exists specifically to surface *past*
-- expiries, which by definition are never "currently" snoozed.
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
      AND NOT EXISTS (
        SELECT 1 FROM public.thing_snooze s2
        WHERE s2.profile_id = v_profile AND s2.thing_id = n.thing_id AND s2.snoozed_until > now()
      )

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
      AND NOT EXISTS (
        SELECT 1 FROM public.thing_snooze s2
        WHERE s2.profile_id = v_profile AND s2.thing_id = d.thing_id AND s2.snoozed_until > now()
      )

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
      AND NOT EXISTS (
        SELECT 1 FROM public.thing_snooze s2
        WHERE s2.profile_id = v_profile AND s2.thing_id = f.thing_id AND s2.snoozed_until > now()
      )
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

NOTIFY pgrst, 'reload schema';
