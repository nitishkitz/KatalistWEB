import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/**
 * P8: a tested, reference-counted, single-owner registry for the
 * per-list `list-chat:${listId}` broadcast channel -- same pattern
 * already proven correct in this codebase for presence.ts's
 * "presence:team" channel, applied here because multiple mounted
 * consumers can independently call useListMessages(listId) for the
 * same List (e.g. a chat dock and a full List-detail view both open
 * on the same List at once). Without this, each consumer created its
 * OWN separate channel subscribed to the same broadcast name --
 * duplicate delivery isn't a correctness bug here (each consumer just
 * re-invalidates its own query), but it is duplicate channel overhead
 * with no benefit, and exactly the kind of thing this registry exists
 * to collapse into one owned subscription, detached only when the
 * last consumer leaves.
 *
 * Scoped by listId only, not by identity/profile -- the channel is
 * List-level shared infrastructure, matching its pre-existing name
 * shape (no profile dimension ever existed in `list-chat:${listId}`).
 * An identity switch naturally clears this registry's entries anyway:
 * IdentityBoundary's remount unmounts every mounted useListMessages
 * instance, each of which releases its own acquisition below, driving
 * every entry's refCount to 0 and tearing the channel down before the
 * new identity's (possibly different) consumers re-acquire fresh ones.
 */

type RegistryEntry = {
  channel: RealtimeChannel;
  refCount: number;
  listeners: Set<() => void>;
};

const registry = new Map<string, RegistryEntry>();

/**
 * Registers `onChanged` to be called whenever a "changed" broadcast
 * arrives for `listId`, creating the shared channel on the first
 * acquisition and reusing it for every subsequent one. Returns a
 * release function -- call it on cleanup (e.g. a useEffect's return).
 * The channel itself is only torn down once every acquirer has
 * released.
 */
export function acquireListChatChannel(listId: string, onChanged: () => void): () => void {
  let entry = registry.get(listId);
  if (!entry) {
    const listeners = new Set<() => void>();
    const channel = supabase
      .channel(`list-chat:${listId}`)
      .on("broadcast", { event: "changed" }, () => {
        for (const listener of listeners) listener();
      })
      .subscribe();
    entry = { channel, refCount: 0, listeners };
    registry.set(listId, entry);
  }
  entry.refCount += 1;
  entry.listeners.add(onChanged);

  let released = false;
  return () => {
    if (released) return; // idempotent -- a caller invoking the release twice (e.g. Strict Mode) must not double-decrement
    released = true;
    entry!.listeners.delete(onChanged);
    entry!.refCount -= 1;
    if (entry!.refCount <= 0) {
      registry.delete(listId);
      void supabase.removeChannel(entry!.channel);
    }
  };
}

/** Sends a "changed" broadcast on listId's shared channel, if one is currently open. A no-op if nothing has acquired it (nothing to notify). */
export function broadcastListChatChange(listId: string): void {
  const entry = registry.get(listId);
  if (!entry) return;
  void entry.channel.send({ type: "broadcast", event: "changed", payload: {} });
}

/** Test-only escape hatch: how many active acquirers a given listId currently has, and whether a channel is open for it. Not used by production code. */
export function debugRegistryState(listId: string): { refCount: number; channelOpen: boolean } {
  const entry = registry.get(listId);
  return { refCount: entry?.refCount ?? 0, channelOpen: Boolean(entry) };
}
