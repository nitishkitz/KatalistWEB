import { createContext, useContext } from "react";
import type { ContextKind } from "@/domain/thing";

/**
 * Extracted from AppContextProvider.tsx so that file exports only the
 * component itself -- react-refresh/only-export-components otherwise warns
 * when a component file also exports a hook (same reason
 * use-interaction-blocker.ts's hook was split out of its own provider).
 */
export type AppCtx = {
  context: ContextKind;
  setContext: (next: ContextKind) => Promise<void>;
};

export const AppContext = createContext<AppCtx | null>(null);

export function useAppContext(): AppCtx {
  const value = useContext(AppContext);
  if (!value) throw new Error("useAppContext must be used within AppContextProvider");
  return value;
}
