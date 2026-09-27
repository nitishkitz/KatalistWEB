import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  nextLocalMidnight,
  nextMorningThreshold,
  resolveEffectiveTimezone,
} from "./morning-brief-schedule";
import {
  claimMorningBriefLive,
  claimMorningBriefPreview,
  dismissMorningBriefLive,
  dismissMorningBriefPreview,
  MorningBriefClaimRejected,
  type MorningBriefClaimResult,
} from "./morning-brief-receipts";
import { getIdentityEpoch, isEpochCurrent } from "@/features/realtime/identity-cache-policy";
import { logTelemetryEvent } from "@/lib/telemetry";

/**
 * F01/F04/T10-03: wires the pure schedule model (morning-brief-schedule.ts),
 * the presentation receipt (morning-brief-receipts.ts), Catch Up's own
 * moments (use-catchup.ts), and the interaction-blocker registry (D03)
 * into one "should Morning Brief be open right now, and why" contract.
 *
 * One presentation controller per mounted instance is the caller's
 * responsibility (F04 wires exactly one into each active Court surface) --
 * this hook itself does not deduplicate multiple simultaneous mounts.
 *
 * T10-03 rewrite: replaces the previous collection of independent booleans
 * (`open`, `alreadyPresentedToday`, a single `attemptedKeyRef`) with an
 * explicit `BriefScope` -- identity + context + resolved timezone + local
 * calendar date -- and per-scope attempt ownership tokens. A scope change
 * (identity, context, timezone, or local date rolling over) retires any
 * open presentation and any in-flight/pending attempt for the OLD scope;
 * a stale attempt's continuation can never mark a NEWER scope as
 * already-presented or paint stale content for it.
 */
export type UseMorningBrief = {
  /** True while the brief should be showing -- either auto-opened or manually reopened.
   *  Gated by the CURRENT scope matching the scope it was opened for; a scope
   *  change (context/identity/zone/local-date) closes this immediately. */
  open: boolean;
  /** Explicit dismissal (Escape/X/backdrop/finish-review/opening a Thing).
   *  Records the receipt's dismissal (best-effort), targeting the exact
   *  receipt this review owns, and suppresses further automatic opens for
   *  the remainder of this local day; does not affect a LATER manual
   *  reopen today. */
  dismiss: () => void;
  /** Manual banner reopening -- works at any time, never touches the
   *  receipt (a manual open must not consume or reset the daily claim). */
  reopen: () => void;
  /** True once the CURRENT scope (identity/context/local-date) has a
   *  confirmed presented receipt -- either from this session's own claim
   *  or a prior claim discovered as "already shown". An old receipt kept
   *  for a RETIRED scope (e.g. yesterday's) never marks a newer scope as
   *  already presented. */
  alreadyPresentedToday: boolean;
};

type BriefScope = {
  epoch: number;
  identityKind: "live" | "preview";
  identityId: string;
  context: "work" | "home";
  timezone: string;
  localDate: string;
};

function scopeKey(s: BriefScope): string {
  return `${s.identityKind}:${s.identityId}:${s.context}:${s.timezone}:${s.localDate}`;
}

function scopePresentationMatches(receipt: BriefScope | null, scope: BriefScope): boolean {
  if (!receipt) return false;
  return (
    receipt.identityKind === scope.identityKind &&
    receipt.identityId === scope.identityId &&
    receipt.context === scope.context &&
    receipt.localDate === scope.localDate
  );
}

/** Profile timezone readiness, classified explicitly rather than inferred
 *  from `isLoading` alone (T10-03 gap: "a successful no-profile result must
 *  be explicitly classified; undefined data is not a resolved unset
 *  timezone"). `pending` covers first load AND a paused/offline fetch with
 *  no cached data yet -- neither is a resolved fact about the timezone. */
type ProfileReadiness =
  | { kind: "pending" }
  | { kind: "error" }
  | { kind: "resolved"; timezone: string | null };

// T10-03: at most two bounded retries for a server-confirmed "premature"
// (before-threshold) rejection, at 30s then 120s, per scope -- never after
// the scope itself has retired. The adapter's claim result carries no
// server-provided retry instant today (see morning-brief-receipts.ts's
// `MorningBriefClaimResult`), so this fallback schedule is used; revisit if
// the RPC contract ever adds one.
const PREMATURE_RETRY_DELAYS_MS = [30_000, 120_000];

