import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveEffectiveTimezone,
  isValidTimeZone,
  localDateKey,
  isPastMorningThreshold,
  nextMorningThreshold,
  nextLocalMidnight,
  isEligibleToAutoOpen,
  MORNING_THRESHOLD_HOUR,
} from "@/features/catchup/morning-brief-schedule";

const NY = "America/New_York";

test("MORNING_THRESHOLD_HOUR is the accepted default of 7am", () => {
  assert.equal(MORNING_THRESHOLD_HOUR, 7);
});

test("resolveEffectiveTimezone: a valid profile timezone wins", () => {
  assert.equal(resolveEffectiveTimezone("Asia/Tokyo"), "Asia/Tokyo");
});

test("resolveEffectiveTimezone: an invalid profile timezone falls back to the browser's (mocked via Intl default)", () => {
  // The test environment's own resolved timezone is whatever Intl reports
  // by default -- just assert it's a valid IANA zone string, not a
  // specific value (that would make the test environment-dependent).
  const result = resolveEffectiveTimezone("not-a-real-timezone");
  assert.ok(isValidTimeZone(result), `expected a valid fallback timezone, got ${result}`);
});

test("resolveEffectiveTimezone: null/undefined profile timezone also falls back", () => {
  assert.ok(isValidTimeZone(resolveEffectiveTimezone(null)));
  assert.ok(isValidTimeZone(resolveEffectiveTimezone(undefined)));
});

test("isValidTimeZone rejects garbage and accepts real IANA zones", () => {
  assert.equal(isValidTimeZone("America/New_York"), true);
  assert.equal(isValidTimeZone("Definitely/Not/A/Zone"), false);
});

test("localDateKey: the same real instant can be a different calendar date in a different timezone", () => {
  const instant = new Date("2026-06-15T02:00:00Z"); // late evening in the Americas, already the next day further east
  assert.equal(localDateKey(instant, "America/Los_Angeles"), "2026-06-14");
  assert.equal(localDateKey(instant, "Asia/Tokyo"), "2026-06-15");
});

test("isPastMorningThreshold: 06:59 local is not past, 07:00 and 18:00 are", () => {
  // These three instants are all on 2026-06-15 in America/New_York (EDT, UTC-4).
  assert.equal(isPastMorningThreshold(new Date("2026-06-15T10:59:00Z"), NY), false, "06:59 local");
  assert.equal(isPastMorningThreshold(new Date("2026-06-15T11:00:00Z"), NY), true, "exactly 07:00 local qualifies");
  assert.equal(isPastMorningThreshold(new Date("2026-06-15T22:00:00Z"), NY), true, "18:00 local -- no noon cutoff");
});

test("nextMorningThreshold: before today's 07:00 returns today's threshold", () => {
  // 2026-06-15T09:00:00Z = 05:00 local (EDT) -- before today's 7am.
  const result = nextMorningThreshold(new Date("2026-06-15T09:00:00Z"), NY);
  assert.equal(result.toISOString(), "2026-06-15T11:00:00.000Z", "today 07:00 local = 11:00 UTC in EDT");
});

test("nextMorningThreshold: exactly at today's 07:00 returns TOMORROW's threshold (strictly after `now`)", () => {
  const result = nextMorningThreshold(new Date("2026-06-15T11:00:00Z"), NY);
  assert.equal(result.toISOString(), "2026-06-16T11:00:00.000Z");
});

test("nextMorningThreshold: after today's 07:00 returns tomorrow's threshold", () => {
  // 2026-06-15T18:00:00Z = 14:00 local -- well past today's 7am.
  const result = nextMorningThreshold(new Date("2026-06-15T18:00:00Z"), NY);
  assert.equal(result.toISOString(), "2026-06-16T11:00:00.000Z");
});

test("nextMorningThreshold across a DST spring-forward (America/New_York, 2026-03-08): tomorrow's 07:00 is correctly in EDT, not naively +24h from EST", () => {
  // 2026-03-07T23:30:00Z = 18:30 local on March 7 (EST, UTC-5) -- well
  // past that day's own 7am, so the next threshold is March 8's 7am,
  // which falls in EDT (UTC-4) once the transition happens overnight.
  // A naive "add 24 hours" would land on 2026-03-08T12:00:00Z (wrong by
  // an hour); the real local-calendar-date-based answer is 11:00Z.
  const result = nextMorningThreshold(new Date("2026-03-07T23:30:00Z"), NY);
  assert.equal(result.toISOString(), "2026-03-08T11:00:00.000Z");
});

