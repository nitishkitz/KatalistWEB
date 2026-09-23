import type { QueryClient } from "@tanstack/react-query";
import type { Thing } from "@/domain/thing";

export type ThingPatch = Partial<Thing> | ((thing: Thing) => Thing);

function applyPatch(thing: Thing, patch: ThingPatch): Thing {
  return typeof patch === "function" ? patch(thing) : { ...thing, ...patch };
}

/**
 * Plain structural equality for Thing objects (only plain
 * strings/booleans/nulls/nested plain objects/arrays — no Date/Map/Set
 * fields). Used instead of `===` to detect "has anyone else touched this
 * cache entry": QueryClient's structural sharing rebuilds a new object on
 * every setQueryData call even when the values are unchanged, so a
 * reference-identity check would treat every write as "something else
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
 * One entry per still-active (not yet rolled back) optimistic write to a
 * given cache location, in application order. `previousThing` is what was
 * there immediately before this entry was applied — i.e. the *previous
 * entry's* `patchedThing`, or the true pre-chain value for the first entry.
 */
type ChainEntry = { version: number; previousThing: Thing; patchedThing: Thing };

/**
 * Per-QueryClient, per-cache-location chains (so independent QueryClients —
 * e.g. in tests — never share state, and the single-Thing cache and each
 * Court query's copy of this Thing are tracked independently, since they
 * are independent cached copies that a given call may or may not have
 * found this Thing in).
 */
const chainsByClient = new WeakMap<QueryClient, Map<string, ChainEntry[]>>();

let nextVersionId = 0;

// Keyed by (queryKey, thingId) — not queryKey alone: a single Court query
// caches *many* Things, so without the thingId component every Thing
// sharing that Court query would incorrectly share one chain.
function locationKey(queryKey: readonly unknown[], thingId: string): string {
  return `${JSON.stringify(queryKey)}::${thingId}`;
}

function getChain(qc: QueryClient, queryKey: readonly unknown[], thingId: string): ChainEntry[] {
  let chains = chainsByClient.get(qc);
  if (!chains) {
    chains = new Map();
    chainsByClient.set(qc, chains);
  }
  const key = locationKey(queryKey, thingId);
  let chain = chains.get(key);
  if (!chain) {
    chain = [];
    chains.set(key, chain);
  }
  return chain;
}

/**
 * Records a new optimistic write in this location's chain. If the chain's
 * last known value doesn't match what's actually there (an external
 * change — a completed refetch, a realtime update, anything that didn't
 * go through this module) the recorded lineage is stale, so the chain is
 * reset and starts fresh from the real current value instead of risking a
 * later rollback resurrecting an old optimistic guess.
 */
function pushChainEntry(chain: ChainEntry[], version: number, previousThing: Thing, patchedThing: Thing) {
  const last = chain.at(-1);
  if (last && !deepEqual(last.patchedThing, previousThing)) {
    chain.length = 0;
  }
  chain.push({ version, previousThing, patchedThing });
}

/**
 * Removes `version`'s entry from this location's chain and, if it was the
 * most recently applied (tail) entry, returns the value that should now be
 * visible — the new tail's patchedThing, or the removed entry's own
 * previousThing if the chain is now empty. Returns `undefined` if the
 * entry wasn't the tail (nothing else needs to change — a still-active,
 * more recent write is already showing) or wasn't found at all.
 *
 * When the removed entry isn't the tail, the entry now immediately after
 * it (if any) has its `previousThing` corrected to bridge over the gap, so
 * a *later* rollback of that entry (or beyond) still unwinds to the right
 * value instead of one that included the now-removed write.
 */
function spliceChainEntry(chain: ChainEntry[], version: number): Thing | undefined {
  const index = chain.findIndex((entry) => entry.version === version);
  if (index === -1) return undefined;
  const [removed] = chain.splice(index, 1);
  const wasTail = index === chain.length;
  if (!wasTail) {
    chain[index] = { ...chain[index], previousThing: removed.previousThing };
    return undefined;
  }
  return chain.length > 0 ? chain.at(-1)!.patchedThing : removed.previousThing;
}

