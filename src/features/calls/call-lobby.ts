import { supabase } from "@/integrations/supabase/client";

/**
 * In-app incoming-call "ring" over Supabase Realtime. When someone starts a
 * list call, they broadcast a ring to a shared lobby channel; every signed-in
 * client listens and shows an incoming-call banner if it's addressed to them.
 *
 * Targeting: `memberIds` are the list members' profile ids (matched against the
 * recipient's user id). `fromDeviceId` is a per-device id so the SAME account on
 * a second device still rings (only the exact sending device is excluded).
 */
export type RingPayload = {
  listId: string;
  listName: string;
  fromDeviceId: string;
  fromName: string;
  memberIds: string[];
  /** Conversation kind, so the ring routes to /team (dm/group) vs /lists. */
  kind?: "dm" | "group" | "list";
};

const LOBBY = "calls-lobby";

let deviceId: string | null = null;
/** Stable-per-tab device id, used to distinguish devices of the same account. */
export function getDeviceId(): string {
  if (deviceId) return deviceId;
  try {
    const existing = sessionStorage.getItem("katalist.deviceId");
    if (existing) {
      deviceId = existing;
      return deviceId;
    }
  } catch {
    /* ignore */
  }
  deviceId =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  try {
    sessionStorage.setItem("katalist.deviceId", deviceId);
  } catch {
    /* ignore */
  }
  return deviceId;
}

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
  setTimeout(() => void supabase.removeChannel(channel), 2000);
}

/** Subscribe to incoming rings addressed to `selfUserId` (excluding this device). */
export function subscribeToRings(
  selfUserId: string,
  selfDeviceId: string,
  onRing: (p: RingPayload) => void,
): () => void {
  const channel = supabase.channel(LOBBY);
  channel
    .on("broadcast", { event: "ring" }, ({ payload }) => {
      const p = payload as RingPayload | undefined;
      if (!p || p.fromDeviceId === selfDeviceId) return;
      if (!Array.isArray(p.memberIds) || !p.memberIds.includes(selfUserId)) return;
      onRing(p);
    })
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