test("nextMorningThreshold across a DST fall-back (America/New_York, 2026-11-01): tomorrow's 07:00 is correctly in EST", () => {
  // 2026-10-31T23:30:00Z = 19:30 local on Oct 31 (EDT, UTC-4) -- past
  // that day's 7am, so the next threshold is Nov 1's 7am, in EST (UTC-5)
  // once the transition happens overnight.
  const result = nextMorningThreshold(new Date("2026-10-31T23:30:00Z"), NY);
  assert.equal(result.toISOString(), "2026-11-01T12:00:00.000Z");
});

// T10-03 (gap #11): the previous "tomorrow" derivation round-tripped a
// UTC-noon guess through `timeZone` and then added a UTC day -- at an
// extreme offset (UTC+14), that round-trip can ALREADY land on the next
// local calendar day before the "+1 day" step even runs, silently
// overshooting by an extra day. These tests exercise UTC+14, UTC-12, a
// half-hour-offset zone, and the existing DST pair, validating the exact
// resulting local hour/date rather than assuming a fixed 24h increment.
test("nextMorningThreshold: UTC+14 (Pacific/Kiritimati) does not overshoot by an extra day", () => {
  const KIRITIMATI = "Pacific/Kiritimati";
  // 2026-06-15T20:00:00Z = 2026-06-16T10:00 local (UTC+14) -- past today's
  // (the 16th's) 7am threshold, so the next one is the 17th's 07:00 local.
  const result = nextMorningThreshold(new Date("2026-06-15T20:00:00Z"), KIRITIMATI);
  assert.equal(result.toISOString(), "2026-06-16T17:00:00.000Z", "2026-06-17T07:00 local (UTC+14) = 2026-06-16T17:00Z");
});

test("nextMorningThreshold: UTC-12 (Etc/GMT+12) resolves the correct next day", () => {
  const BAKER_ISLAND = "Etc/GMT+12"; // POSIX Etc/GMT signs are inverted: this zone IS UTC-12.
  // 2026-06-15T10:00:00Z = 2026-06-14T22:00 local (UTC-12) -- already past
  // the 14th's 7am threshold, so the next one is the 15th's 07:00 local.
  const result = nextMorningThreshold(new Date("2026-06-15T10:00:00Z"), BAKER_ISLAND);
  assert.equal(result.toISOString(), "2026-06-15T19:00:00.000Z", "2026-06-15T07:00 local (UTC-12) = 2026-06-15T19:00Z");
});

test("nextMorningThreshold: a half-hour-offset zone (Asia/Kolkata, UTC+5:30) resolves exactly, not rounded to a whole hour", () => {
  const KOLKATA = "Asia/Kolkata";
  // 2026-06-15T10:00:00Z = 15:30 local -- past today's threshold, so the
  // next one is tomorrow's 07:00 local.
  const result = nextMorningThreshold(new Date("2026-06-15T10:00:00Z"), KOLKATA);
  assert.equal(result.toISOString(), "2026-06-16T01:30:00.000Z", "2026-06-16T07:00 local (UTC+5:30) = 2026-06-16T01:30Z");
});

test("nextLocalMidnight: resolves the next local calendar-date rollover, not a fixed 24h increment", () => {
  // 2026-06-15T20:00:00Z = 2026-06-16T10:00 local (UTC+14) -- the next
  // rollover is the start of the 17th, local.
  const result = nextLocalMidnight(new Date("2026-06-15T20:00:00Z"), "Pacific/Kiritimati");
  assert.equal(result.toISOString(), "2026-06-16T10:00:00.000Z", "2026-06-17T00:00 local (UTC+14) = 2026-06-16T10:00Z");
});

