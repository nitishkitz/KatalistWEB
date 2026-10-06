export type TextSegment = { kind: "text"; text: string } | { kind: "link"; text: string; href: string };

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
const TRAILING = /[),.;:!?'"\]}]+$/;

/** Turn a matched URL-ish string into a safe absolute http(s) href, or null. */
export function toSafeHref(candidate: string): string | null {
  const withScheme = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Split text into plain and link segments; trailing punctuation stays outside the link. */
export function splitLinks(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const raw = match[0];
    const start = match.index ?? 0;
    const trimmed = raw.replace(TRAILING, "");
    const href = toSafeHref(trimmed);
    if (!href) continue;
    if (start > last) segments.push({ kind: "text", text: text.slice(last, start) });
    segments.push({ kind: "link", text: trimmed, href });
    last = start + trimmed.length;
  }
  if (last < text.length) segments.push({ kind: "text", text: text.slice(last) });
  return segments;
}

/** Unique link hrefs in order of appearance. */
export function extractLinks(...texts: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const segment of splitLinks(text)) if (segment.kind === "link") seen.add(segment.href);
  }
  return [...seen];
}
