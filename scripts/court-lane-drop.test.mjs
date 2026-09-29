import assert from "node:assert/strict";
import { test } from "node:test";
import { courtLaneDropAction } from "@/features/court/court-lane-drop";

function thing(acknowledgement, assigneeId = "me") {
  return {
    id: "thing-1",
    acknowledgement,
    workStatus: "not_started",
    cancelledAt: null,
    owner: { id: "owner" },
    assignee: { id: assigneeId },
  };
}

test("dropping a waiting Thing catches it at the destination pace", () => {
  assert.deepEqual(courtLaneDropAction(thing("waiting_for_catch"), "me", "now"), {
    kind: "catch",
    thingId: "thing-1",
    pace: "now",
  });
});

test("dropping a caught Thing changes only its personal pace", () => {
  assert.deepEqual(courtLaneDropAction(thing("caught"), "me", "later"), {
    kind: "set_pace",
    thingId: "thing-1",
    pace: "later",
  });
});

test("a Thing assigned to someone else cannot move between personal lanes", () => {
  assert.equal(courtLaneDropAction(thing("caught", "someone-else"), "me", "next"), null);
});
