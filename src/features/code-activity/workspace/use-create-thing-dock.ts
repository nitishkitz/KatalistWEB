import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { registerMagicBoxHandler, requestMagicBoxFocus } from "@/features/court/magic-box-entry";

/** Opens, focuses and closes the Create Thing dock. Registered as the one handler the global shortcut and every Create Thing button share. */
export function useCreateThingDock(enabled: boolean) {
  const [open, setOpen] = useState(false);
  const returnTo = useRef<HTMLElement | null>(null);
  const focusFrame = useRef<number | null>(null);
  useEffect(() => () => {
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
  }, []);

  const reveal = () => {
    if (!enabled) return false;
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body && !document.activeElement.closest("[data-create-thing-dock]")) returnTo.current = document.activeElement;
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    // Render now, so the composer is visible and mounted before it is asked to take focus.
    flushSync(() => setOpen(true));
    requestMagicBoxFocus();
    // The Magic Box ignores focus requests until it is mounted and visible, and React renders after this call returns, so
    // ask again on the next frames until focus is inside the dock (bounded: about a third of a second at 60 Hz).
    let attempts = 0;
    const focusWhenReady = () => {
      focusFrame.current = null;
      requestMagicBoxFocus();
      const dock = document.querySelector("[data-create-thing-dock]");
      if ((dock && dock.contains(document.activeElement)) || (attempts += 1) >= 20) return;
      focusFrame.current = requestAnimationFrame(focusWhenReady);
    };
    focusFrame.current = requestAnimationFrame(focusWhenReady);
    return true;
  };
  const revealRef = useRef(reveal);
  revealRef.current = reveal;

  useEffect(() => {
    if (!enabled) return;
    return registerMagicBoxHandler(() => revealRef.current());
  }, [enabled]);

  const close = () => {
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    focusFrame.current = null;
    setOpen(false);
    const target = returnTo.current;
    returnTo.current = null;
    if (target && document.contains(target)) focusFrame.current = requestAnimationFrame(() => {
      focusFrame.current = null;
      target.focus({ preventScroll: true });
    });
  };
  return { open, reveal, close };
}
