/**
 * Follow-up cadence (spec §9.1–9.4). Pure: given schedules, holder calendars
 * and a clock, returns which follow-ups are due now and on which channel.
 * Delivery re-checks eligibility atomically on the server; this only plans.
 */
import { COEY_CONFIG, type CoeyConfig } from "./config";
import {
  addWorkingMs,
  isFestival,
  isInsideWindow,
  localParts,
  nextWindowStart,
  subtractWorkingMs,
  zonedInstant,
  type HolderCalendar,
} from "./calendar";
import type { ThingSchedule } from "./model";
import { cadenceMs } from "./placement";

const HOUR = 3_600_000;

export type FollowUpKind = "cadence" | "promise_soon" | "promise_due";
export type PlannedFollowUp = {
  thingId: string;
  holderProfileId: string;
  senderProfileId: string;
  step: number;
  kind: FollowUpKind;
  /** When it became due (working time); delivery may be later. */
  dueAt: number;
  /** §9.2: nudge 1 is in-app only (a line on the Thing); later steps may push. */
  channel: "in_app" | "push";
};

/** Whether Coey may follow up on this Thing at all. */
export function followUpEligible(s: ThingSchedule): boolean {
  if (s.state === "sorted" || s.state === "blocked" || s.state === "with_sender") return false;
  if (s.privateWait || s.inboxReason) return false; // C6 and C10: nobody is nudged.
  if (!s.holderProfileId || s.holderProfileId === s.senderProfileId) return false; // self-Things get no nudges.
  return true;
}

/** The next follow-up for one Thing, or null when Coey stays silent. */
export function nextFollowUp(s: ThingSchedule, cal: HolderCalendar, config: CoeyConfig = COEY_CONFIG): Omit<PlannedFollowUp, "channel"> | null {
  if (!followUpEligible(s)) return null;
  const step = s.nudgeCountCycle + 1;
  const base = { thingId: s.thingId, holderProfileId: s.holderProfileId!, senderProfileId: s.senderProfileId, step };
  if (s.promiseAt !== null) {
    // M3/M4: nudges stop until the promise is close; then shortly before, then at it.
    if (step === 1) {
      const soon = s.pace === "urgent"
        ? subtractWorkingMs(s.promiseAt, 2 * HOUR, cal, s.mode)
        : zonedInstant(localParts(s.promiseAt, cal.timezone).date, s.mode === "home" ? cal.homeStart : cal.workStart, cal.timezone);
      return { ...base, kind: "promise_soon", dueAt: Math.min(soon, s.promiseAt) };
    }
    if (step === 2) return { ...base, kind: "promise_due", dueAt: s.promiseAt };
    return null; // M5: a missed promise becomes an offer to ask for more time, not another nudge.
  }
  if (step > config.F7_MAX_AUTO_NUDGES_PER_CYCLE) return null; // After 3: the sender sees "needs attention".
  const interval = cadenceMs(s.pace, cal, s.mode, config);
  if (interval === null) return null; // Chill: never (Spring Cleaning only).
  return { ...base, kind: "cadence", dueAt: addWorkingMs(s.lastActivityAt, interval * step, cal, s.mode) };
}

export type FollowUpPlan = { due: PlannedFollowUp[]; deferredUntil: Array<{ thingId: string; at: number }> };

/**
 * All follow-ups due at `now`. A due item outside the holder's working window,
 * on a festival, or while the holder is snoozing it waits for the next window.
 */
export function planFollowUps(
  items: Array<{ schedule: ThingSchedule; holderCal: HolderCalendar }>,
  now: number,
  config: CoeyConfig = COEY_CONFIG,
): FollowUpPlan {
  const due: PlannedFollowUp[] = [];
  const deferredUntil: FollowUpPlan["deferredUntil"] = [];
  for (const { schedule: s, holderCal: cal } of items) {
    const next = nextFollowUp(s, cal, config);
    if (!next || next.dueAt > now) continue;
    if (s.snoozeUntil !== null && s.snoozeUntil > now) { deferredUntil.push({ thingId: s.thingId, at: s.snoozeUntil }); continue; }
    const today = localParts(now, cal.timezone).date;
    if (isFestival(today, cal) || !isInsideWindow(now, cal, s.mode)) {
      deferredUntil.push({ thingId: s.thingId, at: nextWindowStart(now + 60_000, cal, s.mode) });
      continue;
    }
    due.push({ ...next, channel: next.step === 1 ? "in_app" : "push" });
  }
  return { due, deferredUntil };
}

/** One message per holder per tick (§9.4 batching). */
export function batchByHolder(due: PlannedFollowUp[]): Map<string, PlannedFollowUp[]> {
  const batches = new Map<string, PlannedFollowUp[]>();
  for (const f of due) batches.set(f.holderProfileId, [...(batches.get(f.holderProfileId) ?? []), f]);
  return batches;
}
