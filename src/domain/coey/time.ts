/**
 * Resolves the closed time grammar (contract.ts) into instants, in code
 * (spec §4.4, non-negotiable rule 7). The model never supplies a timestamp.
 */
import {
  addDays,
  daysInMonth,
  lastWorkingDayOfMonth,
  lastWorkingDayOfQuarter,
  localParts,
  parseMinutes,
  weekdayOf,
  zonedInstant,
  type HolderCalendar,
  type Mode,
} from "./calendar";
import type { TimeExpr } from "./contract";

export type Precision = "date" | "time";

export type ResolvedTime =
  | {
      ok: true;
      /** Epoch ms. Date precision uses that day's window end (start for "before"). */
      at: number;
      date: string;
      minutes: number | null;
      precision: Precision;
      boundary: "at" | "by" | "before" | "after";
      phrase: string;
      /** A time with no date had already passed today, so it moved to tomorrow (§4.4). */
      rolledToTomorrow?: boolean;
    }
  | {
      ok: false;
      phrase: string;
      reason: "end_of_week" | "unknown_festival" | "malformed" | "empty";
    };

export const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** Part-of-day words resolve to the window start (§4.4: "shaam" → 17:00). */
export const PART_OF_DAY: Record<string, number> = {
  morning: 9 * 60,
  afternoon: 14 * 60,
  evening: 17 * 60,
  night: 21 * 60,
};

/**
 * Festival dates (local). Maintained data, never guessed by the model. A
 * festival with no listed future date stays unresolved and Coey asks.
 */
export const FESTIVAL_DATES: Record<string, string[]> = {
  diwali: ["2026-11-08"],
  christmas: ["2026-12-25", "2027-12-25"],
};

function onOrAfter(today: string, weekday: number): string {
  return addDays(today, (weekday - weekdayOf(today) + 7) % 7);
}

type DayResult = { date: string } | { reason: "end_of_week" | "unknown_festival" | "malformed" };

function resolveDay(day: string, today: string, cal: HolderCalendar, offsetDays: number | null): DayResult {
  const [head, arg = ""] = day.split(":");
  switch (head) {
    case "today":
      return { date: today };
    case "tomorrow":
      return { date: addDays(today, 1) };
    case "day_after_tomorrow":
      return { date: addDays(today, 2) };
    case "weekday": {
      const wd = WEEKDAY_KEYS.indexOf(arg as (typeof WEEKDAY_KEYS)[number]);
      return wd < 0 ? { reason: "malformed" } : { date: onOrAfter(today, wd) };
    }
    case "nextweekday": {
      // "Next Friday" = the Friday of next week (§4.4). Weeks start Monday.
      const wd = WEEKDAY_KEYS.indexOf(arg as (typeof WEEKDAY_KEYS)[number]);
      if (wd < 0) return { reason: "malformed" };
      const monday = addDays(today, -((weekdayOf(today) + 6) % 7) + 7);
      return { date: addDays(monday, (wd + 6) % 7) };
    }
    case "date": {
      const [y, m, d] = arg.split("-").map(Number);
      if (!y || !m || !d || m > 12 || d < 1 || d > daysInMonth(y, m)) return { reason: "malformed" };
      return { date: arg };
    }
    case "monthday": {
      const n = Number(arg);
      if (!n || n > 31) return { reason: "malformed" };
      const [y, m] = today.split("-").map(Number) as [number, number];
      for (let i = 0; i < 13; i++) {
        const month = ((m - 1 + i) % 12) + 1;
        const year = y + Math.floor((m - 1 + i) / 12);
        if (n > daysInMonth(year, month)) continue;
        const date = `${year}-${String(month).padStart(2, "0")}-${String(n).padStart(2, "0")}`;
        if (date >= today) return { date };
      }
      return { reason: "malformed" };
    }
    case "in_days":
      return { date: addDays(today, Number(arg)) };
    case "in_weeks":
      return { date: addDays(today, Number(arg) * 7) };
    case "monthend": {
      const [y, m] = today.split("-").map(Number) as [number, number];
      let date = lastWorkingDayOfMonth(y, m, cal);
      if (date < today) date = m === 12 ? lastWorkingDayOfMonth(y + 1, 1, cal) : lastWorkingDayOfMonth(y, m + 1, cal);
      return { date };
    }
    case "quarterend": {
      const [y, m] = today.split("-").map(Number) as [number, number];
      let date = lastWorkingDayOfQuarter(y, m, cal);
      if (date < today) {
        const next = Math.ceil(m / 3) * 3 + 1;
        date = next > 12 ? lastWorkingDayOfQuarter(y + 1, 1, cal) : lastWorkingDayOfQuarter(y, next, cal);
      }
      return { date };
    }
    case "weekend":
      return { date: onOrAfter(today, 6) };
    case "end_of_week":
      // Not defined by the documents; the user decided Coey asks (decision D8).
      return { reason: "end_of_week" };
    case "festival": {
      const date = (FESTIVAL_DATES[arg] ?? []).find((d) => d >= today);
      return date ? { date: addDays(date, offsetDays ?? 0) } : { reason: "unknown_festival" };
    }
    default:
      return { reason: "malformed" };
  }
}

