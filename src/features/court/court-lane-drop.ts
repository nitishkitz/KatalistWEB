import { getThingCapabilities } from "@/domain/capabilities";
import type { Thing } from "@/domain/thing";
import type { ThingActionRequest } from "@/features/things/run-thing-action";
import type { CourtLaneId } from "./court-view-model";

/** A drop onto a personal lane either accepts a waiting Thing there or
 * changes the current assignee's pace for an already caught Thing. */
export function courtLaneDropAction(
  thing: Thing,
  myActorId: string | null,
  lane: CourtLaneId,
): ThingActionRequest | null {
  const caps = getThingCapabilities(thing, myActorId);
  if (caps.canCatch) return { kind: "catch", thingId: thing.id, pace: lane };
  if (caps.canSetPace) return { kind: "set_pace", thingId: thing.id, pace: lane };
  return null;
}
