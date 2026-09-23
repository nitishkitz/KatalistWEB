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

-- ── 2. claim_morning_brief() ─────────────────────────────────────────────────
-- Atomically claims today's (profile, context) presentation slot. The
-- caller's identity and "today" are BOTH derived server-side, never taken
-- from client input, so a caller cannot claim another profile's slot or an
-- arbitrary past/future date by lying about either:
--   * profile — derived from auth.uid(), no profile_id parameter exists.
--   * local date — computed from now() (server time) in an effective
--     timezone. `profiles.timezone` (already used for nudge quiet-hours;
--     see 20260916160000_nudge_escalation.sql) wins whenever it has been
--     explicitly set away from its 'UTC' column default. Only when it is
--     still sitting at that default AND the caller supplies a syntactically
--     valid IANA zone (validated by actually using it in an `AT TIME ZONE`
--     cast, which raises for a bogus zone name) does the client's own
--     detected browser zone get used instead — and even then, the
--     resulting date is still computed from real server time, so the
--     client can only ever shift which zone's "today" applies, never
--     claim a date that isn't actually today in some real zone.
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
  v_profile_tz    text;
  v_effective_tz  text;
  v_local_date    date;
  v_existing      public.morning_brief_presentations;
  v_inserted      public.morning_brief_presentations;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_context NOT IN ('work', 'home') THEN
    RAISE EXCEPTION 'invalid context';
  END IF;

  SELECT p.timezone INTO v_profile_tz FROM public.profiles p WHERE p.id = v_me;
  v_effective_tz := v_profile_tz;

  -- Only fall back to the client's own zone when the stored one is still
  -- exactly the column default -- an explicit 'UTC' the user actually set
  -- is trusted like any other value, not treated as "unset".
  IF v_effective_tz = 'UTC' AND p_client_timezone IS NOT NULL AND btrim(p_client_timezone) <> '' THEN
    BEGIN
      PERFORM now() AT TIME ZONE p_client_timezone;
      v_effective_tz := p_client_timezone;
    EXCEPTION WHEN OTHERS THEN
      v_effective_tz := v_profile_tz; -- invalid zone name from the client -- ignore it, keep 'UTC'
    END;
  END IF;

  v_local_date := (now() AT TIME ZONE v_effective_tz)::date;

  INSERT INTO public.morning_brief_presentations (profile_id, context, local_date, timezone)
  VALUES (v_me, p_context, v_local_date, v_effective_tz)
  ON CONFLICT (profile_id, context, local_date) DO NOTHING
  RETURNING * INTO v_inserted;

  IF v_inserted.id IS NOT NULL THEN
    RETURN QUERY SELECT true, v_inserted.local_date, v_inserted.timezone, v_inserted.presented_at;
    RETURN;
  END IF;

  -- Someone (this caller, an earlier call this same day, or a concurrent
  -- racing call) already holds today's slot -- report it, don't claim again.
  SELECT * INTO v_existing
  FROM public.morning_brief_presentations
  WHERE profile_id = v_me AND context = p_context AND local_date = v_local_date;

  RETURN QUERY SELECT false, v_existing.local_date, v_existing.timezone, v_existing.presented_at;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_morning_brief(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_morning_brief(text, text) TO authenticated, service_role;

-- ── 3. dismiss_morning_brief() ───────────────────────────────────────────────
-- Best-effort dismissal timestamp on today's already-claimed row. Never
-- creates a row on its own (dismissing without ever having claimed is a
-- no-op) and never un-claims -- a dismissal failing to record must not
-- resurrect the "not yet shown today" state, which would defeat the
-- once-per-day guarantee claim_morning_brief() provides.
--
-- Takes the same optional p_client_timezone fallback as claim_morning_brief
-- and resolves it identically -- if the original claim used the client's
-- zone (because profiles.timezone was still at its 'UTC' default), dismiss
-- must recompute the SAME local_date or it would look for a row under a
-- different date than the one actually claimed and silently match nothing.
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
  v_me           uuid := auth.uid();
  v_profile_tz   text;
  v_effective_tz text;
  v_local_date   date;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_context NOT IN ('work', 'home') THEN
    RAISE EXCEPTION 'invalid context';
  END IF;

  SELECT p.timezone INTO v_profile_tz FROM public.profiles p WHERE p.id = v_me;
  v_effective_tz := v_profile_tz;

  IF v_effective_tz = 'UTC' AND p_client_timezone IS NOT NULL AND btrim(p_client_timezone) <> '' THEN
    BEGIN
      PERFORM now() AT TIME ZONE p_client_timezone;
      v_effective_tz := p_client_timezone;
    EXCEPTION WHEN OTHERS THEN
      v_effective_tz := v_profile_tz;
    END;
  END IF;

  v_local_date := (now() AT TIME ZONE v_effective_tz)::date;

  UPDATE public.morning_brief_presentations
     SET dismissed_at = now()
   WHERE profile_id = v_me
     AND context = p_context
     AND local_date = v_local_date
     AND dismissed_at IS NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.dismiss_morning_brief(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dismiss_morning_brief(text, text) TO authenticated, service_role;
