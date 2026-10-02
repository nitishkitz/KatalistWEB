import type { Importance, Person } from "@/domain/thing";

export type TossChip = {
  kind: "assignee" | "due" | "importance" | "list" | "bucket" | "suggestion" | "unresolved";
  label: string;
  value: string;
};

const COMMON_STOP_WORDS = new Set([
  "the", "for", "and", "with", "from", "now", "next", "later", "today", "tomorrow",
  "this", "that", "get", "got", "send", "call", "talk", "chat", "meet", "meeting",
  "review", "reviewed", "reviewing", "check", "checked", "discuss", "discussed",
  "deck", "card", "task", "item", "work", "home", "into", "onto", "about", "have", "need"
]);

export function findFuzzyPersonMatch(
  text: string,
  people: Person[],
): { person: Person; matchedWord: string } | null {
  const tokens = text.match(/[A-Za-z0-9_.-]+/g) ?? [];

  for (const token of tokens) {
    const clean = token.toLowerCase().replace(/^[@#/]/, "").trim();
    if (clean.length < 3 || COMMON_STOP_WORDS.has(clean)) continue;

    for (const p of people) {
      const firstName = p.name.split(" ")[0].toLowerCase();
      const fullName = p.name.toLowerCase();

      // Exact match on first or full name.
      if (clean === firstName || clean === fullName) {
        return { person: p, matchedWord: token };
      }

      // Strong prefix match only: the typed word is a near-complete prefix of the
      // first name (e.g. "priy" -> "priya"). Requires 4+ chars and covers most of
      // the name, so ordinary words no longer trigger a suggestion.
      if (
        clean.length >= 4 &&
        firstName.length >= 4 &&
        firstName.startsWith(clean) &&
        clean.length >= firstName.length - 2
      ) {
        return { person: p, matchedWord: token };
      }
    }
  }
  return null;
}

/**
 * Collapse directory entries that describe the same human. The @-mention
 * directory merges several sources (Court collaborators, the assignable-people
 * RPC, demo personas), so one person can appear under two different ids. Keyed
 * by name, we keep a single entry and prefer a real actor id over a demo `p-`
 * id so the resolved assignee is not filtered out before the Thing is created.
 */
function dedupePeopleByName(list: Person[]): Person[] {
  const byName = new Map<string, Person>();
  for (const p of list) {
    const key = p.name.trim().toLowerCase();
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, p);
      continue;
    }
    if (existing.id.startsWith("p-") && !p.id.startsWith("p-")) {
      byName.set(key, p);
    }
  }
  return Array.from(byName.values());
}

/**
 * Resolve an @-mention needle to the people it could refer to, most-specific
 * first: an exact first-name / full-name match wins over a prefix match, which
 * wins over a loose substring match. Duplicate entries for the same person are
 * collapsed so a directory that lists someone twice no longer reads as an
 * ambiguous "who is this?".
 */
function resolveMentionCandidates(needle: string, people: Person[]): Person[] {
  const firstNameOf = (name: string) => name.toLowerCase().split(" ")[0] ?? "";
  const exact = people.filter(
    (p) => p.name.toLowerCase() === needle || firstNameOf(p.name) === needle,
  );
  const prefix = people.filter(
    (p) => p.name.toLowerCase().startsWith(needle) || firstNameOf(p.name).startsWith(needle),
  );
  const substring = people.filter((p) => p.name.toLowerCase().includes(needle));
  const pool = exact.length ? exact : prefix.length ? prefix : substring;
  return dedupePeopleByName(pool);
}

function dueFromToken(token: string, time: string | undefined, now: Date): { dueAt: string; dueHasTime: boolean } | null {
  const day = now.getDay();
  const start = new Date(now);
  // A date without an explicit time means 10 PM local, never 9 AM in the past.
  start.setHours(22, 0, 0, 0);
  const map: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };
  const key = token.toLowerCase().replace(/^next\s+/, "");
  if (key === "today") return withTime(start, time);
  if (key === "tomorrow") {
    start.setDate(start.getDate() + 1);
    return withTime(start, time);
  }
  if (key in map) {
    const target = map[key]!;
    let delta = (target - day + 7) % 7;
    if (delta === 0) delta = 7;
    start.setDate(start.getDate() + delta);
    return withTime(start, time);
  }
  return null;
}

function withTime(date: Date, rawTime?: string) {
  if (rawTime) {
    const match = rawTime.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
    if (match) {
      let hour = Number(match[1]);
      const minute = Number(match[2] ?? 0);
      const period = match[3]?.toLowerCase();
      if (period) hour = (hour % 12) + (period === "pm" ? 12 : 0);
      if (hour < 24 && minute < 60) date.setHours(hour, minute, 0, 0);
    }
  }
  return { dueAt: date.toISOString(), dueHasTime: true };
}

