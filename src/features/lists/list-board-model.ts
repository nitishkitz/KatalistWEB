import { isActiveThing, laneOf, type Person, type Thing } from "@/domain/thing";

export type ListStatusFilter = "all" | "due" | "waiting" | "progress" | "completed";

type Input = {
  things: Thing[];
  status: ListStatusFilter;
  assigneeId: string | null;
  query: string;
  now: Date;
};

function matchesStatus(thing: Thing, status: ListStatusFilter, now: Date) {
  if (status === "all") return true;
  if (status === "waiting") return thing.acknowledgement === "waiting_for_catch";
  if (status === "progress") return thing.workStatus === "under_progress";
  if (status === "completed") return thing.workStatus === "sorted";
  return Boolean(
    thing.dueAt && new Date(thing.dueAt).getTime() < now.getTime() && isActiveThing(thing),
  );
}

function compareThings(a: Thing, b: Thing) {
  const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.POSITIVE_INFINITY;
  const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.POSITIVE_INFINITY;
  if (aDue !== bDue) return aDue - bDue;
  const updated = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  return updated || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
}

export function deriveListView(input: Input) {
  const query = input.query.trim().toLocaleLowerCase();
  const assignees = [...new Map(input.things.map((thing) => [thing.assignee.id, thing.assignee])).values()]
    .sort((a, b) => a.name.localeCompare(b.name));
  const flat = input.things
    .filter((thing) => matchesStatus(thing, input.status, input.now))
    .filter((thing) => !input.assigneeId || thing.assignee.id === input.assigneeId)
    .filter((thing) => !query || thing.title.toLocaleLowerCase().includes(query))
    .sort(compareThings);

  return {
    now: flat.filter((thing) => laneOf(thing) === "now"),
    next: flat.filter((thing) => laneOf(thing) === "next"),
    later: flat.filter((thing) => laneOf(thing) === "later"),
    flat,
    assignees,
  } satisfies {
    now: Thing[];
    next: Thing[];
    later: Thing[];
    flat: Thing[];
    assignees: Person[];
  };
}

export function canDragListThing(thing: Thing, myActorId: string | null) {
  return Boolean(
    myActorId &&
      thing.assignee.id === myActorId &&
      thing.acknowledgement === "caught" &&
      isActiveThing(thing),
  );
}
