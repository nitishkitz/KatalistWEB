import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleStatusActions } from "@/features/bridge/visible-status-actions";

/**
 * H03: bridge_act's server-side assert_forward_status rejects a request to
 * go back to "not_started" once work has moved past it (see
 * supabase/migrations/20260818161732_*.sql). The Bridge guest page
 * previously always rendered all three status buttons regardless of the
 * Thing's current status, so clicking "not_started" while under_progress
 * would always fail with a generic "Unable to update this Thing." error
 * instead of simply not being offered.
 */

test("while not_started, all three actions are offered (not_started is a harmless no-op, forward transitions are legal)", () => {
  assert.deepEqual(visibleStatusActions("not_started"), ["not_started", "under_progress", "sorted"]);
});

test("once under_progress, not_started is hidden -- it would always be rejected as backward", () => {
  assert.deepEqual(visibleStatusActions("under_progress"), ["under_progress", "sorted"]);
});

test("the terminal states are never passed in by the caller (the page hides this row once terminal), but if they were, not_started still would not be offered", () => {
  assert.deepEqual(visibleStatusActions("sorted"), ["under_progress", "sorted"]);
  assert.deepEqual(visibleStatusActions("cancelled"), ["under_progress", "sorted"]);
});
