import assert from "node:assert/strict";
import { test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { advanceIdentityEpoch, getIdentityEpoch } from "@/features/realtime/identity-cache-policy";

/**
 * P3 mutation-callback retrofit: invalidatePersonalSurfaces/
 * invalidateSnoozeSurfaces are shared helpers with multiple, independent
 * callers (use-trophy.ts's restore, CourtDesktop.tsx's refreshAfterMutation
 * proxy, CourtLaneStack.tsx's runSnooze, use-realtime.ts's
 * profile_object_state handler). Rather than trust every call site to
 * remember its own epoch guard, the check lives once inside the shared
 * helper itself -- a caller with a stale, since-retired epoch gets a
 * silent no-op instead of a cache write attributed to a retired identity.
 */

let invalidateCallCount = 0;

const { invalidatePersonalSurfaces } = await import("@/features/things/personal-shred");
const { invalidateSnoozeSurfaces } = await import("@/features/things/personal-snooze");

function countingClient() {
  const qc = new QueryClient();
  const original = qc.invalidateQueries.bind(qc);
  qc.invalidateQueries = (...args) => {
    invalidateCallCount += 1;
    return original(...args);
  };
  return qc;
}

test("invalidatePersonalSurfaces is a no-op when the captured epoch is stale", async () => {
  invalidateCallCount = 0;
  const qc = countingClient();
  const staleEpoch = getIdentityEpoch(qc).epoch;
  advanceIdentityEpoch(qc, { kind: "live", profileId: "B" }); // simulate the identity switch happening before this call runs

  await invalidatePersonalSurfaces(qc, staleEpoch);

  assert.equal(invalidateCallCount, 0, "a stale-epoch call must not perform any of its 14 invalidations");
});

test("invalidatePersonalSurfaces performs all its invalidations when the epoch is still current", async () => {
  invalidateCallCount = 0;
  const qc = countingClient();
  const epoch = getIdentityEpoch(qc).epoch;

  await invalidatePersonalSurfaces(qc, epoch);

  assert.equal(invalidateCallCount, 14, "expected all 14 invalidateQueries calls to run for a current epoch");
});

test("invalidateSnoozeSurfaces is a no-op when the captured epoch is stale", async () => {
  invalidateCallCount = 0;
  const qc = countingClient();
  const staleEpoch = getIdentityEpoch(qc).epoch;
  advanceIdentityEpoch(qc, { kind: "live", profileId: "B" });

  await invalidateSnoozeSurfaces(qc, staleEpoch);

  assert.equal(invalidateCallCount, 0);
});

test("invalidateSnoozeSurfaces performs all its invalidations when the epoch is still current", async () => {
  invalidateCallCount = 0;
  const qc = countingClient();
  const epoch = getIdentityEpoch(qc).epoch;

  await invalidateSnoozeSurfaces(qc, epoch);

  assert.equal(invalidateCallCount, 3);
});
