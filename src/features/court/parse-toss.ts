import type { Importance, Person } from "@/domain/thing";
import { parseTossDue, type TossDueChoice } from "./parse-toss-due";

export type TossChip = {
  kind: "assignee" | "due" | "importance" | "list" | "bucket" | "suggestion" | "unresolved";
  label: string;
  value: string;
};

const COMMON_STOP_WORDS = new Set([
  "the", "for", "and", "with", "from", "now", "next", "later", "today", "tomorrow",
  "this", "that", "get", "got", "send", "call", "talk", "chat", "meet", "meeting",
  "review", "reviewed", "reviewing", "check", "checked", "discuss", "discussed",
  "deck", "card", "task", "item", "work", "home", "into", "onto", "about", "have", "need",
  "please", "kindly", "can", "could", "you", "we", "help", "remind", "remember", "update", "fix",
  "docs", "documents", "files", "ready", "done", "all", "your", "my", "our"
]);

function oneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length >= b.length) i++;
    if (b.length >= a.length) j++;
  }
  return edits + Number(i < a.length || j < b.length) <= 1;
}

export function findFuzzyPersonMatch(
  text: string,
  people: Person[],
): { person: Person; matchedWord: string } | null {
  const suggestion = findPersonSuggestions(text, people);
  return suggestion?.people.length === 1 ? { person: suggestion.people[0]!, matchedWord: suggestion.matchedWord } : null;
}

