import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { getThingCapabilities } from "@/domain/capabilities";
import type { Pace, Thing } from "@/domain/thing";
import { domainErrorMessage } from "@/lib/domain-error";
import {
  rpcCatchAndStart,
  rpcNudgeThing,
  rpcSetPersonalPace,
  rpcSnoozeThing,
  type NudgeReason,
} from "@/features/things/rpc";
import { snoozeUntilFor, type SnoozeOption } from "@/features/things/personal-snooze";
import { useDoorman } from "@/features/doorman/use-doorman";
import { CatchUpStackCard } from "./CatchUpStackCard";
import { catchUpActionsFor, type CatchUpActionId } from "./catchup-logic";
import type { CatchUpMoment } from "./use-catchup";

type Props = {
  moments: CatchUpMoment[];
  myActorId: string | null;
  surfaceMoment: (momentKey: string) => void;
  onOpenThing: (thing: Thing) => void;
  onClose: () => void;
  onRefresh: () => void;
};

export function CatchUpStack({
  moments,
  myActorId,
  surfaceMoment,
  onOpenThing,
  onClose,
  onRefresh,
}: Props) {
  // Freeze the deck for the lifetime of the overlay so surfacing/refetch does not
  // reshuffle the cards mid-review.
  const [deck] = useState(() => moments);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const doorman = useDoorman();

  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;

  const current = deck[index];

  // On unmount (any close path — finish, X, Esc, overlay click), refresh the
  // Court so any actions taken are reflected. Viewing, paging, and closing never
  // dismiss a moment — only an explicit action writes a receipt (see runAction).
  useEffect(() => {
    return () => {
      refreshRef.current();
    };
  }, []);

  const advance = useCallback(() => {
    setIndex((i) => {
      if (i >= deck.length - 1) {
        onClose();
        return i;
      }
      return i + 1;
    });
  }, [deck.length, onClose]);

  const runAction = useCallback(
    async (id: CatchUpActionId, arg?: string) => {
      if (!current || busy) return;
      const thing = current.thing;

      if (id === "open") {
        onOpenThing(thing);
        onClose();
        return;
      }

      setBusy(true);
      try {
        switch (id) {
          case "catch":
            await rpcCatchAndStart(thing.id);
            toast.success("Caught — it’s in your Court.");
            break;
          case "set_pace":
            await rpcSetPersonalPace(thing.id, (arg ?? "next") as Pace);
            toast.success(`Pace set to ${arg ?? "next"}.`);
            break;
          case "move_now":
            await rpcSetPersonalPace(thing.id, "now");
            toast.success("Moved to Now.");
            break;
          case "snooze":
            await rpcSnoozeThing(thing.id, snoozeUntilFor((arg ?? "1h") as SnoozeOption));
            toast.success("Snoozed.");
            break;
          case "nudge":
            await rpcNudgeThing(thing.id, current.reason as NudgeReason);
            toast.success("Nudge sent.");
            break;
          case "dismiss_ghost":
            await doorman.dismiss.mutateAsync(thing.id);
            toast.success("Dismissed.");
            break;
        }
        surfaceMoment(current.momentKey);
        advance();
      } catch (error) {
        toast.error(domainErrorMessage(error));
      } finally {
        setBusy(false);
      }
    },
    [advance, busy, current, doorman.dismiss, onClose, onOpenThing, surfaceMoment],
  );

  const goPrev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);
  // Paging never dismisses — it only navigates the deck.
  const goNext = useCallback(() => advance(), [advance]);

  if (!current) return null;

  const caps = getThingCapabilities(current.thing, myActorId);
  const actions = catchUpActionsFor(current.kind, {
    canCatch: caps.canCatch,
    canSetPace: caps.canSetPace,
    canNudge: caps.canNudge,
  });

  return (
    <div className="flex flex-col gap-5">
      {/* Card stack: two static layers peek behind the active card. */}
      <div className="relative">
        {deck.length > 1 ? (
          <div className="pointer-events-none absolute -top-2 left-3 right-3 h-full rounded-[16px] border border-slate-200/70 bg-white/80" />
        ) : null}
        {deck.length > 2 ? (
          <div className="pointer-events-none absolute -top-4 left-6 right-6 h-full rounded-[16px] border border-slate-200/50 bg-white/60" />
        ) : null}
        <CatchUpStackCard moment={current} actions={actions} busy={busy} onAction={runAction} />
      </div>

      {/* Pager */}
      <div className="flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={goPrev}
          disabled={index === 0 || busy}
          aria-label="Previous"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 outline-none transition hover:border-slate-300 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-[64px] text-center text-[13px] font-medium text-slate-500">
          {index + 1} of {deck.length}
        </span>
        <button
          type="button"
          onClick={goNext}
          disabled={busy}
          aria-label={index >= deck.length - 1 ? "Finish" : "Next"}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 outline-none transition hover:border-slate-300 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
