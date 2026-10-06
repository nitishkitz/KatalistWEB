export const MAGIC_BOX_FOCUS_EVENT = "katalist:focus-magic-box";

/** Focus the currently visible Magic Box after navigation has reached Court. */
export function requestMagicBoxFocus() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(MAGIC_BOX_FOCUS_EVENT));
}
