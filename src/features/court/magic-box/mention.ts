import type { Person } from "@/domain/thing";
import type { MentionQuery, ResolvedMention } from "./types";

const MENTION_TOKEN = /@([^\s@]*)/g;

export function findMentionTokens(text: string): MentionQuery[] {
  const out: MentionQuery[] = [];
  const re = new RegExp(MENTION_TOKEN.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const start = match.index;
    const query = match[1] ?? "";
    out.push({ start, end: start + match[0].length, query });
  }
  return out;
}

/** Active @token containing the caret. Caret at the end of the token still counts. */
export function findActiveMention(text: string, caret: number): MentionQuery | null {
  const safeCaret = Math.max(0, Math.min(caret, text.length));
  const tokens = findMentionTokens(text);
  for (const token of tokens) {
    if (safeCaret >= token.start + 1 && safeCaret <= token.end) return token;
  }
  return null;
}

export function replaceMention(
  text: string,
  mention: MentionQuery,
  person: Person,
): { text: string; caret: number; binding: ResolvedMention } {
  const inserted = `@${person.name}`;
  const next = `${text.slice(0, mention.start)}${inserted}${text.slice(mention.end)}`;
  const end = mention.start + inserted.length;
  return {
    text: next,
    caret: end,
    binding: {
      actorId: person.id,
      displayName: person.name,
      start: mention.start,
      end,
    },
  };
}

export function bindingStillValid(text: string, binding: ResolvedMention | null): boolean {
  if (!binding) return false;
  if (binding.start < 0 || binding.end > text.length || binding.end < binding.start) return false;
  const slice = text.slice(binding.start, binding.end);
  return slice === `@${binding.displayName}`;
}

export function ghostSuffix(query: string, displayName: string): string {
  const q = query;
  if (!q) return displayName;
  const lower = displayName.toLowerCase();
  const ql = q.toLowerCase();
  if (lower.startsWith(ql)) return displayName.slice(q.length);
  const words = displayName.split(/\s+/);
  for (const word of words) {
    if (word.toLowerCase().startsWith(ql)) {
      const idx = displayName.toLowerCase().indexOf(word.toLowerCase());
      if (idx >= 0) return displayName.slice(idx + q.length);
    }
  }
  return "";
}

export function uniquePersonMatch(query: string, people: Person[]): Person | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const hits = people.filter((p) => {
    const n = p.name.toLowerCase();
    return n === q || n.startsWith(q) || n.includes(q) || n.split(/\s+/).some((w) => w.startsWith(q));
  });
  return hits.length === 1 ? hits[0]! : null;
}

export function mentionOptionId(composerId: string, personId: string) {
  return `${composerId}-option-${personId}`;
}
