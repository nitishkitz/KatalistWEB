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

/**
 * Per-Thing ownership counters, scoped per QueryClient (so independent
 * QueryClients — e.g. in tests — never share state). One counter per
 * thingId, incremented once per patchThingInCaches call and stamped onto
 * every cache entry that call touches. This is what actually establishes
 * "am I still the most recent optimistic write to this Thing" — value
 * equality alone cannot: two different, overlapping mutations can
 * legitimately compute the *same* resulting value (e.g. both set
 * workStatus to "under_progress"), in which case a value-only check would
 * wrongly treat an older, failed mutation's rollback as still "mine" and
 * erase a newer mutation's identical-looking but actually-separate write.
 */
const versionsByClient = new WeakMap<QueryClient, Map<string, number>>();

function nextThingVersion(qc: QueryClient, thingId: string): number {
  let versions = versionsByClient.get(qc);
  if (!versions) {
    versions = new Map();
    versionsByClient.set(qc, versions);
  }
  const next = (versions.get(thingId) ?? 0) + 1;
  versions.set(thingId, next);
  return next;
}

function currentThingVersion(qc: QueryClient, thingId: string): number {
  return versionsByClient.get(qc)?.get(thingId) ?? 0;
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
 * Rollback only undoes this call's own write, verified two ways:
 * 1. Ownership: the per-Thing version counter (see nextThingVersion) must
 *    still equal the version this call was stamped with — if a later
 *    patchThingInCaches call for the same Thing has since run (whether or
 *    not it produced the same-looking value), that call now owns this
 *    Thing and this rollback is a no-op for it.
 * 2. No untracked external change: the cache must still hold (structurally
 *    — see deepEqual, since QueryClient's structural sharing means it
 *    won't be the same *reference*) the value this call wrote. This
 *    catches changes that don't go through this module at all — a
 *    completed refetch or a realtime update — which the version counter
 *    alone can't see since only patchThingInCaches calls bump it.
 * Both must hold; either one failing means something newer wins and
 * rollback leaves this cache entry alone. An earlier version restored the
 * *entire* previous Court query snapshot on rollback, which meant one
 * failed mutation could silently erase an unrelated Thing's independent
 * update, a newly-arrived Thing, or a newer write to this same Thing —
 * this is why rollback re-reads the *current* cache at rollback time
 * rather than replaying an old blob.
 *
 * Scope: only the Court and single-Thing caches are patched. List/Bucket
 * caches (list-things, bucket-items) are left to invalidatePersonalSurfaces'
 * broader invalidate-and-refetch, which already runs on success — this
 * covers the two highest-traffic surfaces (Court, an open Thing detail
 * panel) without guessing at every list/bucket cache's shape.
 */
export function patchThingInCaches(qc: QueryClient, thingId: string, patch: ThingPatch): () => void {
  const restoreEntries: RestoreEntry[] = [];
  let myVersion: number | null = null;
  const ownVersion = () => (myVersion ??= nextThingVersion(qc, thingId));

  const thingKey = ["thing", thingId] as const;
  const previousThing = qc.getQueryData<Thing | null>(thingKey);
  if (previousThing) {
    ownVersion();
    const patchedThing = applyPatch(previousThing, patch);
    qc.setQueryData<Thing | null>(thingKey, patchedThing);
    restoreEntries.push({ kind: "thing", queryKey: thingKey, previousThing, patchedThing });
  }

  for (const query of qc.getQueryCache().findAll({ queryKey: ["court"] })) {
    const key = query.queryKey;
    const previous = qc.getQueryData<CourtCache>(key);
    const index = previous?.things.findIndex((t) => t.id === thingId) ?? -1;
    if (!previous || index === -1) continue;
    ownVersion();
    const previousCourtThing = previous.things[index];
    const patchedThing = applyPatch(previousCourtThing, patch);
    const nextThings = previous.things.slice();
    nextThings[index] = patchedThing;
    qc.setQueryData<CourtCache>(key, { ...previous, things: nextThings });
    restoreEntries.push({ kind: "court", queryKey: key, previousThing: previousCourtThing, patchedThing });
  }

  return () => {
    if (myVersion == null || currentThingVersion(qc, thingId) !== myVersion) {
      // Either nothing was ever patched (no-op call), or a later mutation
      // on this Thing has since run — that one owns it now.
      return;
    }
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
