import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getThingCapabilities } from "@/domain/capabilities";
import type { Thing } from "@/domain/thing";
import { localParts, zonedInstant } from "@/domain/coey/calendar";
import { runThingAction } from "@/features/things/run-thing-action";
import { domainErrorMessage } from "@/lib/domain-error";
import { coeyLaneMove, promiseLane } from "../court-lane-drop";
import type { CourtLaneId } from "../court-view-model";

type LooseRpc = (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
const rpc = (fn: string, args: Record<string, unknown>) => (supabase.rpc as unknown as LooseRpc)(fn, args);

const LANE_LABEL: Record<string, string> = { now: "Now", next: "Next", later: "Later", none: "out of the lanes", hidden: "snoozed" };
const DATE_REASON: Record<string, string> = {
  L3: "its date is within a working day", L4: "its date is a few working days away", L5: "its date is more than five working days away",
  M3: "it follows the promised date", L10: "its date and pace disagree",
};

const toLocalInput = (at: number, tz: string) => {
  const p = localParts(at, tz);
  return `${p.date}T${String(Math.floor(p.minutes / 60)).padStart(2, "0")}:${String(p.minutes % 60).padStart(2, "0")}`;
};
const fromLocalInput = (value: string, tz: string) => {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(value);
  return m ? zonedInstant(m[1]!, Number(m[2]) * 60 + Number(m[3]), tz) : null;
};

type Pending = { thing: Thing; lane: CourtLaneId; when: string };

/**
 * Moves a Coey-scheduled Thing between lanes the way spec §8.4 allows.
 * `move` returns false when the Thing has no Coey schedule, so the caller
 * keeps its legacy path. `dialog` must be rendered by the caller.
 */
export function useCoeyLaneMove({ myActorId, onMoved }: { myActorId: string | null; onMoved: () => unknown }) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    await Promise.all([qc.invalidateQueries({ queryKey: ["court"] }), Promise.resolve(onMoved())]).catch(() => {});
  };
  const catchIfWaiting = async (thing: Thing) => {
    if (!getThingCapabilities(thing, myActorId).canCatch) return true;
    const outcome = await runThingAction(qc, { kind: "catch", thingId: thing.id }, { dismissGhost: async () => {} });
    if (outcome.status === "failed") { toast.error(domainErrorMessage(outcome.error)); return false; }
    return true;
  };

  const move = async (thing: Thing, lane: CourtLaneId): Promise<boolean> => {
    const plan = coeyLaneMove(thing, lane);
    if (!plan) return false;
    if (plan.kind === "date_wins") {
      toast.info(`“${thing.title}” stays in ${LANE_LABEL[plan.lane]} because ${DATE_REASON[plan.rule] ?? "of its date"}. Change its date to move it.`);
      return true;
    }
    if (plan.kind === "promise") {
      setPending({ thing, lane, when: toLocalInput(plan.suggestedAt, thing.coey!.holderCal.timezone) });
      return true;
    }
    if (!(await catchIfWaiting(thing))) return true;
    const { error } = await rpc("coey_set_pace", { p_thing_id: thing.id, p_pace: plan.pace });
    if (error) { toast.error(error.message); return true; }
    toast.success(`Moved “${thing.title}” to ${LANE_LABEL[plan.lane]}`);
    await refresh();
    return true;
  };

  const tz = pending?.thing.coey?.holderCal.timezone ?? "Asia/Kolkata";
  const at = pending ? fromLocalInput(pending.when, tz) : null;
  const lands = pending && at !== null ? promiseLane(pending.thing, at) : null;
  const sender = pending?.thing.owner.name.split(" ")[0] || "The sender";

  const confirm = async () => {
    if (!pending || at === null) return;
    setBusy(true);
    try {
      if (!(await catchIfWaiting(pending.thing))) return;
      const { error } = await rpc("coey_promise", { p_thing_id: pending.thing.id, p_promise_at: new Date(at).toISOString() });
      if (error) { toast.error(error.message); return; }
      toast.success(`Promised. “${pending.thing.title}” is in ${LANE_LABEL[lands ?? "next"]} now, and ${sender} can see your date.`);
      setPending(null);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const dialog: ReactNode = (
    <Dialog open={pending !== null} onOpenChange={(open) => { if (!open && !busy) setPending(null); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Move “{pending?.thing.title}” to {pending ? LANE_LABEL[pending.lane] : ""}?</DialogTitle>
          <DialogDescription>
            {sender} set the pace for this one, so Coey does not change it for you. Say when you will have it done and Coey places it by your date.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-[13px]">
          <label className="block font-medium text-slate-700" htmlFor="coey-lane-promise">I will have it done by</label>
          <input
            id="coey-lane-promise"
            type="datetime-local"
            value={pending?.when ?? ""}
            onChange={(e) => setPending((p) => (p ? { ...p, when: e.target.value } : p))}
            className="w-full rounded-md border border-border px-2 py-1.5"
          />
          <p className="text-slate-600" aria-live="polite">
            {at === null ? "Pick a date and time." : at < Date.now() ? "Pick a time that has not passed." : `This date puts it in ${LANE_LABEL[lands ?? "next"]}.`}
          </p>
        </div>
        <DialogFooter>
          <button type="button" disabled={busy} onClick={() => setPending(null)} className="rounded-md border border-border px-3 py-1.5 text-[13px] font-medium">Cancel</button>
          <button type="button" disabled={busy || at === null || at < Date.now()} onClick={() => void confirm()} className="rounded-md bg-violet-600 px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50">Promise this date</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { move, dialog };
}
