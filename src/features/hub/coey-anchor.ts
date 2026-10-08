import { useSyncExternalStore } from "react";

/**
 * Where Coey should dock while the Magic Box is active. The Magic Box publishes the target while it has focus and clears it
 * on blur or Escape; Coey's chat head reads it and glides there with a transform, then glides back to wherever it rests.
 * One owner (the Magic Box) sets it, so two screens can never fight over Coey's position.
 */
export interface CoeyAnchor {
  /** Top-left of the chat head, in viewport pixels. */
  x: number;
  y: number;
}

let anchor: CoeyAnchor | null = null;
const listeners = new Set<() => void>();

export function setCoeyAnchor(next: CoeyAnchor | null) {
  const same = anchor === next || (anchor && next && Math.abs(anchor.x - next.x) < 0.5 && Math.abs(anchor.y - next.y) < 0.5);
  if (same) return;
  anchor = next;
  listeners.forEach((l) => l());
}

export function useCoeyAnchor(): CoeyAnchor | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => anchor,
    () => null,
  );
}
