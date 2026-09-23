import assert from "node:assert/strict";
import test from "node:test";
import {
  lockGestureAxis,
  reconcileStackIndex,
  resistedDragOffset,
  resolveHorizontalAction,
  shouldRestoreFocusAfterFailedRemoval,
  shouldRestoreSelectionAfterFailedRemoval,
  stepStackIndex,
} from "@/features/court/court-stack-model";

const items = (...ids) => ids.map((id) => ({ id }));

test("reconciliation preserves identity through reorder and clamps removal", () => {
  assert.equal(reconcileStackIndex(1, "b", items("c", "b", "a")), 1);
  assert.equal(reconcileStackIndex(2, "c", items("a", "b")), 1);
  assert.equal(reconcileStackIndex(3, "missing", []), 0);
});

test("stepping wraps only non-empty multi-item stacks", () => {
  assert.equal(stepStackIndex(2, 3, 1), 0);
  assert.equal(stepStackIndex(0, 3, -1), 2);
  assert.equal(stepStackIndex(0, 0, 1), 0);
});

test("gesture intent locks to the first dominant axis after ten pixels", () => {
  assert.equal(lockGestureAxis(null, 6, 5), null);
  assert.equal(lockGestureAxis(null, 12, 7), "horizontal");
  assert.equal(lockGestureAxis("horizontal", 13, 40), "horizontal");
  assert.equal(lockGestureAxis(null, 8, -14), "vertical");
});

test("actions honor capability, direction, threshold, and LATER resistance", () => {
  assert.equal(
    resolveHorizontalAction({ deltaX: 80, threshold: 72, canSort: true, canMoveLater: true }),
    "sort",
  );
  assert.equal(
    resolveHorizontalAction({ deltaX: -80, threshold: 72, canSort: true, canMoveLater: true }),
    "later",
  );
  assert.equal(
    resolveHorizontalAction({ deltaX: -80, threshold: 72, canSort: true, canMoveLater: false }),
    null,
  );
  assert.equal(
    resolveHorizontalAction({ deltaX: 50, threshold: 72, canSort: true, canMoveLater: true }),
    null,
  );
  assert.equal(resistedDragOffset(-100, true, false), -18);
});

test("a failed removal with no intervening navigation restores the original selection", () => {
  // The Thing was swiped away (removedIds gained it) and its mutation then
  // failed; nothing else navigated in the meantime (the version counter
  // is unchanged), and the Thing is back in `things` now that the removal
  // rolled back — so selection should return to it.
  assert.equal(
    shouldRestoreSelectionAfterFailedRemoval({
      navigationVersionAtRemoval: 3,
      currentNavigationVersion: 3,
      removedThingId: "a",
      things: items("a", "b", "c"),
    }),
    true,
  );
});

test("a failure after intentional navigation preserves the newer selection", () => {
  // Between the removal starting and its mutation failing, the user (or a
  // parent component via focusThing) explicitly navigated — the version
  // counter advanced — so the failure must not yank selection back to the
  // Thing that was swiped away; the newer selection wins.
  assert.equal(
    shouldRestoreSelectionAfterFailedRemoval({
      navigationVersionAtRemoval: 3,
      currentNavigationVersion: 4,
      removedThingId: "a",
      things: items("a", "b", "c"),
    }),
    false,
  );
});

test("restoration requires the Thing to actually be back in the stack", () => {
  // Defensive: even with no intervening navigation, don't claim "restore"
  // for a Thing that isn't (yet, or ever) back in `things` — e.g. this ran
  // before the revert actually landed, or the Thing was independently
  // removed by something else in the meantime.
  assert.equal(
    shouldRestoreSelectionAfterFailedRemoval({
      navigationVersionAtRemoval: 1,
      currentNavigationVersion: 1,
      removedThingId: "z",
      things: items("a", "b", "c"),
    }),
    false,
  );
});

test("DOM focus restoration: no intervening interaction restores focus to the card", () => {
  assert.equal(
    shouldRestoreFocusAfterFailedRemoval({
      navigationVersionAtSchedule: 2,
      currentNavigationVersion: 2,
      focusIsWithinLane: true,
    }),
    true,
  );
});

test("DOM focus restoration: focus moved to an input or another panel since scheduling preserves it", () => {
  // Simulates the requestAnimationFrame re-check: by the time the deferred
  // callback fires, the user has clicked into an input or opened another
  // panel, so focus is no longer inside this lane at all.
  assert.equal(
    shouldRestoreFocusAfterFailedRemoval({
      navigationVersionAtSchedule: 2,
      currentNavigationVersion: 2,
      focusIsWithinLane: false,
    }),
    false,
  );
});

test("DOM focus restoration: navigation between scheduling and the animation frame firing is not overridden", () => {
  // The version advanced (an arrow/wheel navigation, the navigator strip,
  // or an external focusThing() call happened) in the gap between
  // scheduling the rAF and it actually running — the deferred call must
  // not steal focus back from wherever that newer navigation landed.
  assert.equal(
    shouldRestoreFocusAfterFailedRemoval({
      navigationVersionAtSchedule: 2,
      currentNavigationVersion: 3,
      focusIsWithinLane: true,
    }),
    false,
  );
});
