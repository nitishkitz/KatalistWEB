export const CATCHUP_OPEN_EVENT = "katalist:open-catchup";

const PENDING_OPEN_KEY = "katalist.pending-catchup-open";

/** Request the shared Catch Up review surface from any top-level screen. */
export function requestCatchupOpen() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(PENDING_OPEN_KEY, "1");
  } catch {
    // The event still handles the current screen when storage is unavailable.
  }
  window.dispatchEvent(new Event(CATCHUP_OPEN_EVENT));
}

/** Consume a request that was queued before navigation to Court completed. */
export function consumeCatchupOpen(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const pending = window.sessionStorage.getItem(PENDING_OPEN_KEY) === "1";
    if (pending) window.sessionStorage.removeItem(PENDING_OPEN_KEY);
    return pending;
  } catch {
    return false;
  }
}
