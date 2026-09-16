/**
 * Pure decision logic for the Coey escalation ladder, frequency caps, streaks
 * and quiet hours. Framework-free and side-effect-free so it can be unit-tested
 * (scripts/nudge-escalation.test.mjs) and reused client-side (staleness tint).
 *
 * The Supabase engine (supabase/migrations/…_nudge_escalation.sql and the daily
 * maintenance RPC) mirrors these exact thresholds — keep the two in lockstep.
 */

export type StalenessBand = "fresh" | "warm" | "hot" | "on_fire" | "stale";

export const BAND_ORDER: StalenessBand[] = ["fresh", "warm", "hot", "on_fire", "stale"];

const HOUR_MS = 60 * 60 * 1000;

/** Map age (ms since last movement) to a staleness band. Thresholds: 12/24/48/72h. */
export function computeBand(ageMs: number): StalenessBand {
  if (ageMs < 12 * HOUR_MS) return "fresh";
  if (ageMs < 24 * HOUR_MS) return "warm";
  if (ageMs < 48 * HOUR_MS) return "hot";
  if (ageMs < 72 * HOUR_MS) return "on_fire";
  return "stale";
}

export function bandRank(band: StalenessBand): number {
  return BAND_ORDER.indexOf(band);
}

/** True when `next` is a strictly higher band than `prev` (prev may be null). */
export function bandAdvanced(prev: StalenessBand | null | undefined, next: StalenessBand): boolean {
  if (!prev) return next !== "fresh";
  return bandRank(next) > bandRank(prev);
}

// ── Frequency caps (§5.2) ────────────────────────────────────────────────────

export type CapType =
  | "auto_nudge"
  | "morning_brief"
  | "spring_clean"
  | "streak"
  | "reactivation"
  | "upgrade";

/**
 * Given the timestamps (ms) of prior sends of a type (optionally for one thing),
 * decide whether another send is allowed now. Mirrors the SQL `can_send` guard.
 */
export function canSend(type: CapType, priorSendsMs: number[], now: number = Date.now()): boolean {
  const within = (windowMs: number) => priorSendsMs.some((t) => now - t < windowMs);
  switch (type) {
    case "auto_nudge":
      return !within(24 * HOUR_MS); // 1 per item per 24h
    case "morning_brief":
      return !within(20 * HOUR_MS); // at most once per morning
    case "spring_clean":
      return !within(7 * 24 * HOUR_MS); // 1 per week
    case "upgrade":
      return !within(7 * 24 * HOUR_MS); // 1 per week
    case "reactivation":
      return priorSendsMs.length < 2; // 3-day then 7-day, then silence
    case "streak":
      return true; // milestone-gated by isStreakMilestone, not by time
    default:
      return true;
  }
}

// ── Streaks (§3.5) ───────────────────────────────────────────────────────────

export const STREAK_MILESTONES = [3, 7, 14, 30] as const;

export function isStreakMilestone(days: number): boolean {
  return (STREAK_MILESTONES as readonly number[]).includes(days);
}

/** Local YYYY-MM-DD key for a date. */
export function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Consecutive-day streak ending today (or yesterday, so a streak isn't "broken"
 * until a full day is missed). `activityIso` = timestamps of qualifying events
 * (e.g. "sorted"). Returns the count of consecutive days up to and including the
 * most recent active day, provided that day is today or yesterday.
 */
export function computeStreak(activityIso: string[], now: Date = new Date()): number {
  const days = new Set<string>();
  for (const iso of activityIso) {
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) days.add(dayKey(d));
  }
  if (days.size === 0) return 0;

  const today = new Date(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  // Anchor: today if active today, else yesterday if active yesterday, else broken.
  let cursor: Date;
  if (days.has(dayKey(today))) cursor = today;
  else if (days.has(dayKey(yesterday))) cursor = yesterday;
  else return 0;

  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// ── Quiet hours ──────────────────────────────────────────────────────────────

/** True if `hour` (0–23) falls in the quiet window, handling overnight wrap. */
export function isQuietHour(hour: number, quietStart: number, quietEnd: number): boolean {
  if (quietStart === quietEnd) return false; // no quiet window
  if (quietStart < quietEnd) return hour >= quietStart && hour < quietEnd;
  // Overnight window, e.g. 21 → 8
  return hour >= quietStart || hour < quietEnd;
}
