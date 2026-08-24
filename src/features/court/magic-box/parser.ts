import type { Importance } from "@/domain/thing";
import {
  applyPeriod,
  formatDueLabel,
  fromZonedLocal,
  isoFromDate,
  parseClock,
  resolveWeekday,
  withClock,
  zonedParts,
  type PeriodName,
  type WeekdayModifier,
} from "./date-time";
import { findMentionTokens } from "./mention";
import type { DueResolution, MagicBoxFieldSource, ParsedMagicBoxText } from "./types";

export type ParseMagicBoxOptions = {
  now: Date;
  timeZone: string;
  manualImportance?: Importance | null;
  manualDue?: { dueAt: string; dueHasTime: boolean; label: string } | null;
};

type Span = { start: number; end: number };

const WEEKDAYS = "monday|tuesday|wednesday|thursday|friday|saturday|sunday";
const PERIOD = "morning|afternoon|evening|tonight|noon|night";
const TIME =
  "(?:(?:at\\s+)?(?:\\d{1,2}:\\d{2}|\\d{1,2})\\s*(?:a\\.?m\\.?|p\\.?m\\.?)|\\d{1,2}:\\d{2}|(?:at\\s+)\\d{1,2}(?!\\d))";

function pushSpan(spans: Span[], start: number, end: number) {
  spans.push({ start, end });
}

function stripSpans(text: string, spans: Span[]): string {
  if (spans.length === 0) return text;
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const merged: Span[] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  let out = "";
  let cursor = 0;
  for (const span of merged) {
    out += text.slice(cursor, span.start);
    cursor = span.end;
  }
  out += text.slice(cursor);
  return out.replace(/\s+/g, " ").trim();
}

function detectImportance(text: string): { importance: Importance; source: MagicBoxFieldSource; spans: Span[] } {
  const bang = /!!!/.exec(text);
  if (bang && bang.index != null) {
    return { importance: "now", source: "parser", spans: [{ start: bang.index, end: bang.index + 3 }] };
  }
  const re = /\b(now|next|later)\b/gi;
  const match = re.exec(text);
  if (!match || match.index == null) return { importance: "next", source: "default", spans: [] };
  const token = match[1]!.toLowerCase() as Importance;
  return {
    importance: token,
    source: "parser",
    spans: [{ start: match.index, end: match.index + match[0].length }],
  };
}

function detectPeriod(fragment: string): PeriodName | null {
  const s = fragment.toLowerCase();
  if (/\btonight\b/.test(s)) return "tonight";
  if (/\bnoon\b/.test(s)) return "noon";
  if (/\bmorning\b/.test(s)) return "morning";
  if (/\bafternoon\b/.test(s)) return "afternoon";
  if (/\bevening\b/.test(s)) return "evening";
  if (/\bnight\b/.test(s)) return "night";
  return null;
}

function dueResolved(date: Date, hasTime: boolean, timeZone: string, source: MagicBoxFieldSource): DueResolution {
  const parts = zonedParts(date, timeZone);
  return {
    status: "resolved",
    dueAt: isoFromDate(date),
    dueHasTime: hasTime,
    label: formatDueLabel(parts, hasTime),
    source,
  };
}

function applyTimeOrPeriod(
  date: Date,
  timeRaw: string | undefined,
  timeZone: string,
): { date: Date; hasTime: boolean } {
  if (!timeRaw) return { date, hasTime: false };
  const period = detectPeriod(timeRaw);
  if (period) return { date: applyPeriod(date, period, timeZone), hasTime: true };
  if (/\b(?:eod|end of day)\b/i.test(timeRaw)) {
    return { date: applyPeriod(date, "eod", timeZone), hasTime: true };
  }
  const clock = parseClock(timeRaw);
  if (clock) return { date: withClock(date, clock, timeZone), hasTime: true };
  return { date, hasTime: false };
}

type DateHit = { due: DueResolution; span: Span };

