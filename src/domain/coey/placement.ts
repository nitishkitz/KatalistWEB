/**
 * Court, lane and concern engines (spec §6, §7, §8.2, pseudocode §16.1–16.4).
 * Pure functions: the same code runs for the composer preview, the server
 * commit and every later re-evaluation, so a Thing never jumps lanes merely
 * because a different code path looked at it.
 */
import { COEY_CONFIG, type CoeyConfig } from "./config";
import {
  subtractWorkingDays,
  workingDaysBetween,
  workingMsBetween,
  type HolderCalendar,
  type Mode,
} from "./calendar";
import type { Pace } from "./contract";
import type {
  Anchor,
  CourtDecision,
  DraftThing,
  HolderLane,
  LaneDecision,
  ResolvedParticipant,
  SenderConcern,
  ThingSchedule,
} from "./model";

const HOUR = 3_600_000;

function needsResolution(p: ResolvedParticipant): boolean {
  return p.status === "ambiguous" || p.status === "unknown" || p.status === "not_connected";
}

/** §16.1. Runs once on send. `things.length > 1` is a split offer (C0c). */
export function placeCourt(things: DraftThing[]): CourtDecision {
  if (things.length > 1) return { kind: "split", rule: "C0c" };
  const t = things[0];
  if (!t) return { kind: "my_court", rule: "C1" };
  if (t.kind === "question") return { kind: "answer", rule: "C0a" };
  if (t.kind === "note") return { kind: "note", rule: "C0b" };

  const others = t.participants.filter((p) => p.status !== "self");
  const doers = others.filter((p) => p.role === "doer");
  const tracked = others.filter((p) => p.role === "tracked");

  if (!doers.length && !tracked.length) {
    if (t.kind === "thought") return { kind: "inbox", reason: "thought", rule: "C2" };
    // "Team, submit expense claims" with no resolvable people: Coey cannot guess who.
    if (t.addressesGroup) return { kind: "inbox", reason: "unresolved_person", rule: "C10" };
    return { kind: "my_court", rule: others.some((p) => p.role === "mentioned") ? "C5" : "C1" };
  }
  if ([...doers, ...tracked].some(needsResolution)) return { kind: "inbox", reason: "unresolved_person", rule: "C10" };
  if (tracked.length && !doers.length) return { kind: "with_others", holders: tracked, privateWait: true, rule: "C6" };

  if (doers.length === 1) return { kind: "with_others", holders: doers, privateWait: false, rule: "C3" };
  switch (t.shape) {
    case "each":
      return { kind: "group", holders: doers, rule: "C8" };
    case "chain":
      return { kind: "chain", holders: doers, rule: "C9" };
    default:
      // Several doers on one job: shared ownership usually means nobody owns it (C7).
      return { kind: "ask_owner", holders: doers, rule: "C7" };
  }
}

/** Lead time before an event: 1 working day for bookings, 0 for meetings (§7.2). */
function leadWorkingDays(thing: { activityType: DraftThing["activityType"]; action: string }): number {
  if (thing.activityType === "entertainment.movie") return 1;
  return /\b(book|reserve|buy tickets?|order)\b/i.test(thing.action) ? 1 : 0;
}

function anchorCounts(anchor: Anchor | null, config: CoeyConfig): anchor is Anchor {
  if (!anchor) return false;
  return anchor.source === "typed" || anchor.accepted || config.F3_INFERRED_TIME_ACTS_BEFORE_ACCEPT;
}

/**
 * The anchor the lane follows. An explicit action time wins for the action
 * (decision D2); otherwise the latest sensible action time before the event;
 * otherwise an accepted inferred time.
 */
export function effectiveAnchor(
  thing: { actionTime: Anchor | null; eventTime: Anchor | null; inferredTime?: Anchor | null; activityType: DraftThing["activityType"]; action?: string },
  cal: HolderCalendar,
  mode: Mode,
  config: CoeyConfig = COEY_CONFIG,
): number | null {
  if (anchorCounts(thing.actionTime, config)) return thing.actionTime.at;
  if (anchorCounts(thing.eventTime, config)) {
    const lead = leadWorkingDays({ activityType: thing.activityType, action: thing.action ?? "" });
    return lead ? subtractWorkingDays(thing.eventTime.at, lead, cal, mode) : thing.eventTime.at;
  }
  if (thing.inferredTime && anchorCounts(thing.inferredTime, config)) return thing.inferredTime.at;
  return null;
}

