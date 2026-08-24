export type TossMotionKind = "self" | "delegated";

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function tossMotionClass(kind: TossMotionKind, reduced = prefersReducedMotion()): string {
  if (reduced) return "transition-opacity duration-200 ease-out opacity-60";
  if (kind === "delegated") return "transition-transform duration-300 ease-out translate-x-2 -translate-y-1";
  return "transition-transform duration-200 ease-out translate-y-1";
}

export function tossMotionDurationMs(kind: TossMotionKind, reduced = prefersReducedMotion()): number {
  if (reduced) return 200;
  return kind === "delegated" ? 280 : 220;
}
