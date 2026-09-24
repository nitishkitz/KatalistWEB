-- Morning Brief — a daily "shown once per profile/context/local-date"
-- presentation receipt, atomically claimed so two concurrent clients (or
-- two tabs of the same account) can't both win the same day's automatic
-- open. See docs/superpowers/plans/KATALIST_D_TO_H_IMPLEMENTATION_EXECUTION_PLAN.md
-- (F02) for the full contract this implements.
--
-- Prepared as part of the D-H implementation batch. NOT applied to any
-- database by this change — deployment and live acceptance are a
-- separate, later step. VITE_KATALIST_MORNING_BRIEF_AUTO_OPEN stays off
-- until this migration is actually deployed and verified.

-- ── 1. Receipt table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.morning_brief_presentations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  context text NOT NULL CHECK (context IN ('work', 'home')),
  local_date date NOT NULL,
  timezone text NOT NULL,
  presented_at timestamptz NOT NULL DEFAULT now(),
  dismissed_at timestamptz,
  UNIQUE (profile_id, context, local_date)
);

GRANT SELECT ON public.morning_brief_presentations TO authenticated;
GRANT ALL ON public.morning_brief_presentations TO service_role;
ALTER TABLE public.morning_brief_presentations ENABLE ROW LEVEL SECURITY;

-- Owner-only reads. There is no direct INSERT/UPDATE policy for
-- `authenticated` at all — every write goes through the SECURITY DEFINER
-- RPCs below, which derive the profile from auth.uid() themselves, so a
-- caller can never claim or dismiss another profile's receipt regardless
-- of what profile_id they might try to pass (there is no client-facing
-- parameter for it).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'morning_brief_presentations'
      AND policyname = 'own morning brief presentations are readable'
  ) THEN
    CREATE POLICY "own morning brief presentations are readable"
      ON public.morning_brief_presentations FOR SELECT TO authenticated
      USING (profile_id = auth.uid());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_morning_brief_presentations_profile
  ON public.morning_brief_presentations (profile_id, context, local_date);

-- ── 2. resolve_morning_brief_timezone() ──────────────────────────────────────
-- F-02: extracted out of claim_morning_brief so the effective-timezone rule
-- has one place it's defined and can be tested directly. Must match the
-- client's own resolveEffectiveTimezone() (morning-brief-schedule.ts)
-- exactly: the profile's stored zone wins whenever it is a valid IANA zone
-- name, INCLUDING an explicit 'UTC' -- a real, deliberately-set value is
-- never treated as "unset" just because it happens to equal the column
-- default. The client-supplied zone is used ONLY when the profile's own
-- stored zone is null or not a real IANA zone (validated by actually using
-- it in an AT TIME ZONE cast, which raises for a bogus name); final
-- fallback is 'UTC'. Not exposed to callers other than service_role/the
-- functions below -- it takes a profile id directly, which must never be
-- caller-suppliable outside a SECURITY DEFINER context that already
-- derived it from auth.uid() itself.
CREATE OR REPLACE FUNCTION katalist_priv.resolve_morning_brief_timezone(
  p_profile_id uuid,
  p_client_timezone text
)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_profile_tz   text;
  v_effective_tz text;
BEGIN
  SELECT p.timezone INTO v_profile_tz FROM public.profiles p WHERE p.id = p_profile_id;

  v_effective_tz := NULL;
  IF v_profile_tz IS NOT NULL THEN
    BEGIN
      PERFORM now() AT TIME ZONE v_profile_tz;
      v_effective_tz := v_profile_tz;
    EXCEPTION WHEN OTHERS THEN
      v_effective_tz := NULL; -- profile's stored zone is not a valid IANA name
    END;
  END IF;

  IF v_effective_tz IS NULL AND p_client_timezone IS NOT NULL AND btrim(p_client_timezone) <> '' THEN
    BEGIN
      PERFORM now() AT TIME ZONE p_client_timezone;
      v_effective_tz := p_client_timezone;
    EXCEPTION WHEN OTHERS THEN
      v_effective_tz := NULL; -- invalid zone name from the client either -- fall through to UTC
    END;
  END IF;

  RETURN COALESCE(v_effective_tz, 'UTC');