const PACE_PHRASES: Array<{ importance: Importance; regex: RegExp }> = [
  { importance: "later", regex: /\b(?:no rush|not urgent|when there(?:'s| is) time|whenever|someday|eventually|later)\b/i },
  { importance: "now", regex: /\b(?:as soon as possible|right away|right now|top priority|immediately|urgently|urgent|asap|now)\b/i },
  { importance: "next", regex: /\b(?:when (?:i'm|i am) done with this|up next|after this|next|soon)\b/i },
];

export function parseToss(
  raw: string,
  people: Person[],
  now = new Date(),
): {
  title: string;
  chips: TossChip[];
  importance: Importance;
  assigneeId?: string;
  assigneeIds: string[];
  dueAt?: string;
  dueHasTime?: boolean;
  suggestedPerson?: { person: Person; matchedWord: string };
  pacePhrase?: string;
  duePhrase?: string;
} {
  let title = raw.trim();
  const chips: TossChip[] = [];
  let importance: Importance = "next";
  const assigneeIds: string[] = [];
  let suggestedPerson: { person: Person; matchedWord: string } | undefined;
  let pacePhrase: string | undefined;

  // Find all @mentions (global)
  const mentionRegex = /@([A-Za-z][\w.-]*)/g;
  const allMentions = [...title.matchAll(mentionRegex)];
  for (const mention of allMentions) {
    const needle = mention[1].toLowerCase();
    const hits = resolveMentionCandidates(needle, people);
    if (hits.length === 1) {
      const person = hits[0]!;
      if (!assigneeIds.includes(person.id)) {
        assigneeIds.push(person.id);
        chips.push({ kind: "assignee", label: person.name, value: person.id });
      }
    } else {
      chips.push({ kind: "unresolved", label: `Who is @${mention[1]}?`, value: "person" });
    }
    title = title.replace(mention[0], "").trim();
  }

  const hashMatch = title.match(/#([A-Za-z0-9_ -]+)/);
  if (hashMatch) {
    const tag = hashMatch[1].trim();
    if (tag) {
      chips.push({ kind: "list", label: `#${tag}`, value: tag });
      title = title.replace(hashMatch[0], "").trim();
    }
  }

  const slashMatch = title.match(/\/([A-Za-z0-9_ -]+)/);
  if (slashMatch) {
    const tag = slashMatch[1].trim();
    if (tag) {
      chips.push({ kind: "bucket", label: `/${tag}`, value: tag });
      title = title.replace(slashMatch[0], "").trim();
    }
  }

  for (const phrase of PACE_PHRASES) {
    const match = title.match(phrase.regex);
    if (!match) continue;
    importance = phrase.importance;
    pacePhrase = match[0];
    title = title.replace(match[0], "").trim();
    break;
  }
  chips.push({ kind: "importance", label: importance.toUpperCase(), value: importance });

  const dateMatch = title.match(/\b(?:by\s+)?(today|tomorrow|(?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))(?:\s+at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?))?\b/i);
  let dueAt: string | undefined;
  let dueHasTime: boolean | undefined;
  if (dateMatch) {
    chips.push({ kind: "due", label: dateMatch[0], value: dateMatch[0] });
    title = title.replace(dateMatch[0], "").trim();
    const parsedDue = dueFromToken(dateMatch[1], dateMatch[2], now);
    if (parsedDue) {
      dueAt = parsedDue.dueAt;
      dueHasTime = parsedDue.dueHasTime;
    }
  }

  if (/\b\d{1,2}\/\d{1,2}\b/.test(raw) && !dateMatch) {
    chips.push({ kind: "unresolved", label: "Check date", value: "ambiguous" });
  }

  // If no @mention was given, check for natural name / typo match
  if (assigneeIds.length === 0 && allMentions.length === 0) {
    const fuzzyHit = findFuzzyPersonMatch(title, people);
    if (fuzzyHit) {
      suggestedPerson = fuzzyHit;
      chips.push({
        kind: "suggestion",
        label: `Assign to ${fuzzyHit.person.name.split(" ")[0]}?`,
        value: fuzzyHit.person.id,
      });
    }
  }

  // Add multi-toss preview chip when more than one assignee
  if (assigneeIds.length > 1) {
    chips.push({
      kind: "importance",
      label: `${assigneeIds.length} Things`,
      value: "multi",
    });
  }

  return {
    title: title.replace(/\s+/g, " ").trim() || raw.trim(),
    chips,
    importance,
    assigneeId: assigneeIds[0],
    assigneeIds,
    dueAt,
    dueHasTime,
    suggestedPerson,
    pacePhrase,
    duePhrase: dateMatch?.[0],
  };
}

export function tossBlockedByPerson(chips: TossChip[]): boolean {
  // Only block on an unresolved @mention. A fuzzy-name suggestion is a soft hint
  // — the user can toss without dismissing it.
  return chips.some((c) => c.kind === "unresolved" && c.value === "person");
}
