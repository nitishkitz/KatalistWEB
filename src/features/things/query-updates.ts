import type { QueryClient } from "@tanstack/react-query";
import type { Thing } from "@/domain/thing";

type ThingPatch = Partial<Thing> | ((thing: Thing) => Thing);

function applyPatch(thing: Thing, patch: ThingPatch): Thing {
  return typeof patch === "function" ? patch(thing) : { ...thing, ...patch };
}

/**
 * Plain structural equality for Thing objects (only plain
 * strings/booleans/nulls/nested plain objects/arrays — no Date/Map/Set
 * fields). Used instead of `===` to detect "has anyone else touched this
 * Thing since my patch": QueryClient's structural sharing rebuilds a new
 * object on every setQueryData call even when the values are unchanged, so
 * a reference-identity check would treat every write as "something else
 * changed it" and skip rollback far too often.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) =>
    deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
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

type RestoreEntry =
  | { kind: "thing"; queryKey: readonly unknown[]; previousThing: Thing; patchedThing: Thing }
  | { kind: "court"; queryKey: readonly unknown[]; previousThing: Thing; patchedThing: Thing };

/**
 * Applies `patch` to this Thing everywhere it's currently cached — the
 * single-Thing cache (keys.thing) and every Court query's `things` array
 * (any profile/context key), without forcing a refetch. Returns a function
 * that restores just this mutation's own change, for rollback if the
 * mutation that motivated the patch fails.
 *
 * Rollback is scoped to this one Thing, and only undoes it if the cache
 * still holds (structurally — see deepEqual, since QueryClient's
 * structural sharing means it won't be the same *reference*) the value
 * this call wrote. If anything else touched this Thing since — another
 * mutation's own patch, a realtime update, a completed refetch — that
 * newer value wins and rollback leaves it alone. An earlier version
 * restored the *entire* previous Court query snapshot on rollback, which
 * meant one failed mutation could silently erase an unrelated Thing's
 * independent update, a newly-arrived Thing, or a newer write to this same
 * Thing — this is why rollback re-reads the *current* cache at rollback
 * time rather than replaying an old blob.
 *
 * Scope: only the Court and single-Thing caches are patched. List/Bucket
 * caches (list-things, bucket-items) are left to invalidatePersonalSurfaces'
 * broader invalidate-and-refetch, which already runs on success — this
 * covers the two highest-traffic surfaces (Court, an open Thing detail
 * panel) without guessing at every list/bucket cache's shape.
 */
export function patchThingInCaches(qc: QueryClient, thingId: string, patch: ThingPatch): () => void {
  const restoreEntries: RestoreEntry[] = [];

  const thingKey = ["thing", thingId] as const;
  const previousThing = qc.getQueryData<Thing | null>(thingKey);
  if (previousThing) {
    const patchedThing = applyPatch(previousThing, patch);
    qc.setQueryData<Thing | null>(thingKey, patchedThing);
    restoreEntries.push({ kind: "thing", queryKey: thingKey, previousThing, patchedThing });
  }

  for (const query of qc.getQueryCache().findAll({ queryKey: ["court"] })) {
    const key = query.queryKey;
    const previous = qc.getQueryData<CourtCache>(key);
    const index = previous?.things.findIndex((t) => t.id === thingId) ?? -1;
    if (!previous || index === -1) continue;
    const previousCourtThing = previous.things[index];
    const patchedThing = applyPatch(previousCourtThing, patch);
    const nextThings = previous.things.slice();
    nextThings[index] = patchedThing;
    qc.setQueryData<CourtCache>(key, { ...previous, things: nextThings });
    restoreEntries.push({ kind: "court", queryKey: key, previousThing: previousCourtThing, patchedThing });
  }

  return () => {
    for (const entry of restoreEntries) {
      if (entry.kind === "thing") {
        const current = qc.getQueryData<Thing | null>(entry.queryKey);
        if (current && deepEqual(current, entry.patchedThing)) {
          qc.setQueryData(entry.queryKey, entry.previousThing);
        }
        continue;
      }
      const current = qc.getQueryData<CourtCache>(entry.queryKey);
      if (!current) continue;
      const index = current.things.findIndex((t) => t.id === thingId);
      if (index === -1 || !deepEqual(current.things[index], entry.patchedThing)) continue;
      const nextThings = current.things.slice();
      nextThings[index] = entry.previousThing;
      qc.setQueryData<CourtCache>(entry.queryKey, { ...current, things: nextThings });
    }
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
