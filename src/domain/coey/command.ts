/**
 * An instruction to Coey about an EXISTING Thing ("sort the electricity bill",
 * "snooze pay the electricity bill for 6 hours", "move the deck to later").
 * Grounded, not guessed: it must start with a Coey verb AND name a Thing the
 * person already has. New work ("Mark the register by Friday") stays a Toss.
 */
const VERB = /^\s*(?:please\s+|pls\s+|coey,?\s+)?(nudge|chase|catch|sort|snooze|unsnooze|move|shift|mark|promise|reassign|comment on|summari[sz]e|open|show me)\b/i;
const STOP = new Set(["the", "a", "an", "to", "for", "my", "me", "it", "this", "that", "thing", "things", "about", "on", "of", "and", "with", "till", "until", "by", "in", "at",
  "now", "next", "later", "sorted", "done", "complete", "completed", "hours", "hour", "tomorrow", "today", "please", "pls", "coey"]);
const words = (s: string) => (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length >= 3 && !STOP.has(w));

export function isCoeyCommand(line: string, titles: readonly string[]): boolean {
  const m = VERB.exec(line);
  if (!m) return false;
  const verb = m[1]!.toLowerCase();
  const rest = line.slice(m[0].length);
  if (verb === "mark" && !/\b(sorted|done|complete[d]?)\b/i.test(rest)) return false;
  if ((verb === "move" || verb === "shift") && !/\bto\s+(now|next|later)\b/i.test(rest)) return false;
  const said = words(rest);
  if (!said.length) return false;
  // Most of the named words must belong to one existing Thing title.
  return titles.some((title) => {
    const have = new Set(words(title));
    const hits = said.filter((w) => have.has(w)).length;
    return hits >= 1 && hits / said.length >= 0.6;
  });
}
