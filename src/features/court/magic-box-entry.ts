export const MAGIC_BOX_FOCUS_EVENT = "katalist:focus-magic-box";

/** Focus the currently visible Magic Box after navigation has reached Court. */
export function requestMagicBoxFocus() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(MAGIC_BOX_FOCUS_EVENT));
}

/**
 * A screen that already owns a List-scoped Magic Box (the Code Activity workspace) can register one handler here. The global
 * shortcut and every "Create Thing" button call the same function, so there is one behaviour: reveal that composer in place,
 * focus it, and do not navigate. With no handler registered, callers fall back to opening Court.
 */
type CaptureHandler = () => boolean | Promise<boolean>;
let handler: CaptureHandler | null = null;

/** Returns the function that removes this registration. Only the most recent registration is active. */
export function registerMagicBoxHandler(next: CaptureHandler): () => void {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

/** True when a registered screen handled the request. False means the caller should open Court. */
export async function tryHandleMagicBoxCapture(): Promise<boolean> {
  const current = handler;
  if (!current) return false;
  try {
    return (await current()) === true;
  } catch {
    return false;
  }
}

/**
 * Destination-aware insertion of Thing references. A Magic Box that is visible consumes the request through the same
 * validation and dedupe path as paste. When none is visible the request stays queued, so the Magic Box that mounts after
 * navigation to Court picks it up; callers should open Court when this returns false.
 */
export const MAGIC_BOX_REFERENCES_EVENT = "katalist:magic-box-references";
type ReferenceInsertion = { thingId: string; version: 1 };
let pendingReferences: ReferenceInsertion[] = [];
let referencesConsumed = false;

export function requestMagicBoxReferences(refs: ReferenceInsertion[]): boolean {
  if (typeof window === "undefined" || refs.length === 0) return false;
  pendingReferences = [...pendingReferences, ...refs];
  referencesConsumed = false;
  window.dispatchEvent(new Event(MAGIC_BOX_REFERENCES_EVENT));
  return referencesConsumed;
}

/** Called by a visible Magic Box. Drains the queue once and marks the request handled. */
export function takePendingMagicBoxReferences(): ReferenceInsertion[] {
  const taken = pendingReferences;
  pendingReferences = [];
  if (taken.length) referencesConsumed = true;
  return taken;
}
