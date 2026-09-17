import { useEffect } from "react";
import { useSyncExternalStore } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";

/**
 * App-wide online presence over a shared Supabase Realtime presence channel.
 * Every client that mounts `usePresence` tracks itself (keyed by profile id),
 * so the returned set reflects who currently has the app open. This backs the
 * Team screen's "Online" status with real data instead of a hard-coded value.
 */
let onlineIds: Set<string> = new Set();
const listeners = new Set<() => void>();
let channel: RealtimeChannel | null = null;
let refCount = 0;

function emit() {
  for (const l of listeners) l();
}

function ensureChannel(selfId: string) {
  refCount += 1;
  if (channel) return;
  const ch = supabase.channel("presence:team", {
    config: { presence: { key: selfId } },
  });
  ch.on("presence", { event: "sync" }, () => {
    onlineIds = new Set(Object.keys(ch.presenceState()));
    emit();
  }).subscribe((status) => {
    if (status === "SUBSCRIBED") void ch.track({ online_at: new Date().toISOString() });
  });
  channel = ch;
}

function releaseChannel() {
  refCount = Math.max(0, refCount - 1);
  if (refCount === 0 && channel) {
    const ch = channel;
    channel = null;
    onlineIds = new Set();
    emit();
    void supabase.removeChannel(ch);
  }
}

/** Track this client as online and subscribe to the live set of online ids. */
export function usePresence(): Set<string> {
  const { user } = useSession();
  const selfId = user?.id;
  useEffect(() => {
    if (!selfId) return;
    ensureChannel(selfId);
    return () => releaseChannel();
  }, [selfId]);
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => onlineIds,
    () => onlineIds,
  );
}
