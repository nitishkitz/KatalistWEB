import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { ContextKind } from "@/domain/thing";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { useQueryClient } from "@tanstack/react-query";

const STORAGE_KEY = "katalist.active_context";

type AppCtx = {
  context: ContextKind;
  setContext: (next: ContextKind) => Promise<void>;
};

const Ctx = createContext<AppCtx | null>(null);

export function AppContextProvider({ children }: { children: ReactNode }) {
  const { user, session } = useSession();
  const qc = useQueryClient();
  const [context, setContextState] = useState<ContextKind>(() => {
    if (typeof window === "undefined") return "work";
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "home" || stored === "work" ? stored : "work";
  });

  useEffect(() => {
    if (!user || isPreviewSession(session)) return;
    let cancelled = false;
    supabase
      .from("profiles")
      .select("active_context")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data?.active_context) return;
        setContextState(data.active_context);
        window.localStorage.setItem(STORAGE_KEY, data.active_context);
      });
    return () => {
      cancelled = true;
    };
  }, [user, session]);

  const setContext = useCallback(
    async (next: ContextKind) => {
      setContextState(next);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, next);
      }
      if (user && !isPreviewSession(session)) {
        await supabase.from("profiles").update({ active_context: next }).eq("id", user.id);
      }
      await qc.invalidateQueries();
    },
    [user, session, qc],
  );

  return <Ctx.Provider value={{ context, setContext }}>{children}</Ctx.Provider>;
}

export function useAppContext() {
  const value = useContext(Ctx);
  if (!value) {
    throw new Error("useAppContext must be used within AppContextProvider");
  }
  return value;
}
