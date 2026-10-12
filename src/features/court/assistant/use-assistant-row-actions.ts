import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Thing } from "@/domain/thing";
import { theirStateFor } from "@/domain/thing";
import {
  rpcCatchAndStart,
  rpcNudgeThing,
  rpcSnoozeThing,
  rpcSortThing,
  type NudgeReason,
} from "@/features/things/rpc";
import { snoozeUntilFor, type SnoozeOption } from "@/features/things/personal-snooze";
import { claimThingMutation, releaseThingMutation } from "@/features/things/query-updates";
import { getIdentityEpoch, isEpochCurrent } from "@/features/realtime/identity-cache-policy";
import { domainErrorMessage } from "@/lib/domain-error";

export type RowActionKind = "catch" | "sort" | "nudge" | "snooze";

const PENDING_LABEL: Record<RowActionKind, string> = {
  catch: "Catching…",
  sort: "Sorting…",
  nudge: "Nudging…",
  snooze: "Snoozing…",
};

const SNOOZE_TOAST: Record<SnoozeOption, string> = {
  "1h": "Snoozed for 1 hour.",
  "6h": "Snoozed for 6 hours.",
  next_day: "Snoozed until tomorrow, 9 AM.",
};

function nudgeReasonFor(thing: Thing): NudgeReason {
  const state = theirStateFor(thing);
  return state === "waiting_for_catch"
    ? "waiting_for_catch"
    : state === "moving"
      ? "quiet"
      : "stale";
}

export function pendingLabel(kind: RowActionKind) {
  return PENDING_LABEL[kind];
}

/**
 * Server-first row actions for the Ask panel. Nothing is patched ahead of the
 * server: a row keeps its current state, shows a pending label, and changes
 * only after the RPC succeeds AND the refreshed Court, nudge and assistant
 * data have arrived. The cross-surface claim stops the Court and the panel
 * from acting on the same Thing at once.
 */
export function useAssistantRowActions() {
  const qc = useQueryClient();
  const [pending, setPending] = useState<Record<string, RowActionKind>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const clear = (map: Record<string, unknown>, id: string) => {
    const next = { ...map };
    delete next[id];
    return next;
  };

  const run = useCallback(
    async (thing: Thing, kind: RowActionKind, snooze?: SnoozeOption) => {
      const epoch = getIdentityEpoch(qc).epoch;
      const claim = claimThingMutation(qc, thing.id, epoch);
      if (!claim) {
        setErrors((current) => ({
          ...current,
          [thing.id]: "This Thing is already being updated.",
        }));
        return;
      }
      setPending((current) => ({ ...current, [thing.id]: kind }));
      setErrors((current) => clear(current, thing.id) as Record<string, string>);
      try {
        if (kind === "catch") await rpcCatchAndStart(thing.id);
        else if (kind === "sort") await rpcSortThing(thing.id);
        else if (kind === "nudge") await rpcNudgeThing(thing.id, nudgeReasonFor(thing));
        else await rpcSnoozeThing(thing.id, snoozeUntilFor(snooze ?? "1h"));
        if (!isEpochCurrent(qc, epoch)) return;
        // Wait for the server's view before the row changes; no guessing.
        await Promise.all(
          ["court", "nudges", "nudge-history", "snoozed", "assistant"].map((key) =>
            qc.refetchQueries({ queryKey: [key], type: "active" }),
          ),
        );
        for (const key of [
          "thing",
          "thing-activity",
          "notifications",
          "catchup",
          "accessible-things",
        ])
          void qc.invalidateQueries({ queryKey: [key] });
        if (!isEpochCurrent(qc, epoch)) return;
        toast.success(
          kind === "catch"
            ? "Caught."
            : kind === "sort"
              ? "Nicely sorted."
              : kind === "nudge"
                ? `Nudged ${thing.assignee.name.split(" ")[0]}.`
                : SNOOZE_TOAST[snooze ?? "1h"],
        );
      } catch (error) {
        if (isEpochCurrent(qc, epoch))
          setErrors((current) => ({ ...current, [thing.id]: domainErrorMessage(error) }));
      } finally {
        releaseThingMutation(qc, claim);
        if (isEpochCurrent(qc, epoch))
          setPending((current) => clear(current, thing.id) as Record<string, RowActionKind>);
      }
    },
    [qc],
  );

  return { pending, errors, run };
}
