import { supabase } from "@/integrations/supabase/client";

/**
 * In-app incoming-call "ring" over Supabase Realtime. When someone starts a
 * list call, they broadcast a ring to a shared lobby channel; every signed-in
 * client listens and shows an incoming-call banner if it's addressed to them.
 * No Firebase needed — this works while the app is open.
 */
export type RingPayload = {
  listId: string;
  listName: string;
  fromId: string;
  fromName: string;
  memberIds: string[];
};

const LOBBY = "calls-lobby";

/** Broadcast an incoming-call ring to a list's members (fire-and-forget). */
export async function announceCall(payload: RingPayload): Promise<void> {
  const channel = supabase.channel(LOBBY);
  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        void channel.send({ type: "broadcast", event: "ring", payload }).finally(done);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        done();
      }
    });
  });
  // Tear the temporary sender channel down shortly after.
  setTimeout(() => void supabase.removeChannel(channel), 2000);
}

/** Subscribe to incoming rings addressed to `selfId`. Returns an unsubscribe fn. */
export function subscribeToRings(selfId: string, onRing: (p: RingPayload) => void): () => void {
  const channel = supabase.channel(LOBBY);
  channel
    .on("broadcast", { event: "ring" }, ({ payload }) => {
      const p = payload as RingPayload | undefined;
      if (!p || p.fromId === selfId) return;
      if (!Array.isArray(p.memberIds) || !p.memberIds.includes(selfId)) return;
      onRing(p);
    })
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
