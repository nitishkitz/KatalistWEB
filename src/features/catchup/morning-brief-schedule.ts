/**
 * F01: pure, injectable-clock scheduling/eligibility model for Morning
 * Brief. No React, no Supabase -- this only answers "is it eligible right
 * now" and "when should we check again", using real timezone-aware date
 * math (not a fixed 24h-from-now offset, which silently drifts across a
 * DST transition).
 *
 * Eligibility window: once per identity/profile, per active Work/Home
 * context, per LOCAL CALENDAR DATE, after 07:00 local time. There is no
 * "noon cutoff" -- the first eligible visit later that same day still
 * qualifies. The 07:00 threshold is this codebase's own accepted default
 * (no pre-existing product rule specified one), chosen to be well clear
 * of a plausible overnight/pre-dawn open.
 */
export const MORNING_THRESHOLD_HOUR = 7;

/** A profile's stored IANA timezone wins when valid; otherwise the
 *  browser's own resolved timezone, itself validated the same way (a
 *  browser can in principle report something Intl doesn't recognize). */
export function resolveEffectiveTimezone(profileTimezone: string | null | undefined): string {
  if (profileTimezone && isValidTimeZone(profileTimezone)) return profileTimezone;
  const browserTz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;
  if (browserTz && isValidTimeZone(browserTz)) return browserTz;
  return "UTC";
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function localPartsAt(instant: Date, timeZone: string): LocalParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/** UTC-minus-local offset in ms at `instant`, for `timeZone` -- i.e. the
 *  value to SUBTRACT from a UTC-interpreted wall-clock guess to get the
 *  real UTC instant that wall-clock time represents in `timeZone`. */
function offsetMsAt(instant: Date, timeZone: string): number {
  const p = localPartsAt(instant, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - instant.getTime();
}

/** The local calendar date (YYYY-MM-DD) `instant` falls on in `timeZone` --
 *  this is the identity a Morning Brief presentation receipt is scoped to,
 *  not a rolling 24-hour cooldown. Crossing a timezone (e.g. travel) can
 *  change this date's value for the same real instant; that is expected
 *  and correct, not a bug -- the receipt is inherently about the viewer's
 *  own local morning. */
export function localDateKey(instant: Date, timeZone: string): string {
  const p = localPartsAt(instant, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Converts a local-calendar-date + wall-clock hour/minute in `timeZone`
 *  into the real UTC instant it represents. Uses one offset-correction
 *  pass (computed from the naive UTC-interpreted guess) rather than a
 *  fixed-point loop -- exact except for the rare case where a DST
 *  transition happens between hour 0 and `hour` on the target date
 *  itself, which would shift the result by the transition's own delta
 *  (typically one hour). Accepted approximation, not silently assumed
 *  perfect. */
function localWallClockToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const naiveGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const offset = offsetMsAt(naiveGuess, timeZone);
  return new Date(naiveGuess.getTime() - offset);
}

/** True once `now` is on/after the current local date's 07:00 threshold
 *  in `timeZone`. There is no upper bound -- any later time that same
 *  local day still qualifies (the master requirement's "no noon cutoff"). */
export function isPastMorningThreshold(now: Date, timeZone: string): boolean {
  const p = localPartsAt(now, timeZone);
  if (p.hour > MORNING_THRESHOLD_HOUR) return true;
  if (p.hour < MORNING_THRESHOLD_HOUR) return false;
  return true; // hour === threshold: 07:00 itself already qualifies ("after 07:00" is inclusive of the boundary minute).
}

/** The next local 07:00 instant strictly after `now`, in `timeZone` --
 *  today's if `now` is still before it, otherwise tomorrow's. Used to
 *  schedule a re-check timer, not to decide eligibility directly (that's
 *  `isPastMorningThreshold` + the presentation-receipt check together). */
export function nextMorningThreshold(now: Date, timeZone: string): Date {
  const p = localPartsAt(now, timeZone);
  const todayThreshold = localWallClockToInstant(p.year, p.month, p.day, MORNING_THRESHOLD_HOUR, 0, timeZone);
  if (todayThreshold.getTime() > now.getTime()) return todayThreshold;
  // Tomorrow: step the LOCAL calendar date forward by one day (not "add
  // 24h to the instant", which would land on the wrong wall-clock hour
  // across a DST transition), then resolve 07:00 on that new local date.
  const tomorrowNoonGuess = new Date(Date.UTC(p.year, p.month - 1, p.day, 12, 0, 0));
  tomorrowNoonGuess.setUTCDate(tomorrowNoonGuess.getUTCDate() + 1);
  const tomorrow = localPartsAt(tomorrowNoonGuess, timeZone);
  return localWallClockToInstant(tomorrow.year, tomorrow.month, tomorrow.day, MORNING_THRESHOLD_HOUR, 0, timeZone);
}

export type MorningBriefBlocker =
  | "pending-auth"
  | "loading"
  | "no-moments"
  | "hidden-tab"
  | "before-threshold"
  | "active-call"
  | "blocking-dialog"
  | "dirty-composer";

/**
 * Whether Morning Brief should be ELIGIBLE to auto-open right now, before
 * consulting the (server or local, see morning-brief-receipts.ts)
 * presentation receipt. This does not itself check the receipt --
 * eligibility and "already shown today" are separate, composable checks,
 * matching the master requirement that the receipt is what suppresses
 * repeat auto-opens, not this function silently doing both jobs.
 */
export function isEligibleToAutoOpen(input: {
  now: Date;
  timeZone: string;
  hasActionableMoments: boolean;
  isTabHidden: boolean;
  authPending: boolean;
  momentsLoading: boolean;
  hasBlockingInteraction: boolean;
}): { eligible: true } | { eligible: false; reason: MorningBriefBlocker } {
  if (input.authPending) return { eligible: false, reason: "pending-auth" };
  if (input.momentsLoading) return { eligible: false, reason: "loading" };
  if (input.isTabHidden) return { eligible: false, reason: "hidden-tab" };
  if (input.hasBlockingInteraction) return { eligible: false, reason: "blocking-dialog" };
  if (!isPastMorningThreshold(input.now, input.timeZone)) return { eligible: false, reason: "before-threshold" };
  if (!input.hasActionableMoments) return { eligible: false, reason: "no-moments" };
  return { eligible: true };
}
