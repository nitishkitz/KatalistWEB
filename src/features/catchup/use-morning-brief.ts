import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { useAppContext } from "@/features/context/use-app-context";
import { useProfile } from "@/features/me/use-profile";
import { currentDemoActorId } from "@/features/demo/identities";
import { useCatchup } from "./use-catchup";
import { useInteractionBlocker } from "@/components/katalist/use-interaction-blocker";
import { morningBriefAutoOpenEnabled } from "./morning-brief-flag";
import {
  isEligibleToAutoOpen,
  isPastMorningThreshold,
  localDateKey,
  nextMorningThreshold,
  resolveEffectiveTimezone,
} from "./morning-brief-schedule";
import {
  claimMorningBriefLive,
  claimMorningBriefPreview,
  dismissMorningBriefLive,
  dismissMorningBriefPreview,
} from "./morning-brief-receipts";
import { getIdentityEpoch, isEpochCurrent } from "@/features/realtime/identity-cache-policy";

/**
 * F01/F04: wires the pure schedule model (morning-brief-schedule.ts), the
 * presentation receipt (morning-brief-receipts.ts), Catch Up's own
 * moments (use-catchup.ts), and the interaction-blocker registry (D03)
 * into one "should Morning Brief be open right now, and why" contract.
 *
 * One presentation controller per mounted instance is the caller's
 * responsibility (F04 wires exactly one into each active Court surface) --
 * this hook itself does not deduplicate multiple simultaneous mounts.
 */
export type UseMorningBrief = {
  /** True while the brief should be showing -- either auto-opened or manually reopened. */
  open: boolean;
  /** Explicit dismissal (Escape/X/backdrop/finish-review/opening a Thing).
   *  Records the receipt's dismissal (best-effort) and suppresses further
   *  automatic opens for the remainder of this local day; does not affect
   *  a LATER manual reopen today. */
  dismiss: () => void;
  /** Manual banner reopening -- works at any time, never touches the
   *  receipt (a manual open must not consume or reset the daily claim). */
  reopen: () => void;
  /** True once this session has confirmed an automatic open already
   *  happened today (via either this session's own claim or a prior
   *  claim discovered as "already shown") -- callers can use this to
   *  decide whether a manual "Review" affordance is still worth showing
   *  even though the automatic moment has passed. */
  alreadyPresentedToday: boolean;
};

