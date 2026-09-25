import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { getThingCapabilities } from "@/domain/capabilities";
import type { Pace, Thing } from "@/domain/thing";
import { domainErrorMessage } from "@/lib/domain-error";
import { cn } from "@/lib/utils";
import type { NudgeReason } from "@/features/things/rpc";
import { runThingAction, type ThingActionRequest } from "@/features/things/run-thing-action";
import type { SnoozeOption } from "@/features/things/personal-snooze";
import { useDoorman } from "@/features/doorman/use-doorman";
import { getIdentityEpoch, isEpochCurrent } from "@/features/realtime/identity-cache-policy";
import { CatchUpStackCard } from "./CatchUpStackCard";
import { catchUpActionsFor, type CatchUpActionId } from "./catchup-logic";
import type { CatchUpMoment } from "./use-catchup";

type Props = {
  moments: CatchUpMoment[];
  myActorId: string | null;
  surfaceMoment: (momentKey: string) => Promise<void>;
  onOpenThing: (thing: Thing) => void;
  onClose: () => void;
  onRefresh: () => void;
};

/**
 * T10-05: one entry per moment key EVER seen this review session, in a
 * stable append-only order -- not a frozen snapshot of the moments array
 * (the old `useState(() => moments)` froze stale status/permission data
 * for the whole review) and not simply "whatever `moments` currently
 * contains" (a moment that disappears the instant its own action succeeds
 * would otherwise vanish before its receipt-pending state could ever be
 * shown or retried).
 */
type QueueStatus =
  /** Still present in the latest `moments` result; actions reflect its
   *  CURRENT capabilities every render. */
  | "active"
  /** THIS review successfully performed a domain action on it -- kept
   *  visible (using its last known data) even after it drops out of the
   *  latest `moments` result, so its acknowledgement-retry state (if any)
   *  is never lost. Counts toward the action-completed total. */
  | "resolved"
  /** It disappeared from the latest `moments` result WITHOUT this review
   *  having acted on it (someone else acted on it, it was cancelled, a
   *  permission changed, etc.) -- a confirmed fact, not a transient
   *  refresh failure, so its actions are cleared; only its last known
   *  title is kept for orientation. */
  | "unavailable";

type AckState = "none" | "pending" | "error";

type QueueEntry = {
  key: string;
  status: QueueStatus;
  /** Present only while `status === "active"` -- the actual live moment,
   *  always read fresh from the latest `moments` prop so capability/status
   *  changes are reflected immediately (T10-05: "current permission/status
   *  changes immediately recompute available commands"). */
  live: CatchUpMoment | null;
  /** The last data this moment ever had, for display once it's no longer
   *  `active` -- never used to decide which actions are available. */
  lastKnown: CatchUpMoment;
  ack: AckState;
};

function buildRequest(id: CatchUpActionId, thingId: string, arg: string | undefined, reason: string): ThingActionRequest | null {
  switch (id) {
    case "catch":
      return { kind: "catch", thingId };
    case "set_pace":
      return { kind: "set_pace", thingId, pace: (arg ?? "next") as Pace };
    case "move_now":
      return { kind: "move_now", thingId };
    case "snooze":
      return { kind: "snooze", thingId, option: (arg ?? "1h") as SnoozeOption };
    case "nudge":
      return { kind: "nudge", thingId, reason: reason as NudgeReason };
    case "dismiss_ghost":
      return { kind: "dismiss_ghost", thingId };
    case "open":
      return null; // handled directly in runAction -- never a domain mutation
  }
}

function actionSuccessLabel(id: CatchUpActionId, arg?: string): string {
  switch (id) {
    case "catch":
      return "Caught — it’s in your Court.";
    case "set_pace":
      return `Pace set to ${arg ?? "next"}.`;
    case "move_now":
      return "Moved to Now.";
    case "snooze":
      return "Snoozed.";
    case "nudge":
      return "Nudge sent.";
    case "dismiss_ghost":
      return "Dismissed.";
    case "open":
      return "";
  }
}

