import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { InteractionBlockerContext, type InteractionBlockerContextValue } from "./use-interaction-blocker";

/**
 * D03: a small registry of "something is actively using the user's
 * attention right now" reasons -- an active call, an open blocking
 * dialog, a composer with unsaved text. Morning Brief (F04) checks this
 * before auto-opening so it doesn't interrupt any of them. This is
 * deliberately NOT a second general application state store: it holds
 * nothing but a set of opaque reason strings and a count, with no
 * knowledge of what any particular reason means.
 */
export function InteractionBlockerProvider({ children }: { children: ReactNode }) {
  const [reasons, setReasons] = useState<ReadonlySet<string>>(() => new Set());
  // Multiple registrations can share the same reason string (e.g. two
  // mounted dialogs both registering "modal") -- a plain count per reason
  // so the last one to unregister is the one that actually clears it.
  const countsRef = useRef(new Map<string, number>());

  const registerBlocker = useCallback((reason: string) => {
    const counts = countsRef.current;
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
    setReasons(new Set(counts.keys()));
    let released = false;
    return () => {
      if (released) return; // idempotent -- a Strict Mode double-invoke must not double-decrement
      released = true;
      const next = (counts.get(reason) ?? 1) - 1;
      if (next <= 0) counts.delete(reason);
      else counts.set(reason, next);
      setReasons(new Set(counts.keys()));
    };
  }, []);

  const value = useMemo<InteractionBlockerContextValue>(
    () => ({
      isBlocked: reasons.size > 0,
      blockedReasons: [...reasons],
      registerBlocker,
    }),
    [reasons, registerBlocker],
  );

  return <InteractionBlockerContext.Provider value={value}>{children}</InteractionBlockerContext.Provider>;
}
