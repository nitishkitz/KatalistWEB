import type { Importance } from "@/domain/thing";

export type ImportanceSpan = { start: number; end: number };

export type ImportancePhraseHit = ImportanceSpan & {
  importance: Importance;
  phrase: string;
  kind: "canonical" | "phrase";
};

export const IMPORTANCE_PHRASES: ReadonlyArray<{ phrase: string; importance: Importance }> = [
  { phrase: "as soon as possible", importance: "now" },
  { phrase: "when you have time", importance: "later" },
  { phrase: "in a few weeks", importance: "later" },
  { phrase: "by end of day", importance: "now" },
  { phrase: "end of day", importance: "now" },
  { phrase: "before lunch", importance: "now" },
  { phrase: "this instant", importance: "now" },
  { phrase: "right away", importance: "now" },
  { phrase: "right now", importance: "now" },
  { phrase: "low priority", importance: "later" },
  { phrase: "not urgent", importance: "later" },
  { phrase: "next month", importance: "later" },
  { phrase: "next week", importance: "later" },
  { phrase: "much later", importance: "later" },
  { phrase: "after this", importance: "next" },
  { phrase: "this week", importance: "next" },
  { phrase: "when free", importance: "later" },
  { phrase: "can wait", importance: "later" },
  { phrase: "no rush", importance: "later" },
  { phrase: "one day", importance: "later" },
  { phrase: "a.s.a.p.", importance: "now" },
  { phrase: "a.s.a.p", importance: "now" },
  { phrase: "immediately", importance: "now" },
  { phrase: "eventually", importance: "later" },
  { phrase: "emergency", importance: "now" },
  { phrase: "whenever", importance: "later" },
  { phrase: "someday", importance: "later" },
  { phrase: "shortly", importance: "next" },
  { phrase: "urgently", importance: "now" },
  { phrase: "critical", importance: "now" },
  { phrase: "backlog", importance: "later" },
  { phrase: "future", importance: "later" },
  { phrase: "urgent", importance: "now" },
  { phrase: "by eod", importance: "now" },
  { phrase: "asap", importance: "now" },
  { phrase: "soon", importance: "next" },
  { phrase: "eod", importance: "now" },
  { phrase: "!!!", importance: "now" },
];

function isWordChar(ch: string | undefined) {
  return ch != null && /[A-Za-z0-9]/.test(ch);
}

function expandTrailingPunctuation(text: string, end: number) {
  let spanEnd = end;
  while (spanEnd < text.length && /[!,.]/.test(text[spanEnd]!)) spanEnd += 1;
  return spanEnd;
}

export function findBoundedPhrase(text: string, phrase: string, from = 0): ImportanceSpan | null {
  const haystack = text.toLowerCase();
  const needle = phrase.toLowerCase();
  let searchFrom = from;
  while (searchFrom <= haystack.length - needle.length) {
    const start = haystack.indexOf(needle, searchFrom);
    if (start < 0) return null;
    const rawEnd = start + needle.length;
    const before = start === 0 ? undefined : text[start - 1];
    const after = rawEnd >= text.length ? undefined : text[rawEnd];
    if (!isWordChar(before) && !isWordChar(after)) {
      return { start, end: expandTrailingPunctuation(text, rawEnd) };
    }
    searchFrom = start + 1;
  }
  return null;
}

export function findImportancePhraseHits(text: string): ImportancePhraseHit[] {
  const hits: ImportancePhraseHit[] = [];
  for (const { phrase, importance } of IMPORTANCE_PHRASES) {
    let from = 0;
    while (from < text.length) {
      const span = findBoundedPhrase(text, phrase, from);
      if (!span) break;
      hits.push({ ...span, importance, phrase, kind: "phrase" });
      from = span.start + 1;
    }
  }
  const canonical = /\b(now|next|later)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = canonical.exec(text))) {
    const token = match[1]!.toLowerCase() as Importance;
    hits.push({
      start: match.index,
      end: match.index + match[0].length,
      importance: token,
      phrase: match[0],
      kind: "canonical",
    });
  }
  return hits;
}

function overlaps(a: ImportanceSpan, b: ImportanceSpan) {
  return a.start < b.end && a.end > b.start;
}

function contains(outer: ImportanceSpan, inner: ImportanceSpan) {
  return outer.start <= inner.start && inner.end <= outer.end;
}

function lengthOf(span: ImportanceSpan) {
  return span.end - span.start;
}

export function selectImportanceFromText(
  text: string,
  dueSpan: ImportanceSpan | null = null,
): { importance: Importance; source: "parser"; spans: ImportanceSpan[] } | null {
  const hits = findImportancePhraseHits(text);
  const phrases = hits.filter((hit) => hit.kind === "phrase");
  const canonical = hits.filter((hit) => hit.kind === "canonical");
  const standaloneCanonical = canonical.filter(
    (hit) =>
      !phrases.some((phrase) => contains(phrase, hit) && lengthOf(phrase) > lengthOf(hit)) &&
      !(dueSpan && overlaps(hit, dueSpan)),
  );
  standaloneCanonical.sort((a, b) => a.start - b.start || lengthOf(b) - lengthOf(a));
  if (standaloneCanonical[0]) {
    const selected = standaloneCanonical[0];
    return { importance: selected.importance, source: "parser", spans: [selected] };
  }

  const usablePhrases = phrases.filter((hit) => !(dueSpan && overlaps(hit, dueSpan)));
  usablePhrases.sort((a, b) => a.start - b.start || lengthOf(b) - lengthOf(a));
  if (usablePhrases[0]) {
    const selected = usablePhrases[0];
    return { importance: selected.importance, source: "parser", spans: [selected] };
  }
  return null;
}
