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
};

export type CourtLane = "now" | "next" | "later";
export type TheirState = "waiting_for_catch" | "moving" | "needs_attention";

export function laneOf(thing: Thing): CourtLane {
  if (thing.acknowledgement === "waiting_for_catch") return "now";
  return thing.personalPace ?? "next";
}

export function theirStateFor(thing: Thing): TheirState {
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
  const mine = active.filter((t) => t.assignee.id === myActorId);
  const theirs = active.filter((t) => t.owner.id === myActorId && t.assignee.id !== myActorId);
  return {
    mine,
    now: mine.filter((t) => laneOf(t) === "now"),
    next: mine.filter((t) => laneOf(t) === "next"),
    later: mine.filter((t) => laneOf(t) === "later"),
    theirs,
  };
}
