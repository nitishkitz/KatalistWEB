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
  return thing.personalPace ?? thing.ownerImportance;
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
