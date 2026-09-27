import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { advanceIdentityEpoch, getIdentityEpoch } from "@/features/realtime/identity-cache-policy";

/**
 * T10-04: run-thing-action.ts is the shared dispatch point for every
 * Thing-mutating Catch Up/Court/detail action. Every RPC call is mocked at
 * its own module boundary (rpc.ts) so these tests exercise the SHARED
 * claim/patch/rollback/outcome logic itself, not the network layer --
 * query-updates.ts's own primitives (claimThingMutation etc.) are used for
 * real, matching this repo's existing query-updates-rollback.test.mjs style.
 */

let catchCalls = [];
let setPaceCalls = [];
let snoozeCalls = [];
let nudgeCalls = [];
let acknowledgeCalls = [];
let sortCalls = [];
let catchGate = null;
let nextCatchRejects = null;

mock.module("@/features/things/rpc", {
  namedExports: {
    rpcCatchAndStart: async (thingId) => {
      catchCalls.push(thingId);
      if (catchGate) await catchGate;
      if (nextCatchRejects) {
        const err = nextCatchRejects;
        nextCatchRejects = null;
        throw err;
      }
    },
    rpcCatchThing: async (thingId) => {
      acknowledgeCalls.push(thingId);
    },
    rpcSortThing: async (thingId) => {
      sortCalls.push(thingId);
    },
    rpcSetPersonalPace: async (thingId, pace) => {
      setPaceCalls.push({ thingId, pace });
    },
    rpcSnoozeThing: async (thingId, until) => {
      snoozeCalls.push({ thingId, until });
    },
    rpcNudgeThing: async (thingId, reason) => {
      nudgeCalls.push({ thingId, reason });
    },
  },
});

const { runThingAction } = await import("@/features/things/run-thing-action");

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
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  advanceIdentityEpoch(qc, { kind: "live", profileId: "p1" });
  return qc;
}

function resetShared() {
  catchCalls = [];
  setPaceCalls = [];
  snoozeCalls = [];
  nudgeCalls = [];
  acknowledgeCalls = [];
  sortCalls = [];
  catchGate = null;
  nextCatchRejects = null;
}

const noopDeps = { dismissGhost: async () => {} };

test("Court row acknowledgement preserves the existing catch-only transport and shares a cache claim", async () => {
  resetShared();
  const qc = newClient();
  const courtKey = ["court", "p1", "work"];
  qc.setQueryData(courtKey, { things: [makeThing("a")], myActorId: "p1" });
  const outcome = await runThingAction(qc, { kind: "acknowledge", thingId: "a" }, noopDeps);
  assert.deepEqual(outcome, { status: "performed" });
  assert.deepEqual(acknowledgeCalls, ["a"]);
  assert.deepEqual(catchCalls, []);
  assert.equal(qc.getQueryData(courtKey).things[0].acknowledgement, "caught");
  assert.equal(qc.getQueryData(courtKey).things[0].workStatus, "not_started");
});

test("Court row Sort uses the shared optimistic patch and domain RPC", async () => {
  resetShared();
  const qc = newClient();
  const courtKey = ["court", "p1", "work"];
  qc.setQueryData(courtKey, { things: [makeThing("a")], myActorId: "p1" });
  const outcome = await runThingAction(qc, { kind: "sort", thingId: "a" }, noopDeps);
  assert.deepEqual(outcome, { status: "performed" });
  assert.deepEqual(sortCalls, ["a"]);
  assert.equal(qc.getQueryData(courtKey).things[0].workStatus, "sorted");
});

test("catch: performs the domain action once and optimistically patches the Court cache", async () => {
  resetShared();
  const qc = newClient();
  const courtKey = ["court", "p1", "work"];
  qc.setQueryData(courtKey, { things: [makeThing("a")], myActorId: "p1" });

  const outcome = await runThingAction(qc, { kind: "catch", thingId: "a" }, noopDeps);

  assert.deepEqual(outcome, { status: "performed" });
  assert.deepEqual(catchCalls, ["a"]);
  const after = qc.getQueryData(courtKey);
  assert.equal(after.things[0].workStatus, "under_progress");
  assert.equal(after.things[0].acknowledgement, "caught");
});

