import type { Importance } from "@/domain/thing";
import {
  addRelativeDuration,
  applyPeriod,
  formatDueLabel,
  fromZonedLocal,
  importanceFromDueInstant,
  isoFromDate,
  parseClock,
  parseDurationUnit,
  resolveWeekday,
  withClock,
  zonedParts,
  type PeriodName,
  type RelativeDurationUnit,
  type WeekdayModifier,
} from "./date-time";
import { selectImportanceFromText } from "./importance-language";
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
  if (spans.length === 0) return text.replace(/\s+/g, " ").trim();
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

type DateHit = { due: DueResolution; span: Span; durationUnit?: RelativeDurationUnit | null };

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
      const re = /\b(?:in|within)\s+(\d+)\s+(minutes?|mins?|hours?|hrs?|days?|weeks?)\b/gi;
      const m = re.exec(text);
      if (!m || m.index == null) return null;
      const n = Number(m[1]);
      if (!Number.isFinite(n) || n < 0) return null;
      const unit = parseDurationUnit(m[2]!);
      if (!unit) return null;
      const added = addRelativeDuration(now, n, unit, timeZone);
      return {
        due: dueResolved(added.date, added.hasTime, timeZone, "parser"),
        span: { start: m.index, end: m.index + m[0].length },
        durationUnit: unit,
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
      const re = /\bbefore lunch\b/gi;
      const m = re.exec(text);
      if (!m || m.index == null) return null;
      const date = fromZonedLocal(parts.year, parts.month, parts.day, 12, 0, timeZone);
      return {
        due: dueResolved(date, true, timeZone, "parser"),
        span: { start: m.index, end: m.index + m[0].length },
      };
    },
    () => {
      const re = /\b(?:by\s+)?(tonight|(?:this\s+)?(?:morning|afternoon|evening)|noon|eod|end of day)\b/gi;
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
  let due: DueResolution = { status: "none" };
  let dueHit: DateHit | null = null;
  if (options.manualDue) {
    due = { status: "resolved", ...options.manualDue, source: "manual" };
  } else {
    dueHit = detectDue(rawText, now, timeZone);
    if (dueHit) due = dueHit.due;
  }

  if (options.manualImportance) {
    ownerImportance = options.manualImportance;
    importanceSource = "manual";
  } else {
    const selected = selectImportanceFromText(rawText, dueHit?.span ?? null);
    if (selected) {
      ownerImportance = selected.importance;
      importanceSource = selected.source;
      for (const span of selected.spans) pushSpan(spans, span.start, span.end);
    } else if (due.status === "resolved") {
      ownerImportance = importanceFromDueInstant(
        now,
        new Date(due.dueAt),
        timeZone,
        dueHit?.durationUnit,
      );
      importanceSource = "parser";
    }
  }

  if (due.status === "resolved" && dueHit) {
    pushSpan(spans, dueHit.span.start, dueHit.span.end);
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