export function useMorningBrief(): UseMorningBrief {
  const { session, user } = useSession();
  const preview = isPreviewSession(session);
  const { context } = useAppContext();
  const qc = useQueryClient();
  const catchup = useCatchup();
  const { isBlocked: hasBlockingInteraction } = useInteractionBlocker();
  const profileQuery = useProfile();

  const [open, setOpen] = useState(false);
  const [alreadyPresentedToday, setAlreadyPresentedToday] = useState(false);
  const [isTabHidden, setIsTabHidden] = useState(
    typeof document === "undefined" ? false : document.visibilityState === "hidden",
  );

  // Guards against attempting a claim more than once for the same
  // identity+context+local-date in this mount, and against retrying
  // forever after a service-unavailable error (no infinite retry loop).
  const attemptedKeyRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // F-03: attemptClaim's own closure only sees the values current at the
  // moment it was CALLED -- if context/tab-visibility/blocker/moments
  // change while its claim RPC is still in flight, the continuation must
  // not open stale UI (e.g. a claim made for Work, now shown as Home's
  // brief because context switched mid-await). These refs are updated on
  // every render (not just via an effect) so the continuation can read
  // the LATEST truth after its await, not what was true when it started.
  const contextRef = useRef(context);
  contextRef.current = context;
  const isTabHiddenRef = useRef(isTabHidden);
  isTabHiddenRef.current = isTabHidden;
  const hasBlockingInteractionRef = useRef(hasBlockingInteraction);
  hasBlockingInteractionRef.current = hasBlockingInteraction;
  const catchupCountRef = useRef(catchup.count);
  catchupCountRef.current = catchup.count;
  const catchupErrorRef = useRef(catchup.error);
  catchupErrorRef.current = catchup.error;
  // R-04: the effective timezone/profile-readiness current when the claim
  // was CALLED can be stale by the time it resolves -- a profile timezone
  // edit, or the fetch itself only settling mid-await, must not let a
  // now-outdated "past threshold" verdict decide whether to open.
  const timeZoneRef = useRef<string>("UTC");
  const profileLoadingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibility = () => setIsTabHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
    };
  }, []);

  const identityId = preview ? currentDemoActorId() : user?.id;
  // R-04: `profileQuery.data` is `undefined` both while the profile is
  // still loading AND once it has settled with no `timezone` column set --
  // those are NOT the same fact. Using the browser-zone fallback before
  // the fetch has settled can evaluate the 07:00 threshold against the
  // wrong zone entirely. `profileLoading` gates eligibility on this below;
  // the fallback itself is only reached once the query has actually
  // settled (success or error), matching "wait for it to settle before
  // trusting a fallback" rather than eagerly guessing.
  const profileLoading = !preview && Boolean(identityId) && profileQuery.isLoading;
  const profileTimezone = preview ? null : profileQuery.data?.timezone ?? null;
  const timeZone = resolveEffectiveTimezone(profileTimezone);
  timeZoneRef.current = timeZone;
  profileLoadingRef.current = profileLoading;

  const attemptClaim = useCallback(async () => {
    if (!morningBriefAutoOpenEnabled()) return;
    if (!identityId) return;

    const now = new Date();
    const dateKey = localDateKey(now, timeZone);
    const attemptKey = `${identityId}:${context}:${dateKey}`;
    if (attemptedKeyRef.current === attemptKey) return; // already attempted this identity/context/day this mount

    const decision = isEligibleToAutoOpen({
      now,
      timeZone,
      hasActionableMoments: catchup.count > 0,
      hasMomentsError: catchup.error != null,
      isTabHidden,
      authPending: !preview && !session,
      profileLoading,
      momentsLoading: catchup.isLoading,
      hasBlockingInteraction,
    });
    if (!decision.eligible) return;

    attemptedKeyRef.current = attemptKey;
    const epoch = getIdentityEpoch(qc).epoch;
    try {
      const result = preview
        ? await claimMorningBriefPreview(identityId, context, dateKey, timeZone)
        : await claimMorningBriefLive(context, timeZone);
      if (!isEpochCurrent(qc, epoch)) return; // identity switched while the claim was in flight
      if (!mountedRef.current) return; // unmounted while the claim was in flight
      // F-03/R-04: the claim itself succeeded (or was already claimed) for
      // the SCOPE captured above (identity/context/date) -- but showing it
      // now requires that scope to still be the live one. A context switch
      // mid-await means this claim's context no longer matches what's
      // displayed; a blocker/hidden-tab appearing meanwhile means the
      // moment to interrupt is no longer right; moments emptying meanwhile
      // means there's nothing left to show. A profile timezone resolving
      // (or changing) meanwhile, or the real clock crossing back before
      // the threshold in the NOW-current zone, means "past threshold" is
      // no longer actually true for this viewer -- re-verified against the
      // LATEST timezone/profile-readiness/clock, not what was true when
      // this call started. In every one of these cases the receipt itself
      // is still recorded/valid -- only the automatic OPEN is skipped, so
      // manual review remains available and the day's slot is not
      // reattempted (attemptedKeyRef already marks it done).
      const stillEligibleToShow =
        contextRef.current === context &&
        !hasBlockingInteractionRef.current &&
        !isTabHiddenRef.current &&
        catchupErrorRef.current == null &&
        catchupCountRef.current > 0 &&
        !profileLoadingRef.current &&
        isPastMorningThreshold(new Date(), timeZoneRef.current);
      if (result.claimed && stillEligibleToShow) {
        setOpen(true);
      }
      setAlreadyPresentedToday(true);
    } catch (err) {
      // R-04: the server is authoritative for the 07:00 threshold too
      // (see claim_morning_brief's own check) and rejects a genuinely
      // premature claim with this specific message rather than inserting
      // a row. That is a "not yet, try again later today" outcome, not a
      // permanent failure -- unlike every other error here (most likely:
      // the migration isn't deployed yet), it must NOT consume today's
      // one attempt, or the legitimate later claim could never succeed
      // today. The already-scheduled next-threshold timer (below) will
      // retry; nothing here needs to reschedule directly.
      if (err instanceof Error && err.message.toLowerCase().includes("before morning threshold")) {
        attemptedKeyRef.current = null;
        return;
      }
      console.error("Morning Brief claim failed", err);
    }
  }, [
    identityId,
    context,
    timeZone,
    catchup.count,
    catchup.isLoading,
    catchup.error,
    isTabHidden,
    hasBlockingInteraction,
    preview,
    session,
    profileLoading,
    qc,
  ]);

  // Re-evaluate whenever any input that could flip eligibility changes.
  useEffect(() => {
    void attemptClaim();
  }, [attemptClaim]);

  // Schedule a re-check at the next local 07:00 threshold, so a tab left
  // open overnight (or across a blocker clearing later) still gets a
  // chance without needing a reload. Re-armed whenever the identity,
  // context, or timezone changes (all of which can shift the threshold).
  useEffect(() => {
    if (!identityId) return;
    const epoch = getIdentityEpoch(qc).epoch;
    const scheduleNext = () => {
      const delayMs = Math.max(1000, nextMorningThreshold(new Date(), timeZone).getTime() - Date.now());
      timerRef.current = setTimeout(() => {
        if (!isEpochCurrent(qc, epoch)) return;
        void attemptClaim();
        scheduleNext();
      }, delayMs);
    };
    scheduleNext();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [identityId, context, timeZone, qc, attemptClaim]);

  const dismiss = useCallback(() => {
    setOpen(false);
    if (!identityId) return;
    const dateKey = localDateKey(new Date(), timeZone);
    if (preview) {
      dismissMorningBriefPreview(identityId, context, dateKey);
    } else {
      void dismissMorningBriefLive(context, timeZone).catch((err) => {
        // Best-effort: a failed dismissal must not resurrect "not yet
        // shown today" (it never un-claims), and must not repeat an
        // already-successful Thing action -- there is none here, this
        // only ever records a timestamp.
        console.error("Morning Brief dismiss failed", err);
      });
    }
  }, [identityId, context, timeZone, preview]);

  const reopen = useCallback(() => {
    // Deliberately does not touch the receipt at all -- see the type's
    // own doc comment on `reopen`.
    setOpen(true);
  }, []);

  return { open, dismiss, reopen, alreadyPresentedToday };
}
