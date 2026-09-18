import assert from "node:assert/strict";
import test from "node:test";
import {
  MOMENT_PRIORITY,
  momentPriority,
  dedupeMoments,
  filterSurfaced,
  resolveMoments,
  reasonLabelFor,
  relativeTimeLabel,
  catchUpActionsFor,
} from "@/features/catchup/catchup-logic";

const H = 60 * 60 * 1000;

function moment(overrides = {}) {
  return {
    momentKey: overrides.momentKey ?? "nudge:1",
    kind: overrides.kind ?? "nudge",
    thingId: overrides.thingId ?? "t1",
    occurredAt: overrides.occurredAt ?? new Date().toISOString(),
    actorId: overrides.actorId ?? null,
    reason: overrides.reason ?? "waiting_for_catch",
  };
}

test("priority order is nudge > snooze_ended > ghost > follow_up", () => {
  assert.ok(MOMENT_PRIORITY.nudge < MOMENT_PRIORITY.snooze_ended);
  assert.ok(MOMENT_PRIORITY.snooze_ended < MOMENT_PRIORITY.ghost);
  assert.ok(MOMENT_PRIORITY.ghost < MOMENT_PRIORITY.follow_up);
  assert.equal(momentPriority("nudge"), 1);
});

test("one Thing with multiple triggers appears once, with the highest-priority reason", () => {
  const now = Date.now();
  const input = [
    moment({ momentKey: "followup:t1", kind: "follow_up", thingId: "t1", occurredAt: new Date(now).toISOString() }),
    moment({ momentKey: "nudge:t1", kind: "nudge", thingId: "t1", occurredAt: new Date(now - 5 * H).toISOString() }),
  ];
  const out = dedupeMoments(input);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, "nudge"); // higher priority wins even though it is older
});

test("same-kind duplicates collapse to the newest occurrence", () => {
  const now = Date.now();
  const input = [
    moment({ momentKey: "nudge:old", kind: "nudge", thingId: "t1", occurredAt: new Date(now - 10 * H).toISOString() }),
    moment({ momentKey: "nudge:new", kind: "nudge", thingId: "t1", occurredAt: new Date(now - 1 * H).toISOString() }),
  ];
  const out = dedupeMoments(input);
  assert.equal(out.length, 1);
  assert.equal(out[0].momentKey, "nudge:new");
});

test("dedupe orders results priority-first then newest-first", () => {
  const now = Date.now();
  const input = [
    moment({ momentKey: "followup:t3", kind: "follow_up", thingId: "t3", occurredAt: new Date(now).toISOString() }),
    moment({ momentKey: "nudge:t1", kind: "nudge", thingId: "t1", occurredAt: new Date(now - 2 * H).toISOString() }),
    moment({ momentKey: "snooze:t2", kind: "snooze_ended", thingId: "t2", occurredAt: new Date(now).toISOString() }),
  ];
  const out = dedupeMoments(input);
  assert.deepEqual(
    out.map((m) => m.thingId),
    ["t1", "t2", "t3"],
  );
});

test("a surfaced nudge does not return, but a later nudge for the same Thing does", () => {
  const surfaced = new Set(["nudge:123"]);
  const first = [moment({ momentKey: "nudge:123", thingId: "t1" })];
  assert.equal(filterSurfaced(first, surfaced).length, 0);

  // A new nudge produces a new key and reappears.
  const later = [moment({ momentKey: "nudge:456", thingId: "t1" })];
  assert.equal(filterSurfaced(later, surfaced).length, 1);
});

test("resolveMoments filters surfaced then dedupes", () => {
  const now = Date.now();
  const surfaced = new Set(["nudge:t1"]);
  const input = [
    moment({ momentKey: "nudge:t1", kind: "nudge", thingId: "t1", occurredAt: new Date(now).toISOString() }),
    moment({ momentKey: "followup:t1", kind: "follow_up", thingId: "t1", occurredAt: new Date(now).toISOString() }),
  ];
  const out = resolveMoments(input, surfaced);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, "follow_up"); // the nudge was surfaced, follow_up remains
});

test("contextual actions match capabilities and never invent permissions", () => {
  // Waiting nudge → Catch first
  assert.deepEqual(
    catchUpActionsFor("nudge", { canCatch: true, canSetPace: false, canNudge: false }),
    ["catch", "snooze", "open"],
  );
  // Caught nudge → Set Pace
  assert.deepEqual(
    catchUpActionsFor("nudge", { canCatch: false, canSetPace: true, canNudge: false }),
    ["set_pace", "snooze", "open"],
  );
  // No capability → only Snooze + Open
  assert.deepEqual(
    catchUpActionsFor("nudge", { canCatch: false, canSetPace: false, canNudge: false }),
    ["snooze", "open"],
  );
  // Snooze ended, already caught → Move to Now
  assert.deepEqual(
    catchUpActionsFor("snooze_ended", { canCatch: false, canSetPace: true, canNudge: false }),
    ["move_now", "snooze", "open"],
  );
  // Ghost → Open, Snooze, Dismiss
  assert.deepEqual(
    catchUpActionsFor("ghost", { canCatch: false, canSetPace: false, canNudge: false }),
    ["open", "snooze", "dismiss_ghost"],
  );
  // Follow-up → Open, plus Nudge only when authorised
  assert.deepEqual(
    catchUpActionsFor("follow_up", { canCatch: false, canSetPace: false, canNudge: true }),
    ["open", "nudge"],
  );
  assert.deepEqual(
    catchUpActionsFor("follow_up", { canCatch: false, canSetPace: false, canNudge: false }),
    ["open"],
  );
});

test("reasonLabelFor and relativeTimeLabel produce readable text", () => {
  assert.equal(reasonLabelFor("nudge", "waiting_for_catch"), "Waiting for Catch");
  assert.equal(reasonLabelFor("snooze_ended", "snooze_ended"), "Snooze ended");
  assert.equal(reasonLabelFor("follow_up", "due_soon"), "Due soon");

  const now = Date.now();
  assert.equal(relativeTimeLabel(new Date(now - 10 * 60 * 1000).toISOString(), now), "10 min ago");
  assert.equal(relativeTimeLabel(new Date(now - 2 * H).toISOString(), now), "2 hrs ago");
  assert.equal(relativeTimeLabel(new Date(now).toISOString(), now), "just now");
});