function laneForDistance(wd: number): HolderLane {
  return wd <= 1 ? "now" : wd <= 5 ? "next" : "later";
}

type LaneInput = {
  pace: Pace | null;
  paceResolution: "pace" | "anchor" | null;
  anchorAt: number | null;
  promiseAt: number | null;
  inferredUnaccepted: boolean;
  selfTask: boolean;
};

/**
 * One lane policy for creation and runtime. Order: promise (M3–M5), the
 * sender's own pace word (L1/L2, "always wins"), an accepted anchor (L3–L5),
 * then the safe default Next (L6–L8). Pace/anchor disagreement is L10: ask,
 * shown as Next, until the user's answer is stored in `paceResolution`.
 */
function laneFromSignals(input: LaneInput, now: number, cal: HolderCalendar, mode: Mode, config: CoeyConfig): LaneDecision {
  if (input.promiseAt !== null) {
    return { lane: laneForDistance(workingDaysBetween(now, input.promiseAt, cal, mode)), rule: "M3" };
  }
  const wd = input.anchorAt !== null ? workingDaysBetween(now, input.anchorAt, cal, mode) : null;
  const anchorLane = (): LaneDecision => {
    const lane = laneForDistance(wd!);
    if (lane === "later") {
      return { lane, rule: "L5", wakeAt: subtractWorkingDays(input.anchorAt!, config.F8_LATER_WAKE_WORKING_DAYS, cal, mode) };
    }
    return { lane, rule: lane === "now" ? "L3" : "L4" };
  };

  if (input.pace === "urgent") {
    if (wd !== null && wd > 5) {
      if (input.paceResolution === "anchor") return anchorLane();
      if (input.paceResolution === "pace") return { lane: "now", rule: "L1" };
      return { lane: "next", rule: "L10", ask: "pace_conflict" };
    }
    return { lane: "now", rule: "L1" };
  }
  if (input.pace === "chill") {
    if (wd !== null && wd <= 1) {
      if (input.paceResolution === "anchor") return anchorLane();
      if (input.paceResolution === "pace") return { lane: "later", rule: "L2" };
      return { lane: "next", rule: "L10", ask: "pace_conflict" };
    }
    return { lane: "later", rule: "L2" };
  }
  if (wd === null) {
    return { lane: "next", rule: input.inferredUnaccepted ? "L6" : input.selfTask ? "L8" : "L7" };
  }
  return anchorLane();
}

/** §16.2 Lane at creation. */
export function placeLane(
  thing: DraftThing,
  court: CourtDecision,
  cal: HolderCalendar,
  now: number,
  paceResolution: "pace" | "anchor" | null = null,
  config: CoeyConfig = COEY_CONFIG,
): LaneDecision {
  if (court.kind === "inbox" && court.reason === "unresolved_person") return { lane: "none", rule: "L0" };
  if (court.kind === "inbox" && court.reason === "thought") return { lane: "later", rule: "L9" };
  if (court.kind === "answer" || court.kind === "note" || court.kind === "split" || court.kind === "ask_owner") {
    return { lane: "none", rule: court.rule };
  }
  if (thing.recurrence && !thing.actionTime) return { lane: "later", rule: "L11" };
  const anchorAt = effectiveAnchor(thing, cal, thing.mode, config);
  const inferredUnaccepted = Boolean(thing.inferredTime && !thing.inferredTime.accepted && !config.F3_INFERRED_TIME_ACTS_BEFORE_ACCEPT);
  return laneFromSignals(
    { pace: thing.pace, paceResolution, anchorAt, promiseAt: null, inferredUnaccepted, selfTask: court.kind === "my_court" },
    now,
    cal,
    thing.mode,
    config,
  );
}

