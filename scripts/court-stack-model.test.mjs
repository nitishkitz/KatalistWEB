import assert from "node:assert/strict";
import test from "node:test";
import {
  getStackPreviewIndices,
  lockGestureAxis,
  reconcileStackIndex,
  resistedDragOffset,
  resolveHorizontalAction,
  shouldCaptureStackPointer,
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

test("a tap remains a card click while an intentional drag captures the pointer", () => {
  assert.equal(shouldCaptureStackPointer(null), false);
  assert.equal(shouldCaptureStackPointer("horizontal"), true);
  assert.equal(shouldCaptureStackPointer("vertical"), true);
});

test("lane presentation exposes the next two queued Things in wrapped order", () => {
  assert.deepEqual(getStackPreviewIndices(0, 5, 2), [1, 2]);
  assert.deepEqual(getStackPreviewIndices(4, 5, 2), [0, 1]);
  assert.deepEqual(getStackPreviewIndices(0, 2, 2), [1]);
  assert.deepEqual(getStackPreviewIndices(0, 1, 2), []);
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
