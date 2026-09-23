/**
 * D02: shared motion timing bands. "feedback" is immediate state/focus
 * response (a press state, a toggle) and stays fast even under reduced
 * motion -- it isn't spatial movement, so reduced motion doesn't zero it.
 * "local"/"workspace" are actual spatial movement (a card sliding, a
 * hero-flight transition) and collapse to 0ms under reduced motion.
 */
export type MotionKind = "feedback" | "local" | "workspace";

const MOTION_DURATIONS_MS: Record<MotionKind, number> = {
  feedback: 120, // 100-150ms band
  local: 200, // 180-240ms band
  workspace: 260, // <=280ms
};

export function motionDurationMs(kind: MotionKind, reduceMotion: boolean): number {
  if (reduceMotion && kind !== "feedback") return 0;
  return MOTION_DURATIONS_MS[kind];
}

/** Same duration, in seconds, for GSAP's `duration` option. */
export function motionDurationSeconds(kind: MotionKind, reduceMotion: boolean): number {
  return motionDurationMs(kind, reduceMotion) / 1000;
}
