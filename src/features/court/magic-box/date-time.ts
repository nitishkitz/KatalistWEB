/** Canonical local times from Magic Box v2 BRD. */
import type { Importance } from "@/domain/thing";

export const PERIOD_TIMES = {
  morning: { hour: 9, minute: 0 },
  noon: { hour: 12, minute: 0 },
  afternoon: { hour: 15, minute: 0 },
  evening: { hour: 19, minute: 0 },
  tonight: { hour: 20, minute: 0 },
  night: { hour: 20, minute: 0 },
  eod: { hour: 17, minute: 0 },
} as const;

export type PeriodName = keyof typeof PERIOD_TIMES;

export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
  weekdayIndex: number;
};

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

export function weekdayIndex(name: string): number | null {
  const key = name.trim().toLowerCase();
  return key in WEEKDAY_INDEX ? WEEKDAY_INDEX[key]! : null;
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = get("weekday");
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday,
    weekdayIndex: weekdayIndex(weekday) ?? 0,
  };
}

export function fromZonedLocal(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 4; i++) {
    const got = zonedParts(new Date(utc), timeZone);
    const gotUtc = Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute, 0);
    const want = Date.UTC(year, month - 1, day, hour, minute, 0);
    const diff = want - gotUtc;
    if (diff === 0) break;
    utc += diff;
  }
  return new Date(utc);
}

export function addZonedDays(parts: ZonedParts, days: number, timeZone: string, hour = 9, minute = 0): Date {
  return fromZonedLocal(parts.year, parts.month, parts.day + days, hour, minute, timeZone);
}

export type ClockTime = { hour: number; minute: number };

export function parseClock(raw: string): ClockTime | null {
  const s = raw.trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, " ");
  const ampm = /\b(am|pm)\b/.exec(s);
  const hm = /(\d{1,2})(?::(\d{2}))?/.exec(s);
  if (!hm) return null;
  let hour = Number(hm[1]);
  const minute = hm[2] ? Number(hm[2]) : 0;
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute > 59 || minute < 0) return null;
  if (ampm) {
    if (hour < 1 || hour > 12) return null;
    if (ampm[1] === "am") {
      if (hour === 12) hour = 0;
    } else if (hour !== 12) {
      hour += 12;
    }
  } else if (hour > 23 || hour < 0) {
    return null;
  }
  return { hour, minute };
}

export type WeekdayModifier = "bare" | "this" | "next";

export type WeekdayResolution =
  | { status: "resolved"; date: Date; label: string }
  | { status: "ambiguous"; raw: string };

/**
 * ISO week starts Monday.
 * Bare weekday = next occurrence strictly in the future.
 * "this Friday" = Friday of the current ISO week if still ahead (today counts);
 *   if already passed, Check date — do not jump a week.
 * "next Friday" = Friday of the following ISO week.
 */
export function resolveWeekday(
  weekdayName: string,
  modifier: WeekdayModifier,
  now: Date,
  timeZone: string,
): WeekdayResolution {
  const target = weekdayIndex(weekdayName);
  if (target == null) return { status: "ambiguous", raw: weekdayName };
  const parts = zonedParts(now, timeZone);
  const isoDow = parts.weekdayIndex === 0 ? 6 : parts.weekdayIndex - 1;
  const targetIso = target === 0 ? 6 : target - 1;
  const deltaFromMonday = targetIso;
  const thisWeekDay = addZonedDays(parts, deltaFromMonday - isoDow, timeZone);
  const thisWeekParts = zonedParts(thisWeekDay, timeZone);
  const todayStart = fromZonedLocal(parts.year, parts.month, parts.day, 0, 0, timeZone);
  const thisWeekStart = fromZonedLocal(thisWeekParts.year, thisWeekParts.month, thisWeekParts.day, 0, 0, timeZone);

  if (modifier === "this") {
    if (thisWeekStart.getTime() < todayStart.getTime()) {
      return { status: "ambiguous", raw: `this ${weekdayName}` };
    }
    return {
      status: "resolved",
      date: fromZonedLocal(thisWeekParts.year, thisWeekParts.month, thisWeekParts.day, 9, 0, timeZone),
      label: formatDueLabel(thisWeekParts, false),
    };
  }

  if (modifier === "next") {
    const next = addZonedDays(thisWeekParts, 7, timeZone);
    const np = zonedParts(next, timeZone);
    return {
      status: "resolved",
      date: fromZonedLocal(np.year, np.month, np.day, 9, 0, timeZone),
      label: formatDueLabel(np, false),
    };
  }

  let delta = (target - parts.weekdayIndex + 7) % 7;
  if (delta === 0) delta = 7;
  const date = addZonedDays(parts, delta, timeZone);
  const dp = zonedParts(date, timeZone);
  return {
    status: "resolved",
    date: fromZonedLocal(dp.year, dp.month, dp.day, 9, 0, timeZone),
    label: formatDueLabel(dp, false),
  };
}

