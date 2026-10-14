import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getThingCapabilities } from "@/domain/capabilities";
import type { Thing, Pace } from "@/domain/thing";
import { runThingAction } from "@/features/things/run-thing-action";
import { domainErrorMessage } from "@/lib/domain-error";
import { getIdentityEpoch, isEpochCurrent } from "@/features/realtime/identity-cache-policy";
import type { CourtLaneId } from "../court-view-model";

/** Personal organization never calls coey_set_pace/coey_promise or Catch. */
export function useCoeyLaneMove({ myActorId, onMoved }: { myActorId: string | null; onMoved: () => unknown }) {
  const qc = useQueryClient();
  const move = async (thing: Thing, lane: CourtLaneId | null): Promise<boolean> => {
    if (!getThingCapabilities(thing, myActorId).canSetCourtLane) {
      toast.error("Only the current assignee can place this active Thing in their Court.");
      return true;
    }
    const epoch = getIdentityEpoch(qc).epoch;
    const result = await runThingAction(qc, { kind: "set_court_lane", thingId: thing.id, lane: lane as Pace | null }, { dismissGhost: async () => {} });
    if (!isEpochCurrent(qc, epoch)) return true;
    if (result.status === "failed") { toast.error(domainErrorMessage(result.error)); return true; }
    if (result.status !== "performed") return true;
    toast.success(lane ? `Moved to ${lane[0].toUpperCase() + lane.slice(1)} in your Court` : "Following Coey placement", {
      description: "Sender’s pace and due date are unchanged.",
    });
    await Promise.all([
      ...["court", "thing", "accessible-things", "list-things", "bucket-items", "assistant"].map(key => qc.invalidateQueries({ queryKey: [key] })),
      Promise.resolve(onMoved()),
    ]).catch(() => {
      if (isEpochCurrent(qc, epoch)) toast.info("Saved. Your Court will refresh when Katalist reconnects.");
    });
    return true;
  };
  // Kept for existing consumers; lane moves no longer require a promise dialog.
  return { move, dialog: null };
}
