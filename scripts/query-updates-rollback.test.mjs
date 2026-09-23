import assert from "node:assert/strict";
import { test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import {
  claimThingMutation,
  isThingMutationInFlight,
  patchThingInCaches,
  releaseThingMutation,
  withOptimisticPatch,
} from "@/features/things/query-updates";

function makeThing(id, overrides = {}) {
  return {
    id,
    title: `Thing ${id}`,
    workStatus: "not_started",
    acknowledgement: "waiting_for_catch",
    personalPace: null,
    ownerImportance: "next",
    ...overrides,
  };
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

test("rollback undoes only the failed mutation's own Thing, not an unrelated Thing's independent update", () => {
  const qc = newClient();
  const courtKey = ["court", "p1", "work"];
  const a = makeThing("a", { workStatus: "not_started" });
  const b = makeThing("b", { workStatus: "not_started" });
  qc.setQueryData(courtKey, { things: [a, b], myActorId: "p1" });

  const rollbackA = patchThingInCaches(qc, "a", { workStatus: "under_progress" });
  // Independent mutation on B applied after A's optimistic patch.
  const rollbackB = patchThingInCaches(qc, "b", { workStatus: "sorted" });
  void rollbackB; // B's mutation succeeds — no rollback call.

  rollbackA(); // A's mutation failed.

  const after = qc.getQueryData(courtKey);
  assert.equal(after.things.find((t) => t.id === "a").workStatus, "not_started", "A rolled back");
  assert.equal(after.things.find((t) => t.id === "b").workStatus, "sorted", "B's independent update survives A's rollback");
});

test("rollback does not remove a Thing that entered the cache after the patch", () => {
  const qc = newClient();
  const courtKey = ["court", "p1", "work"];
  const a = makeThing("a");
  qc.setQueryData(courtKey, { things: [a], myActorId: "p1" });

  const rollbackA = patchThingInCaches(qc, "a", { workStatus: "under_progress" });

  // A new Thing C lands in the cache (e.g. a refetch merged in a new row)
  // before A's mutation is known to have failed.
  const current = qc.getQueryData(courtKey);
  const c = makeThing("c");
  qc.setQueryData(courtKey, { ...current, things: [...current.things, c] });

  rollbackA();

  const after = qc.getQueryData(courtKey);
  assert.ok(after.things.some((t) => t.id === "c"), "C is still present after A's rollback");
  assert.equal(after.things.find((t) => t.id === "a").workStatus, "not_started", "A still rolls back correctly");
});

test("rollback does not restore a stale collection over newer server data for the same Thing", () => {
  const qc = newClient();
  const courtKey = ["court", "p1", "work"];
  const a = makeThing("a", { workStatus: "not_started", title: "Original" });
  qc.setQueryData(courtKey, { things: [a], myActorId: "p1" });

  const rollbackA = patchThingInCaches(qc, "a", { workStatus: "under_progress" });

  // Newer server data (a completed refetch) replaces the whole Thing A
  // object with fresh data reflecting reality server-side.
  const serverA = makeThing("a", { workStatus: "sorted", title: "Server truth" });
  qc.setQueryData(courtKey, { things: [serverA], myActorId: "p1" });

  rollbackA();

  const after = qc.getQueryData(courtKey);
  const finalA = after.things.find((t) => t.id === "a");
  assert.equal(finalA.workStatus, "sorted", "newer server data is not overwritten by an older rollback");
  assert.equal(finalA.title, "Server truth");
});

test("an older failure cannot erase a newer successful patch to the same Thing", () => {
  const qc = newClient();
  const courtKey = ["court", "p1", "work"];
  const a = makeThing("a", { workStatus: "not_started" });
  qc.setQueryData(courtKey, { things: [a], myActorId: "p1" });

  const rollbackFirst = patchThingInCaches(qc, "a", { workStatus: "under_progress" });
  // A second, later mutation on the same Thing succeeds and re-patches it.
  patchThingInCaches(qc, "a", { workStatus: "sorted" });

  // The first mutation now fails and rolls back — it must not clobber the
  // second mutation's result.
  rollbackFirst();

  const after = qc.getQueryData(courtKey);
  assert.equal(after.things.find((t) => t.id === "a").workStatus, "sorted", "the newer operation's result wins");
});

test("an older failure cannot erase a newer patch even when both compute the identical value", () => {
  // The concurrency guard cannot rely on value comparison alone: two
  // independent, overlapping mutations can legitimately produce the exact
  // same resulting value (e.g. both set workStatus to "under_progress").
  // If rollback only checked "does the cache still hold what I wrote",
  // the older mutation's rollback would look identical to "still mine" and
  // incorrectly erase the newer mutation's write.
  const qc = newClient();
  const courtKey = ["court", "p1", "work"];
  const a = makeThing("a", { workStatus: "not_started" });
  qc.setQueryData(courtKey, { things: [a], myActorId: "p1" });

  const rollbackFirst = patchThingInCaches(qc, "a", { workStatus: "under_progress" });
  // Second, independent mutation computes the identical resulting value.
  patchThingInCaches(qc, "a", { workStatus: "under_progress" });

  // First mutation fails.
  rollbackFirst();

  const after = qc.getQueryData(courtKey);
  assert.equal(
    after.things.find((t) => t.id === "a").workStatus,
    "under_progress",
    "the second (still-pending) mutation's write survives, even though the first mutation's rollback would restore a value that looks unrelated to it",
  );
});

test("when two overlapping mutations on the same Thing both fail, the Thing unwinds all the way to its true original value", () => {
  // The specific gap in the previous "still the most recent write" model:
  // op1 fails first and is correctly recognized as no longer the tail (op2
  // is), so its rollback is a no-op for the cache — but if op2 *also*
  // fails afterward, its own rollback must not restore op1's (also
  // failed) intermediate value. It has to unwind through the whole chain
  // back to the value before either mutation ran.
  const qc = newClient();
  const courtKey = ["court", "p1", "work"];
  const a = makeThing("a", { workStatus: "not_started" });
  qc.setQueryData(courtKey, { things: [a], myActorId: "p1" });

  const rollbackFirst = patchThingInCaches(qc, "a", { workStatus: "under_progress" });
  const rollbackSecond = patchThingInCaches(qc, "a", { workStatus: "sorted" });

  rollbackFirst(); // op1 fails — not the tail, so this is a no-op for the cache.
  assert.equal(qc.getQueryData(courtKey).things[0].workStatus, "sorted", "op2's write is still visible after op1's no-op rollback");

  rollbackSecond(); // op2 also fails — must unwind past op1's value too.

  assert.equal(
    qc.getQueryData(courtKey).things[0].workStatus,
    "not_started",
    "both mutations failed, so the Thing must be back to its true original value, not op1's already-failed intermediate value",
  );
});

test("when two overlapping mutations both fail in reverse order (newest first), the Thing still unwinds to its true original value", () => {
  // Same guarantee as the older-first case above, but failing the *tail*
  // (most recent) mutation first, then the earlier one — verified against
  // both the Court cache and the single-Thing cache, matching how a real
  // mutation touches both simultaneously.
  const qc = newClient();
  const courtKey = ["court", "p1", "work"];
  const thingKey = ["thing", "a"];
  const a = makeThing("a", { workStatus: "not_started" });
  qc.setQueryData(courtKey, { things: [a], myActorId: "p1" });
  qc.setQueryData(thingKey, a);

  const rollbackFirst = patchThingInCaches(qc, "a", { workStatus: "under_progress" });
  const rollbackSecond = patchThingInCaches(qc, "a", { workStatus: "sorted" });

  rollbackSecond(); // op2 fails first — it *is* the tail, so the cache reverts to op1's value.
  assert.equal(qc.getQueryData(courtKey).things[0].workStatus, "under_progress", "Court reverts to op1's value once op2 (the tail) fails");
  assert.equal(qc.getQueryData(thingKey).workStatus, "under_progress", "single-Thing cache reverts to op1's value once op2 (the tail) fails");

  rollbackFirst(); // op1 also fails — now the only (and tail) entry, unwinds to the true original.

  assert.equal(qc.getQueryData(courtKey).things[0].workStatus, "not_started", "Court unwinds to the true original once op1 also fails");
  assert.equal(qc.getQueryData(thingKey).workStatus, "not_started", "single-Thing cache unwinds to the true original once op1 also fails");
});

test("two Things sharing the same Court query key track independent chains", () => {
  // Both mutations land in the *same* Court query cache entry (same
  // profile/context) but on different Things — the chain bookkeeping must
  // key by (queryKey, thingId), not queryKey alone, or one Thing's history
  // would corrupt another's.
  const qc = newClient();
  const courtKey = ["court", "p1", "work"];
  const a = makeThing("a", { workStatus: "not_started" });
  const b = makeThing("b", { workStatus: "not_started" });
  qc.setQueryData(courtKey, { things: [a, b], myActorId: "p1" });

  const rollbackA = patchThingInCaches(qc, "a", { workStatus: "under_progress" });
  patchThingInCaches(qc, "b", { workStatus: "sorted" }); // succeeds, no rollback

  rollbackA();

  const after = qc.getQueryData(courtKey);
  assert.equal(after.things.find((t) => t.id === "a").workStatus, "not_started", "A rolled back correctly");
  assert.equal(after.things.find((t) => t.id === "b").workStatus, "sorted", "B's unrelated write is untouched");
});

test("the current owner's rollback restores what it actually saw before it wrote, not the original value", () => {
  const qc = newClient();
  const courtKey = ["court", "p1", "work"];
  const a = makeThing("a", { workStatus: "not_started" });
  qc.setQueryData(courtKey, { things: [a], myActorId: "p1" });

  patchThingInCaches(qc, "a", { workStatus: "under_progress" }); // succeeds, no rollback call
  // Second mutation runs after the first succeeded, so its own "previous"
  // is "under_progress", not the very first "not_started".
  const rollbackSecond = patchThingInCaches(qc, "a", { workStatus: "sorted" });

  rollbackSecond();

  const after = qc.getQueryData(courtKey);
  assert.equal(
    after.things.find((t) => t.id === "a").workStatus,
    "under_progress",
    "rollback restores the immediately-preceding value, not the Thing's original state",
  );
});

test("single-Thing and Court caches both reconcile after a failed mutation", () => {
  const qc = newClient();
  const courtKey = ["court", "p1", "work"];
  const thingKey = ["thing", "a"];
  const a = makeThing("a", { workStatus: "not_started" });
  qc.setQueryData(courtKey, { things: [a], myActorId: "p1" });
  qc.setQueryData(thingKey, a);

  const rollback = patchThingInCaches(qc, "a", { workStatus: "under_progress" });
  assert.equal(qc.getQueryData(thingKey).workStatus, "under_progress");
  assert.equal(qc.getQueryData(courtKey).things[0].workStatus, "under_progress");

  rollback();

  assert.equal(qc.getQueryData(thingKey).workStatus, "not_started", "single-Thing cache rolled back");
  assert.equal(qc.getQueryData(courtKey).things[0].workStatus, "not_started", "Court cache rolled back");
});

test("a successful mutation's optimistic patch is left in place (no rollback call)", () => {
  const qc = newClient();
  const courtKey = ["court", "p1", "work"];
  const a = makeThing("a", { workStatus: "not_started" });
  qc.setQueryData(courtKey, { things: [a], myActorId: "p1" });

  patchThingInCaches(qc, "a", { workStatus: "under_progress" });

  assert.equal(qc.getQueryData(courtKey).things[0].workStatus, "under_progress");
});

test("patching a Thing that isn't in any cache yet does not create a malformed entry", () => {
  const qc = newClient();
  const rollback = patchThingInCaches(qc, "does-not-exist", { workStatus: "under_progress" });

  assert.equal(qc.getQueryData(["thing", "does-not-exist"]), undefined);
  assert.deepEqual(qc.getQueryCache().findAll({ queryKey: ["court"] }), []);

  // Rollback of a no-op patch must also be a no-op, not throw.
  assert.doesNotThrow(() => rollback());
});

test("a stale chain from a much earlier mutation cannot resurface after an untracked external change", () => {
  // If chain bookkeeping persisted forever regardless of what actually
  // happens to the cache, a long-dead failed rollback could resurrect an
  // ancient optimistic guess: mutation 1 succeeds (chain: [v1]); later, an
  // untracked external write (a completed refetch, a realtime event)
  // replaces the cache with fresh server data; mutation 2 then runs and
  // fails. Mutation 2's rollback must restore to the external value it
  // actually overwrote, not resurrect mutation 1's old patched value.
  const qc = newClient();
  const courtKey = ["court", "p1", "work"];
  const a = makeThing("a", { workStatus: "not_started" });
  qc.setQueryData(courtKey, { things: [a], myActorId: "p1" });

  patchThingInCaches(qc, "a", { workStatus: "under_progress" }); // succeeds

  // Untracked external change: a refetch lands with fresh server data.
  const serverA = makeThing("a", { workStatus: "sorted", title: "Server truth" });
  qc.setQueryData(courtKey, { things: [serverA], myActorId: "p1" });

  const rollbackSecond = patchThingInCaches(qc, "a", { workStatus: "cancelled" });
  rollbackSecond();

  const after = qc.getQueryData(courtKey);
  const finalA = after.things.find((t) => t.id === "a");
  assert.equal(finalA.workStatus, "sorted", "rollback restores the external value it overwrote, not the ancient chain's value");
  assert.equal(finalA.title, "Server truth");
});

test("claimThingMutation prevents a second concurrent claim on the same Thing", () => {
  // This is the cross-surface guarantee: a Court swipe stack's own
  // in-flight tracking and a Thing detail panel's own useMutation()
  // pending state are each local to that component — neither alone
  // prevents both surfaces from mutating the same Thing at once.
  // claimThingMutation is shared per QueryClient, regardless of caller.
  const qc = newClient();
  assert.equal(claimThingMutation(qc, "a"), true, "first claim succeeds");
  assert.equal(claimThingMutation(qc, "a"), false, "a second concurrent claim on the same Thing is rejected");
  assert.equal(isThingMutationInFlight(qc, "a"), true);
  releaseThingMutation(qc, "a");
  assert.equal(isThingMutationInFlight(qc, "a"), false);
  assert.equal(claimThingMutation(qc, "a"), true, "claimable again after release");
});

test("claimThingMutation on different Things does not serialize unrelated work", () => {
  const qc = newClient();
  assert.equal(claimThingMutation(qc, "a"), true);
  assert.equal(claimThingMutation(qc, "b"), true, "an unrelated Thing is unaffected by A's claim");
});

test("withOptimisticPatch is a no-op if the Thing is already claimed by another surface", async () => {
  const qc = newClient();
  const courtKey = ["court", "p1", "work"];
  const a = makeThing("a", { workStatus: "not_started" });
  qc.setQueryData(courtKey, { things: [a], myActorId: "p1" });

  // Simulate a detail panel already mid-mutation on this Thing.
  claimThingMutation(qc, "a");

  let called = false;
  await withOptimisticPatch(qc, "a", { workStatus: "under_progress" }, async () => {
    called = true;
  })();

  assert.equal(called, false, "the wrapped mutation never runs while another surface holds the claim");
  assert.equal(qc.getQueryData(courtKey).things[0].workStatus, "not_started", "no patch was applied either");

  releaseThingMutation(qc, "a");
});

test("withOptimisticPatch releases its claim after success and after failure", async () => {
  const qc = newClient();

  await withOptimisticPatch(qc, "a", { workStatus: "under_progress" }, async () => {})();
  assert.equal(isThingMutationInFlight(qc, "a"), false, "claim released after success");

  await assert.rejects(
    withOptimisticPatch(qc, "a", { workStatus: "under_progress" }, async () => {
      throw new Error("boom");
    })(),
  );
  assert.equal(isThingMutationInFlight(qc, "a"), false, "claim released after failure too");
});
