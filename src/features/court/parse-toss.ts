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
    // Prefer an entry that already carries a resolved actor id (assignment
    // RPCs reject profile ids), then any non-demo id over a demo `p-` id.
    const better =
      (!existing.actorId && Boolean(p.actorId)) ||
      (existing.id.startsWith("p-") && !p.id.startsWith("p-") && !existing.actorId);
    if (better) byName.set(key, p);
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
  const key = token.toLowerCase().replace(/^(?:this|next|coming)\s+/, "");
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

const MONTHS: Record<string, number> = {
  january: 0, jan: 0,
  february: 1, feb: 1,
  march: 2, mar: 2,
  april: 3, apr: 3,
  may: 4,
  june: 5, jun: 5,
  july: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sept: 8, sep: 8,
  october: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11,
};
const MONTH_PATTERN = "january|february|march|april|may|june|july|august|september|sept|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec";

function endOfMonthDue(year: number, month: number, time: string | undefined, now: Date) {
  const due = new Date(now);
  due.setFullYear(year, month + 1, 0);
  due.setHours(22, 0, 0, 0);
  return withTime(due, time);
}

function calendarPeriodDue(kind: "month" | "year", offset: number, now: Date) {
  if (kind === "year") return endOfMonthDue(now.getFullYear() + offset, 11, undefined, now);
  const target = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  return endOfMonthDue(target.getFullYear(), target.getMonth(), undefined, now);
}

function dueFromCalendarDate(monthToken: string, dayToken: string | undefined, yearToken: string | undefined, time: string | undefined, now: Date) {
  const month = MONTHS[monthToken.toLowerCase()];
  if (month === undefined) return null;

  if (!dayToken) {
    const requestedYear = yearToken ? Number(yearToken) : undefined;
    if (requestedYear !== undefined) return endOfMonthDue(requestedYear, month, time, now);
    const year = month < now.getMonth() ? now.getFullYear() + 1 : now.getFullYear();
    return endOfMonthDue(year, month, time, now);
  }

  const day = Number(dayToken.replace(/(?:st|nd|rd|th)$/i, ""));
  let year = yearToken ? Number(yearToken) : now.getFullYear();
  const due = new Date(now);
  due.setFullYear(year, month, day);
  // Reject impossible dates (e.g. February 31) instead of silently rolling forward.
  if (due.getMonth() !== month || due.getDate() !== day) return null;
  due.setHours(22, 0, 0, 0);
  if (!yearToken && due.getTime() < now.getTime()) {
    year += 1;
    due.setFullYear(year, month, day);
  }
  return withTime(due, time);
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
  { importance: "next", regex: /\b(?!(?:next\s+(?:month|year|yr)\b))(?:when (?:i'm|i am) done with this|up next|after this|next|soon)\b/i },
];

const URL_OPEN = "\uE000";
const URL_CLOSE = "\uE001";
const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
const URL_PLACEHOLDER = new RegExp(`${URL_OPEN}(\\d+)${URL_CLOSE}`, "g");

/** Trim and force a scheme so the URL is always a valid, clickable absolute link. */
export function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withScheme).toString();
  } catch {
    return withScheme;
  }
}

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
  // URLs are lifted out before any @/#// token or date parsing runs, so the
  // slashes, dots and path segments inside a link are never read as a bucket,
  // List or date. They are restored verbatim (minus trailing punctuation) at the end.
  const urls: string[] = [];
  let title = raw.trim().replace(URL_PATTERN, (match) => {
    const url = match.replace(/[),.;:!?'"]+$/, "");
    urls.push(normalizeUrl(url));
    return `${URL_OPEN}${urls.length - 1}${URL_CLOSE}${match.slice(url.length)}`;
  });
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

  const dateMatch = title.match(new RegExp(
    `\\b(?:(?:by|on|before|until)\\s+)?(today|tomorrow|(?:(?:this|next|coming)\\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))(?:\\s+at\\s+(\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?))?\\b|` +
    `\\b((?:(?:by|in|before|until)\\s+)?(?:(?:this|next)\\s+)?(?:the\\s+)?(${MONTH_PATTERN})\\s+(\\d{1,2}(?:st|nd|rd|th)?)(?:,?\\s+(\\d{4}))?(?:\\s+at\\s+(\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?))?)\\b|` +
    `\\b((?:(?:by|in|before|until)\\s+)?(?:(?:this|next)\\s+)?(?:the\\s+)?(\\d{1,2}(?:st|nd|rd|th)?)\\s+(?:of\\s+)?(${MONTH_PATTERN})(?:,?\\s+(\\d{4}))?(?:\\s+at\\s+(\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?))?)\\b|` +
    `\\b((?:by\\s+)?(?:this|next)\\s+(month|year|yr))\\b`,
    "i",
  ));
  let dueAt: string | undefined;
  let dueHasTime: boolean | undefined;
  if (dateMatch) {
    const phrase = dateMatch[0];
    let parsedDue: { dueAt: string; dueHasTime: boolean } | null = null;
    if (dateMatch[1]) {
      parsedDue = dueFromToken(dateMatch[1], dateMatch[2], now);
    } else if (dateMatch[3]) {
      parsedDue = dueFromCalendarDate(dateMatch[4]!, dateMatch[5], dateMatch[6], dateMatch[7], now);
    } else if (dateMatch[8]) {
      parsedDue = dueFromCalendarDate(dateMatch[10]!, dateMatch[9], dateMatch[11], dateMatch[12], now);
    } else if (dateMatch[13]) {
      const kind = dateMatch[14]?.toLowerCase() === "month" ? "month" : "year";
      parsedDue = calendarPeriodDue(kind, dateMatch[13].toLowerCase().includes("next") ? 1 : 0, now);
    }

    if (parsedDue) {
      chips.push({ kind: "due", label: phrase, value: phrase });
      title = title.replace(phrase, "").trim();
      dueAt = parsedDue.dueAt;
      dueHasTime = parsedDue.dueHasTime;
    } else {
      chips.push({ kind: "unresolved", label: "Check date", value: "ambiguous" });
    }
  }

  // A connector left dangling by a removed due phrase ("finish this by") reads as a broken title.
  title = title.replace(/\s+(?:by|before|until|due)\s*$/i, "").trim();

  if (/\b\d{1,2}\/\d{1,2}\b/.test(raw.replace(URL_PATTERN, "")) && !dateMatch) {
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

  const restoreUrls = (text: string) => text.replace(URL_PLACEHOLDER, (_m, i: string) => urls[Number(i)] ?? "");
  title = restoreUrls(title);

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