export function CatchUpStack({ moments, myActorId, surfaceMoment, onOpenThing, onClose, onRefresh }: Props) {
  const qc = useQueryClient();
  const doorman = useDoorman();

  // T10-05: append-only key order for this session, plus a keyed map of
  // per-moment state -- replaces the old frozen `useState(() => moments)`
  // deck. `order` only ever grows (new keys appended at the end); it never
  // reorders or drops a key just because the moment briefly left the
  // latest response.
  const [order, setOrder] = useState<string[]>(() => moments.map((m) => m.momentKey));
  const [entries, setEntries] = useState<Map<string, QueueEntry>>(
    () => new Map(moments.map((m) => [m.momentKey, { key: m.momentKey, status: "active", live: m, lastKnown: m, ack: "none" }])),
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(() => order[0] ?? null);
  const [viewedKeys, setViewedKeys] = useState<Set<string>>(() => new Set(order[0] ? [order[0]] : []));
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // Reconcile on every `moments` change (initial load, background refetch,
  // post-action invalidation): merge in new/changed live data, append any
  // genuinely new keys at the end (never reordering existing ones), and
  // mark a dropped key "unavailable" UNLESS this review itself already
  // marked it "resolved" (a successful action removing its own moment from
  // the next fetch is expected, not a loss).
  useEffect(() => {
    const incoming = new Map(moments.map((m) => [m.momentKey, m]));
    setOrder((prevOrder) => {
      const next = prevOrder.slice();
      for (const m of moments) {
        if (!next.includes(m.momentKey)) next.push(m.momentKey);
      }
      return next;
    });
    setEntries((prev) => {
      const next = new Map(prev);
      for (const [key, moment] of incoming) {
        const existing = next.get(key);
        if (existing) {
          next.set(key, { ...existing, status: "active", live: moment, lastKnown: moment });
        } else {
          next.set(key, { key, status: "active", live: moment, lastKnown: moment, ack: "none" });
        }
      }
      for (const [key, entry] of next) {
        if (incoming.has(key) || entry.status !== "active") continue;
        // Was active, now missing, and THIS review didn't resolve it --
        // a confirmed external change, not an ambiguous refresh failure.
        next.set(key, { ...entry, status: "unavailable", live: null });
      }
      return next;
    });
  }, [moments]);

  // Refresh Court on close (any path — finish, X, Esc, overlay click) so
  // actions taken are reflected. Viewing/paging/closing never dismiss a
  // moment on their own -- only a successful action's own surfaceMoment
  // call does that.
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  useEffect(() => {
    return () => refreshRef.current();
  }, []);

  const currentIndex = selectedKey ? order.indexOf(selectedKey) : -1;
  const currentEntry = currentIndex >= 0 ? entries.get(order[currentIndex]) : undefined;
  const isFirst = currentIndex <= 0;
  const isLast = currentIndex >= order.length - 1;

  const selectKey = useCallback((key: string) => {
    setSelectedKey(key);
    setViewedKeys((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }, []);

  // T10-05: Previous/Next are plain callbacks driven by the current
  // (key-derived) index, not a `setIndex` updater with a parent `onClose()`
  // call nested inside it -- Finish is the explicit, only path that closes
  // on Next from the last item.
  const goPrev = useCallback(() => {
    if (currentIndex <= 0) return;
    selectKey(order[currentIndex - 1]);
  }, [currentIndex, order, selectKey]);

  const goNext = useCallback(() => {
    if (currentIndex < 0) return;
    if (currentIndex >= order.length - 1) {
      onClose();
      return;
    }
    selectKey(order[currentIndex + 1]);
  }, [currentIndex, order, onClose, selectKey]);

  const setAck = useCallback((key: string, ack: AckState) => {
    setEntries((prev) => {
      const existing = prev.get(key);
      if (!existing) return prev;
      const next = new Map(prev);
      next.set(key, { ...existing, ack });
      return next;
    });
  }, []);

  const markResolved = useCallback((key: string) => {
    setEntries((prev) => {
      const existing = prev.get(key);
      if (!existing) return prev;
      const next = new Map(prev);
      next.set(key, { ...existing, status: "resolved" });
      return next;
    });
  }, []);

  const runAcknowledgement = useCallback(
    async (key: string, momentKey: string) => {
      const epoch = getIdentityEpoch(qc).epoch;
      setAck(key, "pending");
      try {
        // T10-04: retrying acknowledgement calls ONLY surfaceMoment -- the
        // domain action already succeeded and is never re-dispatched here.
        await surfaceMoment(momentKey);
        if (!isEpochCurrent(qc, epoch)) return;
        setAck(key, "none");
        onRefresh();
      } catch {
        if (!isEpochCurrent(qc, epoch)) return;
        setAck(key, "error");
      }
    },
    [qc, surfaceMoment, setAck, onRefresh],
  );

  const runAction = useCallback(
    async (id: CatchUpActionId, arg?: string) => {
      if (!currentEntry || currentEntry.status !== "active" || !currentEntry.live || busyKey) return;
      const moment = currentEntry.live;
      const thing = moment.thing;

      if (id === "open") {
        onOpenThing(thing);
        onClose();
        return;
      }

      const request = buildRequest(id, thing.id, arg, moment.reason);
      if (!request) return;

      // T10-04: captured before dispatch -- every check after an await
      // below re-verifies against this, never trusting stale closure state.
      const epoch = getIdentityEpoch(qc).epoch;
      const key = currentEntry.key;
      const momentKey = moment.momentKey;

      setBusyKey(key);
      const outcome = await runThingAction(qc, request, {
        dismissGhost: (thingId) => doorman.dismiss.mutateAsync(thingId),
      });

      if (!isEpochCurrent(qc, epoch)) {
        // Identity retired mid-flight -- no toast, no advance, no receipt;
        // whatever happened server-side belongs to an identity that is no
        // longer current here.
        setBusyKey(null);
        return;
      }

      if (outcome.status === "failed") {
        toast.error(domainErrorMessage(outcome.error));
        setBusyKey(null);
        return;
      }
      if (outcome.status === "already-in-flight" || outcome.status === "retired") {
        // Another surface already owns this Thing's mutation, or the
        // action itself detected a retired identity internally -- no
        // advance, no receipt; the user can simply try again.
        setBusyKey(null);
        return;
      }

      // outcome.status === "performed"
      toast.success(actionSuccessLabel(id, arg));
      markResolved(key);
      setBusyKey(null);

      try {
        await surfaceMoment(momentKey);
        if (!isEpochCurrent(qc, epoch)) return;
        setAck(key, "none");
        onRefresh();
        goNext();
      } catch {
        if (!isEpochCurrent(qc, epoch)) return;
        // T10-04: "Action saved. Review acknowledgement could not be
        // saved." -- surfaced via the card's own ack-error affordance
        // (Retry acknowledgement), never by re-running the domain action.
        setAck(key, "error");
        toast.message("Action saved. Review acknowledgement could not be saved.", {
          description: "Retry acknowledgement from this card.",
        });
      }
    },
    [busyKey, currentEntry, doorman.dismiss, goNext, markResolved, onClose, onOpenThing, onRefresh, qc, setAck, surfaceMoment],
  );

  const resolvedCount = useMemo(() => {
    let n = 0;
    for (const entry of entries.values()) if (entry.status === "resolved") n += 1;
    return n;
  }, [entries]);

  if (!currentEntry) return null;

  const displayMoment = currentEntry.live ?? currentEntry.lastKnown;
  const isActive = currentEntry.status === "active" && currentEntry.live != null;
  const caps = isActive
    ? getThingCapabilities(displayMoment.thing, myActorId)
    : { canCatch: false, canSetPace: false, canNudge: false };
  const actions = isActive
    ? catchUpActionsFor(displayMoment.kind, { canCatch: caps.canCatch, canSetPace: caps.canSetPace, canNudge: caps.canNudge })
    : (["open"] as CatchUpActionId[]);
  const busy = busyKey === currentEntry.key;

  return (
    <div className="flex flex-col gap-5">
      <div className="relative">
        {order.length > 1 ? (
          <div className="pointer-events-none absolute -top-2 left-3 right-3 h-full rounded-[16px] border border-slate-200/70 bg-white/80" />
        ) : null}
        {order.length > 2 ? (
          <div className="pointer-events-none absolute -top-4 left-6 right-6 h-full rounded-[16px] border border-slate-200/50 bg-white/60" />
        ) : null}
        {!isActive ? (
          <div className="relative z-10 flex flex-col gap-3 rounded-[16px] border border-slate-200 bg-white p-5 text-center shadow-[0_12px_40px_-12px_rgba(15,23,42,0.18)]">
            <h3 className="text-[16px] font-semibold text-slate-800">{displayMoment.thing.title}</h3>
            {currentEntry.status === "resolved" ? (
              <>
                <p className="text-[13px] text-slate-500">Action saved for this moment.</p>
                {currentEntry.ack === "error" || currentEntry.ack === "pending" ? (
                  <button
                    type="button"
                    onClick={() => void runAcknowledgement(currentEntry.key, displayMoment.momentKey)}
                    disabled={currentEntry.ack === "pending"}
                    className="inline-flex h-9 items-center justify-center gap-2 self-center rounded-[10px] border border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-700 outline-none transition hover:border-slate-300 disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", currentEntry.ack === "pending" && "animate-spin")} />
                    {currentEntry.ack === "pending" ? "Retrying…" : "Retry acknowledgement"}
                  </button>
                ) : (
                  <p className="text-[12px] text-slate-400">Review acknowledgement saved.</p>
                )}
              </>
            ) : (
              <p className="text-[13px] text-slate-500">This moment is no longer available.</p>
            )}
          </div>
        ) : (
          <CatchUpStackCard moment={displayMoment} actions={actions} busy={busy} onAction={runAction} />
        )}
      </div>

      <div className="flex items-center justify-between gap-4">
        <span className="text-[12px] text-slate-500" data-testid="catchup-viewed-summary">
          Viewed {viewedKeys.size} of {order.length}
          {resolvedCount > 0 ? ` · ${resolvedCount} action${resolvedCount === 1 ? "" : "s"} completed` : ""}
        </span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={goPrev}
            disabled={isFirst || busy}
            aria-label="Previous"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 outline-none transition hover:border-slate-300 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span
            className="min-w-[64px] text-center text-[13px] font-medium text-slate-500"
            data-testid="catchup-pager-position"
          >
            {currentIndex + 1} of {order.length}
          </span>
          <button
            type="button"
            onClick={goNext}
            disabled={busy}
            aria-label={isLast ? "Finish" : "Next"}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 outline-none transition hover:border-slate-300 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