/** §16.3 Holder lane on every tick and event. */
export function computeHolderLane(
  s: ThingSchedule,
  cal: HolderCalendar,
  now: number,
  config: CoeyConfig = COEY_CONFIG,
): LaneDecision {
  if (s.state === "sorted") return { lane: "none", rule: "M15" };
  if (s.state === "blocked" && s.blockedOn?.kind !== "sender") return { lane: "none", rule: "M10" };
  if (s.inboxReason === "thought") return { lane: "later", rule: "L9" };
  if (s.inboxReason) return { lane: "none", rule: "L0" };
  if (s.snoozeUntil !== null && now < s.snoozeUntil) return { lane: "hidden", rule: "M6" };
  const anchorAt = effectiveAnchor(
    { actionTime: s.actionTime, eventTime: s.eventTime, activityType: s.activityType, action: s.textRaw },
    cal,
    s.mode,
    config,
  );
  const decision = laneFromSignals(
    {
      pace: s.pace,
      paceResolution: s.paceResolution,
      anchorAt,
      promiseAt: s.promiseAt,
      inferredUnaccepted: false,
      selfTask: s.holderProfileId === s.senderProfileId,
    },
    now,
    cal,
    s.mode,
    config,
  );
  // At runtime an unanswered L10 stays visibly Next; staleness never raises (F1, M8).
  if (config.F1_STALE_RAISES_LANE && decision.lane === "next" && isStale(s, cal, now, config)) {
    return { lane: "now", rule: "M8" };
  }
  return decision;
}

/** Cadence step (working ms) for the holder, by the sender's pace (§9.1). Null = never. */
export function cadenceMs(pace: Pace | null, cal: HolderCalendar, mode: Mode, config: CoeyConfig = COEY_CONFIG): number | null {
  if (pace === "chill") return null;
  if (pace === "urgent") return config.F6_CADENCE_URGENT_WORKING_HOURS * HOUR;
  const dayMs = (mode === "home" ? cal.homeEnd - cal.homeStart : cal.workEnd - cal.workStart) * 60_000;
  return config.F6_CADENCE_NORMAL_WORKING_DAYS * dayMs;
}

/** No qualified holder activity for at least one cadence step, in the holder's working time. */
export function isStale(s: ThingSchedule, cal: HolderCalendar, now: number, config: CoeyConfig = COEY_CONFIG): boolean {
  if (s.state === "sorted" || s.state === "blocked" || s.promiseAt !== null) return false;
  if (s.holderProfileId === s.senderProfileId) return false;
  const step = cadenceMs(s.pace, cal, s.mode, config);
  if (step === null) return false;
  return workingMsBetween(s.lastActivityAt, now, cal, s.mode) >= step;
}

/** §16.4 Sender concern: how much should the sender worry about their own Thing. */
export function computeSenderConcern(s: ThingSchedule, cal: HolderCalendar, now: number, config: CoeyConfig = COEY_CONFIG): SenderConcern {
  if (s.state === "blocked" && s.blockedOn?.kind === "third_party") return "blocked";
  if (s.promiseAt !== null && now > s.promiseAt && s.state !== "sorted") return "promise_missed";
  if (s.promiseAt !== null) return "on_track";
  if (isStale(s, cal, now, config)) return "stale";
  if (s.state === "caught") return "caught_no_date";
  return "not_caught";
}

export const CONCERN_ORDER: Record<SenderConcern, number> = {
  promise_missed: 1,
  stale: 2,
  not_caught: 3,
  caught_no_date: 4,
  on_track: 5,
  blocked: 6,
};

/** §8.3 order within a holder's lane: soonest anchor/promise, then paced by others, then oldest. */
export function compareForHolder(
  a: { anchorAt: number | null; pacedByOther: boolean; createdAt: number },
  b: { anchorAt: number | null; pacedByOther: boolean; createdAt: number },
): number {
  const aa = a.anchorAt ?? Number.POSITIVE_INFINITY, ba = b.anchorAt ?? Number.POSITIVE_INFINITY;
  if (aa !== ba) return aa - ba;
  if (a.pacedByOther !== b.pacedByOther) return a.pacedByOther ? -1 : 1;
  return a.createdAt - b.createdAt;
}
