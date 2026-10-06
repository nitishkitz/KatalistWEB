import type { Person } from "@/domain/thing";

type MemberLike = {
  actorId?: string;
  profileId?: string;
  name: string;
  initials: string;
  avatarUrl?: string | null;
};

/** A List member as a Person. Members only carry a profile id until an actor id is resolved. */
export function memberToPerson(member: MemberLike): Person {
  return {
    id: member.actorId || member.profileId || member.name,
    actorId: member.actorId,
    profileId: member.profileId,
    name: member.name,
    initials: member.initials,
    avatarUrl: member.avatarUrl ?? null,
    listMember: true,
  };
}

const isDemoId = (id: string) => id.startsWith("p-");

/**
 * Merge the globally assignable people with a List's members into one
 * de-duplicated roster. The same human can show up under a profile id (List
 * members), an actor id (assignment RPCs) and a demo id; assignment RPCs only
 * accept actor ids, so an entry that already carries one always wins. Members
 * who are not in the assignable set stay in the roster (id = profile id) and
 * are resolved to an actor id at assignment time.
 */
export function mergeAssignablePeople(assignable: Person[], members: Person[] = []): Person[] {
  const rank = (p: Person) => (p.actorId ? 3 : isDemoId(p.id) ? 0 : 1);
  const byKey = new Map<string, Person>();
  const keyFor = (p: Person) => p.name.trim().toLowerCase() || p.id.toLowerCase();
  for (const person of [...assignable, ...members]) {
    const key = keyFor(person);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, person);
      continue;
    }
    const winner = rank(person) > rank(existing) ? person : existing;
    const other = winner === person ? existing : person;
    byKey.set(key, {
      ...winner,
      profileId: winner.profileId ?? other.profileId,
      actorId: winner.actorId ?? other.actorId,
      avatarUrl: winner.avatarUrl ?? other.avatarUrl,
      listMember: winner.listMember || other.listMember || undefined,
    });
  }
  return [...byKey.values()];
}