/**
 * Applies `patch` to this Thing everywhere it's currently cached — the
 * single-Thing cache (keys.thing) and every Court query's `things` array
 * (any profile/context key), without forcing a refetch. Returns a function
 * that restores just this mutation's own change, for rollback if the
 * mutation that motivated the patch fails.
 *
 * Each cache location tracks its own ordered chain of still-active
 * optimistic writes (see ChainEntry). Rolling back a write:
 * - If a *more recent* write to the same location is still active, the
 *   visible value is already that newer write's — this rollback only
 *   removes its own entry from the chain and leaves the cache alone.
 * - If it *is* the most recent (visible) write, the cache reverts to
 *   whichever write is now the new most-recent, or the true pre-chain
 *   value if none remain — not simply "my own previousThing", which
 *   would resurrect an already-failed intermediate value if an earlier
 *   write in the same chain had *also* failed and been removed.
 * Either way, the actual cache write only happens if the cache still
 * holds (structurally — see deepEqual) the value this entry produced;
 * anything else (a newer write already having changed it, or an external
 * refetch/realtime update) wins and this rollback leaves it alone.
 *
 * An earlier version restored the *entire* previous Court query snapshot
 * on rollback, which meant one failed mutation could silently erase an
 * unrelated Thing's independent update or a newly-arrived Thing — this is
 * why rollback re-reads the *current* cache at rollback time rather than
 * replaying an old blob. A version after that used a single "still the
 * most recent write" check without chain bookkeeping, which correctly
 * protected a newer write but — when *two* overlapping writes to the same
 * Thing both failed — restored the first (also-failed) write's value
 * instead of unwinding all the way back to the true original.
 *
 * Scope: only the Court and single-Thing caches are patched. List/Bucket
 * caches (list-things, bucket-items) are left to invalidatePersonalSurfaces'
 * broader invalidate-and-refetch, which already runs on success — this
 * covers the two highest-traffic surfaces (Court, an open Thing detail
 * panel) without guessing at every list/bucket cache's shape.
 */
export function patchThingInCaches(qc: QueryClient, thingId: string, patch: ThingPatch): () => void {
  const version = ++nextVersionId;
  const touched: Array<{ queryKey: readonly unknown[]; kind: "thing" | "court" }> = [];

  const thingKey = ["thing", thingId] as const;
  const previousThing = qc.getQueryData<Thing | null>(thingKey);
  if (previousThing) {
    const patchedThing = applyPatch(previousThing, patch);
    pushChainEntry(getChain(qc, thingKey, thingId), version, previousThing, patchedThing);
    qc.setQueryData<Thing | null>(thingKey, patchedThing);
    touched.push({ queryKey: thingKey, kind: "thing" });
  }

  for (const query of qc.getQueryCache().findAll({ queryKey: ["court"] })) {
    const key = query.queryKey;
    const previous = qc.getQueryData<CourtCache>(key);
    const index = previous?.things.findIndex((t) => t.id === thingId) ?? -1;
    if (!previous || index === -1) continue;
    const previousCourtThing = previous.things[index];
    const patchedThing = applyPatch(previousCourtThing, patch);
    pushChainEntry(getChain(qc, key, thingId), version, previousCourtThing, patchedThing);
    const nextThings = previous.things.slice();
    nextThings[index] = patchedThing;
    qc.setQueryData<CourtCache>(key, { ...previous, things: nextThings });
    touched.push({ queryKey: key, kind: "court" });
  }

  return () => {
    for (const { queryKey, kind } of touched) {
      const chain = getChain(qc, queryKey, thingId);
      const removedEntry = chain.find((entry) => entry.version === version);
      if (!removedEntry) continue;
      const expectedCurrent = removedEntry.patchedThing;
      const nextVisible = spliceChainEntry(chain, version);
      if (nextVisible === undefined) continue; // not the tail — nothing else to update

      if (kind === "thing") {
        const current = qc.getQueryData<Thing | null>(queryKey);
        if (current && deepEqual(current, expectedCurrent)) {
          qc.setQueryData(queryKey, nextVisible);
        }
        continue;
      }
      const current = qc.getQueryData<CourtCache>(queryKey);
      if (!current) continue;
      const index = current.things.findIndex((t) => t.id === thingId);
      if (index === -1 || !deepEqual(current.things[index], expectedCurrent)) continue;
      const nextThings = current.things.slice();
      nextThings[index] = nextVisible;
      qc.setQueryData<CourtCache>(queryKey, { ...current, things: nextThings });
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
