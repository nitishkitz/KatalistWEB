const MENTION = /@[^\s@]+/g;
const URLS = /https?:\/\/[^\s]+/gi;
const TIME = /\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/gi;
const NUMERIC = /\b\d+(?:[./:-]\d+)+\b|\b\d+\b/g;
const QUOTED = /"([^"]+)"/g;
const FILE = /\b[\w.-]+\.[A-Za-z]{2,4}\b/g;

export function extractProtectedTokens(text: string): string[] {
  const out: string[] = [];
  const push = (items: Iterable<string>) => {
    for (const item of items) {
      if (item && !out.includes(item)) out.push(item);
    }
  };
  push(text.match(MENTION) ?? []);
  push(text.match(URLS) ?? []);
  push(text.match(TIME) ?? []);
  push(text.match(NUMERIC) ?? []);
  push([...text.matchAll(QUOTED)].map((m) => m[1] ?? m[0]));
  push(text.match(FILE) ?? []);
  return out;
}

export function correctionPreservesTokens(source: string, corrected: string): boolean {
  return extractProtectedTokens(source).every((token) => corrected.includes(token));
}
