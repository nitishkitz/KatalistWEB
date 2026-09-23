import assert from "node:assert/strict";
import { test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { patchThingInCaches } from "@/features/things/query-updates";

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
