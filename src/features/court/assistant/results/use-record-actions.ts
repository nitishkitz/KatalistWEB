import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { CoeyRecord, RecordActionKind } from "@/domain/coey/presentation";
import { claimThingMutation, releaseThingMutation } from "@/features/things/query-updates";
import { getIdentityEpoch, isEpochCurrent } from "@/features/realtime/identity-cache-policy";
import { domainErrorMessage } from "@/lib/domain-error";

export type RowState = { pending?: RecordActionKind; error?: string; done?: string };

const DONE: Record<Exclude<RecordActionKind, "open">, string> = {
  catch: "Caught. It’s in progress now.",
  mark_sorted: "Nicely sorted.",
  nudge: "Nudge sent.",
  bring_back: "Back in your Court. Catch is still a separate step.",
};

/** The record after the server accepted an action, so the row shows the real next step. */
export function applyOutcome(record: CoeyRecord, kind: RecordActionKind): CoeyRecord {
  const open = { kind: "open" as const, status: "available" as const };
  switch (kind) {
    case "catch":
      return { ...record, lifecycle: "in_progress", actions: [{ kind: "mark_sorted", status: "available" }, open] };
    case "mark_sorted":
      return { ...record, lifecycle: "sorted", actions: [open] };
    case "nudge":
      return { ...record, actions: [{ kind: "nudge", status: "unavailable", reason: "Nudged just now. Another nudge opens after the cooldown." }, open] };
    case "bring_back":
      return {
        ...record,
        snoozed_until: null,
        actions: [{ kind: record.lifecycle === "waiting_for_catch" ? "catch" : "mark_sorted", status: "available" }, open],
      };
    default:
      return record;
  }
}

/**
 * Direct row actions in Coey's results. Nothing changes on screen until the
 * server accepts; the cross-surface claim stops the Court and the panel from
 * acting on the same Thing at once.
 */
export function useRecordActions() {
  const qc = useQueryClient();
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [records, setRecords] = useState<Record<string, CoeyRecord>>({});

  const run = useCallback(async (record: CoeyRecord, kind: Exclude<RecordActionKind, "open">) => {
    const epoch = getIdentityEpoch(qc).epoch;
    const claim = claimThingMutation(qc, record.id, epoch);
    if (!claim) {
      setRows((r) => ({ ...r, [record.id]: { error: "This Thing is already being updated." } }));
      return;
    }
    setRows((r) => ({ ...r, [record.id]: { pending: kind } }));
    try {
      // Loaded on first use so the results view stays light for the Ask panel.
      const { rpcCatchAndStart, rpcNudgeThing, rpcSortThing, rpcUnsnoozeThing } = await import("@/features/things/rpc");
      if (kind === "catch") await rpcCatchAndStart(record.id);
      else if (kind === "mark_sorted") await rpcSortThing(record.id);
      else if (kind === "nudge") await rpcNudgeThing(record.id, record.lifecycle === "waiting_for_catch" ? "waiting_for_catch" : "quiet");
      else await rpcUnsnoozeThing(record.id);
      if (!isEpochCurrent(qc, epoch)) return;
      setRecords((r) => ({ ...r, [record.id]: applyOutcome(r[record.id] ?? record, kind) }));
      setRows((r) => ({ ...r, [record.id]: { done: DONE[kind] } }));
      for (const key of ["court", "nudges", "nudge-history", "snoozed", "thing", "thing-activity", "catchup"]) void qc.invalidateQueries({ queryKey: [key] });
    } catch (error) {
      if (isEpochCurrent(qc, epoch)) setRows((r) => ({ ...r, [record.id]: { error: domainErrorMessage(error) } }));
    } finally {
      releaseThingMutation(qc, claim);
    }
  }, [qc]);

  return { rows, current: (record: CoeyRecord) => records[record.id] ?? record, run };
}
