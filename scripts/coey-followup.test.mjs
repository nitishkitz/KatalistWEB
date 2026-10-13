import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultCalendar, localParts, zonedInstant } from "../src/domain/coey/calendar.ts";
import { batchByHolder, nextFollowUp, planFollowUps } from "../src/domain/coey/followup.ts";

const IST = "Asia/Kolkata";
const at = (date, hhmm) => zonedInstant(date, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), IST);
const local = (ms) => {
  const p = localParts(ms, IST);
  return `${p.date} ${String(Math.floor(p.minutes / 60)).padStart(2, "0")}:${String(p.minutes % 60).padStart(2, "0")}`;
};
const cal = { ...defaultCalendar(IST), offSaturdays: [2, 4] };
const schedule = (over) => ({
  thingId: "t1", textRaw: "x", mode: "work", kind: "task", senderProfileId: "sender", holderProfileId: "ravi", state: "open",
  inboxReason: null, privateWait: false, groupId: null, chain: [], pace: "normal", paceResolution: null, actionTime: null,
  eventTime: null, activityType: null, recurrence: null, promiseAt: null, snoozeUntil: null, blockedOn: null,
  lastActivityAt: at("2026-10-09", "18:00"), lastNudgeAt: null, nudgeCountCycle: 0, breakthroughUsed: false, createdAt: at("2026-10-09", "18:00"), ...over,
});

test("§7.4: a Normal Thing sent Friday 18:00 is first followed up after one working day — Monday, not Saturday evening", () => {
  const next = nextFollowUp(schedule({}), cal);
  assert.equal(local(next.dueAt), "2026-10-12 18:00");
  assert.equal(planFollowUps([{ schedule: schedule({}), holderCal: cal }], at("2026-10-10", "19:00")).due.length, 0, "nothing on the 2nd-Saturday off");
});

test("§9.1 Urgent cadence is 4, 8, 12 working hours, then stops; channel ladder is in-app then push", () => {
  const start = at("2026-10-13", "09:00");
  const steps = [0, 1, 2].map((n) => nextFollowUp(schedule({ pace: "urgent", lastActivityAt: start, nudgeCountCycle: n }), cal));
  assert.deepEqual(steps.map((s) => local(s.dueAt)), ["2026-10-13 13:00", "2026-10-13 17:00", "2026-10-14 11:30"]);
  assert.equal(nextFollowUp(schedule({ pace: "urgent", lastActivityAt: start, nudgeCountCycle: 3 }), cal), null, "after 3, automatic nudges stop");
  const plan = planFollowUps([{ schedule: schedule({ pace: "urgent", lastActivityAt: start }), holderCal: cal }], at("2026-10-13", "13:05"));
  assert.equal(plan.due[0].channel, "in_app");
  const second = planFollowUps([{ schedule: schedule({ pace: "urgent", lastActivityAt: start, nudgeCountCycle: 1 }), holderCal: cal }], at("2026-10-13", "17:05"));
  assert.equal(second.due[0].channel, "push");
});

test("Chill never auto-nudges; self, private-wait, inbox, blocked and sorted Things are silent", () => {
  assert.equal(nextFollowUp(schedule({ pace: "chill" }), cal), null);
  for (const over of [{ holderProfileId: "sender" }, { privateWait: true }, { inboxReason: "unresolved_person" }, { state: "blocked" }, { state: "sorted" }, { state: "with_sender" }]) {
    assert.equal(nextFollowUp(schedule(over), cal), null, JSON.stringify(over));
  }
});

test("M3/M4: a promise stops cadence nudges until it is close — urgent 2 working hours before, normal at the start of the promise day", () => {
  const promise = at("2026-10-15", "16:00");
  assert.equal(local(nextFollowUp(schedule({ pace: "urgent", state: "promised", promiseAt: promise }), cal).dueAt), "2026-10-15 14:00");
  assert.equal(local(nextFollowUp(schedule({ state: "promised", promiseAt: promise }), cal).dueAt), "2026-10-15 09:00");
  assert.equal(local(nextFollowUp(schedule({ state: "promised", promiseAt: promise, nudgeCountCycle: 1 }), cal).dueAt), "2026-10-15 16:00");
  assert.equal(nextFollowUp(schedule({ state: "promised", promiseAt: promise, nudgeCountCycle: 2 }), cal), null, "a missed promise becomes an offer, not a third nudge");
});

test("§9.4: due outside working time, while snoozed, or on a festival waits for the next window; due items batch per holder", () => {
  const festive = { ...cal, festivals: ["2026-10-13"] };
  const s = schedule({ lastActivityAt: at("2026-10-12", "09:00") });
  assert.equal(planFollowUps([{ schedule: s, holderCal: festive }], at("2026-10-13", "12:00")).due.length, 0);
  const night = planFollowUps([{ schedule: s, holderCal: cal }], at("2026-10-13", "22:10"));
  assert.equal(night.due.length, 0);
  assert.equal(local(night.deferredUntil[0].at), "2026-10-14 09:00");
  assert.equal(planFollowUps([{ schedule: { ...s, snoozeUntil: at("2026-10-14", "09:00") }, holderCal: cal }], at("2026-10-13", "12:00")).due.length, 0);
  const due = planFollowUps([
    { schedule: s, holderCal: cal },
    { schedule: { ...s, thingId: "t2", senderProfileId: "priya" }, holderCal: cal },
    { schedule: { ...s, thingId: "t3", holderProfileId: "suresh" }, holderCal: cal },
  ], at("2026-10-13", "12:00")).due;
  const batches = batchByHolder(due);
  assert.deepEqual([...batches.keys()].sort(), ["ravi", "suresh"]);
  assert.equal(batches.get("ravi").length, 2);
});
