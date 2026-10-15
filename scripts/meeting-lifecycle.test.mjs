import assert from "node:assert/strict";
import test from "node:test";
import { isUpcomingMeeting } from "../src/features/lists/meeting-lifecycle.ts";

test("a meeting leaves Upcoming at its end even when nobody attended", () => {
  const meeting = { endsAt: "2026-10-14T16:00:00Z" };
  const end = Date.parse(meeting.endsAt);
  assert.equal(isUpcomingMeeting(meeting, end - 1), true);
  assert.equal(isUpcomingMeeting(meeting, end), false);
  assert.equal(isUpcomingMeeting(meeting, end + 24 * 60 * 60 * 1000), false);
  assert.equal(isUpcomingMeeting({ endsAt: "invalid" }, end), false);
});
