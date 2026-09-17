/**
 * A tiny in-memory signal for "please auto-join the call on this list". The
 * incoming-call banner sets it, then navigates; the list page consumes it once
 * its call controls are ready. Using a module singleton (instead of only a
 * transient DOM event + sessionStorage) removes the mount-timing race that made
 * "Join" occasionally do nothing: the value simply waits until the target list
 * page mounts and is ready to act on it.
 */
let pendingListId: string | null = null;
const listeners = new Set<(listId: string) => void>();

/** Request an auto-join for a list. Notifies any already-mounted list page. */
export function requestAutojoin(listId: string): void {
  pendingListId = listId;
  for (const l of listeners) l(listId);
}

/**
 * If an auto-join is pending for this list, clear and return true (one-shot).
 * The list page calls this when its call controls become ready.
 */
export function consumeAutojoin(listId: string): boolean {
  if (pendingListId === listId) {
    pendingListId = null;
    return true;
  }
  return false;
}

/** Subscribe to auto-join requests (for a list page that is already mounted). */
export function onAutojoin(cb: (listId: string) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
