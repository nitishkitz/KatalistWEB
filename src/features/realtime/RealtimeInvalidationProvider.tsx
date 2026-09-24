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
  // A plain string (or undefined for pending/none), narrowed once here
  // via a direct check on identity.kind -- unlike identity itself,
  // this is safe to read unconditionally in the effect's dependency
  // array below, which is evaluated outside any narrowing scope.
  const myProfileId = identity.kind === "live" || identity.kind === "preview" ? identity.profileId : undefined;
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
      channel.on("postgres_changes", { event: "*", schema: "public", table }, (payload) => {
        if (!isEpochCurrent(qc, epoch)) return;
        batcher.enqueue(targetsForEvent({ table }));
        // P8/C-06 membership-revocation fast path: best-effort, NOT the
        // primary mechanism (the batched invalidate above, using the
        // expanded list_members target list, is what actually guarantees
        // coverage). If this DELETE's old row happens to identify OUR OWN
        // removed membership, invalidate the now-inaccessible List's own
        // surfaces immediately rather than waiting for the batcher's
        // debounce. Deliberately conditional on the payload actually
        // containing these fields: a DELETE payload may only include
        // primary-key columns unless the table's REPLICA IDENTITY is
        // FULL, which this code has no way to verify without live
        // database access (an open, blocked verification item -- see the
        // P8/P10 report).
        //
        // C-06: this used to call removeQueries(), which deletes the
        // query object outright -- for an ALREADY-MOUNTED, already-fresh
        // observer (e.g. the exact List detail page the user is looking
        // at when their access is revoked), that silently defeats the
        // batched invalidateQueries() enqueued just above: invalidating a
        // query that no longer exists in the cache is a no-op, so the
        // mounted observer never actually re-fetched and never
        // discovered the access loss (confirmed directly against a bare
        // QueryObserver: invalidateQueries after removeQueries left the
        // fetch count unchanged). invalidateQueries alone both forces an
        // immediate refetch for any currently-active observer AND marks
        // the query invalidated for the next time it's observed even
        // while inactive -- it does not require anything to have been
        // removed first.
        if (
          table === "list_members" &&
          payload?.eventType === "DELETE" &&
          payload.old?.profile_id === myProfileId &&
          typeof payload.old?.list_id === "string"
        ) {
          const listId = payload.old.list_id;
          void qc.invalidateQueries({ queryKey: ["list", listId] });
          void qc.invalidateQueries({ queryKey: ["list-messages", listId] });
          void qc.invalidateQueries({ queryKey: ["list-message-attachments", listId] });
          void qc.invalidateQueries({ queryKey: ["list-system-history", listId] });
          void qc.invalidateQueries({ queryKey: ["list-message-search", listId] });
          void qc.invalidateQueries({ queryKey: ["list-pinned-messages", listId] });
          void qc.invalidateQueries({ queryKey: ["hub-conversation", listId] });
          void qc.invalidateQueries({ queryKey: ["hub-files", listId] });
        }
      });
    }
    // P9: distinguishes an initial subscription from a later reconnect.
    // Realtime does not replay a backlog of missed events for the time
    // spent disconnected, so a genuine reconnect (SUBSCRIBED again,
    // having already been subscribed once before) revalidates
    // everything this owner watches, rather than assuming nothing
    // relevant changed while offline. Routed through the SAME batcher
    // as ordinary events -- still epoch-guarded, and naturally
    // coalesced with whatever else is already pending. Repeated
    // SUBSCRIBED notifications firing in quick succession (Supabase can
    // call this more than once around one real reconnect) don't cause
    // repeated catch-up passes: each call re-enqueues the same
    // already-deduplicated target set, and the batcher's own debounce
    // still flushes it only once. This intentionally does not add any
    // separate handling for the browser's own online/focus events --
    // TanStack Query's existing refetchOnReconnect/refetchOnWindowFocus
    // defaults already own that, and adding a second, redundant
    // invalidation pass on top of them is exactly what the plan warns
    // against.
    channel.subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      const isReconnect = subscriptionStatusRef.current !== "never-subscribed";
      subscriptionStatusRef.current = isReconnect ? "reconnected" : "initial";
      if (isReconnect && isEpochCurrent(qc, epoch)) {
        for (const table of WATCHED_TABLES) {
          batcher.enqueue(targetsForEvent({ table }));
        }
      }
    });

    return () => {
      batcher.dispose();
      void supabase.removeChannel(channel);
    };
    // myProfileId is read inside this effect (the membership-revocation
    // fast path) but should never actually change while this component
    // stays mounted -- a real identity change already remounts this
    // whole subtree via IdentityBoundary's key, tearing this effect down
    // and running a fresh one for the new identity before this
    // dependency could differ. Included anyway for defense-in-depth
    // rather than suppressed, in case that invariant is ever violated.
  }, [qc, shouldSubscribe, myProfileId]);

  return null;
}
