export type MentionPerson = {
  id: string;
  name: string;
  initials: string;
  avatarUrl?: string | null;
  /** Profile id when `id` is an actor id (or vice versa); used to drop yourself. */
  profileId?: string;
};

export type MentionTrigger = { start: number; query: string };

/**
 * The "@partial" being typed at the caret. The "@" must start the text or
 * follow whitespace, so an email address or a pasted handle never opens the
 * menu; whitespace after the query ends the trigger.
 */
export function findMentionTrigger(text: string, caret: number): MentionTrigger | null {
  const upTo = text.slice(0, caret);
  const match = upTo.match(/(?:^|\s)@([^\s@]*)$/);
  if (!match) return null;
  const query = match[1] ?? "";
  return { start: upTo.length - query.length - 1, query };
}

/** Name-prefix matches first, then any word prefix, then substring. Stable within a rank. */
export function filterMentionPeople(people: MentionPerson[], query: string, limit = 6): MentionPerson[] {
  const q = query.trim().toLowerCase();
  if (!q) return people.slice(0, limit);
  const ranked: Array<{ person: MentionPerson; rank: number }> = [];
  for (const person of people) {
    const name = person.name.toLowerCase();
    let rank = -1;
    if (name.startsWith(q)) rank = 0;
    else if (name.split(/\s+/).some((word) => word.startsWith(q))) rank = 1;
    else if (name.includes(q)) rank = 2;
    if (rank >= 0) ranked.push({ person, rank });
  }
  return ranked.sort((a, b) => a.rank - b.rank).slice(0, limit).map((entry) => entry.person);
}

/** Merge several sources by id, then by name, keeping the first (best) entry and any missing avatar. */
export function mergeMentionPeople(...sources: Array<MentionPerson[] | undefined>): MentionPerson[] {
  const byKey = new Map<string, MentionPerson>();
  for (const source of sources) {
    for (const person of source ?? []) {
      if (!person.id || !person.name.trim()) continue;
      const key = person.name.trim().toLowerCase();
      const existing = byKey.get(key);
      if (!existing) byKey.set(key, person);
      else if (!existing.avatarUrl && person.avatarUrl) byKey.set(key, { ...existing, avatarUrl: person.avatarUrl });
    }
  }
  return [...byKey.values()];
}
