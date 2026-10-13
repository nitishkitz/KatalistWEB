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
  /** Caller's profile. Realtime rings without it are ignored (they cannot be checked). */
  fromUserId?: string;
  fromAvatarUrl?: string | null;
  memberIds: string[];
  callType?: "audio" | "video";
  /** Conversation kind, so the ring routes to /team (dm/group) vs /lists. */
  kind?: "dm" | "group" | "list";
};


/**
 * Rings handed over in-process, e.g. from a foreground push message. The
 * Realtime ring and the push travel separately; if the websocket is down the
 * push is the only one that arrives, and it should still show the call card.
 */
const localRingListeners = new Set<(p: RingPayload) => void>();

/** Returns false when nothing is listening (no signed-in app shell mounted). */
export function deliverLocalRing(payload: RingPayload): boolean {
  if (localRingListeners.size === 0) return false;
  localRingListeners.forEach((listener) => listener(payload));
  return true;
}

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

/**
 * Ring people through the server. The database records one ring per allowed
 * recipient with the caller taken from this session (never from the payload),
 * then the server pushes to devices. Returns how many people were rung.
 */
export async function ringPeople(input: { listId: string; memberIds: string[]; callType?: "audio" | "video" }): Promise<number> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return 0;
    const res = await fetch("/api/calls/ring", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
    });
    if (!res.ok) return 0;
    return ((await res.json()) as { rung?: number }).rung ?? 0;
  } catch {
    return 0;
  }
}

type RingRow = {
  id: string; list_id: string; caller_profile_id: string; recipient_profile_id: string; call_type: "audio" | "video" | null;
  caller_name: string; caller_avatar_url: string | null; list_name: string; list_kind: string; expires_at: string;
};

/**
 * Incoming rings are this user's own call_rings rows (Realtime applies RLS, so
 * only rows addressed to them arrive). The caller id comes from the database.
 */
export function subscribeToRings(
  selfUserId: string,
  _selfDeviceId: string,
  onRing: (p: RingPayload) => void,
): () => void {
  const channel = supabase
    .channel(`call-rings:${selfUserId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "call_rings", filter: `recipient_profile_id=eq.${selfUserId}` },
      ({ new: row }) => {
        const r = row as RingRow;
        if (!r || r.recipient_profile_id !== selfUserId || Date.parse(r.expires_at) < Date.now()) return;
        onRing({
          listId: r.list_id,
          listName: r.list_name,
          fromDeviceId: "server",
          fromName: r.caller_name,
          fromUserId: r.caller_profile_id,
          fromAvatarUrl: r.caller_avatar_url,
          memberIds: [selfUserId],
          callType: r.call_type ?? undefined,
          kind: r.list_kind === "dm" || r.list_kind === "group" ? r.list_kind : "list",
        });
      },
    )
    .subscribe();
  // Foreground push handed over in-process; the server already filtered it.
  const local = (p: RingPayload) => onRing(p);
  localRingListeners.add(local);
  return () => {
    localRingListeners.delete(local);
    void supabase.removeChannel(channel);
  };
}
