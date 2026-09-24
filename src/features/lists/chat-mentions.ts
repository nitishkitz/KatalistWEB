export type SelectedMention = { id: string; label: string; start: number; end: number };

/** Preserve selected UUIDs across edits outside their token; drop edited tokens. */
export function reconcileMentions(previous: string, next: string, mentions: SelectedMention[]): SelectedMention[] {
  let prefix = 0;
  while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix++;
  let suffix = 0;
  while (suffix < previous.length - prefix && suffix < next.length - prefix &&
         previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix++;
  const oldEnd = previous.length - suffix;
  const shift = next.length - previous.length;
  return mentions.flatMap((mention) => {
    if (mention.end <= prefix) return [mention];
    if (mention.start >= oldEnd) return [{ ...mention, start: mention.start + shift, end: mention.end + shift }];
    return [];
  }).filter((mention) => next.slice(mention.start, mention.end) === mention.label);
}
