import type { Importance, Person } from "@/domain/thing";

export type TossChip = {
  kind: "assignee" | "due" | "importance" | "list" | "bucket" | "suggestion" | "unresolved";
  label: string;
  value: string;
};

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

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

      // Exact match
      if (clean === firstName || clean === fullName) {
        return { person: p, matchedWord: token };
      }

      // Prefix match (e.g. "priy" -> "priya", "arju" -> "arjun")
      if (clean.length >= 3 && (firstName.startsWith(clean) || clean.startsWith(firstName))) {
        return { person: p, matchedWord: token };
      }

      // Typo distance 1 (e.g. "roht" -> "rohit", "ohit" -> "rohit")
      if (firstName.length >= 3 && Math.abs(clean.length - firstName.length) <= 1) {
        const dist = levenshteinDistance(clean, firstName);
        if (dist === 1) {
          return { person: p, matchedWord: token };
        }
      }
    }
  }
  return null;
}

function dueFromToken(token: string): { dueAt: string; dueHasTime: boolean } | null {
  const now = new Date();
  const day = now.getDay();
  const start = new Date(now);
  start.setHours(9, 0, 0, 0);
  const map: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };
  const key = token.toLowerCase();
  if (key === "today") return { dueAt: start.toISOString(), dueHasTime: false };
  if (key === "tomorrow") {
    start.setDate(start.getDate() + 1);
    return { dueAt: start.toISOString(), dueHasTime: false };
  }
  if (key in map) {
    const target = map[key]!;
    let delta = (target - day + 7) % 7;
    if (delta === 0) delta = 7;
    start.setDate(start.getDate() + delta);
    return { dueAt: start.toISOString(), dueHasTime: false };
  }
  return null;
}

export function parseToss(
  raw: string,
  people: Person[],
): {
  title: string;
  chips: TossChip[];
  importance: Importance;
  assigneeId?: string;
  assigneeIds: string[];
  dueAt?: string;
  dueHasTime?: boolean;
  suggestedPerson?: { person: Person; matchedWord: string };
} {
  let title = raw.trim();
  const chips: TossChip[] = [];
  let importance: Importance = "next";
  const assigneeIds: string[] = [];
  let suggestedPerson: { person: Person; matchedWord: string } | undefined;

  // Find all @mentions (global)
  const mentionRegex = /@([A-Za-z][\w.-]*)/g;
  const allMentions = [...title.matchAll(mentionRegex)];
  for (const mention of allMentions) {
    const needle = mention[1].toLowerCase();
    const hits = people.filter(
      (p) => p.name.toLowerCase().startsWith(needle) || p.name.toLowerCase().includes(needle),
    );
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

  if (/\bnow\b/i.test(title)) {
    importance = "now";
    chips.push({ kind: "importance", label: "NOW", value: "now" });
    title = title.replace(/\bnow\b/i, "").trim();
  } else if (/\blater\b/i.test(title)) {
    importance = "later";
    chips.push({ kind: "importance", label: "LATER", value: "later" });
    title = title.replace(/\blater\b/i, "").trim();
  } else {
    chips.push({ kind: "importance", label: "NEXT", value: "next" });
  }

  const dateMatch = title.match(/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday)\b/i);
  let dueAt: string | undefined;
  let dueHasTime: boolean | undefined;
  if (dateMatch) {
    chips.push({ kind: "due", label: dateMatch[1], value: dateMatch[1] });
    title = title.replace(dateMatch[0], "").trim();
    const parsedDue = dueFromToken(dateMatch[1]);
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
    title: title || raw.trim(),
    chips,
    importance,
    assigneeId: assigneeIds[0],
    assigneeIds,
    dueAt,
    dueHasTime,
    suggestedPerson,
  };
}

export function tossBlockedByPerson(chips: TossChip[]): boolean {
  // Block if there's an unresolved @mention OR an unconfirmed fuzzy-name suggestion
  return chips.some(
    (c) => (c.kind === "unresolved" && c.value === "person") || c.kind === "suggestion",
  );
}
