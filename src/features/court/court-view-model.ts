import type { Acknowledgement, Thing, WorkStatus } from "@/domain/thing";

export type CourtLaneId = "now" | "next" | "later";
export type CourtViewMode = CourtLaneId | null;
export type CourtQuickFilter = "all" | "due" | "waiting" | "progress";
export type CourtDueFilter = "any" | "overdue" | "today" | "this_week" | "no_due";
export type CourtAcknowledgementFilter = "any" | Acknowledgement;
export type CourtWorkStatusFilter = "any" | Extract<WorkStatus, "not_started" | "under_progress">;
export type CourtSort = "due" | "updated" | "importance" | "pace";
export type CourtCardDensity = "overview" | "focused" | "peek";
export type TheirsFocus = "waiting_for_catch" | "moving" | "needs_attention";

export type CourtFilterState = {
  quick: CourtQuickFilter;
  due: CourtDueFilter;
  acknowledgement: CourtAcknowledgementFilter;
  workStatus: CourtWorkStatusFilter;
  starredOnly: boolean;
  personId?: string | null;
};

export const DEFAULT_COURT_FILTERS: CourtFilterState = {
  quick: "all",
  due: "any",
  acknowledgement: "any",
  workStatus: "any",
  starredOnly: false,
  personId: null,
};

function searchableText(thing: Thing) {
  return [thing.title, thing.owner.name, thing.assignee.name, thing.listName ?? ""]
    .join(" ")
    .toLocaleLowerCase();
}

function isSameLocalDay(value: Date, reference: Date) {
  return (
    value.getFullYear() === reference.getFullYear() &&
    value.getMonth() === reference.getMonth() &&
    value.getDate() === reference.getDate()
  );
}

function endOfLocalWeek(reference: Date) {
  const end = new Date(reference);
  const daysUntilSunday = (7 - end.getDay()) % 7;
  end.setDate(end.getDate() + daysUntilSunday);
  end.setHours(23, 59, 59, 999);
  return end;
}

function matchesDueFilter(thing: Thing, filter: CourtDueFilter, now: Date) {
  if (filter === "any") return true;
  if (filter === "no_due") return thing.dueAt == null;
  if (!thing.dueAt) return false;
  const due = new Date(thing.dueAt);
  if (filter === "overdue") {
    return due.getTime() < now.getTime() && (!isSameLocalDay(due, now) || thing.dueHasTime);
  }
  if (filter === "today") return isSameLocalDay(due, now);
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  return due.getTime() >= startOfToday.getTime() && due.getTime() <= endOfLocalWeek(now).getTime();
}

export function filterCourtThings(
  things: readonly Thing[],
  filters: CourtFilterState,
  query: string,
  now = new Date(),
) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return things.filter((thing) => {
    if (normalizedQuery && !searchableText(thing).includes(normalizedQuery)) return false;
    if (filters.quick === "due" && !thing.dueAt) return false;
    if (filters.quick === "waiting" && thing.acknowledgement !== "waiting_for_catch") return false;
    if (filters.quick === "progress" && thing.workStatus !== "under_progress") return false;
    if (!matchesDueFilter(thing, filters.due, now)) return false;
    if (filters.acknowledgement !== "any" && thing.acknowledgement !== filters.acknowledgement)
      return false;
    if (filters.workStatus !== "any" && thing.workStatus !== filters.workStatus) return false;
    if (filters.starredOnly && !thing.starred) return false;
    if (filters.personId) {
      const match =
        thing.assignee.id === filters.personId ||
        thing.owner.id === filters.personId ||
        thing.creator.id === filters.personId;
      if (!match) return false;
    }
    return true;
  });
}

const priority = { now: 0, next: 1, later: 2 } as const;

export function sortCourtThings(things: readonly Thing[], sort: CourtSort) {
  return things
    .map((thing, index) => ({ thing, index }))
    .sort((a, b) => {
      let difference = 0;
      if (sort === "due") {
        difference =
          (a.thing.dueAt ? new Date(a.thing.dueAt).getTime() : Number.POSITIVE_INFINITY) -
          (b.thing.dueAt ? new Date(b.thing.dueAt).getTime() : Number.POSITIVE_INFINITY);
      } else if (sort === "updated") {
        difference = new Date(b.thing.updatedAt).getTime() - new Date(a.thing.updatedAt).getTime();
      } else if (sort === "importance") {
        difference = priority[a.thing.ownerImportance] - priority[b.thing.ownerImportance];
      } else {
        difference =
          (a.thing.personalPace ? priority[a.thing.personalPace] : Number.POSITIVE_INFINITY) -
          (b.thing.personalPace ? priority[b.thing.personalPace] : Number.POSITIVE_INFINITY);
      }
      return difference || a.index - b.index;
    })
    .map(({ thing }) => thing);
}

export function applyCourtView(
  lanes: {
    now: readonly Thing[];
    next: readonly Thing[];
    later: readonly Thing[];
    theirs: readonly Thing[];
  },
  filters: CourtFilterState,
  query: string,
  sort: CourtSort,
  now = new Date(),
) {
  const apply = (things: readonly Thing[]) =>
    sortCourtThings(filterCourtThings(things, filters, query, now), sort);
  const result = {
    now: apply(lanes.now),
    next: apply(lanes.next),
    later: apply(lanes.later),
    theirs: apply(lanes.theirs),
  };
  return {
    ...result,
    counts: {
      now: result.now.length,
      next: result.next.length,
      later: result.later.length,
      theirs: result.theirs.length,
    },
  };
}

export function toggleLaneFocus(current: CourtViewMode, requested: CourtLaneId): CourtViewMode {
  return current === requested ? null : requested;
}

export function toggleTheirsFocus(current: TheirsFocus | null, requested: TheirsFocus) {
  return current === requested ? null : requested;
}

export function cardDensityForLane(focus: CourtViewMode, lane: CourtLaneId): CourtCardDensity {
  if (!focus) return "overview";
  return focus === lane ? "focused" : "peek";
}

export function formatCourtDue(thing: Thing, now = new Date()) {
  if (!thing.dueAt) return { label: "No due date", urgent: false };
  const due = new Date(thing.dueAt);
  if (isSameLocalDay(due, now)) {
    const time = thing.dueHasTime
      ? `, ${due.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
      : "";
    return { label: `Today${time}`, urgent: true };
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (isSameLocalDay(due, tomorrow)) return { label: "Tomorrow", urgent: true };
  return {
    label: due.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    urgent: due.getTime() < now.getTime(),
  };
}
