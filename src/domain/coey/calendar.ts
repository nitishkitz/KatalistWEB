/**
 * Holder working-time calendar (spec §3.3, §7.4). Every distance Coey uses --
 * lane thresholds, cadences, wake dates -- is measured here, in the holder's
 * own IANA timezone. Local dates are "YYYY-MM-DD" strings; instants are epoch
 * milliseconds. Nothing here reads the browser or server local timezone.
 */

export type Mode = "work" | "home";

export type LeaveRange = { start: string; end: string };

export type HolderCalendar = {
  timezone: string;
  /** Working weekdays, 0 = Sunday … 6 = Saturday. Default Mon–Sat. */
  workDays: number[];
  /** Minutes after local midnight. Default 09:00–18:30. */
  workStart: number;
  workEnd: number;
  /** Saturdays of the month that are off, e.g. [2, 4] for 2nd and 4th. */
  offSaturdays: number[];
  /** Local dates that are holidays or festivals. */
  holidays: string[];
  /** Local dates that are festivals (subset of holidays): no automatic nudges (§9.4). */
  festivals: string[];
  leave: LeaveRange[];
  /** Home window, every day. Default 07:00–22:00. */
  homeStart: number;
  homeEnd: number;
};

export const DEFAULT_TIMEZONE = "Asia/Kolkata";

export function defaultCalendar(timezone: string = DEFAULT_TIMEZONE): HolderCalendar {
  return {
    timezone: safeTimezone(timezone),
    workDays: [1, 2, 3, 4, 5, 6],
    workStart: 9 * 60,
    workEnd: 18 * 60 + 30,
    offSaturdays: [],
    holidays: [],
    festivals: [],
    leave: [],
    homeStart: 7 * 60,
    homeEnd: 22 * 60,
  };
}

export function safeTimezone(timezone: string | null | undefined): string {
  if (!timezone) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return timezone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

const MINUTE = 60_000;
const DAY_MS = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timezone: string): Intl.DateTimeFormat {
  let f = formatters.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timezone, f);
  }
  return f;
}

export type LocalParts = { date: string; year: number; month: number; day: number; weekday: number; minutes: number };

