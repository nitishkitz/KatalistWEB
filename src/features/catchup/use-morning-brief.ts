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
  const profileTimezone = preview ? null : profileQuery.data?.timezone ?? null;
  const timeZone = resolveEffectiveTimezone(profileTimezone);

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
      isTabHidden,
      authPending: !preview && !session,
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
      if (result.claimed) {
        setOpen(true);
      }
      setAlreadyPresentedToday(true);
    } catch (err) {
      // Service unavailable (most likely: the migration isn't deployed
      // yet) -- skip automatic opening for this attempt, keep manual
      // access, and do not retry (attemptedKeyRef already marks this
      // identity/context/day as attempted, so a later re-render/timer
      // fire this same day won't try again and loop).
      console.error("Morning Brief claim failed", err);
    }
  }, [identityId, context, timeZone, catchup.count, catchup.isLoading, isTabHidden, hasBlockingInteraction, preview, session, qc]);

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
