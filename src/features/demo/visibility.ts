import type { Thing } from "@/domain/thing";
import type { ListRow } from "@/features/lists/fixtures";

/** Demo visibility: only Things the actor owns, created, is assigned, or can view via List membership. */
export function canDemoActorViewThing(thing: Thing, actorId: string, lists: ListRow[]): boolean {
  if (!actorId) return false;
  if (thing.assignee.id === actorId) return true;
  if (thing.owner.id === actorId) return true;
  if (thing.creator.id === actorId) return true;
  if (thing.listId) {
    const list = lists.find((l) => l.id === thing.listId);
    if (list) {
      if (list.ownerActorId === actorId) return true;
      if (list.members.some((m) => m.actorId === actorId)) return true;
    }
  }
  return false;
}

export function roleForDemoList(list: ListRow, actorId: string): ListRow["role"] | null {
  if (list.ownerActorId === actorId) return "owner";
  const member = list.members.find((m) => m.actorId === actorId);
  if (member?.role === "owner") return "owner";
  if (member?.role === "collaborator") return "collaborator";
  if (member?.role === "view_only") return "view_only";
  if (member) return member.role ?? "collaborator";
  return null;
}

export function projectDemoList(list: ListRow, actorId: string): ListRow | null {
  const role = roleForDemoList(list, actorId);
  if (!role) return null;
  const ownerName = list.members.find((m) => m.actorId === list.ownerActorId)?.name;
  return {
    ...list,
    role,
    ownerLine: list.ownerActorId === actorId ? "Owned by you" : ownerName ? `Owned by ${ownerName}` : list.ownerLine,
  };
}
