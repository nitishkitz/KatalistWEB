import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { ContextKind } from "@/domain/thing";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { useQueryClient } from "@tanstack/react-query";
import { currentDemoActorId } from "@/features/demo/identities";

const STORAGE_KEY = "katalist.active_context";

function demoContextKey(): string {
  try {
    return `${STORAGE_KEY}.demo.${currentDemoActorId()}`;
  } catch {
    return STORAGE_KEY;
  }
}

type AppCtx = {
  context: ContextKind;
  setContext: (next: ContextKind) => Promise<void>;
};

const Ctx = createContext<AppCtx | null>(null);

export function AppContextProvider({ children }: { children: ReactNode }) {
  const { user, session } = useSession();
  const qc = useQueryClient();
  const preview = isPreviewSession(session);

  const [context, setContextState] = useState<ContextKind>(() => {
    if (typeof window === "undefined") return "work";
    const key = preview ? demoContextKey() : STORAGE_KEY;
    const stored = window.localStorage.getItem(key);
    return stored === "home" || stored === "work" ? stored : "work";
  });

  useEffect(() => {
    if (!preview || typeof window === "undefined") return;
    const key = demoContextKey();
    const stored = window.localStorage.getItem(key);
    setContextState(stored === "home" || stored === "work" ? stored : "work");
  }, [preview, session, user?.id]);

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
      const prev = context;
      setContextState(next);
      if (typeof window !== "undefined") {
        const key = isPreviewSession(session) ? demoContextKey() : STORAGE_KEY;
        window.localStorage.setItem(key, next);
      }
      if (user && !isPreviewSession(session)) {
        const { error } = await supabase.from("profiles").update({ active_context: next }).eq("id", user.id);
        if (error) {
          setContextState(prev);
          window.localStorage.setItem(STORAGE_KEY, prev);
          throw error;
        }
      }
      await qc.invalidateQueries();
    },
    [user, session, qc, context],
  );

  return <Ctx.Provider value={{ context, setContext }}>{children}</Ctx.Provider>;
}

export function useAppContext() {
  const value = useContext(Ctx);
  if (!value) throw new Error("useAppContext must be used within AppContextProvider");
  return value;
}
