import { getThingCapabilities } from "@/domain/capabilities";
import type { Thing } from "@/domain/thing";
import type { ThingActionRequest } from "@/features/things/run-thing-action";
import type { CourtLaneId } from "./court-view-model";

/** Organization does not accept work or modify a shared pace/date. */
export function courtLaneDropAction(thing: Thing, myActorId: string | null, lane: CourtLaneId): ThingActionRequest | null {
  if (!getThingCapabilities(thing, myActorId).canSetCourtLane) return null;
  return { kind: "set_court_lane", thingId: thing.id, lane };
}

export type CoeyLaneMove = { kind: "personal_lane"; lane: CourtLaneId };
export function coeyLaneMove(thing: Thing, lane: CourtLaneId): CoeyLaneMove | null {
  const view = thing.coey;
  if (!view || view.schedule.holderProfileId !== view.viewerProfileId || view.schedule.privateWait
    || ["blocked", "with_sender", "sorted"].includes(view.schedule.state)
    || thing.workStatus === "sorted" || thing.workStatus === "cancelled" || thing.cancelledAt) return null;
  return { kind: "personal_lane", lane };
}
