import type { Person, Thing } from "@/domain/thing";

export function bucketThingColumns(thing: Thing) {
  return {
    assignment: {
      from: thing.assignedBy,
      to: thing.assignee,
      selfAssigned: thing.assignedBy.id === thing.assignee.id,
    },
    pace: thing.personalPace,
    status: thing.workStatus,
  };
}

export function bucketPeople(things: readonly Thing[], currentActorId?: string | null): Person[] {
  const people = things.flatMap((thing) => [
    thing.creator,
    thing.owner,
    thing.assignedBy,
    thing.assignee,
  ]);

  return [...new Map(people.map((person) => [person.id, person])).values()].sort((a, b) => {
    if (currentActorId && a.id === currentActorId) return -1;
    if (currentActorId && b.id === currentActorId) return 1;
    return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });
}

export function filterBucketThings(
  things: readonly Thing[],
  query: string,
  personId: string | null,
) {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  return things.filter((thing) => {
    if (personId) {
      const involvedIds = [
        thing.creator.id,
        thing.owner.id,
        thing.assignedBy.id,
        thing.assignee.id,
      ];
      if (!involvedIds.includes(personId)) return false;
    }

    if (!normalizedQuery) return true;
    return [
      thing.title,
      thing.listName ?? "",
      thing.creator.name,
      thing.owner.name,
      thing.assignedBy.name,
      thing.assignee.name,
    ]
      .join(" ")
      .toLocaleLowerCase()
      .includes(normalizedQuery);
  });
}
