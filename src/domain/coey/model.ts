/**
 * Shared Coey scheduling types (spec §3.1). A Thing's schedule is stored once;
 * the holder's lane and the sender's concern are projections computed by
 * placement.ts, never written from UI code.
 */
import type { HolderCalendar, Mode } from "./calendar";
import type { ActivityType, AssignShape, Pace, ParticipantRole, ThingKind } from "./contract";

export type AnchorSource = "typed" | "inferred";

export type Anchor = {
  at: number;
  /** Holder-local date (YYYY-MM-DD). */
  date: string;
  precision: "date" | "time";
  source: AnchorSource;
  accepted: boolean;
  phrase: string | null;
};

export type ScheduleState = "open" | "caught" | "promised" | "snoozed" | "blocked" | "with_sender" | "sorted";
export type InboxReason = "thought" | "unresolved_person" | "wrong_person" | "unresolved_owner" | "unresolved_capture";
export type HolderLane = "now" | "next" | "later" | "none" | "hidden";
export type SenderConcern = "promise_missed" | "stale" | "not_caught" | "caught_no_date" | "on_track" | "blocked";

export type Recurrence = {
  freq: "daily" | "weekly" | "monthly";
  weekdays: string[];
  monthDay: number | null;
  phrase: string;
};

/** The persisted schedule of one Thing (one row per Thing). */
export type ThingSchedule = {
  thingId: string;
  textRaw: string;
  mode: Mode;
  kind: ThingKind;
  senderProfileId: string;
  holderProfileId: string | null;
  state: ScheduleState;
  inboxReason: InboxReason | null;
  privateWait: boolean;
  groupId: string | null;
  chain: string[];
  pace: Pace | null;
  /** How the user resolved an L10 pace/anchor conflict, if they did. */
  paceResolution: "pace" | "anchor" | null;
  actionTime: Anchor | null;
  eventTime: Anchor | null;
  activityType: ActivityType | null;
  recurrence: Recurrence | null;
  promiseAt: number | null;
  snoozeUntil: number | null;
  blockedOn: { kind: "sender" | "third_party"; note: string } | null;
  lastActivityAt: number;
  lastNudgeAt: number | null;
  nudgeCountCycle: number;
  breakthroughUsed: boolean;
  createdAt: number;
  /** Schedule revision; follow-up plans name it so stale plans are rejected. */
  revision?: number;
};

/** A person named in the input after identity resolution (never from the model). */
export type ResolvedParticipant = {
  mention: string;
  role: ParticipantRole;
  status: "resolved" | "self" | "ambiguous" | "unknown" | "not_connected";
  profileId?: string;
  actorId?: string;
  name?: string;
  candidates?: Array<{ profileId: string; actorId: string; name: string; avatarUrl?: string | null }>;
};

/** One interpreted, resolved Thing before placement (the slot object of §5.1). */
export type DraftThing = {
  kind: ThingKind;
  action: string;
  textRaw: string;
  mode: Mode;
  participants: ResolvedParticipant[];
  shape: AssignShape;
  addressesGroup: boolean;
  pace: Pace | null;
  pacePhrase: string | null;
  actionTime: Anchor | null;
  eventTime: Anchor | null;
  /** Ghost proposal from activity priors (R1), not an anchor until accepted. */
  inferredTime: Anchor | null;
  activityType: ActivityType | null;
  recurrence: Recurrence | null;
  waitsOn: string | null;
  toneHarsh: boolean;
  confidence: number;
};

export type CourtDecision =
  | { kind: "answer"; rule: "C0a" }
  | { kind: "note"; rule: "C0b" }
  | { kind: "split"; rule: "C0c" }
  | { kind: "my_court"; rule: "C1" | "C5" }
  | { kind: "inbox"; reason: InboxReason; rule: "C2" | "C10" | "C7" }
  | { kind: "with_others"; holders: ResolvedParticipant[]; privateWait: boolean; rule: "C3" | "C6" }
  | { kind: "chain"; holders: ResolvedParticipant[]; rule: "C9" }
  | { kind: "group"; holders: ResolvedParticipant[]; rule: "C8" }
  | { kind: "ask_owner"; holders: ResolvedParticipant[]; rule: "C7" };

export type LaneDecision = {
  lane: HolderLane;
  rule: string;
  /** L10: the lane is provisional until the user answers. */
  ask?: "pace_conflict";
  wakeAt?: number | null;
};

/** A Thing's schedule plus what the viewer needs to project it (spec §8.2). */
export type CoeyThingView = {
  schedule: ThingSchedule;
  holderCal: HolderCalendar;
  viewerProfileId: string;
};
