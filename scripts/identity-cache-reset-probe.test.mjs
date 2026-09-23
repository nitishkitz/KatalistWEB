import assert from "node:assert/strict";
import { test } from "node:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";

/**
 * P3 design-phase evidence (docs/superpowers/plans/2026-09-23-p3-identity-cache-lifecycle-design.md).
 * These exercise the real @tanstack/react-query QueryClient/QueryObserver
 * classes directly -- no mocking, no React, no DOM -- to settle a factual
 * question the design depends on: does clearing the cache at an identity
 * boundary actually stop an already-mounted, already-subscribed observer
 * from continuing to show the previous identity's data?
 *
 * No production code is touched by this file. It documents library
 * behavior the design relies on, so a future @tanstack/react-query
 * upgrade that changes this behavior would be caught here before it
 * silently invalidates the design's core assumption.
 */

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("qc.clear() does NOT update an already-subscribed observer (documents why resetQueries() is used instead)", async () => {
  const qc = new QueryClient();
  const observer = new QueryObserver(qc, {
    queryKey: ["thing", "shared-thing-1"],
    queryFn: async () => ({ id: "shared-thing-1", owner: "A" }),
  });
  const seen = [];
  const unsub = observer.subscribe((r) => seen.push(r.data));

  await delay(20);
  assert.deepEqual(seen.at(-1), { id: "shared-thing-1", owner: "A" });

  qc.clear();
  await delay(20);

  // This is the load-bearing negative assertion: clear() alone leaves a
  // mounted observer showing stale data indefinitely. If this ever
  // starts failing (i.e. the observer picks up fresh data), the library
  // has changed and identity-boundary disposal could safely go back to
  // clear() -- but until then, resetQueries() is required.
  assert.deepEqual(
    seen.at(-1),
    { id: "shared-thing-1", owner: "A" },
    "expected clear() alone to leave an already-mounted observer stale",
  );

  unsub();
});

test("qc.resetQueries() (no filter) refreshes an active observer and evicts an inactive query without an eager refetch", async () => {
  const qc = new QueryClient();
  let who = "A";

  const observer = new QueryObserver(qc, {
    queryKey: ["thing", "t1"],
    queryFn: async () => ({ id: "t1", owner: who }),
  });
  const seen = [];
  const unsub = observer.subscribe((r) => seen.push(r.data));

  let inactiveFetchCount = 0;
  qc.setQueryDefaults(["thing", "t2-inactive"], {
    queryFn: async () => {
      inactiveFetchCount += 1;
      return { id: "t2-inactive", owner: who };
    },
  });
  await qc.fetchQuery({ queryKey: ["thing", "t2-inactive"] });

  await delay(20);
  assert.deepEqual(seen.at(-1), { id: "t1", owner: "A" });
  assert.equal(inactiveFetchCount, 1);

  who = "B";
  await qc.resetQueries();

  assert.deepEqual(
    seen.at(-1),
    { id: "t1", owner: "B" },
    "active observer must refresh to the new identity's value without a remount",
  );
  assert.equal(
    inactiveFetchCount,
    1,
    "an inactive (unobserved) query must be evicted without an eager background refetch",
  );
  assert.equal(qc.getQueryData(["thing", "t2-inactive"]), undefined);

  unsub();
});

test("a slow fetch started under the old identity cannot clobber a newer post-switch fetch for the same key", async () => {
  const qc = new QueryClient();
  let who = "A";
  let callCount = 0;

  const observer = new QueryObserver(qc, {
    queryKey: ["thing", "t1"],
    queryFn: async () => {
      callCount += 1;
      const isFirstCall = callCount === 1;
      const snapshotWho = who;
      // First call (under A) is slow; the resetQueries()-triggered call
      // (under B) is fast, so if late-completion protection didn't
      // exist, A's result would land last and win.
      await delay(isFirstCall ? 100 : 10);
      return { id: "t1", owner: snapshotWho, callIndex: callCount };
    },
  });
  const seen = [];
  const unsub = observer.subscribe((r) => seen.push(r.data));

  await delay(15); // let the first (A) fetch start, but not finish
  who = "B";
  await qc.resetQueries(); // triggers the second (B) fetch while the first is still in flight

  assert.deepEqual(seen.at(-1), { id: "t1", owner: "B", callIndex: 2 });

  await delay(150); // long enough for the slow first (A) fetch to also resolve

  assert.deepEqual(
    seen.at(-1),
    { id: "t1", owner: "B", callIndex: 2 },
    "the late-arriving pre-switch fetch must not overwrite the post-switch result",
  );

  unsub();
});