test("nextLocalMidnight across a DST spring-forward (America/New_York): correct in EDT, not naively +24h", () => {
  // 2026-03-07T23:30:00Z = 18:30 local on March 7 (EST) -- next midnight
  // rollover is the start of March 8, still in EST (transition is at 2am
  // local on the 8th, after midnight).
  const result = nextLocalMidnight(new Date("2026-03-07T23:30:00Z"), NY);
  assert.equal(result.toISOString(), "2026-03-08T05:00:00.000Z");
});

test("isEligibleToAutoOpen: blockers take precedence over the threshold/moments check, in a defined order", () => {
  const base = {
    now: new Date("2026-06-15T18:00:00Z"), // 14:00 local, past threshold
    timeZone: NY,
    hasActionableMoments: true,
    hasMomentsError: false,
    isTabHidden: false,
    authPending: false,
    profileLoading: false,
    momentsLoading: false,
    hasBlockingInteraction: false,
  };

  assert.deepEqual(isEligibleToAutoOpen(base), { eligible: true });
  assert.deepEqual(isEligibleToAutoOpen({ ...base, authPending: true }), { eligible: false, reason: "pending-auth" });
  assert.deepEqual(
    isEligibleToAutoOpen({ ...base, profileLoading: true }),
    { eligible: false, reason: "profile-loading" },
  );
  assert.deepEqual(isEligibleToAutoOpen({ ...base, momentsLoading: true }), { eligible: false, reason: "loading" });
  assert.deepEqual(isEligibleToAutoOpen({ ...base, isTabHidden: true }), { eligible: false, reason: "hidden-tab" });
  assert.deepEqual(
    isEligibleToAutoOpen({ ...base, hasBlockingInteraction: true }),
    { eligible: false, reason: "blocking-dialog" },
  );
  assert.deepEqual(
    isEligibleToAutoOpen({ ...base, now: new Date("2026-06-15T09:00:00Z") }), // 05:00 local, before threshold
    { eligible: false, reason: "before-threshold" },
  );
  assert.deepEqual(
    isEligibleToAutoOpen({ ...base, hasActionableMoments: false }),
    { eligible: false, reason: "no-moments" },
  );
});

test("isEligibleToAutoOpen: no moments does not report as a false 'before-threshold' or vice versa", () => {
  // Explicitly checks the two reasons aren't confused with each other --
  // an earlier draft of this logic conflated "before 7am" with "no
  // moments yet" under one shared reason string.
  const beforeThreshold = isEligibleToAutoOpen({
    now: new Date("2026-06-15T09:00:00Z"),
    timeZone: NY,
    hasActionableMoments: true,
    isTabHidden: false,
    authPending: false,
    momentsLoading: false,
    hasBlockingInteraction: false,
  });
  assert.equal(beforeThreshold.eligible, false);
  assert.equal(beforeThreshold.reason, "before-threshold");

  const noMoments = isEligibleToAutoOpen({
    now: new Date("2026-06-15T18:00:00Z"),
    timeZone: NY,
    hasActionableMoments: false,
    isTabHidden: false,
    authPending: false,
    momentsLoading: false,
    hasBlockingInteraction: false,
  });
  assert.equal(noMoments.eligible, false);
  assert.equal(noMoments.reason, "no-moments");
});

// R-04: `timeZone` falls back to the browser's own zone whenever the
// profile's stored zone is unknown -- indistinguishable from "genuinely
// unset" while the profile fetch is merely still in flight. Evaluating
// the 07:00 threshold before the real profile zone is known can auto-open
// (or wrongly skip) using the wrong zone's morning -- profileLoading must
// block BEFORE the threshold check even considers `now`/`timeZone`.
test("isEligibleToAutoOpen: profile still loading blocks even when the (unreliable) browser-zone guess looks past threshold", () => {
  const result = isEligibleToAutoOpen({
    now: new Date("2026-06-15T18:00:00Z"), // 14:00 in NY -- looks well past threshold
    timeZone: NY,
    hasActionableMoments: true,
    hasMomentsError: false,
    isTabHidden: false,
    authPending: false,
    profileLoading: true,
    momentsLoading: false,
    hasBlockingInteraction: false,
  });
  assert.deepEqual(result, { eligible: false, reason: "profile-loading" });
});