type AttemptEntry = {
  token: number;
  status: "idle" | "in-flight" | "settled";
  retryCount: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
};

export function useMorningBrief(): UseMorningBrief {
  const { session, user } = useSession();
  const preview = isPreviewSession(session);
  const { context } = useAppContext();
  const qc = useQueryClient();
  const catchup = useCatchup();
  const { isBlocked: hasBlockingInteraction } = useInteractionBlocker();
  const profileQuery = useProfile();

  // The scope this review is currently visibly open/presented for -- `open`
  // in the returned contract is gated by this matching the CURRENT scope at
  // render time, so stale content can never paint while an effect is still
  // catching up to close it (T10-03: "gate visible `open` by matching scope
  // in render").
  const [openForScope, setOpenForScope] = useState<BriefScope | null>(null);
  const [presentedReceiptScope, setPresentedReceiptScope] = useState<BriefScope | null>(null);
  // T10-03: `currentScope` below is memoized on real dependencies (not
  // recomputed unconditionally every render) so its identity is stable
  // across unrelated renders -- but its `localDate` must still refresh
  // exactly at the local midnight rollover even if NOTHING else changed.
  // The scheduled midnight timer bumps this to force that one recompute.
  const [scopeTick, setScopeTick] = useState(0);
  const [isTabHidden, setIsTabHidden] = useState(
    typeof document === "undefined" ? false : document.visibilityState === "hidden",
  );

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibility = () => {
      setIsTabHidden(document.visibilityState === "hidden");
      // T10-03: "on focus/visibility return, recompute from the current
      // clock; do not replay an expired timer's scope" -- `currentScope`
      // below is memoized on identity/context/timezone (deliberately, so
      // an unrelated render doesn't thrash it), so its `localDate` would
      // otherwise only ever refresh when the scheduled midnight timer
      // fires. A tab that was hidden/backgrounded across a local midnight
      // and only THEN returns to the foreground must recompute immediately
      // on that return, not wait for a real-time timer that may already
      // be stale relative to how long the tab was actually hidden.
      setScopeTick((t) => t + 1);
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
    };
  }, []);

  const identityId = preview ? currentDemoActorId() : user?.id;

  const profileReadiness: ProfileReadiness = preview
    ? { kind: "resolved", timezone: null } // preview has no profile row; browser-zone fallback applies below.
    : profileQuery.isError
      ? { kind: "error" }
      : profileQuery.isPending
        ? { kind: "pending" }
        : { kind: "resolved", timezone: profileQuery.data?.timezone ?? null };

  const timeZone = resolveEffectiveTimezone(profileReadiness.kind === "resolved" ? profileReadiness.timezone : null);

  // Latest-truth refs: every value a pending async continuation (a claim
  // await, or a bounded retry timer firing later) must re-read AFTER its
  // await/delay, never the value captured when it started. Updated on every
  // render, not just via an effect.
  const contextRef = useRef(context);
  contextRef.current = context;
  const timeZoneRef = useRef(timeZone);
  timeZoneRef.current = timeZone;
  const isTabHiddenRef = useRef(isTabHidden);
  isTabHiddenRef.current = isTabHidden;
  const hasBlockingInteractionRef = useRef(hasBlockingInteraction);
  hasBlockingInteractionRef.current = hasBlockingInteraction;
  const catchupCountRef = useRef(catchup.count);
  catchupCountRef.current = catchup.count;
  const catchupErrorRef = useRef(catchup.error);
  catchupErrorRef.current = catchup.error;
  const catchupLoadingRef = useRef(catchup.isLoading);
  catchupLoadingRef.current = catchup.isLoading;
  const profileReadinessRef = useRef(profileReadiness);
  profileReadinessRef.current = profileReadiness;
  const identityIdRef = useRef(identityId);
  identityIdRef.current = identityId;
  const previewRef = useRef(preview);
  previewRef.current = preview;
  const sessionRef = useRef(session);
  sessionRef.current = session;

  // Per-scope attempt ownership. Keyed by scopeKey(scope); an entry's
  // `token` is the sole owner allowed to complete/clear/retry that attempt
  // -- a stale continuation whose entry has since been replaced (superseded
  // by a newer attempt for the same key, which cannot happen since scope
  // keys are date-stamped, but also guards a retried entry moving on) is a
  // no-op, never able to erase a newer attempt's state.
  const attemptsRef = useRef(new Map<string, AttemptEntry>());
  const tokenCounterRef = useRef(0);

  // Clear every pending bounded-retry timer on true unmount -- a real OS
  // timer set via setTimeout is not implicitly cancelled by React unmount,
  // and left uncleared would fire later against a torn-down instance (each
  // guarded no-op via mountedRef, but still an unnecessary dangling timer).
  useEffect(() => {
    const attempts = attemptsRef.current;
    return () => {
      for (const entry of attempts.values()) {
        if (entry.retryTimer) clearTimeout(entry.retryTimer);
      }
    };
  }, []);

  const computeScope = useCallback((now: Date): BriefScope | null => {
    const id = identityIdRef.current;
    if (!id) return null;
    const tz = timeZoneRef.current;
    return {
      epoch: getIdentityEpoch(qc).epoch,
      identityKind: previewRef.current ? "preview" : "live",
      identityId: id,
      context: contextRef.current,
      timezone: tz,
      localDate: localDateKey(now, tz),
    };
  }, [qc]);

  const currentScope = useMemo<BriefScope | null>(() => {
    if (!identityId) return null;
    return {
      epoch: getIdentityEpoch(qc).epoch,
      identityKind: preview ? ("preview" as const) : ("live" as const),
      identityId,
      context,
      timezone: timeZone,
      localDate: localDateKey(new Date(), timeZone),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scopeTick deliberately forces a recompute at the local-midnight boundary with no other dependency change
  }, [identityId, preview, context, timeZone, qc, scopeTick]);
  const currentScopeKey = currentScope ? scopeKey(currentScope) : null;

  // T10-03: close/retire on context, identity, zone, or local-date change --
  // capture dismissal ownership (the scope the open review was FOR) before
  // clearing, so a real receipt is targeted rather than whatever the new
  // scope happens to be.
  const prevScopeKeyRef = useRef<string | null>(currentScopeKey);
  useEffect(() => {
    if (prevScopeKeyRef.current !== currentScopeKey) {
      // T10-03: no retry after scope retirement -- clear any pending bounded
      // retry timer for the OLD scope's attempt and mark it settled so a
      // late-firing (already-cleared, but defensive) callback is also a
      // guaranteed no-op via its own ownership check.
      const oldEntry = prevScopeKeyRef.current ? attemptsRef.current.get(prevScopeKeyRef.current) : undefined;
      if (oldEntry?.retryTimer) {
        clearTimeout(oldEntry.retryTimer);
        oldEntry.retryTimer = null;
      }
      if (oldEntry && oldEntry.status !== "in-flight") oldEntry.status = "settled";

      const retiredFor = openForScope && scopeKey(openForScope) === prevScopeKeyRef.current ? openForScope : null;
      if (retiredFor) {
        setOpenForScope(null);
        if (retiredFor.identityKind === "preview") {
          dismissMorningBriefPreview(retiredFor.identityId, retiredFor.context, retiredFor.localDate);
        }
        // Live dismissal on a silent scope retirement is deliberately NOT
        // sent here -- the receipt itself remains valid (a claim is not
        // "undone" by the viewer's scope changing), only the VISIBLE open
        // state retires. An explicit dismiss() call is what records a real
        // dismissal (see below).
      }
      prevScopeKeyRef.current = currentScopeKey;
    }
  }, [currentScopeKey, openForScope]);

  // Visible `open`: gated by the presented scope matching the CURRENT scope
  // at render time (T10-03: stale content cannot paint while an effect
  // waits to close it).
  const open = Boolean(openForScope && currentScopeKey && scopeKey(openForScope) === currentScopeKey);
  const alreadyPresentedToday = Boolean(
    currentScope && scopePresentationMatches(presentedReceiptScope, currentScope),
  );

  const recordPresented = useCallback((scope: BriefScope) => {
    setPresentedReceiptScope(scope);
  }, []);

  const attemptClaim = useCallback(
    async (scope: BriefScope, entry: AttemptEntry) => {
      const key = scopeKey(scope);
      const myToken = entry.token;
      const isOwner = () => attemptsRef.current.get(key) === entry && entry.token === myToken;

      entry.status = "in-flight";
      try {
        const result: MorningBriefClaimResult =
          scope.identityKind === "preview"
            ? await claimMorningBriefPreview(scope.identityId, scope.context, scope.localDate, scope.timezone)
            : await claimMorningBriefLive(scope.context, scope.timezone);

        // T10-03: fresh snapshot after the async boundary -- every
        // downstream check below re-reads current truth, not what was true
        // when this attempt started.
        if (!mountedRef.current || !isOwner()) return;
        if (!isEpochCurrent(qc, scope.epoch)) {
          entry.status = "settled";
          return;
        }
        const freshNow = new Date();
        const nowScope = computeScope(freshNow);
        entry.status = "settled";
        if (!nowScope || scopeKey(nowScope) !== key) {
          // Scope retired mid-flight (context/identity/zone/date changed).
          // The claim itself is still recorded against the scope it was
          // actually made for; only the automatic OPEN is skipped.
          if (result.claimed || result.localDate === scope.localDate) recordPresented(scope);
          return;
        }
        recordPresented(scope);
        logTelemetryEvent({ category: "brief_claim", outcome: result.claimed ? "success" : "failure", scope: "morning-brief" });
        const stillEligible =
          !hasBlockingInteractionRef.current &&
          !isTabHiddenRef.current &&
          catchupErrorRef.current == null &&
          !catchupLoadingRef.current &&
          catchupCountRef.current > 0 &&
          profileReadinessRef.current.kind === "resolved" &&
          isPastMorningThreshold(freshNow, scope.timezone) &&
          result.localDate === scope.localDate;
        if (result.claimed && stillEligible) {
          setOpenForScope(scope);
          logTelemetryEvent({ category: "brief_presentation", outcome: "success", scope: "morning-brief" });
        }
      } catch (err) {
        if (!mountedRef.current || !isOwner()) return;
        if (err instanceof MorningBriefClaimRejected && err.reason === "before-threshold") {
          // R-04/T10-03: the server is authoritative for the 07:00 gate.
          // A premature rejection must not consume the day's attempt
          // permanently -- schedule a bounded retry (recomputing scope
          // fresh when it fires), and give up silently (no retry storm)
          // once the retry budget for THIS scope is exhausted; the
          // already-scheduled next-threshold timer remains a further
          // backstop.
          entry.status = "idle";
          if (entry.retryCount < PREMATURE_RETRY_DELAYS_MS.length) {
            const delay = PREMATURE_RETRY_DELAYS_MS[entry.retryCount];
            entry.retryCount += 1;
            entry.retryTimer = setTimeout(() => {
              if (!mountedRef.current || !isOwner()) return;
              const retryNow = new Date();
              const retryScope = computeScope(retryNow);
              // A newer scope (context/identity/zone/date changed) is left
              // completely untouched -- this timer only ever re-attempts
              // the ORIGINAL scope it was scheduled for.
              if (!retryScope || scopeKey(retryScope) !== key) return;
              void attemptClaim(retryScope, entry);
            }, delay);
          }
          return;
        }
        // Ordinary service error (network failure, RPC not deployed, an
        // unauthorized rejection): logged, left `idle` so a legitimate
        // later trigger (context/moments change, the next-threshold timer,
        // or a manual retry surface) can re-attempt -- but nothing here
        // schedules its own automatic retry, so this can never retry-storm.
        entry.status = "idle";
        logTelemetryEvent({ category: "brief_claim", outcome: "failure", scope: "morning-brief" });
        console.error("Morning Brief claim failed", err);
      }
    },
    [computeScope, qc, recordPresented],
  );

  const maybeAttempt = useCallback(() => {
    if (!morningBriefAutoOpenEnabled()) return;
    const now = new Date();
    const scope = computeScope(now);
    if (!scope) return;
    const key = scopeKey(scope);

    let entry = attemptsRef.current.get(key);
    if (!entry) {
      entry = { token: ++tokenCounterRef.current, status: "idle", retryCount: 0, retryTimer: null };
      attemptsRef.current.set(key, entry);
    }
    if (entry.status !== "idle") return; // already in-flight, or already settled for this scope

    const decision = isEligibleToAutoOpen({
      now,
      timeZone: scope.timezone,
      hasActionableMoments: catchup.count > 0,
      hasMomentsError: catchup.error != null,
      isTabHidden,
      authPending: !preview && !session,
      profileLoading: profileReadiness.kind === "pending",
      momentsLoading: catchup.isLoading,
      hasBlockingInteraction,
    });
    if (!decision.eligible) return; // entry stays idle -- reattempted whenever a dependency actually changes

    void attemptClaim(scope, entry);
  }, [
    computeScope,
    attemptClaim,
    catchup.count,
    catchup.error,
    catchup.isLoading,
    isTabHidden,
    preview,
    session,
    profileReadiness.kind,
    hasBlockingInteraction,
  ]);

  // Re-evaluate whenever any input that could flip eligibility changes.
  useEffect(() => {
    maybeAttempt();
  }, [maybeAttempt]);

  // Schedule a re-check at the next local 07:00 threshold AND at the next
  // local midnight rollover (which retires the current scope's identity
  // even if 07:00 was already reached) -- so a tab left open overnight
  // still gets a chance without a reload, and yesterday's scope closes
  // exactly at the local date boundary rather than waiting for a render.
  // Re-armed whenever identity/context/timezone change, and recomputed
  // (not replayed from an expired timer's captured scope) on focus/
  // visibility return.
  useEffect(() => {
    if (!identityId) return;
    const epoch = getIdentityEpoch(qc).epoch;
    let thresholdTimer: ReturnType<typeof setTimeout> | null = null;
    let midnightTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleThreshold = () => {
      const delayMs = Math.max(1000, nextMorningThreshold(new Date(), timeZone).getTime() - Date.now());
      thresholdTimer = setTimeout(() => {
        if (!isEpochCurrent(qc, epoch)) return;
        maybeAttempt();
        scheduleThreshold();
      }, delayMs);
    };
    const scheduleMidnight = () => {
      const delayMs = Math.max(1000, nextLocalMidnight(new Date(), timeZone).getTime() - Date.now());
      midnightTimer = setTimeout(() => {
        if (!isEpochCurrent(qc, epoch)) return;
        // Recompute fresh -- do not act on the scope this timer was
        // originally armed for; the retirement effect above (driven by
        // currentScopeKey changing on re-render) does the actual closing.
        // This timer's only job is to force a render/recheck at the exact
        // rollover instant, and to give today's fresh scope a chance to
        // auto-open immediately if it's already past 07:00 elsewhere.
        setScopeTick((t) => t + 1);
        maybeAttempt();
        scheduleMidnight();
      }, delayMs);
    };
    scheduleThreshold();
    scheduleMidnight();
    return () => {
      if (thresholdTimer) clearTimeout(thresholdTimer);
      if (midnightTimer) clearTimeout(midnightTimer);
    };
  }, [identityId, context, timeZone, qc, maybeAttempt]);

  const dismiss = useCallback(() => {
    const scope = openForScope ?? currentScope;
    setOpenForScope(null);
    if (!scope) return;
    if (scope.identityKind === "preview") {
      dismissMorningBriefPreview(scope.identityId, scope.context, scope.localDate);
      logTelemetryEvent({ category: "brief_dismiss", outcome: "success", scope: "morning-brief" });
    } else {
      void dismissMorningBriefLive(scope.context, scope.timezone, scope.localDate).then(
        () => logTelemetryEvent({ category: "brief_dismiss", outcome: "success", scope: "morning-brief" }),
        (err) => {
          // Best-effort: a failed dismissal must not resurrect "not yet
          // shown today" (it never un-claims), and must not repeat an
          // already-successful Thing action -- there is none here, this
          // only ever records a timestamp.
          logTelemetryEvent({ category: "brief_dismiss", outcome: "failure", scope: "morning-brief" });
          console.error("Morning Brief dismiss failed", err);
        },
      );
    }
  }, [openForScope, currentScope]);

  const reopen = useCallback(() => {
    // Deliberately does not touch the receipt at all -- see the type's own
    // doc comment on `reopen`. Only opens for a real, current scope.
    if (currentScope) {
      setOpenForScope(currentScope);
      logTelemetryEvent({ category: "brief_presentation", outcome: "success", scope: "morning-brief-manual" });
    }
  }, [currentScope]);

  return { open, dismiss, reopen, alreadyPresentedToday };
}