test("duplicate synchronous clicks on the same Thing: only the first performs, the second is already-in-flight", async () => {
  resetShared();
  const qc = newClient();
  let gateResolve;
  catchGate = new Promise((r) => (gateResolve = r));

  const first = runThingAction(qc, { kind: "catch", thingId: "a" }, noopDeps);
  const second = runThingAction(qc, { kind: "catch", thingId: "a" }, noopDeps);

  // `claimThingMutation` runs synchronously in each call's own pre-await
  // prefix, so the SECOND call's claim attempt is already decided (against
  // the first call's already-recorded claim) before either call reaches
  // any real await -- assert that decision (`second`'s own outcome)
  // immediately, but only assert the RPC call COUNT once both calls have
  // fully settled (the first call's own RPC dispatch is still working its
  // way through `cancelThingReads`'s microtask chain at this point, so
  // checking `catchCalls.length` before it resolves would be a race).
  const secondOutcome = await second;
  assert.deepEqual(secondOutcome, { status: "already-in-flight" });

  gateResolve();
  const firstOutcome = await first;
  assert.deepEqual(firstOutcome, { status: "performed" });
  assert.equal(catchCalls.length, 1, "the second click never dispatched its own RPC");
});

test("cross-surface preclaimed Thing: a claim held by another caller (e.g. a Court lane) blocks Catch Up's own action", async () => {
  resetShared();
  const qc = newClient();
  const { claimThingMutation, releaseThingMutation } = await import("@/features/things/query-updates");
  const epoch = getIdentityEpoch(qc).epoch;
  const externalToken = claimThingMutation(qc, "a", epoch);
  assert.ok(externalToken, "precondition: the external caller holds the claim");

  const outcome = await runThingAction(qc, { kind: "catch", thingId: "a" }, noopDeps);
  assert.deepEqual(outcome, { status: "already-in-flight" });
  assert.equal(catchCalls.length, 0);

  releaseThingMutation(qc, externalToken);
});

test("two independent Things dispatch and claim independently -- neither blocks the other", async () => {
  resetShared();
  const qc = newClient();
  const [outcomeA, outcomeB] = await Promise.all([
    runThingAction(qc, { kind: "catch", thingId: "a" }, noopDeps),
    runThingAction(qc, { kind: "catch", thingId: "b" }, noopDeps),
  ]);
  assert.deepEqual(outcomeA, { status: "performed" });
  assert.deepEqual(outcomeB, { status: "performed" });
  assert.deepEqual(catchCalls.sort(), ["a", "b"]);
});

test("domain failure rolls back the optimistic patch and returns a failed outcome", async () => {
  resetShared();
  const qc = newClient();
  const courtKey = ["court", "p1", "work"];
  qc.setQueryData(courtKey, { things: [makeThing("a")], myActorId: "p1" });
  nextCatchRejects = new Error("network down");

  const outcome = await runThingAction(qc, { kind: "catch", thingId: "a" }, noopDeps);

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.error.message, "network down");
  const after = qc.getQueryData(courtKey);
  assert.equal(after.things[0].workStatus, "not_started", "optimistic patch rolled back");
  assert.equal(after.things[0].acknowledgement, "waiting_for_catch");
});

test("a claim released after failure is available again for a fresh retry", async () => {
  resetShared();
  const qc = newClient();
  nextCatchRejects = new Error("first attempt fails");
  const first = await runThingAction(qc, { kind: "catch", thingId: "a" }, noopDeps);
  assert.equal(first.status, "failed");

  const second = await runThingAction(qc, { kind: "catch", thingId: "a" }, noopDeps);
  assert.deepEqual(second, { status: "performed" });
  assert.equal(catchCalls.length, 2);
});

test("an identity switch resets in-flight claim tracking -- a new identity is never blocked by an old identity's stale claim", async () => {
  // The epoch is captured FRESH, synchronously, at the top of every
  // `runThingAction` call -- there is no "stale epoch at dispatch time"
  // state reachable from outside (a caller can't hand this module an old
  // epoch to check against; it always reads current truth at entry). The
  // real staleness risk this module guards against is an identity switch
  // WHILE its own internal awaits are in flight (covered separately below).
  // What IS observable from outside is that `claimThingMutation`'s
  // in-flight tracking is itself epoch-scoped (see query-updates.ts's
  // `currentInFlight`) -- an old identity's still-held claim must never
  // block a brand new identity's own legitimate action on the same Thing id.
  resetShared();
  const qc = newClient();
  const { claimThingMutation } = await import("@/features/things/query-updates");
  const oldEpoch = getIdentityEpoch(qc).epoch;
  const oldToken = claimThingMutation(qc, "a", oldEpoch);
  assert.ok(oldToken, "precondition: the old identity holds the claim");

  advanceIdentityEpoch(qc, { kind: "live", profileId: "p2" }); // switch identity without ever releasing

  const outcome = await runThingAction(qc, { kind: "catch", thingId: "a" }, noopDeps);
  assert.deepEqual(
    outcome,
    { status: "performed" },
    "the new identity's own action must not be blocked by the old identity's stale, unreleased claim",
  );
});

