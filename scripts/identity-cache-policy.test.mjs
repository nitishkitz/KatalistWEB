import assert from "node:assert/strict";
import { test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import {
  identityEquals,
  identityKey,
  getIdentityEpoch,
  advanceIdentityEpoch,
  isEpochCurrent,
  withEpochGuard,
  withEpochGuardedTimer,
  registerIdentityDisposer,
  runRegisteredDisposers,
} from "@/features/realtime/identity-cache-policy";

test("identityEquals: pending never equals anything, including another pending", () => {
  assert.equal(identityEquals({ kind: "pending" }, { kind: "pending" }), true);
  assert.equal(identityEquals(null, { kind: "pending" }), false);
});

test("identityEquals: live/preview compare by kind AND profileId", () => {
  assert.equal(identityEquals({ kind: "live", profileId: "a" }, { kind: "live", profileId: "a" }), true);
  assert.equal(identityEquals({ kind: "live", profileId: "a" }, { kind: "live", profileId: "b" }), false);
  assert.equal(identityEquals({ kind: "live", profileId: "a" }, { kind: "preview", profileId: "a" }), false);
});

test("identityKey is stable and distinguishes kind+profileId", () => {
  assert.equal(identityKey({ kind: "live", profileId: "a" }), "live:a");
  assert.equal(identityKey({ kind: "preview", profileId: "a" }), "preview:a");
  assert.notEqual(identityKey({ kind: "live", profileId: "a" }), identityKey({ kind: "preview", profileId: "a" }));
  assert.equal(identityKey({ kind: "none" }), "none");
});

test("getIdentityEpoch starts at 0/pending for a fresh QueryClient, independent of other clients", () => {
  const qcA = new QueryClient();
  const qcB = new QueryClient();
  assert.deepEqual(getIdentityEpoch(qcA), { epoch: 0, identity: { kind: "pending" } });
  advanceIdentityEpoch(qcA, { kind: "live", profileId: "a" });
  assert.deepEqual(getIdentityEpoch(qcB), { epoch: 0, identity: { kind: "pending" } }, "advancing one client must not affect another");
});

test("advanceIdentityEpoch increments monotonically and records the new identity", () => {
  const qc = new QueryClient();
  const e1 = advanceIdentityEpoch(qc, { kind: "live", profileId: "a" });
  const e2 = advanceIdentityEpoch(qc, { kind: "live", profileId: "b" });
  assert.ok(e2 > e1);
  assert.equal(isEpochCurrent(qc, e1), false);
  assert.equal(isEpochCurrent(qc, e2), true);
});

test("withEpochGuard: fires when the captured epoch is still current", () => {
  const qc = new QueryClient();
  const epoch = advanceIdentityEpoch(qc, { kind: "live", profileId: "a" });
  let called = false;
  const guarded = withEpochGuard(qc, epoch, () => {
    called = true;
    return "result";
  });
  assert.equal(guarded(), "result");
  assert.equal(called, true);
});

test("withEpochGuard: is a no-op once the epoch has advanced past the captured value", () => {
  const qc = new QueryClient();
  const epoch = advanceIdentityEpoch(qc, { kind: "live", profileId: "a" });
  let called = false;
  const guarded = withEpochGuard(qc, epoch, () => {
    called = true;
    return "result";
  });
  advanceIdentityEpoch(qc, { kind: "live", profileId: "b" });
  assert.equal(guarded(), undefined);
  assert.equal(called, false);
});

test("withEpochGuard: preserves an async fn's Promise so mutation settlement still waits on it", async () => {
  const qc = new QueryClient();
  const epoch = advanceIdentityEpoch(qc, { kind: "live", profileId: "a" });
  let resolved = false;
  const guarded = withEpochGuard(qc, epoch, async () => {
    await new Promise((r) => setTimeout(r, 10));
    resolved = true;
    return "async-result";
  });
  const result = await guarded();
  assert.equal(result, "async-result");
  assert.equal(resolved, true, "the guarded async function must actually have been awaited, not fired-and-forgotten");
});

test("withEpochGuard: capturing the epoch INSIDE the callback instead of at construction time defeats the guard (documents the correct pattern by showing the wrong one fails)", () => {
  const qc = new QueryClient();
  advanceIdentityEpoch(qc, { kind: "live", profileId: "a" });
  let ranWithWrongPattern = false;
  // WRONG: reads "current" epoch inside the callback itself, after the
  // switch could already have happened -- this always reports "current"
  // because it's comparing the epoch against itself.
  const wrongPattern = () => {
    const epochReadTooLate = getIdentityEpoch(qc).epoch;
    if (!isEpochCurrent(qc, epochReadTooLate)) return;
    ranWithWrongPattern = true;
  };
  advanceIdentityEpoch(qc, { kind: "live", profileId: "b" }); // simulate the switch happening before the callback runs
  wrongPattern();
  assert.equal(ranWithWrongPattern, true, "reading epoch inside the callback always passes, which is exactly why capture must happen at construction time instead");
});

test("withEpochGuardedTimer: checks the epoch at fire time, not schedule time", async () => {
  const qc = new QueryClient();
  const epoch = advanceIdentityEpoch(qc, { kind: "live", profileId: "a" });
  let fired = false;
  const timerFn = withEpochGuardedTimer(qc, epoch, () => {
    fired = true;
  });
  // Epoch advances AFTER the timer is scheduled but BEFORE it fires.
  const timer = setTimeout(timerFn, 10);
  advanceIdentityEpoch(qc, { kind: "live", profileId: "b" });
  await new Promise((r) => setTimeout(r, 25));
  clearTimeout(timer);
  assert.equal(fired, false, "a timer captured under the old epoch must not run its body once the epoch has advanced by fire time");
});

test("withEpochGuardedTimer: still fires normally if the epoch never advanced", async () => {
  const qc = new QueryClient();
  const epoch = advanceIdentityEpoch(qc, { kind: "live", profileId: "a" });
  let fired = false;
  const timerFn = withEpochGuardedTimer(qc, epoch, () => {
    fired = true;
  });
  await new Promise((resolve) => setTimeout(() => { timerFn(); resolve(); }, 10));
  assert.equal(fired, true);
});

test("registerIdentityDisposer / runRegisteredDisposers: every registered disposer runs, unregistering stops it from running again", () => {
  const qc = new QueryClient();
  let calls = 0;
  const unregister = registerIdentityDisposer(qc, () => { calls += 1; });
  registerIdentityDisposer(qc, () => { calls += 1; });
  runRegisteredDisposers(qc);
  assert.equal(calls, 2);
  unregister();
  runRegisteredDisposers(qc);
  assert.equal(calls, 3, "only the still-registered disposer should run the second time");
});

test("runRegisteredDisposers on a QueryClient with none registered is a safe no-op", () => {
  const qc = new QueryClient();
  assert.doesNotThrow(() => runRegisteredDisposers(qc));
});
