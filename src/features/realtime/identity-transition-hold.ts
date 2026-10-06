import { useSyncExternalStore } from "react";

/**
 * Lets a screen that is mid-way through its own sign-in transition ask
 * IdentityBoundary to keep the currently committed identity (and so keep
 * the current subtree mounted) until it is done -- e.g. /auth playing its
 * "You're in." gate after verifyOtp has already published the new session.
 *
 * While held, the boundary does not swap away from a signed-out ("none")
 * identity; it still enters "pending" unconditionally, and never defers a
 * switch between two real identities. Releasing lets the deferred swap (disposal,
 * epoch advance, remount) run exactly as it would have. Holders must
 * release on unmount so a hold can never outlive the screen that took it.
 */
let holds = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Returns an idempotent release function. */
export function holdIdentityTransition(): () => void {
  holds += 1;
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds -= 1;
    emit();
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => holds > 0;
const getServerSnapshot = () => false;

export function useIdentityTransitionHeld(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