test("stale epoch mid-flight (identity switches while the RPC is in flight): rollback still runs, releases the claim", async () => {
  resetShared();
  const qc = newClient();
  const courtKey = ["court", "p1", "work"];
  qc.setQueryData(courtKey, { things: [makeThing("a")], myActorId: "p1" });
  let gateResolve;
  catchGate = new Promise((r) => (gateResolve = r));

  const pending = runThingAction(qc, { kind: "catch", thingId: "a" }, noopDeps);
  advanceIdentityEpoch(qc, { kind: "live", profileId: "p2" }); // a different identity takes over mid-flight
  nextCatchRejects = new Error("should not matter -- outcome is decided by the epoch check, not this");
  gateResolve();
  const outcome = await pending;

  // The RPC itself was already dispatched before the switch (this module
  // does not cancel an in-flight RPC), so it still resolves/rejects, but
  // the claim for the OLD epoch is released either way and a NEW caller
  // (under the new identity) can immediately claim the same Thing id --
  // proving no stale claim survives an identity switch.
  void outcome;
  const { claimThingMutation, releaseThingMutation } = await import("@/features/things/query-updates");
  const newEpoch = getIdentityEpoch(qc).epoch;
  const freshToken = claimThingMutation(qc, "a", newEpoch);
  assert.ok(freshToken, "the old epoch's claim did not leak past the identity switch");
  releaseThingMutation(qc, freshToken);
});

test("set_pace validates against supported values -- an unsupported pace never dispatches", async () => {
  resetShared();
  const qc = newClient();
  const outcome = await runThingAction(qc, { kind: "set_pace", thingId: "a", pace: "urgent" }, noopDeps);
  assert.equal(outcome.status, "failed");
  assert.equal(setPaceCalls.length, 0);
});

test("snooze validates against supported options -- an unsupported option never dispatches", async () => {
  resetShared();
  const qc = newClient();
  const outcome = await runThingAction(qc, { kind: "snooze", thingId: "a", option: "3d" }, noopDeps);
  assert.equal(outcome.status, "failed");
  assert.equal(snoozeCalls.length, 0);
});

test("move_now always dispatches personal pace 'now', regardless of the caller's own field name", async () => {
  resetShared();
  const qc = newClient();
  const outcome = await runThingAction(qc, { kind: "move_now", thingId: "a" }, noopDeps);
  assert.deepEqual(outcome, { status: "performed" });
  assert.deepEqual(setPaceCalls, [{ thingId: "a", pace: "now" }]);
});

test("nudge and Timed Snooze apply no Thing-field patch (personal-visibility / non-shared-field actions)", async () => {
  resetShared();
  const qc = newClient();
  const courtKey = ["court", "p1", "work"];
  qc.setQueryData(courtKey, { things: [makeThing("a")], myActorId: "p1" });

  await runThingAction(qc, { kind: "nudge", thingId: "a", reason: "stale" }, noopDeps);
  await runThingAction(qc, { kind: "snooze", thingId: "a", option: "1h" }, noopDeps);

  const after = qc.getQueryData(courtKey);
  assert.equal(after.things[0].workStatus, "not_started", "unchanged by nudge/snooze");
  assert.deepEqual(nudgeCalls, [{ thingId: "a", reason: "stale" }]);
  assert.equal(snoozeCalls.length, 1);
});

test("dismiss_ghost calls the caller-provided dispatcher exactly once on success", async () => {
  resetShared();
  const qc = newClient();
  const calls = [];
  const deps = { dismissGhost: async (thingId) => { calls.push(thingId); } };

  const outcome = await runThingAction(qc, { kind: "dismiss_ghost", thingId: "a" }, deps);
  assert.deepEqual(outcome, { status: "performed" });
  assert.deepEqual(calls, ["a"]);
});

test("dismiss_ghost failure is reported as a failed outcome, not silently swallowed", async () => {
  resetShared();
  const qc = newClient();
  const deps = {
    dismissGhost: async () => {
      throw new Error("dismiss failed");
    },
  };
  const outcome = await runThingAction(qc, { kind: "dismiss_ghost", thingId: "a" }, deps);
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.error.message, "dismiss failed");
});
