import assert from "node:assert/strict";
import test from "node:test";

import {
  loadOnboardingState,
  resolveOnboardingEntry,
  saveOnboardingState,
} from "@/features/onboarding/onboarding-state";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

test("a never-seen identity resumes at step 0, not completed, not skipped", () => {
  const storage = memoryStorage();
  assert.deepEqual(loadOnboardingState(storage, "user-a"), {
    step: 0,
    completed: false,
    skipped: false,
  });
});

test("saved progress round-trips for its own identity only", () => {
  const storage = memoryStorage();
  saveOnboardingState(storage, "user-a", { step: 1, completed: false, skipped: false });

  assert.deepEqual(loadOnboardingState(storage, "user-a"), {
    step: 1,
    completed: false,
    skipped: false,
  });
  // A different identity on the same browser must not resume user-a's step.
  assert.deepEqual(loadOnboardingState(storage, "user-b"), {
    step: 0,
    completed: false,
    skipped: false,
  });
});

test("skip persists independently of completion and does not force a step reset", () => {
  const storage = memoryStorage();
  saveOnboardingState(storage, "user-a", { step: 2, completed: false, skipped: true });

  const state = loadOnboardingState(storage, "user-a");
  assert.equal(state.skipped, true);
  assert.equal(state.completed, false);
  assert.equal(state.step, 2);
});

test("corrupted storage falls back to a safe default instead of throwing", () => {
  const storage = memoryStorage();
  storage.setItem("katalist_onboarding_state:user-a", "{not json");

  assert.deepEqual(loadOnboardingState(storage, "user-a"), {
    step: 0,
    completed: false,
    skipped: false,
  });
});

test("a completed tour always redirects home, never replaying the steps", () => {
  const entry = resolveOnboardingEntry({ step: 1, completed: true, skipped: false }, 2);
  assert.equal(entry.redirectHome, true);
});

test("a fresh identity resumes at the first tour step", () => {
  const entry = resolveOnboardingEntry({ step: 0, completed: false, skipped: false }, 2);
  assert.deepEqual(entry, { redirectHome: false, stepIndex: 0, onDiscoveryStep: false });
});

test("a step within the tour resumes at that exact step, not the discovery step", () => {
  const entry = resolveOnboardingEntry({ step: 1, completed: false, skipped: false }, 2);
  assert.deepEqual(entry, { redirectHome: false, stepIndex: 1, onDiscoveryStep: false });
});

test("a step past the last tour index resumes on the discovery step, not out of bounds", () => {
  const entry = resolveOnboardingEntry({ step: 2, completed: false, skipped: false }, 2);
  assert.deepEqual(entry, { redirectHome: false, stepIndex: 1, onDiscoveryStep: true });
});

test("skipping mid-tour still resumes at the skipped-from step on a later visit, not home", () => {
  const entry = resolveOnboardingEntry({ step: 1, completed: false, skipped: true }, 2);
  assert.equal(entry.redirectHome, false);
  assert.equal(entry.stepIndex, 1);
});

test("a wildly out-of-range stored step is clamped, not left dangling", () => {
  const entry = resolveOnboardingEntry({ step: 999, completed: false, skipped: false }, 2);
  assert.deepEqual(entry, { redirectHome: false, stepIndex: 1, onDiscoveryStep: true });
});

test("a negative or non-integer stored step is rejected back to 0", () => {
  const storage = memoryStorage();
  storage.setItem(
    "katalist_onboarding_state:user-a",
    JSON.stringify({ step: -3, completed: false, skipped: false }),
  );
  assert.equal(loadOnboardingState(storage, "user-a").step, 0);

  storage.setItem(
    "katalist_onboarding_state:user-a",
    JSON.stringify({ step: 1.5, completed: false, skipped: false }),
  );
  assert.equal(loadOnboardingState(storage, "user-a").step, 0);
});