function firstHit(text: string, builders: Array<() => DateHit | null>): DateHit | null {
  const hits: DateHit[] = [];
  for (const build of builders) {
    const hit = build();
    if (hit) hits.push(hit);
  }
  hits.sort((a, b) => a.span.start - b.span.start || b.span.end - b.span.start - (a.span.end - a.span.start));
  return hits[0] ?? null;
}

function detectDue(text: string, now: Date, timeZone: string): DateHit | null {
  const parts = zonedParts(now, timeZone);

  return firstHit(text, [
    () => {
      const re = /\b(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?\b/g;
      const m = re.exec(text);
      if (!m || m.index == null) return null;
      const [year, month, day] = m[1]!.split("-").map(Number);
      const clock = m[2] ? parseClock(m[2]) : null;
      const date = fromZonedLocal(year!, month!, day!, clock?.hour ?? 9, clock?.minute ?? 0, timeZone);
      return {
        due: dueResolved(date, Boolean(clock), timeZone, "parser"),
        span: { start: m.index, end: m.index + m[0].length },
      };
    },
    () => {
      const re = /\bin\s+(\d+)\s+(minutes?|mins?|hours?|hrs?|days?|weeks?)\b/gi;
      const m = re.exec(text);
      if (!m || m.index == null) return null;
      const n = Number(m[1]);
      if (!Number.isFinite(n) || n < 0) return null;
      const unit = m[2]!.toLowerCase();
      const date = new Date(now.getTime());
      const hasTime = true;
      if (unit.startsWith("min")) date.setUTCMinutes(date.getUTCMinutes() + n);
      else if (unit.startsWith("hour") || unit.startsWith("hr")) date.setUTCHours(date.getUTCHours() + n);
      else if (unit.startsWith("day")) {
        const shifted = fromZonedLocal(parts.year, parts.month, parts.day + n, 9, 0, timeZone);
        return {
          due: dueResolved(shifted, false, timeZone, "parser"),
          span: { start: m.index, end: m.index + m[0].length },
        };
      } else {
        const shifted = fromZonedLocal(parts.year, parts.month, parts.day + n * 7, 9, 0, timeZone);
        return {
          due: dueResolved(shifted, false, timeZone, "parser"),
          span: { start: m.index, end: m.index + m[0].length },
        };
      }
      return {
        due: dueResolved(date, hasTime, timeZone, "parser"),
        span: { start: m.index, end: m.index + m[0].length },
      };
    },
    () => {
      const re = new RegExp(`\\bday after tomorrow\\b(?:\\s+(${PERIOD}|${TIME}|eod|end of day))?`, "gi");
      const m = re.exec(text);
      if (!m || m.index == null) return null;
      const base = fromZonedLocal(parts.year, parts.month, parts.day + 2, 9, 0, timeZone);
      const applied = applyTimeOrPeriod(base, m[1], timeZone);
      return {
        due: dueResolved(applied.date, applied.hasTime, timeZone, "parser"),
        span: { start: m.index, end: m.index + m[0].length },
      };
    },
    () => {
      const re = new RegExp(`\\b(today|tomorrow)\\b(?:\\s+(${PERIOD}|${TIME}|eod|end of day))?`, "gi");
      const m = re.exec(text);
      if (!m || m.index == null) return null;
      const delta = m[1]!.toLowerCase() === "today" ? 0 : 1;
      const base = fromZonedLocal(parts.year, parts.month, parts.day + delta, 9, 0, timeZone);
      const applied = applyTimeOrPeriod(base, m[2], timeZone);
      return {
        due: dueResolved(applied.date, applied.hasTime, timeZone, "parser"),
        span: { start: m.index, end: m.index + m[0].length },
      };
    },
    () => {
      const re = new RegExp(
        `\\b(?:(this|next)\\s+)?(${WEEKDAYS})\\b(?:\\s+(${PERIOD}|${TIME}|eod|end of day))?`,
        "gi",
      );
      const m = re.exec(text);
      if (!m || m.index == null) return null;
      const modifier = (m[1] ? m[1].toLowerCase() : "bare") as WeekdayModifier;
      const resolved = resolveWeekday(m[2]!, modifier, now, timeZone);
      if (resolved.status === "ambiguous") {
        return {
          due: { status: "ambiguous", raw: resolved.raw, label: "Check date" },
          span: { start: m.index, end: m.index + m[0].length },
        };
      }
      const applied = applyTimeOrPeriod(resolved.date, m[3], timeZone);
      return {
        due: dueResolved(applied.date, applied.hasTime, timeZone, "parser"),
        span: { start: m.index, end: m.index + m[0].length },
      };
    },
    () => {
      const re = /\b(tonight|(?:this\s+)?(?:morning|afternoon|evening)|noon|eod|end of day)\b/gi;
      const m = re.exec(text);
      if (!m || m.index == null) return null;
      const token = m[1]!.toLowerCase();
      const period: PeriodName =
        token.includes("morning")
          ? "morning"
          : token.includes("afternoon")
            ? "afternoon"
            : token.includes("evening")
              ? "evening"
              : token === "noon"
                ? "noon"
                : token === "tonight"
                  ? "tonight"
                  : "eod";
      const base = fromZonedLocal(parts.year, parts.month, parts.day, 9, 0, timeZone);
      const date = applyPeriod(base, period, timeZone);
      return {
        due: dueResolved(date, true, timeZone, "parser"),
        span: { start: m.index, end: m.index + m[0].length },
      };
    },
    () => {
      const re = new RegExp(`\\b(${TIME})\\b`, "gi");
      const m = re.exec(text);
      if (!m || m.index == null) return null;
      if (/\d{1,2}\/\d{1,2}/.test(m[0])) return null;
      const clock = parseClock(m[0]);
      if (!clock) return null;
      const date = fromZonedLocal(parts.year, parts.month, parts.day, clock.hour, clock.minute, timeZone);
      return {
        due: dueResolved(date, true, timeZone, "parser"),
        span: { start: m.index, end: m.index + m[0].length },
      };
    },
    () => {
      const re = /\b(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?\b/g;
      const m = re.exec(text);
      if (!m || m.index == null) return null;
      return {
        due: { status: "ambiguous", raw: m[0], label: "Check date" },
        span: { start: m.index, end: m.index + m[0].length },
      };
    },
  ]);
}

export function parseMagicBoxText(rawText: string, options: ParseMagicBoxOptions): ParsedMagicBoxText {
  const timeZone = options.timeZone;
  const now = options.now;
  const mentionTokens = findMentionTokens(rawText);
  const spans: Span[] = mentionTokens.map((t) => ({ start: t.start, end: t.end }));

  let ownerImportance: Importance = "next";
  let importanceSource: MagicBoxFieldSource = "default";
  if (options.manualImportance) {
    ownerImportance = options.manualImportance;
    importanceSource = "manual";
  } else {
    const detected = detectImportance(rawText);
    ownerImportance = detected.importance;
    importanceSource = detected.source;
    for (const span of detected.spans) pushSpan(spans, span.start, span.end);
  }

  let due: DueResolution = { status: "none" };
  if (options.manualDue) {
    due = { status: "resolved", ...options.manualDue, source: "manual" };
  } else {
    const hit = detectDue(rawText, now, timeZone);
    if (hit) {
      due = hit.due;
      if (hit.due.status === "resolved") pushSpan(spans, hit.span.start, hit.span.end);
    }
  }

  const derivedTitle = stripSpans(rawText, spans);
  return {
    derivedTitle,
    ownerImportance,
    importanceSource,
    due,
    mentionTokens,
  };
}

export function tossBlockedByPersonResolution(assignee: { status: string }): boolean {
  return assignee.status === "unresolved";
}
