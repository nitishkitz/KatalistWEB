import assert from "node:assert/strict";
import test from "node:test";
import {
  computeBand,
  bandAdvanced,
  canSend,
  computeStreak,
  isStreakMilestone,
  isQuietHour,
  dayKey,
} from "@/features/nudges/escalation-logic";

const H = 60 * 60 * 1000;
const D = 24 * H;

test("computeBand maps age to the right staleness band", () => {
  assert.equal(computeBand(0), "fresh");
  assert.equal(computeBand(11 * H), "fresh");
  assert.equal(computeBand(12 * H), "warm");
  assert.equal(computeBand(23 * H), "warm");
  assert.equal(computeBand(24 * H), "hot");
  assert.equal(computeBand(47 * H), "hot");
  assert.equal(computeBand(48 * H), "on_fire");
  assert.equal(computeBand(71 * H), "on_fire");
  assert.equal(computeBand(72 * H), "stale");
  assert.equal(computeBand(200 * H), "stale");
});

test("bandAdvanced only fires on a strictly higher band", () => {
  assert.equal(bandAdvanced(null, "fresh"), false); // fresh is the baseline, never a nudge
  assert.equal(bandAdvanced(null, "warm"), true);
  assert.equal(bandAdvanced("warm", "warm"), false);
  assert.equal(bandAdvanced("warm", "hot"), true);
  assert.equal(bandAdvanced("stale", "on_fire"), false);
});

test("canSend enforces the auto_nudge 1-per-item-per-24h cap", () => {
  const now = Date.now();
  assert.equal(canSend("auto_nudge", [], now), true);
  assert.equal(canSend("auto_nudge", [now - 23 * H], now), false);
  assert.equal(canSend("auto_nudge", [now - 25 * H], now), true);
});

test("canSend enforces weekly and reactivation caps", () => {
  const now = Date.now();
  assert.equal(canSend("spring_clean", [now - 6 * D], now), false);
  assert.equal(canSend("spring_clean", [now - 8 * D], now), true);
  assert.equal(canSend("reactivation", [now - 3 * D], now), true); // 1 sent, 2nd allowed
  assert.equal(canSend("reactivation", [now - 3 * D, now - 1 * D], now), false); // then silence
});

test("streak milestones are 3/7/14/30 only", () => {
  assert.equal(isStreakMilestone(3), true);
  assert.equal(isStreakMilestone(7), true);
  assert.equal(isStreakMilestone(30), true);
  assert.equal(isStreakMilestone(5), false);
  assert.equal(isStreakMilestone(0), false);
});

test("computeStreak counts consecutive days ending today or yesterday", () => {
  const now = new Date("2026-09-16T10:00:00");
  const d = (offset) => {
    const x = new Date(now);
    x.setDate(x.getDate() - offset);
    return x.toISOString();
  };
  assert.equal(computeStreak([d(0), d(1), d(2)], now), 3); // today back
  assert.equal(computeStreak([d(1), d(2)], now), 2); // yesterday anchor (not yet broken)
  assert.equal(computeStreak([d(2), d(3)], now), 0); // gap at yesterday → broken
  assert.equal(computeStreak([d(0), d(0), d(1)], now), 2); // duplicate same-day collapses
  assert.equal(computeStreak([], now), 0);
});

test("isQuietHour handles same-day and overnight windows", () => {
  assert.equal(isQuietHour(22, 21, 8), true); // overnight
  assert.equal(isQuietHour(3, 21, 8), true);
  assert.equal(isQuietHour(9, 21, 8), false);
  assert.equal(isQuietHour(13, 12, 14), true); // same-day
  assert.equal(isQuietHour(15, 12, 14), false);
  assert.equal(isQuietHour(5, 0, 0), false); // disabled
});

test("dayKey is stable local YYYY-MM-DD", () => {
  assert.equal(dayKey(new Date("2026-01-05T23:30:00")), "2026-01-05");
});
