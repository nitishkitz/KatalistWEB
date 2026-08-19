import { useCallback, useEffect, useState } from "react";
import type { ContextKind } from "@/domain/thing";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";

const STORAGE_KEY = "katalist.active_context";

export function useAppContext() {
  const { user } = useSession();
  const [context, setContextState] = useState<ContextKind>(() => {
    if (typeof window === "undefined") return "work";
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "home" || stored === "work" ? stored : "work";
  });

  useEffect(() => {
    if (!user || user.app_metadata?.provider === "demo") return;
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
  }, [user]);

  const setContext = useCallback(
    async (next: ContextKind) => {
      setContextState(next);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, next);
      }
      if (!user || user.app_metadata?.provider === "demo") return;
      await supabase.from("profiles").update({ active_context: next }).eq("id", user.id);
    },
    [user],
  );

  return { context, setContext };
}
