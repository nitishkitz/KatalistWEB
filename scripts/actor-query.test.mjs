import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { advanceIdentityEpoch, runRegisteredDisposers } from "@/features/realtime/identity-cache-policy";

/**
 * P4 acceptance criteria, each covered by a dedicated test:
 * - correct profile isolation
 * - deduplication of simultaneous lookups
 * - eviction on identity retirement
 * - a missing-actor policy that allows later discovery
 * - a failed request never becomes a cached success
 * - a late response cannot repopulate a retired identity's cache
 * - no context dimension (the actors table has none)
 */

let actorRowsByProfile = new Map();
let fetchCallCountByProfile = new Map();
let failNextFetchFor = null;
let fetchDelayMs = 0;

function bumpCallCount(profileId) {
  fetchCallCountByProfile.set(profileId, (fetchCallCountByProfile.get(profileId) ?? 0) + 1);
}

mock.module("@/integrations/supabase/client", {
  namedExports: {
    supabase: {
      from: () => {
        const node = {
          select: () => node,
          eq: (_col, profileId) => {
            node.__profileId = profileId;
            return node;
          },
          maybeSingle: async () => {
            const profileId = node.__profileId;
            bumpCallCount(profileId);
            if (fetchDelayMs > 0) await new Promise((r) => setTimeout(r, fetchDelayMs));
            if (failNextFetchFor === profileId) {
              failNextFetchFor = null;
              return { data: null, error: new Error("actors read failed") };
            }
            const actorId = actorRowsByProfile.get(profileId);
            return { data: actorId ? { id: actorId } : null, error: null };
          },
        };
        return node;
      },
    },
  },
});

const { getActorId, invalidateActorId, ACTOR_STALE_TIME_MS } = await import("@/features/people/actor-query");

function reset() {
  actorRowsByProfile = new Map();
  fetchCallCountByProfile = new Map();
  failNextFetchFor = null;
  fetchDelayMs = 0;
}

test("correct profile isolation: two profiles never share a cached actor id", async () => {
  reset();
  const qc = new QueryClient();
  actorRowsByProfile.set("profile-A", "actor-A");
  actorRowsByProfile.set("profile-B", "actor-B");

  const [a, b] = await Promise.all([getActorId(qc, "profile-A"), getActorId(qc, "profile-B")]);
  assert.equal(a, "actor-A");
  assert.equal(b, "actor-B");
});

test("deduplication: concurrent lookups for the same profile share one underlying fetch", async () => {
  reset();
  const qc = new QueryClient();
  actorRowsByProfile.set("profile-A", "actor-A");
  fetchDelayMs = 20;

  const [a1, a2, a3] = await Promise.all([
    getActorId(qc, "profile-A"),
    getActorId(qc, "profile-A"),
    getActorId(qc, "profile-A"),
  ]);

  assert.equal(a1, "actor-A");
  assert.equal(a2, "actor-A");
  assert.equal(a3, "actor-A");
  assert.equal(fetchCallCountByProfile.get("profile-A"), 1, "three concurrent callers for the same profile must trigger exactly one fetch");
});

test("eviction on identity retirement: the actor cache is cleared once registered disposers run", async () => {
  reset();
  const qc = new QueryClient();
  actorRowsByProfile.set("profile-A", "actor-A");

  await getActorId(qc, "profile-A");
  assert.notEqual(qc.getQueryData(["actor", "profile-A"]), undefined, "sanity: the lookup cached something");

  runRegisteredDisposers(qc);

  assert.equal(qc.getQueryData(["actor", "profile-A"]), undefined, "the actor cache must be cleared once identity-retirement disposers run");
});

test("missing-actor policy: a legitimate 'no actor yet' is cached, but a later lookup discovers a since-provisioned actor once it's stale", async () => {
  reset();
  const qc = new QueryClient();
  // No row yet for profile-A.
  const first = await getActorId(qc, "profile-A");
  assert.equal(first, null, "a legitimate missing actor resolves to null, not an error");

  // Actor gets provisioned server-side.
  actorRowsByProfile.set("profile-A", "actor-A-new");

  // Immediately re-asking still returns the cached null (within staleTime).
  const stillCached = await getActorId(qc, "profile-A");
  assert.equal(stillCached, null, "within staleTime, the cached null is still served");
  assert.equal(fetchCallCountByProfile.get("profile-A"), 1, "the second call within staleTime must not refetch");

  // An explicit invalidation (the mechanism this module exposes for
  // "I know an actor was just provisioned") makes the next lookup
  // discover it without waiting for staleTime to elapse.
  invalidateActorId(qc, "profile-A");
  const afterInvalidate = await getActorId(qc, "profile-A");
  assert.equal(afterInvalidate, "actor-A-new", "invalidateActorId must let a subsequent lookup discover the newly-provisioned actor");
});

test("a failed request never becomes a cached successful result", async () => {
  reset();
  const qc = new QueryClient();
  failNextFetchFor = "profile-A";

  await assert.rejects(getActorId(qc, "profile-A"), /actors read failed/);
  assert.equal(qc.getQueryData(["actor", "profile-A"]), undefined, "a failed fetch must not leave a cached `data` value behind");

  // A subsequent call must actually retry, not serve a cached failure
  // as if it were a successful null.
  actorRowsByProfile.set("profile-A", "actor-A");
  const result = await getActorId(qc, "profile-A");
  assert.equal(result, "actor-A");
  assert.equal(fetchCallCountByProfile.get("profile-A"), 2, "the retry must actually re-fetch, not reuse a cached failure");
});

test("a late response cannot repopulate a retired identity's cache", async () => {
  reset();
  const qc = new QueryClient();
  actorRowsByProfile.set("profile-A", "actor-A");
  fetchDelayMs = 30;

  const pending = getActorId(qc, "profile-A");

  // Identity retires (a real switch, or this exact profile
  // re-authenticating) while the fetch above is still in flight.
  advanceIdentityEpoch(qc, { kind: "live", profileId: "profile-B" });

  await assert.rejects(pending, /Stale identity/);

  // Even though fetchQuery's own resolution briefly wrote actor-A into
  // the cache as part of settling, the late-completion cleanup must
  // have already removed it again.
  assert.equal(
    qc.getQueryData(["actor", "profile-A"]),
    undefined,
    "a late response completing after retirement must not leave a repopulated cache entry behind",
  );
});

test("no context dimension: the same profile's actor id is identical regardless of which context the caller is in", async () => {
  reset();
  const qc = new QueryClient();
  actorRowsByProfile.set("profile-A", "actor-A");

  // getActorId takes no context argument at all -- this is the API
  // itself enforcing the "actors have no context column" data model,
  // not something that needs a runtime check.
  const work = await getActorId(qc, "profile-A");
  const home = await getActorId(qc, "profile-A");
  assert.equal(work, home);
  assert.equal(fetchCallCountByProfile.get("profile-A"), 1, "a second call within staleTime, regardless of 'context', must not refetch");
});

test("ACTOR_STALE_TIME_MS is a positive, bounded value (not Infinity, not 0)", () => {
  assert.ok(ACTOR_STALE_TIME_MS > 0);
  assert.ok(Number.isFinite(ACTOR_STALE_TIME_MS));
});
