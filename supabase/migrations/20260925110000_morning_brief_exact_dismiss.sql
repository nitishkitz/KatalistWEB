-- Morning Brief — exact-receipt dismissal (T10-02).
--
-- supabase/migrations/20260923100000_morning_brief_receipts.sql's
-- dismiss_morning_brief(context, timezone) targets "the caller's most
-- recent undismissed row for this profile/context" -- verified directly
-- against that migration's SQL, which applies no local_date filter at all.
-- That is correct for the common "dismiss what I was just shown" case, but
-- if a NEWER day's row has already been claimed for the same
-- profile/context by the time an older still-open receipt is dismissed (a
-- tab left open across local midnight, or a second tab/device claiming a
-- new day first), that call would dismiss the newer row instead of the one
-- actually being reviewed.
--
-- This is purely additive: a new function overload distinguished by its
-- argument list (text, text, date) rather than a REPLACE of the existing
-- (text, text) function, so every existing 2-argument caller keeps its
-- current best-effort behavior unchanged. A caller holding an exact
-- presented-receipt reference (context + local_date it was actually shown
-- for) can call this overload instead to target that receipt precisely.
--
-- Prepared as part of the T10 Morning Brief closure batch. NOT applied to
-- any database by this change -- deployment and live acceptance are a
-- separate, later step (see supabase/migration drift notes: this repo's
-- local/remote migration history has diverged, so single migrations are
-- applied manually, not via a blanket `db push`).

CREATE OR REPLACE FUNCTION public.dismiss_morning_brief(
  p_context text,
  p_client_timezone text,
  p_local_date date
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
  IF p_local_date IS NULL THEN
    RAISE EXCEPTION 'local date required';
  END IF;

  -- Exact match on profile/context/local_date -- never falls back to "most
  -- recent" if the exact row isn't found (e.g. wrong date), and never
  -- un-dismisses/touches any other row. A no-op (no matching row, or the
  -- matching row is already dismissed) is not an error, matching the
  -- existing 2-argument overload's "dismiss without a prior claim is a
  -- no-op" contract.
  UPDATE public.morning_brief_presentations AS m
     SET dismissed_at = now()
   WHERE m.profile_id = v_me
     AND m.context = p_context
     AND m.local_date = p_local_date
     AND m.dismissed_at IS NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.dismiss_morning_brief(text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dismiss_morning_brief(text, text, date) TO authenticated, service_role;
