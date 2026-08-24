import type { Importance, Person } from "@/domain/thing";
import { defaultTimeZone } from "./magic-box/date-time";
import { uniquePersonMatch } from "./magic-box/mention";
import { parseMagicBoxText } from "./magic-box/parser";

export type TossChip = { kind: "assignee" | "due" | "importance" | "unresolved"; label: string; value: string };

/** Compatibility wrapper around Magic Box v2 parser. Remove after call sites migrate. */
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
  const parsed = parseMagicBoxText(raw, { now: new Date(), timeZone: defaultTimeZone() });
  const chips: TossChip[] = [];
  let assigneeId: string | undefined;
  const mention = parsed.mentionTokens[0];
  if (mention) {
    const unique = uniquePersonMatch(mention.query, people);
    if (unique) {
      chips.push({ kind: "assignee", label: unique.name, value: unique.id });
      assigneeId = unique.id;
    } else {
      chips.push({ kind: "unresolved", label: `Who is @${mention.query}?`, value: "person" });
    }
  }
  chips.push({
    kind: "importance",
    label: parsed.ownerImportance.toUpperCase(),
    value: parsed.ownerImportance,
  });
  if (parsed.due.status === "resolved") {
    chips.push({ kind: "due", label: parsed.due.label, value: parsed.due.dueAt });
  } else if (parsed.due.status === "ambiguous") {
    chips.push({ kind: "unresolved", label: "Check date", value: "ambiguous" });
  }
  return {
    title: parsed.derivedTitle || raw.trim(),
    chips,
    importance: parsed.ownerImportance,
    assigneeId,
    dueAt: parsed.due.status === "resolved" ? parsed.due.dueAt : undefined,
    dueHasTime: parsed.due.status === "resolved" ? parsed.due.dueHasTime : undefined,
  };
}

export function tossBlockedByPerson(chips: TossChip[]): boolean {
  return chips.some((c) => c.kind === "unresolved" && c.value === "person");
}