function findPersonSuggestions(text: string, people: Person[]): { people: Person[]; matchedWord: string } | null {
  const tokens = text.match(/[A-Za-z0-9_.-]+/g) ?? [];

  for (const token of tokens) {
    const clean = token.toLowerCase().replace(/^[@#/]/, "").trim();
    if (clean.length < 3 || COMMON_STOP_WORDS.has(clean)) continue;

    const exact = people.filter((p) => clean === p.name.split(" ")[0].toLowerCase() || clean === p.name.toLowerCase());
    if (exact.length) return { people: dedupePeopleByName(exact), matchedWord: token };
    const prefix = people.filter((p) => {
      const firstName = p.name.split(" ")[0].toLowerCase();
      // Strong prefix match only: the typed word is a near-complete prefix of the
      // first name (e.g. "priy" -> "priya"). Requires 4+ chars and covers most of
      // the name, so ordinary words no longer trigger a suggestion.
      return (
        clean.length >= 4 &&
        firstName.length >= 4 &&
        firstName.startsWith(clean) &&
        clean.length >= firstName.length - 2
      );
    });
    if (prefix.length) return { people: dedupePeopleByName(prefix), matchedWord: token };
    const near = people.filter(p => {
      const first = p.name.split(" ")[0].toLowerCase();
      return clean.length >= 4 && first.length >= 4 && oneEditApart(clean, first);
    });
    if (near.length) return { people: dedupePeopleByName(near), matchedWord: token };
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
  needle = needle.replace(/\./g, " ");
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
  suggestedPeople?: { people: Person[]; matchedWord: string };
  unmatchedPerson?: { name: string; matchedWord: string };
  clarificationMessage?: string;
  dueChoices?: TossDueChoice[];
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
  let suggestedPeople: { people: Person[]; matchedWord: string } | undefined;
  let unmatchedPerson: { name: string; matchedWord: string } | undefined;
  let clarificationMessage: string | undefined;
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
      clarificationMessage ??= hits.length
        ? `Several contacts match @${mention[1]}. Which person do you mean? Choose their full name.`
        : `I couldn't find a contact named @${mention[1]}. Choose a contact or correct the name before tossing.`;
    }
    title = title.replace(mention[0], "").trim();
  }

  // Resolve dates before pace and destination tokens: "next Friday" is a date,
  // and a trailing date must not become part of a #List or /Bucket name.
  const parsedDue = parseTossDue(title, now);
  const dueAt = parsedDue?.dueAt;
  const dueHasTime = dueAt ? true : undefined;
  if (parsedDue) {
    for (const phrase of parsedDue.phrases ?? [parsedDue.phrase]) title = title.replace(phrase, "").trim();
    if (parsedDue.phrases) title = title.replace(/\s+(?:or|and)\s*$/i, "").trim();
    if (dueAt) chips.push({ kind: "due", label: parsedDue.phrase, value: parsedDue.phrase });
    else {
      chips.push({ kind: "unresolved", label: "Check date", value: "ambiguous" });
      clarificationMessage ??= parsedDue.message;
    }
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

  // If no @mention was given, check for natural name / typo match
  if (assigneeIds.length === 0 && allMentions.length === 0) {
    const fuzzyHit = findPersonSuggestions(title, people);
    if (fuzzyHit) {
      if (fuzzyHit.people.length === 1) suggestedPerson = { person: fuzzyHit.people[0]!, matchedWord: fuzzyHit.matchedWord };
      else suggestedPeople = fuzzyHit;
      chips.push({
        kind: "suggestion",
        label: suggestedPerson ? `Assign to ${suggestedPerson.person.name}?` : `Which ${fuzzyHit.matchedWord}?`,
        value: suggestedPerson?.person.id ?? "person-candidates",
      });
    } else {
      const addressed = title.match(/^([A-Za-z]{3,}),?\s+(?:please\s+)?(?:submit|send|finish|complete|upload|share|prepare|review|check)\b/i)
        || title.match(/^(?:get|collect|send|share|submit)\b.*\b(?:docs?|documents?|files?)\s+(?:(?:for|to|from)\s+)?([A-Za-z]{3,})[.,!?]*$/i);
      if (addressed && !COMMON_STOP_WORDS.has(addressed[1]!.toLowerCase())) {
        unmatchedPerson = { name: addressed[1]!, matchedWord: addressed[1]! };
        chips.push({ kind: "suggestion", label: `Is ${addressed[1]} a contact?`, value: "person-unknown" });
      }
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

  // Only flag strong keyboard-mash evidence. Unknown words, identifiers,
  // acronyms, links and non-Latin writing are valid task descriptions.
  if (raw.trim() && !title.trim()) {
    chips.push({ kind: "unresolved", label: "Add a description", value: "content-empty" });
    clarificationMessage ??= "What would you like this person to do? Add a brief description before tossing.";
  } else if ((/^[a-z]{12,}$/i.test(title.trim()) && (!/[aeiouy]/i.test(title) || /[bcdfghjklmnpqrstvwxz]{9,}/i.test(title)))
    || (/^[a-z\s]+$/i.test(title.trim()) && title.trim().split(/\s+/).every(word =>
      word.length >= 5 && (!/^[A-Z]{1,8}$/.test(word)) && (!/[aeiouy]/i.test(word) || /[bcdfghjklmnpqrstvwxz]{5,}/i.test(word) || /^(asdf|qwerty|zxcv|hjkl)/i.test(word)),
    ))) {
    chips.push({ kind: "unresolved", label: "Clarify your message", value: "content" });
    clarificationMessage ??= "This message is unclear. Could you briefly describe what needs to be done before tossing?";
  }

  return {
    title: title.replace(/\s+/g, " ").trim(),
    chips,
    importance,
    assigneeId: assigneeIds[0],
    assigneeIds,
    dueAt,
    dueHasTime,
    suggestedPerson,
    suggestedPeople,
    unmatchedPerson,
    clarificationMessage,
    pacePhrase,
    duePhrase: parsedDue?.phrase,
    dueChoices: parsedDue?.dueChoices,
  };
}

export function tossBlockedByPerson(chips: TossChip[]): boolean {
  // A plain-text name needs an explicit assignment or "keep in title" choice.
  return chips.some((c) => c.kind === "suggestion" || (c.kind === "unresolved" && c.value === "person"));
}