function resolveMinutes(time: string, cal: HolderCalendar, mode: Mode): number | null {
  if (time === "eod") return mode === "home" ? cal.homeEnd : cal.workEnd;
  if (time.startsWith("partofday:")) return PART_OF_DAY[time.slice("partofday:".length)] ?? null;
  return parseMinutes(time);
}

/** Resolve one time expression in the holder's calendar. `dayChoice` answers an end-of-week question. */
export function resolveTimeExpr(
  expr: TimeExpr,
  now: number,
  cal: HolderCalendar,
  mode: Mode,
  dayChoice?: string,
): ResolvedTime {
  const phrase = expr.phrase;
  const today = localParts(now, cal.timezone).date;
  if (!expr.day && !expr.time && !dayChoice) return { ok: false, phrase, reason: "empty" };

  let date: string | null = dayChoice ?? null;
  if (!date && expr.day) {
    const day = resolveDay(expr.day, today, cal, expr.offset_days);
    if ("reason" in day) return { ok: false, phrase, reason: day.reason };
    date = day.date;
  }

  let minutes: number | null = null;
  if (expr.time) {
    minutes = resolveMinutes(expr.time, cal, mode);
    if (minutes === null) return { ok: false, phrase, reason: "malformed" };
  }

  const boundary = expr.boundary ?? (minutes !== null ? "at" : "by");
  let rolledToTomorrow = false;
  if (!date) {
    date = today;
    if (minutes !== null && zonedInstant(today, minutes, cal.timezone) <= now) {
      date = addDays(today, 1);
      rolledToTomorrow = true;
    }
  }

  const windowEnd = mode === "home" ? cal.homeEnd : cal.workEnd;
  const windowStart = mode === "home" ? cal.homeStart : cal.workStart;
  const at = zonedInstant(date, minutes ?? (boundary === "before" ? windowStart : windowEnd), cal.timezone);
  return {
    ok: true,
    at,
    date,
    minutes,
    precision: minutes === null ? "date" : "time",
    boundary,
    phrase,
    ...(rolledToTomorrow ? { rolledToTomorrow } : {}),
  };
}

/** V2.7: the weekday the user said does not match the explicit date. */
export function weekdayMismatch(expr: TimeExpr, resolved: ResolvedTime): boolean {
  if (!expr.said_weekday || !resolved.ok || !expr.day?.startsWith("date:")) return false;
  return WEEKDAY_KEYS[weekdayOf(resolved.date)] !== expr.said_weekday;
}

/** Candidate days for "end of week": the coming Friday, Saturday and Sunday. */
export function endOfWeekChoices(now: number, cal: HolderCalendar): Array<{ date: string; label: string }> {
  const today = localParts(now, cal.timezone).date;
  return [
    { date: onOrAfter(today, 5), label: "Friday" },
    { date: onOrAfter(today, 6), label: "Saturday" },
    { date: onOrAfter(today, 0), label: "Sunday" },
  ].filter((c) => c.date >= today);
}
