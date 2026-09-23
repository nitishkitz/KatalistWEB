import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { invalidatePersonalSurfaces } from "@/features/things/personal-shred";
import { getIdentityEpoch, isEpochCurrent } from "@/features/realtime/identity-cache-policy";
import { useCurrentIdentity } from "@/features/realtime/use-current-identity";
import { targetsForEvent, type RealtimeTable } from "@/features/realtime/event-invalidation-map";
import { createInvalidationBatcher } from "@/features/realtime/invalidation-batcher";

const WATCHED_TABLES: RealtimeTable[] = [
  "things",
  "thing_comments",
  "thing_activity",
  "nudges",
  "notifications",
  "list_messages",
  "bucket_items",
  "list_members",
  "list_meetings",
  "profile_object_state",
];

/**
 * P7: the single application-level owner of database-change
 * invalidation, replacing use-realtime.ts's AppShell-mounted hook.
 *
 * Mounted once, inside IdentityBoundary's remounted children (see
 * __root.tsx) -- NOT inside AppShell, so route transitions (Court ->
 * Lists -> Buckets -> Nudges, all rendering different AppShell-hosted
 * route components) never create a second owner, and a real identity
 * change (which DOES remount this subtree) naturally disposes the old
 * owner and mounts a fresh one, in that order, before the new
 * identity's queries are even eligible to render -- the epoch/
 * disposal/remount machinery already built for P3 is what makes "key
 * the controller lifecycle by identity, not a boolean" hold here
 * without this component needing its own separate identity-tracking
 * logic.
 *
 * Starts a channel only for a resolved live/preview identity (never
 * "pending"/"none" -- IdentityBoundary already guarantees this
 * component is never rendered for "pending", and "none" is excluded
 * explicitly below, matching use-realtime.ts's original `real` guard).
 */
export function RealtimeInvalidationProvider() {
  const identity = useCurrentIdentity();
  const qc = useQueryClient();
  // Demo/preview sessions use local-state, not real Postgres tables --
  // matches use-realtime.ts's original `provider !== "demo"` exclusion.
  const shouldSubscribe = identity.kind === "live";
  const subscriptionStatusRef = useRef<"never-subscribed" | "initial" | "reconnected">("never-subscribed");

  useEffect(() => {
    if (!shouldSubscribe) return;

    // Captured once per mount (i.e. per identity, given this component
    // remounts on every real identity change) -- every batched
    // invalidation this instance ever triggers is guarded against
    // having been queued by a callback that fires after this specific
    // identity has already retired (defense in depth; the remount
    // itself already tears this effect down via its cleanup below,
    // but a callback already queued in the microtask/event loop at
    // teardown time is exactly what an epoch check protects against).
    const epoch = getIdentityEpoch(qc).epoch;

    const batcher = createInvalidationBatcher({
      invalidate: (target) => {
        if (!isEpochCurrent(qc, epoch)) return;
        if (target[0] === "__personal-surfaces__") {
          void invalidatePersonalSurfaces(qc, epoch);
          return;
        }
        void qc.invalidateQueries({ queryKey: target });
      },
    });

    const channel = supabase.channel("katalist-movement");
    for (const table of WATCHED_TABLES) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, () => {
        if (!isEpochCurrent(qc, epoch)) return;
        batcher.enqueue(targetsForEvent({ table }));
      });
    }
    // Distinguishes an initial subscription from a later reconnect --
    // P9's remit to act on (flushing/revalidating on a genuine
    // disconnected->subscribed transition); tracked here via a ref (not
    // state -- this component renders nothing) so that logic has
    // something to build on rather than needing its own separate
    // status plumbing.
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        subscriptionStatusRef.current = subscriptionStatusRef.current === "never-subscribed" ? "initial" : "reconnected";
      }
    });

    return () => {
      batcher.dispose();
      void supabase.removeChannel(channel);
    };
  }, [qc, shouldSubscribe]);

  return null;
}
