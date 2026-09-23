import type { QueryClient } from "@tanstack/react-query";
import type { Thing } from "@/domain/thing";

type ThingPatch = Partial<Thing> | ((thing: Thing) => Thing);

function applyPatch(thing: Thing, patch: ThingPatch): Thing {
  return typeof patch === "function" ? patch(thing) : { ...thing, ...patch };
}

type CourtCache = { things: Thing[]; myActorId: string | null };

/**
 * Cancels in-flight reads that could race with an optimistic write to this
 * Thing. Call before patchThingInCaches so a still-in-flight Court/Thing
 * fetch can't land after the optimistic patch and silently overwrite it
 * with pre-mutation data.
 */
export async function cancelThingReads(qc: QueryClient, thingId: string): Promise<void> {
  await Promise.all([
    qc.cancelQueries({ queryKey: ["court"] }),
    qc.cancelQueries({ queryKey: ["thing", thingId] }),
  ]);
}

/**
 * Applies `patch` to this Thing everywhere it's currently cached — the
 * single-Thing cache (keys.thing) and every Court query's `things` array
 * (any profile/context key), without forcing a refetch. Returns a function
 * that restores the pre-patch snapshot, for rollback if the mutation that
 * motivated the patch fails.
 *
 * Scope: only the Court and single-Thing caches are patched. List/Bucket
 * caches (list-things, bucket-items) are left to invalidatePersonalSurfaces'
 * broader invalidate-and-refetch, which already runs on success — this
 * covers the two highest-traffic surfaces (Court, an open Thing detail
 * panel) without guessing at every list/bucket cache's shape.
 */
export function patchThingInCaches(qc: QueryClient, thingId: string, patch: ThingPatch): () => void {
  const restoreFns: Array<() => void> = [];

  const thingKey = ["thing", thingId] as const;
  const previousThing = qc.getQueryData<Thing | null>(thingKey);
  if (previousThing) {
    qc.setQueryData<Thing | null>(thingKey, applyPatch(previousThing, patch));
    restoreFns.push(() => qc.setQueryData(thingKey, previousThing));
  }

  for (const query of qc.getQueryCache().findAll({ queryKey: ["court"] })) {
    const key = query.queryKey;
    const previous = qc.getQueryData<CourtCache>(key);
    const index = previous?.things.findIndex((t) => t.id === thingId) ?? -1;
    if (!previous || index === -1) continue;
    const nextThings = previous.things.slice();
    nextThings[index] = applyPatch(previous.things[index], patch);
    qc.setQueryData<CourtCache>(key, { ...previous, things: nextThings });
    restoreFns.push(() => qc.setQueryData(key, previous));
  }

  return () => {
    for (const restore of restoreFns) restore();
  };
}

/**
 * Wraps a canonical Thing mutation with cancel-then-patch-then-rollback:
 * cancels conflicting reads, applies `patch` to every cache that has this
 * Thing, runs `fn`, and restores the pre-patch snapshot if `fn` throws
 * (rethrowing so the caller's own error handling — e.g. a useMutation
 * onError toast — still runs). On success, the patch is left in place;
 * whatever invalidation the caller already does afterward (e.g.
 * invalidatePersonalSurfaces) will settle it to server truth shortly after.
 */
export function withOptimisticPatch(
  qc: QueryClient,
  thingId: string,
  patch: ThingPatch,
  fn: () => Promise<unknown>,
): () => Promise<unknown> {
  return async () => {
    await cancelThingReads(qc, thingId);
    const rollback = patchThingInCaches(qc, thingId, patch);
    try {
      return await fn();
    } catch (error) {
      rollback();
      throw error;
    }
  };
}
