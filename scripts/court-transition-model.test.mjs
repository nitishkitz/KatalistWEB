import assert from "node:assert/strict";
import test from "node:test";
import {
  focusColumns,
  transitionDuration,
} from "@/features/court/court-stack-model";

const kinds = (lane) =>
  focusColumns({ lane, thingId: "thing-1" }).map(
    (column) => `${column.kind}:${column.lane}`,
  );

test("focused detail follows its selected lane", () => {
  assert.deepEqual(kinds("now"), [
    "navigator:now",
    "detail:now",
    "compact:next",
    "compact:later",
  ]);
  assert.deepEqual(kinds("next"), [
    "compact:now",
    "navigator:next",
    "detail:next",
    "compact:later",
  ]);
  assert.deepEqual(kinds("later"), [
    "compact:now",
    "compact:next",
    "navigator:later",
    "detail:later",
  ]);
});

test("Court transition timings are fixed and reduced motion is immediate", () => {
  assert.equal(transitionDuration("opening", false), 240);
  assert.equal(transitionDuration("closing", false), 220);
  assert.equal(transitionDuration("focused", false), 180);
  assert.equal(transitionDuration("opening", true), 0);
  assert.equal(transitionDuration("closing", true), 0);
});