/** Local calendar parts of an instant in `timezone`. */
export function localParts(instant: number, timezone: string): LocalParts {
  const parts = Object.fromEntries(
    formatter(timezone).formatToParts(new Date(instant)).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const year = Number(parts.year), month = Number(parts.month), day = Number(parts.day);
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return {
    date,
    year,
    month,
    day,
    weekday: weekdayOf(date),
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function offsetAt(instant: number, timezone: string): number {
  const p = Object.fromEntries(
    formatter(timezone).formatToParts(new Date(instant)).map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant at which the wall clock in `timezone` reads `date` + `minutes`.
 * In a DST gap the result is pushed forward past the gap; in an overlap the
 * earlier instant is used.
 */
export function zonedInstant(date: string, minutes: number, timezone: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const wall = Date.UTC(y!, m! - 1, d!) + minutes * MINUTE;
  let guess = wall - offsetAt(wall, timezone);
  const second = wall - offsetAt(guess, timezone);
  if (second !== guess) guess = Math.min(guess, second);
  return guess;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function inLeave(date: string, cal: HolderCalendar): boolean {
  return cal.leave.some((range) => date >= range.start && date <= range.end);
}

/** Whether `date` is a working day in the Work calendar. */
export function isWorkingDay(date: string, cal: HolderCalendar): boolean {
  const weekday = weekdayOf(date);
  if (!cal.workDays.includes(weekday)) return false;
  if (weekday === 6 && cal.offSaturdays.length) {
    const nth = Math.ceil(Number(date.slice(8, 10)) / 7);
    if (cal.offSaturdays.includes(nth)) return false;
  }
  if (cal.holidays.includes(date) || cal.festivals.includes(date)) return false;
  return !inLeave(date, cal);
}

export function isFestival(date: string, cal: HolderCalendar): boolean {
  return cal.festivals.includes(date);
}

/** The local window [start, end) for one day, or null if the day does not count. */
export function windowFor(date: string, cal: HolderCalendar, mode: Mode): { start: number; end: number } | null {
  if (mode === "home") {
    // Home Things count the home window every day, including leave (§7.4).
    return {
      start: zonedInstant(date, cal.homeStart, cal.timezone),
      end: zonedInstant(date, cal.homeEnd, cal.timezone),
    };
  }
  if (!isWorkingDay(date, cal)) return null;
  return {
    start: zonedInstant(date, cal.workStart, cal.timezone),
    end: zonedInstant(date, cal.workEnd, cal.timezone),
  };
}

/** Nominal length of one working day in ms (normalised day, §7.4). */
export function workdayLength(cal: HolderCalendar, mode: Mode): number {
  const minutes = mode === "home" ? cal.homeEnd - cal.homeStart : cal.workEnd - cal.workStart;
  return Math.max(1, minutes) * MINUTE;
}

const MAX_SCAN_DAYS = 800;

/** Working ms between two instants (negative when `to` is before `from`). */
export function workingMsBetween(from: number, to: number, cal: HolderCalendar, mode: Mode): number {
  if (to < from) return -workingMsBetween(to, from, cal, mode);
  let total = 0;
  let date = addDays(localParts(from, cal.timezone).date, -1);
  const last = addDays(localParts(to, cal.timezone).date, 1);
  for (let i = 0; i < MAX_SCAN_DAYS && date <= last; i++, date = addDays(date, 1)) {
    const w = windowFor(date, cal, mode);
    if (!w) continue;
    const start = Math.max(w.start, from), end = Math.min(w.end, to);
    if (end > start) total += end - start;
  }
  return total;
}

export function workingDaysBetween(from: number, to: number, cal: HolderCalendar, mode: Mode): number {
  return workingMsBetween(from, to, cal, mode) / workdayLength(cal, mode);
}

/** The instant after `from` by `ms` of working time. */
export function addWorkingMs(from: number, ms: number, cal: HolderCalendar, mode: Mode): number {
  if (ms < 0) return subtractWorkingMs(from, -ms, cal, mode);
  let remaining = ms;
  let date = localParts(from, cal.timezone).date;
  for (let i = 0; i < MAX_SCAN_DAYS; i++, date = addDays(date, 1)) {
    const w = windowFor(date, cal, mode);
    if (!w) continue;
    const start = Math.max(w.start, from);
    if (start >= w.end) continue;
    const available = w.end - start;
    if (remaining <= available) return start + remaining;
    remaining -= available;
  }
  return from + ms;
}

export function subtractWorkingMs(from: number, ms: number, cal: HolderCalendar, mode: Mode): number {
  let remaining = ms;
  let date = localParts(from, cal.timezone).date;
  for (let i = 0; i < MAX_SCAN_DAYS; i++, date = addDays(date, -1)) {
    const w = windowFor(date, cal, mode);
    if (!w) continue;
    const end = Math.min(w.end, from);
    if (end <= w.start) continue;
    const available = end - w.start;
    if (remaining <= available) return end - remaining;
    remaining -= available;
  }
  return from - ms;
}

export function subtractWorkingDays(at: number, days: number, cal: HolderCalendar, mode: Mode): number {
  return subtractWorkingMs(at, days * workdayLength(cal, mode), cal, mode);
}

export function addWorkingDays(at: number, days: number, cal: HolderCalendar, mode: Mode): number {
  return addWorkingMs(at, days * workdayLength(cal, mode), cal, mode);
}

/** `instant` if inside a window, else the start of the next window (§9.4 queueing). */
export function nextWindowStart(instant: number, cal: HolderCalendar, mode: Mode): number {
  let date = localParts(instant, cal.timezone).date;
  for (let i = 0; i < MAX_SCAN_DAYS; i++, date = addDays(date, 1)) {
    const w = windowFor(date, cal, mode);
    if (!w) continue;
    if (instant < w.start) return w.start;
    if (instant < w.end) return instant;
  }
  return instant;
}

export function isInsideWindow(instant: number, cal: HolderCalendar, mode: Mode): boolean {
  return nextWindowStart(instant, cal, mode) === instant;
}

/** Next working day on or after `date` (Work calendar). */
export function nextWorkingDay(date: string, cal: HolderCalendar): string {
  let d = date;
  for (let i = 0; i < MAX_SCAN_DAYS; i++, d = addDays(d, 1)) if (isWorkingDay(d, cal)) return d;
  return date;
}

export function previousWorkingDay(date: string, cal: HolderCalendar): string {
  let d = date;
  for (let i = 0; i < MAX_SCAN_DAYS; i++, d = addDays(d, -1)) if (isWorkingDay(d, cal)) return d;
  return date;
}

export function lastWorkingDayOfMonth(year: number, month: number, cal: HolderCalendar): string {
  const date = `${year}-${String(month).padStart(2, "0")}-${String(daysInMonth(year, month)).padStart(2, "0")}`;
  return previousWorkingDay(date, cal);
}

export function lastWorkingDayOfQuarter(year: number, month: number, cal: HolderCalendar): string {
  const quarterEndMonth = Math.ceil(month / 3) * 3;
  return lastWorkingDayOfMonth(year, quarterEndMonth, cal);
}

export function formatMinutes(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function parseMinutes(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export { DAY_MS };