END;
$$;
REVOKE EXECUTE ON FUNCTION katalist_priv.resolve_morning_brief_timezone(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION katalist_priv.resolve_morning_brief_timezone(uuid, text) TO service_role;

-- ── 3. claim_morning_brief() ─────────────────────────────────────────────────
-- Atomically claims today's (profile, context) presentation slot. The
-- caller's identity and "today" are BOTH derived server-side, never taken
-- from client input, so a caller cannot claim another profile's slot or an
-- arbitrary past/future date by lying about either:
--   * profile — derived from auth.uid(), no profile_id parameter exists.
--   * local date — computed from now() (server time) in an effective
--     timezone, resolved by ONE rule that matches the client's own
--     resolveEffectiveTimezone() exactly (morning-brief-schedule.ts):
--     the profile's stored `timezone` (already used for nudge quiet-hours;
--     see 20260916160000_nudge_escalation.sql) wins whenever it is a
--     valid IANA zone name, INCLUDING an explicit 'UTC' -- a real,
--     deliberately-set value is never treated as "unset" just because it
--     happens to equal the column default (F-02: the previous version's
--     "fall back to the client's zone whenever the stored one is exactly
--     'UTC'" rule could not tell a deliberate UTC choice from an
--     unset/defaulted one, and disagreed with the client's own rule,
--     which never does that). The client-supplied zone is used ONLY when
--     the profile's own stored zone is null or not a real IANA zone
--     (validated the same way: an `AT TIME ZONE` cast, which raises for a
--     bogus name) -- and even then, the resulting date is still computed
--     from real server time, so the client can only ever shift which
--     zone's "today" applies, never claim a date that isn't actually
--     today in some real zone.
-- ON CONFLICT DO NOTHING makes two concurrent callers race safely: exactly
-- one INSERT succeeds, and this returns claimed=false to the other without
-- a second row or a duplicate presentation.
CREATE OR REPLACE FUNCTION public.claim_morning_brief(
  p_context text,
  p_client_timezone text DEFAULT NULL
)
RETURNS TABLE (
  claimed boolean,
  local_date date,
  timezone text,
  presented_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_me            uuid := auth.uid();
  v_effective_tz  text;
  v_local_date    date;
  v_local_hour    int;
  v_existing      public.morning_brief_presentations;
  v_inserted      public.morning_brief_presentations;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_context NOT IN ('work', 'home') THEN
    RAISE EXCEPTION 'invalid context';
  END IF;

  v_effective_tz := katalist_priv.resolve_morning_brief_timezone(v_me, p_client_timezone);

  v_local_date := (now() AT TIME ZONE v_effective_tz)::date;
  v_local_hour := EXTRACT(HOUR FROM (now() AT TIME ZONE v_effective_tz))::int;

  -- F-02: the server was not previously authoritative for the 07:00
  -- threshold at all -- only the client's own morning-brief-schedule.ts
  -- checked it before ever calling this RPC. A client that called this
  -- early (a clock/timezone-resolution mismatch, a future caller that
  -- forgets the client-side check, or a direct RPC call) would otherwise
  -- silently burn today's one-per-day slot before the real morning
  -- moment, permanently preventing the legitimate later claim from ever
  -- succeeding today. Reject instead of inserting a row, so the slot
  -- remains open for a later, legitimately-timed claim the same day.
  -- NOTE: 7 here must stay in sync with MORNING_THRESHOLD_HOUR in
  -- src/features/catchup/morning-brief-schedule.ts.
  IF v_local_hour < 7 THEN
    RAISE EXCEPTION 'before morning threshold';
  END IF;

  -- F-01 fix: RETURNS TABLE above declares implicit PL/pgSQL variables
  -- named `local_date` and `timezone` that collide with this table's own
  -- `local_date`/`timezone` columns. A bare `local_date` reference --
  -- including inside an ON CONFLICT (...) target list, not only in a
  -- WHERE/SELECT -- is ambiguous between the two and fails at execution
  -- time with "column reference \"local_date\" is ambiguous" (reproduced
  -- against a real Postgres-compatible engine; migration parsing alone
  -- does not exercise function bodies). Fixed by targeting the unique
  -- constraint by name (sidesteps the column-name-based conflict target
  -- entirely) and qualifying every table-column reference with the `m`
  -- alias below.
  INSERT INTO public.morning_brief_presentations AS m (profile_id, context, local_date, timezone)
  VALUES (v_me, p_context, v_local_date, v_effective_tz)
  ON CONFLICT ON CONSTRAINT morning_brief_presentations_profile_id_context_local_date_key DO NOTHING
  RETURNING m.* INTO v_inserted;

  IF v_inserted.id IS NOT NULL THEN
    RETURN QUERY SELECT true, v_inserted.local_date, v_inserted.timezone, v_inserted.presented_at;
    RETURN;
  END IF;

  -- Someone (this caller, an earlier call this same day, or a concurrent
  -- racing call) already holds today's slot -- report it, don't claim again.
  SELECT m.* INTO v_existing
  FROM public.morning_brief_presentations m
  WHERE m.profile_id = v_me AND m.context = p_context AND m.local_date = v_local_date;

  RETURN QUERY SELECT false, v_existing.local_date, v_existing.timezone, v_existing.presented_at;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_morning_brief(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_morning_brief(text, text) TO authenticated, service_role;

-- ── 4. dismiss_morning_brief() ───────────────────────────────────────────────
-- Best-effort dismissal timestamp on the caller's most recent still-open
-- claimed row for this context. Never creates a row on its own (dismissing
-- without ever having claimed is a no-op) and never un-claims -- a
-- dismissal failing to record must not resurrect the "not yet shown today"
-- state, which would defeat the once-per-day guarantee claim_morning_brief()
-- provides.
--
-- F-02/F-03: this used to recompute "today" from scratch (the same
-- profile-or-client-timezone dance as claim_morning_brief) and match on
-- that freshly-computed local_date. That silently failed to find the
-- right row whenever "today" as recomputed at dismiss time differed from
-- "today" as it was when the row was actually claimed -- e.g. dismissing
-- just after local midnight, or after the caller's resolved timezone
-- changed in between (profile timezone edited, or the client-fallback
-- branch resolving differently). Targeting "the most recent undismissed
-- row for this profile/context" instead means dismiss always finds the
-- actual receipt that was actually presented, regardless of what "today"
-- would recompute to right now -- it dismisses the claimed receipt by
-- identity, not by re-deriving a date that might have moved on.
-- p_client_timezone is accepted but intentionally unused; kept only for
-- call-signature symmetry with claim_morning_brief so existing callers
-- don't need a second, differently-shaped RPC call.
CREATE OR REPLACE FUNCTION public.dismiss_morning_brief(
  p_context text,
  p_client_timezone text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_context NOT IN ('work', 'home') THEN
    RAISE EXCEPTION 'invalid context';
  END IF;

  UPDATE public.morning_brief_presentations AS m
     SET dismissed_at = now()
   WHERE m.id = (
     SELECT id FROM public.morning_brief_presentations
      WHERE profile_id = v_me AND context = p_context AND dismissed_at IS NULL
      ORDER BY local_date DESC
      LIMIT 1
   );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.dismiss_morning_brief(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dismiss_morning_brief(text, text) TO authenticated, service_role;
