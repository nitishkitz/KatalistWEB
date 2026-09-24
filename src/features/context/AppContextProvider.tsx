import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { ContextKind } from "@/domain/thing";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { useQueryClient } from "@tanstack/react-query";
import { currentDemoActorId } from "@/features/demo/identities";
import { getIdentityEpoch, isEpochCurrent } from "@/features/realtime/identity-cache-policy";
import { AppContext } from "./use-app-context";

const STORAGE_KEY = "katalist.active_context";

function demoContextKey(): string {
  try {
    return `${STORAGE_KEY}.demo.${currentDemoActorId()}`;
  } catch {
    return STORAGE_KEY;
  }
}

/**
 * Live (non-preview) sessions used to store this under the bare STORAGE_KEY,
 * with no profile scoping at all -- on a shared device (or after switching
 * from one signed-in account to another) that let one profile's saved
 * work/home context leak onto a different profile. A prior unscoped value is
 * never read as a fallback for a *specific* profile below (there is no way
 * to know which profile actually wrote it); it is only best-effort removed
 * once a scoped key has been written, so it stops lingering in storage.
 */
function liveContextKey(profileId: string): string {
  return `${STORAGE_KEY}.live.${profileId}`;
}

export function AppContextProvider({ children }: { children: ReactNode }) {
  const { user, session } = useSession();
  const qc = useQueryClient();
  const preview = isPreviewSession(session);

  const [context, setContextState] = useState<ContextKind>(() => {
    if (typeof window === "undefined") return "work";
    if (preview) {
      const stored = window.localStorage.getItem(demoContextKey());
      return stored === "home" || stored === "work" ? stored : "work";
    }
    if (!user) return "work";
    const stored = window.localStorage.getItem(liveContextKey(user.id));
    return stored === "home" || stored === "work" ? stored : "work";
  });

  useEffect(() => {
    if (!preview || typeof window === "undefined") return;
    const key = demoContextKey();
    const stored = window.localStorage.getItem(key);
    setContextState(stored === "home" || stored === "work" ? stored : "work");
  }, [preview, session, user?.id]);

  // Seed from this profile's own scoped local cache as soon as its id is
  // known (e.g. session resolving after mount) -- fast, and avoids ever
  // reading another profile's or an unowned legacy unscoped value.
  useEffect(() => {
    if (preview || typeof window === "undefined" || !user) return;
    const stored = window.localStorage.getItem(liveContextKey(user.id));
    if (stored === "home" || stored === "work") setContextState(stored);
    // Depends on user?.id (the only part of `user` this reads), deliberately
    // narrower than the whole `user` object -- re-running this on every
    // other User field change (e.g. a token refresh) would needlessly
    // re-read localStorage without the id itself having changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, user?.id]);

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
        window.localStorage.setItem(liveContextKey(user.id), data.active_context);
        window.localStorage.removeItem(STORAGE_KEY);
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
      const isPreview = isPreviewSession(session);
      setContextState(next);
      if (typeof window !== "undefined") {
        const key = isPreview ? demoContextKey() : user ? liveContextKey(user.id) : null;
        if (key) window.localStorage.setItem(key, next);
      }
      if (user && !isPreview) {
        const { error } = await supabase.from("profiles").update({ active_context: next }).eq("id", user.id);
        if (error) {
          // Only roll back the optimistic context flip if this identity
          // is still the one that's current -- rolling back to A's
          // `prev` value after B is already active would incorrectly
          // overwrite B's own context state.
          if (isEpochCurrent(qc, epoch)) {
            setContextState(prev);
            window.localStorage.setItem(liveContextKey(user.id), prev);
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

  return <AppContext.Provider value={{ context, setContext }}>{children}</AppContext.Provider>;
}
