import { createContext, useContext, useEffect } from "react";

/**
 * Extracted from InteractionBlockerProvider.tsx so that file exports only
 * the component itself -- react-refresh/only-export-components otherwise
 * warns when a component file also exports hooks/context (same reason
 * IdentityBoundary.tsx's useCurrentIdentity was pulled into its own file).
 */
export type InteractionBlockerContextValue = {
  isBlocked: boolean;
  blockedReasons: readonly string[];
  registerBlocker: (reason: string) => () => void;
};

export const InteractionBlockerContext = createContext<InteractionBlockerContextValue | null>(null);

export function useInteractionBlocker(): InteractionBlockerContextValue {
  const value = useContext(InteractionBlockerContext);
  if (!value) throw new Error("useInteractionBlocker must be used within InteractionBlockerProvider");
  return value;
}

/** Convenience for the common case: register a reason for exactly as long
 *  as `active` is true, unregistering automatically on false or unmount.
 *  e.g. `useBlockWhile(callState !== "idle", "active-call")`. */
export function useBlockWhile(active: boolean, reason: string): void {
  const { registerBlocker } = useInteractionBlocker();
  useEffect(() => {
    if (!active) return;
    return registerBlocker(reason);
  }, [active, reason, registerBlocker]);
}
