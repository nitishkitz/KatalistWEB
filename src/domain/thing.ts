import type { CoeyThingView } from "./coey/model";
import { computeHolderLane, computeSenderConcern, CONCERN_ORDER } from "./coey/placement";

export type Importance = "now" | "next" | "later";
export type Pace = "now" | "next" | "later";
export type Acknowledgement = "waiting_for_catch" | "caught";
export type WorkStatus = "not_started" | "under_progress" | "sorted" | "cancelled";
export type ContextKind = "work" | "home";

export type Person = {
  id: string;
  name: string;
  initials: string;
  avatarUrl?: string | null;
  actorId?: string;
  profileId?: string;
  /** Set when this person was resolved from the Thing's List membership. */
  listMember?: boolean;
};

export type Thing = {
  id: string;
  title: string;
  creator: Person;
  owner: Person;
  assignee: Person;
  acknowledgement: Acknowledgement;
  workStatus: WorkStatus;
  ownerImportance: Importance;
  personalPace: Pace | null;
  dueAt: string | null;
  dueHasTime: boolean;
  context: ContextKind;
  listId: string | null;
  listName: string | null;
  starred?: boolean;
  cancelledAt: string | null;
  sortedAt: string | null;
  caughtAt: string | null;
  updatedAt: string;
  createdAt?: string;
  description?: string | null;
  commentCount?: number;
  unreadCommentCount?: number;
  attachmentCount?: number;
  files?: ThingFile[];
  /** Summary objects never claim to contain the full attachment/detail set. */
  detailLevel?: "overview" | "detail";
  /** Counts unavailable is distinct from a confirmed zero. */
  overviewStatsUnavailable?: boolean;
  /** A detail attachment read failed; an empty files array is not authoritative. */
  attachmentsUnavailable?: boolean;
  commentCountsUnavailable?: boolean;
  /** Coey schedule projection, when this Thing was captured through the Magic Box. */
  coey?: CoeyThingView;
};

export type ThingFileType = "image" | "video" | "pdf" | "docx" | "excel" | "other" | "png" | "jpg";

export type ThingFile = {
  id: string;
  name: string;
  type: ThingFileType;
  url?: string;
  /** Signing failed or the storage object is unavailable; never invent a URL. */
  urlError?: string;
  sizeLabel?: string;
  mimeType?: string;
  isNew?: boolean;
  /** H03: the real Storage object path behind `url`, needed to request a
   *  fresh signed URL when the current one expires -- absent for a
   *  not-yet-uploaded local preview (`isNew`), which has no Storage path. */
  storageKey?: string;
};

export type CourtLane = "now" | "next" | "later";
export type TheirState = "waiting_for_catch" | "moving" | "needs_attention";

/** The holder's lane, recomputed from the schedule on every read so it moves with time (M1). */
export function coeyLane(thing: Thing, now = Date.now()) {
  const view = thing.coey;
  if (!view) return null;
  // The personal snooze lens hides snoozed Things separately; here the lane is the waking lane.
  return computeHolderLane({ ...view.schedule, snoozeUntil: null }, view.holderCal, now);
}

export function laneOf(thing: Thing): CourtLane {
  const lane = coeyLane(thing)?.lane;
  if (lane === "now" || lane === "next" || lane === "later") return lane;
  // Caught Things follow the assignee's personal pace. Uncaught (waiting for
  // catch) Things surface in the lane matching the owner's stated importance,
  // so a Thing tossed as "later" stays in Later — not forced into Now.
  return thing.personalPace ?? thing.ownerImportance ?? "next";
}

export function theirStateFor(thing: Thing): TheirState {
  if (thing.coey) {
    const concern = computeSenderConcern(thing.coey.schedule, thing.coey.holderCal, Date.now());
    if (concern === "not_caught") return "waiting_for_catch";
    if (concern === "promise_missed" || concern === "stale") return "needs_attention";
    return "moving";
  }
  if (thing.acknowledgement === "waiting_for_catch") return "waiting_for_catch";
  const overdue =
    thing.dueAt != null &&
    new Date(thing.dueAt).getTime() < Date.now() &&
    thing.workStatus !== "sorted";
  if (overdue) return "needs_attention";
  return "moving";
}

export function isActiveThing(thing: Thing): boolean {
  return thing.workStatus !== "sorted" && thing.workStatus !== "cancelled" && !thing.cancelledAt;
}

export function partitionCourt(things: Thing[], myActorId: string) {
  const active = things.filter(isActiveThing);
  const mine: Thing[] = [];
  const theirs: Thing[] = [];
  const inbox: Thing[] = [];
  for (const t of active) {
    const view = t.coey;
    if (view) {
      const s = view.schedule;
      const me = view.viewerProfileId;
      if (s.state === "sorted") continue;
      if (s.senderProfileId === me && s.inboxReason && s.inboxReason !== "thought") { inbox.push(t); continue; }
      if (s.privateWait) { if (s.senderProfileId === me) theirs.push(t); continue; }
      if (s.holderProfileId === me) {
        // A third-party blocker parks the Thing outside the lanes (M10).
        if (s.state === "blocked") inbox.push(t);
        else mine.push(t);
        continue;
      }
      if (s.senderProfileId === me) { theirs.push(t); continue; }
    }
    if (t.assignee.id === myActorId) mine.push(t);
    else if (t.owner.id === myActorId) theirs.push(t);
  }
  // With Others is ordered by how much the sender should worry (§8.2).
  const concernRank = (t: Thing) => (t.coey ? CONCERN_ORDER[computeSenderConcern(t.coey.schedule, t.coey.holderCal, Date.now())] : 3);
  theirs.sort((a, b) => concernRank(a) - concernRank(b));
  return {
    mine,
    now: mine.filter((t) => laneOf(t) === "now"),
    next: mine.filter((t) => laneOf(t) === "next"),
    later: mine.filter((t) => laneOf(t) === "later"),
    theirs,
    inbox,
  };
}
