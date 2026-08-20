import type { Importance, Person } from "@/domain/thing";

export type TossChip = { kind: "assignee" | "due" | "importance" | "unresolved"; label: string; value: string };

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
  dueAt?: string;
  dueHasTime?: boolean;
} {
  let title = raw.trim();
  const chips: TossChip[] = [];
  let importance: Importance = "next";
  let assigneeId: string | undefined;

  const mention = title.match(/@([A-Za-z][\w.-]*)/);
  if (mention) {
    const needle = mention[1].toLowerCase();
    const hits = people.filter((p) => p.name.toLowerCase().startsWith(needle) || p.name.toLowerCase().includes(needle));
    if (hits.length === 1) {
      chips.push({ kind: "assignee", label: hits[0]!.name, value: hits[0]!.id });
      assigneeId = hits[0]!.id;
    } else {
      chips.push({ kind: "unresolved", label: `Who is @${mention[1]}?`, value: "person" });
    }
    title = title.replace(mention[0], "").trim();
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

  return { title: title || raw.trim(), chips, importance, assigneeId, dueAt, dueHasTime };
}

export function tossBlockedByPerson(chips: TossChip[]): boolean {
  return chips.some((c) => c.kind === "unresolved" && c.value === "person");
}