export function formatDueLabel(parts: Pick<ZonedParts, "year" | "month" | "day" | "hour" | "minute">, hasTime: boolean): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const date = `${parts.day} ${months[parts.month - 1]}`;
  if (!hasTime) return date;
  const hour12 = parts.hour % 12 === 0 ? 12 : parts.hour % 12;
  const ampm = parts.hour >= 12 ? "PM" : "AM";
  const mm = String(parts.minute).padStart(2, "0");
  return `${date} ${hour12}:${mm} ${ampm}`;
}

export function withClock(date: Date, clock: ClockTime, timeZone: string): Date {
  const parts = zonedParts(date, timeZone);
  return fromZonedLocal(parts.year, parts.month, parts.day, clock.hour, clock.minute, timeZone);
}

export function applyPeriod(date: Date, period: PeriodName, timeZone: string): Date {
  const clock = PERIOD_TIMES[period];
  return withClock(date, clock, timeZone);
}

export function isoFromDate(date: Date): string {
  return date.toISOString();
}

export function defaultTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export type RelativeDurationUnit = "minute" | "hour" | "day" | "week";

export function parseDurationUnit(raw: string): RelativeDurationUnit | null {
  const unit = raw.toLowerCase();
  if (unit.startsWith("min")) return "minute";
  if (unit.startsWith("hour") || unit.startsWith("hr")) return "hour";
  if (unit.startsWith("day")) return "day";
  if (unit.startsWith("week")) return "week";
  return null;
}

export function addRelativeDuration(
  now: Date,
  amount: number,
  unit: RelativeDurationUnit,
  timeZone: string,
): { date: Date; hasTime: boolean } {
  if (unit === "minute") return { date: new Date(now.getTime() + amount * 60_000), hasTime: true };
  if (unit === "hour") return { date: new Date(now.getTime() + amount * 3_600_000), hasTime: true };
  const parts = zonedParts(now, timeZone);
  const days = unit === "week" ? amount * 7 : amount;
  return {
    date: fromZonedLocal(parts.year, parts.month, parts.day + days, 9, 0, timeZone),
    hasTime: false,
  };
}

export function importanceFromDueInstant(
  now: Date,
  dueAt: Date,
  timeZone: string,
  unit?: RelativeDurationUnit | null,
): Importance {
  if (unit === "week") return "later";
  if (unit === "minute" || unit === "hour") {
    const hours = (dueAt.getTime() - now.getTime()) / 3_600_000;
    return hours <= 2 ? "now" : "next";
  }
  const nowParts = zonedParts(now, timeZone);
  const dueParts = zonedParts(dueAt, timeZone);
  const days =
    (Date.UTC(dueParts.year, dueParts.month - 1, dueParts.day) -
      Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day)) /
    86_400_000;
  if (days <= 0) return "now";
  if (days <= 7) return "next";
  return "later";
}
