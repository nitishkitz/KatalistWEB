/**
 * Carries the finished "You're in." state across IdentityBoundary's
 * remount. Signing in changes identity, which remounts the whole routed
 * subtree; if that remount lands on /auth before navigation settles, the
 * fresh gate resumes on the same final frame instead of the opening one.
 */
export type GateHandoff = {
  /** The clip's last frame as a data URL, used as the fresh video's poster. */
  frame: string | null;
  welcomeName: string;
  at: number;
};

// The remount follows release within a frame; anything older is stale.
const HANDOFF_TTL_MS = 3_000;

let handoff: GateHandoff | null = null;

export function setGateHandoff(next: Omit<GateHandoff, "at">) {
  handoff = { ...next, at: Date.now() };
}

/** Non-consuming, so Strict Mode's double initializer sees the same value. */
export function peekGateHandoff(): GateHandoff | null {
  if (!handoff || Date.now() - handoff.at > HANDOFF_TTL_MS) return null;
  return handoff;
}

export function clearGateHandoff() {
  handoff = null;
}
