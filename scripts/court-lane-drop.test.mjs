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

// Coey-scheduled Things are placed from their schedule (spec §8.4).
const { coeyLaneMove, promiseLane } = await import("@/features/court/court-lane-drop");
const { defaultCalendar, zonedInstant } = await import("@/domain/coey/calendar");
const IST = "Asia/Kolkata";
const NOW = zonedInstant("2026-10-13", 11 * 60, IST);
const cal = defaultCalendar(IST);
function scheduled(sender, holder, over = {}) {
  return {
    id: "t1", title: "Book movie tickets", acknowledgement: "waiting_for_catch", workStatus: "not_started", cancelledAt: null,
    owner: { id: "a-" + sender, name: "Sudheer" }, assignee: { id: "a-" + holder },
    coey: {
      viewerProfileId: "me", holderCal: cal,
      schedule: { thingId: "t1", textRaw: "Book movie tickets", mode: "work", kind: "task", senderProfileId: sender, holderProfileId: holder, state: "open",
        inboxReason: null, privateWait: false, groupId: null, chain: [], pace: null, paceResolution: null, actionTime: null, eventTime: null,
        activityType: null, recurrence: null, promiseAt: null, snoozeUntil: null, blockedOn: null, lastActivityAt: NOW, lastNudgeAt: null,
        nudgeCountCycle: 0, breakthroughUsed: false, createdAt: NOW, ...over },
    },
  };
}

test("production regression: moving someone else's Thing to Later is a promise that lands in Later, never a silent no-op", () => {
  const sent = scheduled("sudheer", "me", { actionTime: { phrase: "Oct 15", at: zonedInstant("2026-10-15", 9 * 60, IST), source: "typed" } });
  for (const lane of ["now", "next", "later"]) {
    const move = coeyLaneMove(sent, lane, NOW);
    assert.equal(move.kind, "promise", "the holder cannot change the sender's pace");
    assert.ok(move.suggestedAt > NOW);
    assert.equal(promiseLane(sent, move.suggestedAt, NOW), lane, `the suggested promise lands in ${lane}`);
  }
});

test("my own Thing moves by its pace; when its date keeps it elsewhere, Coey says so instead of claiming a move", () => {
  assert.deepEqual(coeyLaneMove(scheduled("me", "me"), "later", NOW), { kind: "pace", pace: "chill", lane: "later" });
  assert.deepEqual(coeyLaneMove(scheduled("me", "me"), "now", NOW), { kind: "pace", pace: "urgent", lane: "now" });
  const dueToday = scheduled("me", "me", { actionTime: { phrase: "today", at: zonedInstant("2026-10-13", 17 * 60, IST), source: "typed" } });
  assert.equal(coeyLaneMove(dueToday, "next", NOW).kind, "date_wins");
  assert.equal(coeyLaneMove(scheduled("sudheer", "ravi"), "later", NOW), null, "not my Thing to move");
  assert.equal(coeyLaneMove({ ...scheduled("me", "me"), coey: undefined }, "later", NOW), null, "unscheduled Things keep the legacy path");
});
