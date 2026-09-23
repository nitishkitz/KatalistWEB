import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { ContextKind } from "@/domain/thing";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { useQueryClient } from "@tanstack/react-query";
import { currentDemoActorId } from "@/features/demo/identities";
import { getIdentityEpoch, isEpochCurrent } from "@/features/realtime/identity-cache-policy";

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
      // Context changes don't advance the identity epoch (they aren't an
      // identity change), but this function can still straddle one: an
      // update started under identity A can complete after a switch to
      // B, and the profile-update RPC above binds `user.id` from this
      // closure's own render, which may already be A's stale id by the
      // time the awaited call resolves. Captured here so the completion
      // can be guarded even though nothing about context itself is
      // epoch-scoped.
      const epoch = getIdentityEpoch(qc).epoch;
      setContextState(next);
      if (typeof window !== "undefined") {
        const key = isPreviewSession(session) ? demoContextKey() : STORAGE_KEY;
        window.localStorage.setItem(key, next);
      }
      if (user && !isPreviewSession(session)) {
        const { error } = await supabase.from("profiles").update({ active_context: next }).eq("id", user.id);
        if (error) {
          // Only roll back the optimistic context flip if this identity
          // is still the one that's current -- rolling back to A's
          // `prev` value after B is already active would incorrectly
          // overwrite B's own context state.
          if (isEpochCurrent(qc, epoch)) {
            setContextState(prev);
            window.localStorage.setItem(STORAGE_KEY, prev);
          }
          throw error;
        }
      }
      // A full, keyless invalidateQueries() after a since-completed
      // identity switch would force an unnecessary refetch storm right
      // as B's UI has settled -- IdentityBoundary's own resetQueries()
      // on the switch already handles B's cache correctly, so this call
      // has nothing useful left to do once the epoch has moved on.
      if (!isEpochCurrent(qc, epoch)) return;
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
