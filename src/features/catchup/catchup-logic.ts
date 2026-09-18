/**
 * Pure, framework-free decision logic for Catch Up. Kept side-effect-free so it
 * can be unit-tested (scripts/catchup-logic.test.mjs) and reused by both the
 * live and demo/preview data paths.
 *
 * The Supabase RPC (supabase/migrations/…_catchup.sql, list_catchup_moments)
 * mirrors the dedupe/priority/surfaced rules here — keep the two in lockstep.
 *
 * Catch Up surfaces movement; it never changes a Thing merely because it was
 * shown. Viewing records a receipt only (see surface_catchup_moment).
 */

export type CatchUpMomentKind = "nudge" | "snooze_ended" | "ghost" | "follow_up";

/** A raw moment as returned by the RPC or derived from demo local-state. */
export type RawCatchUpMoment = {
  momentKey: string;
  kind: CatchUpMomentKind;
  thingId: string;
  /** ISO timestamp of when the underlying event occurred. */
  occurredAt: string;
  actorId?: string | null;
  reason: string;
};

/** Lower number = higher priority when a single Thing has several triggers. */
export const MOMENT_PRIORITY: Record<CatchUpMomentKind, number> = {
  nudge: 1,
  snooze_ended: 2,
  ghost: 3,
  follow_up: 4,
};

export function momentPriority(kind: CatchUpMomentKind): number {
  return MOMENT_PRIORITY[kind] ?? 99;
}

function occurredMs(m: RawCatchUpMoment): number {
  const t = new Date(m.occurredAt).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** Drop moments whose key already has a surfaced receipt. */
export function filterSurfaced(
  moments: RawCatchUpMoment[],
  surfaced: Set<string>,
): RawCatchUpMoment[] {
  if (!surfaced.size) return moments;
  return moments.filter((m) => !surfaced.has(m.momentKey));
}

/**
 * Collapse to one moment per Thing (highest priority, then newest), then order
 * the result priority-first and newest-first. One Thing with multiple triggers
 * appears once with its newest/highest-priority reason.
 */
export function dedupeMoments(moments: RawCatchUpMoment[]): RawCatchUpMoment[] {
  const bestByThing = new Map<string, RawCatchUpMoment>();
  for (const m of moments) {
    const current = bestByThing.get(m.thingId);
    if (!current) {
      bestByThing.set(m.thingId, m);
      continue;
    }
    const betterPriority = momentPriority(m.kind) < momentPriority(current.kind);
    const samePriorityNewer =
      momentPriority(m.kind) === momentPriority(current.kind) && occurredMs(m) > occurredMs(current);
    if (betterPriority || samePriorityNewer) {
      bestByThing.set(m.thingId, m);
    }
  }
  return [...bestByThing.values()].sort((a, b) => {
    const byPriority = momentPriority(a.kind) - momentPriority(b.kind);
    if (byPriority !== 0) return byPriority;
    return occurredMs(b) - occurredMs(a);
  });
}

/** Full pipeline: filter surfaced, then dedupe + order. */
export function resolveMoments(
  moments: RawCatchUpMoment[],
  surfaced: Set<string> = new Set(),
): RawCatchUpMoment[] {
  return dedupeMoments(filterSurfaced(moments, surfaced));
}

// ── Presentation helpers ──────────────────────────────────────────────────────

const NUDGE_REASON_LABEL: Record<string, string> = {
  waiting_for_catch: "Waiting for Catch",
  quiet: "No movement",
  due_soon: "Due soon",
  stale: "Gone stale",
  repeated_handoff: "Handed off repeatedly",
};

/** Short human label for a moment's reason, used on the trigger chip. */
export function reasonLabelFor(kind: CatchUpMomentKind, reason: string): string {
  switch (kind) {
    case "nudge":
      return NUDGE_REASON_LABEL[reason] ?? "Nudged";
    case "snooze_ended":
      return "Snooze ended";
    case "ghost":
      return "Broke through";
    case "follow_up":
      return NUDGE_REASON_LABEL[reason] ?? "Needs a follow-up";
    default:
      return "Needs you";
  }
}

/** Relative "10 min ago" style label for the trigger chip. */
export function relativeTimeLabel(iso: string, nowMs: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Math.max(0, nowMs - then);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

// ── Contextual actions ─────────────────────────────────────────────────────────

export type CatchUpActionId =
  | "catch" // Catch & Start (waiting Things)
  | "set_pace" // change personal pace (already caught)
  | "move_now" // move a woken Thing back to NOW
  | "snooze" // the explicit "later" action
  | "open" // open the Thing detail
  | "nudge" // nudge again (owner-facing follow-ups)
  | "dismiss_ghost"; // dismiss a breakthrough reference

/** Minimal capability shape needed to decide Catch Up actions. */
export type CatchUpCaps = {
  canCatch: boolean;
  canSetPace: boolean;
  canNudge: boolean;
};

/**
 * Contextual actions for a moment, most-important first. Actions map 1:1 to the
 * Thing's existing capabilities — Catch Up never invents permissions, and there
 * is no generic "Reviewed" action. Snooze is the explicit "later".
 */
export function catchUpActionsFor(kind: CatchUpMomentKind, caps: CatchUpCaps): CatchUpActionId[] {
  if (kind === "ghost") {
    return ["open", "snooze", "dismiss_ghost"];
  }
  if (kind === "follow_up") {
    return caps.canNudge ? ["open", "nudge"] : ["open"];
  }
  if (kind === "snooze_ended") {
    if (caps.canCatch) return ["catch", "snooze", "open"];
    if (caps.canSetPace) return ["move_now", "snooze", "open"];
    return ["snooze", "open"];
  }
  // nudge + fallback
  if (caps.canCatch) return ["catch", "snooze", "open"];
  if (caps.canSetPace) return ["set_pace", "snooze", "open"];
  return ["snooze", "open"];
}
