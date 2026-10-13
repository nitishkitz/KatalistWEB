import { getThingCapabilities } from "@/domain/capabilities";
import type { Thing } from "@/domain/thing";
import type { Pace as CoeyPace } from "@/domain/coey/contract";
import type { HolderLane } from "@/domain/coey/model";
import { computeHolderLane } from "@/domain/coey/placement";
import { addWorkingDays, localParts, nextWindowStart, windowFor } from "@/domain/coey/calendar";
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

/**
 * What a lane move means for a Coey-scheduled Thing (spec §8.4). Coey places
 * these from the schedule, so the legacy personal pace alone never moves them.
 *  - My own Thing: I am its sender, so the move sets its pace (M9). If its
 *    date keeps it in another lane, say so instead of claiming a move.
 *  - A Thing someone sent me: I cannot lower their pace; a promised date
 *    places it honestly (M3), so the move becomes a promise.
 */
export type CoeyLaneMove =
  | { kind: "pace"; pace: CoeyPace; lane: HolderLane }
  | { kind: "date_wins"; lane: HolderLane; rule: string }
  | { kind: "promise"; suggestedAt: number };

const PACE_FOR_LANE: Record<CourtLaneId, CoeyPace> = { now: "urgent", next: "normal", later: "chill" };
const PROMISE_DAYS: Record<CourtLaneId, number> = { now: 0, next: 3, later: 7 };

export function promiseLane(thing: Thing, promiseAt: number, now = Date.now()): HolderLane | null {
  const view = thing.coey;
  if (!view) return null;
  return computeHolderLane({ ...view.schedule, snoozeUntil: null, promiseAt }, view.holderCal, now).lane;
}

/** A promise that lands in `lane`: the end of a working day that far ahead. */
export function suggestedPromise(thing: Thing, lane: CourtLaneId, now = Date.now()): number | null {
  const view = thing.coey;
  if (!view) return null;
  const { holderCal: cal, schedule } = view;
  const days = PROMISE_DAYS[lane];
  const raw = days === 0 ? nextWindowStart(now, cal, schedule.mode) : addWorkingDays(now, days, cal, schedule.mode);
  const end = windowFor(localParts(raw, cal.timezone).date, cal, schedule.mode)?.end;
  const at = end && end > now ? end : raw;
  return promiseLane(thing, at, now) === lane ? at : raw;
}

export function coeyLaneMove(thing: Thing, lane: CourtLaneId, now = Date.now()): CoeyLaneMove | null {
  const view = thing.coey;
  if (!view) return null;
  const s = view.schedule;
  const me = view.viewerProfileId;
  if (s.holderProfileId !== me) return null;
  if (s.senderProfileId === me) {
    const pace = PACE_FOR_LANE[lane];
    const decision = computeHolderLane({ ...s, snoozeUntil: null, pace, paceResolution: "pace" }, view.holderCal, now);
    return decision.lane === lane ? { kind: "pace", pace, lane } : { kind: "date_wins", lane: decision.lane, rule: decision.rule };
  }
  const suggestedAt = suggestedPromise(thing, lane, now);
  return suggestedAt === null ? null : { kind: "promise", suggestedAt };
}
