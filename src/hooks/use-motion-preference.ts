import { useSyncExternalStore } from "react";

/**
 * D02: one motion-preference contract, replacing three independent
 * `window.matchMedia("(prefers-reduced-motion: reduce)")` checks
 * (use-stack-gesture.ts, CourtLaneStack.tsx x2, CourtFocusView.tsx) that
 * only ever looked at the OS setting, plus Me's own reduced-motion toggle
 * that wrote to localStorage and toggled a CSS class nothing else read.
 *
 * Effective reduction = OS `prefers-reduced-motion: reduce` OR the
 * stored app-level preference -- either one is enough to reduce motion,
 * matching the accepted contract that this is a device-level
 * accessibility preference, not something that needs per-account storage.
 */
const STORAGE_KEY = "katalist.reduced_motion";
/** Exported for callers that need to react to a change outside React state
 *  (e.g. killing an in-flight GSAP tween), not just via the hooks below. */
export const MOTION_PREFERENCE_BROADCAST_EVENT = "katalist-motion-preference-changed";
const BROADCAST_EVENT = MOTION_PREFERENCE_BROADCAST_EVENT;

function getStoredPreference(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** The app-level override alone (not OR'd with the OS setting) -- for a
 *  settings toggle that must reflect what the user explicitly chose here,
 *  not whether motion happens to be reduced for an unrelated OS reason. */
export function getStoredMotionPreference(): boolean {
  return getStoredPreference();
}

function getOsPreference(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** One-shot synchronous read for call sites that aren't React state (a
 *  callback or effect deciding, at the moment it runs, whether to animate
 *  this one transition) rather than a component that needs to re-render
 *  when the preference changes later. */
export function getEffectiveReducedMotion(): boolean {
  return getOsPreference() || getStoredPreference();
}

export function setStoredMotionPreference(reduceMotion: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, reduceMotion ? "1" : "0");
  } catch {
    // Storage can be unavailable (quota, privacy mode) -- the in-memory
    // OS preference still applies; only the app-level override is lost.
  }
  window.dispatchEvent(new CustomEvent(BROADCAST_EVENT));
}

/** D08: exported so an imperative (non-React-state) consumer -- e.g. a
 *  GSAP tween that must snap to its end state the instant motion becomes
 *  reduced -- can share the exact same OS/storage/broadcast wiring the
 *  hooks below use, instead of re-deriving its own `matchMedia` listener. */
export function subscribeToMotionPreference(callback: () => void): () => void {
  return subscribe(callback);
}

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const onStorage = (event: StorageEvent) => {
    // event.key is null when localStorage.clear() was called elsewhere.
    if (event.key === null || event.key === STORAGE_KEY) callback();
  };
  mediaQuery.addEventListener("change", callback);
  window.addEventListener("storage", onStorage);
  window.addEventListener(BROADCAST_EVENT, callback);
  return () => {
    mediaQuery.removeEventListener("change", callback);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(BROADCAST_EVENT, callback);
  };
}

function getServerSnapshot(): boolean {
  return false;
}

/** Reactive hook for components that must re-render when the effective
 *  preference changes (a gesture hook that needs to stay in sync for as
 *  long as it's mounted). Hydration-safe: the server snapshot is always
 *  `false` (the server can't know the client's OS/localStorage state),
 *  and the real value is read after mount. */
export function useMotionPreference(): {
  reduceMotion: boolean;
  setReduceMotion: (next: boolean) => void;
} {
  const reduceMotion = useSyncExternalStore(subscribe, getEffectiveReducedMotion, getServerSnapshot);
  return { reduceMotion, setReduceMotion: setStoredMotionPreference };
}

/** Same as useMotionPreference, but reflects only the stored app-level
 *  override (not OR'd with the OS setting) -- for the Me settings toggle
 *  itself, which must show what was explicitly chosen here, and must stay
 *  in sync if changed from another tab or another mounted instance. */
export function useStoredMotionPreference(): {
  reduceMotion: boolean;
  setReduceMotion: (next: boolean) => void;
} {
  const reduceMotion = useSyncExternalStore(subscribe, getStoredMotionPreference, getServerSnapshot);
  return { reduceMotion, setReduceMotion: setStoredMotionPreference };
}
