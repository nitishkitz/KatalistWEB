import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addWorkingMs,
  defaultCalendar,
  isWorkingDay,
  lastWorkingDayOfMonth,
  localParts,
  nextWindowStart,
  workingDaysBetween,
  workingMsBetween,
  zonedInstant,
} from "../src/domain/coey/calendar.ts";
import { resolveTimeExpr } from "../src/domain/coey/time.ts";
import { buildDraftPlan, resolveMention } from "../src/domain/coey/draft.ts";
import { computeHolderLane, computeSenderConcern, isStale } from "../src/domain/coey/placement.ts";

const IST = "Asia/Kolkata";
const HOUR = 3_600_000;
const at = (date, hhmm, tz = IST) => {
  const [h, m] = hhmm.split(":").map(Number);
  return zonedInstant(date, h * 60 + m, tz);
};
const local = (ms, tz = IST) => {
  const p = localParts(ms, tz);
  return `${p.date} ${String(Math.floor(p.minutes / 60)).padStart(2, "0")}:${String(p.minutes % 60).padStart(2, "0")}`;
};
const expr = (phrase, day, time = null, extra = {}) => ({ phrase, day, time, boundary: null, offset_days: null, said_weekday: null, ...extra });

test("calendar: Friday 18:00 + 1 working day lands Monday, skipping a 2nd-Saturday off and Sunday (§7.4)", () => {
  const cal = { ...defaultCalendar(IST), offSaturdays: [2, 4] };
  assert.equal(isWorkingDay("2026-10-10", cal), false, "10 Oct 2026 is the 2nd Saturday");
  assert.equal(isWorkingDay("2026-10-17", cal), true, "3rd Saturday works");
  const due = addWorkingMs(at("2026-10-09", "18:00"), 9.5 * HOUR, cal, "work");
  assert.equal(local(due), "2026-10-12 18:00");
  assert.equal(workingDaysBetween(at("2026-10-09", "18:00"), due, cal, "work"), 1);
});

test("calendar: outside-window times queue to the next working window; nights and holidays never count", () => {
  const cal = { ...defaultCalendar(IST), holidays: ["2026-10-12"] };
  assert.equal(local(nextWindowStart(at("2026-10-09", "22:10"), cal, "work")), "2026-10-10 09:00");
  assert.equal(local(nextWindowStart(at("2026-10-11", "10:00"), cal, "work")), "2026-10-13 09:00", "Sunday then holiday Monday");
  assert.equal(workingMsBetween(at("2026-10-09", "18:30"), at("2026-10-10", "09:00"), cal, "work"), 0);
  assert.equal(workingMsBetween(at("2026-10-09", "21:00"), at("2026-10-10", "08:00"), cal, "home"), 2 * HOUR, "home counts 21:00–22:00 and 07:00–08:00, never the night");
});

test("calendar: DST transitions in a holder timezone keep wall-clock windows", () => {
  const cal = { ...defaultCalendar("America/New_York"), workDays: [1, 2, 3, 4, 5], workStart: 9 * 60, workEnd: 17 * 60 };
  // US DST ends 1 Nov 2026. Fri 30 Oct 16:00 → Mon 2 Nov 10:00 is 1 h + 1 h working time.
  const from = zonedInstant("2026-10-30", 16 * 60, cal.timezone);
  const to = zonedInstant("2026-11-02", 10 * 60, cal.timezone);
  assert.equal(workingMsBetween(from, to, cal, "work"), 2 * HOUR);
  assert.equal(local(zonedInstant("2026-11-02", 9 * 60, cal.timezone), cal.timezone), "2026-11-02 09:00");
});

test("calendar: month end is the last working day in the holder calendar", () => {
  const cal = defaultCalendar(IST);
  assert.equal(lastWorkingDayOfMonth(2026, 5, cal), "2026-05-30", "31 May 2026 is a Sunday");
});

test("time: kal/tomorrow, next weekday, a passed time rolls forward, EOD is the holder's work end", () => {
  const cal = defaultCalendar(IST);
  const now = at("2026-10-13", "14:30"); // Tuesday
  assert.equal(resolveTimeExpr(expr("kal", "tomorrow"), now, cal, "work").date, "2026-10-14");
  assert.equal(resolveTimeExpr(expr("next Friday", "nextweekday:fri"), now, cal, "work").date, "2026-10-23");
  assert.equal(resolveTimeExpr(expr("Friday", "weekday:fri"), now, cal, "work").date, "2026-10-16");
  const atFive = resolveTimeExpr(expr("at 9", null, "09:00"), now, cal, "work");
  assert.equal(atFive.date, "2026-10-14");
  assert.equal(atFive.rolledToTomorrow, true);
  const eod = resolveTimeExpr(expr("EOD", "today", "eod"), now, cal, "work");
  assert.equal(local(eod.at), "2026-10-13 18:30");
  assert.deepEqual(
    { ok: resolveTimeExpr(expr("end of week", "end_of_week"), now, cal, "work").ok, reason: resolveTimeExpr(expr("end of week", "end_of_week"), now, cal, "work").reason },
    { ok: false, reason: "end_of_week" },
  );
  assert.equal(resolveTimeExpr(expr("31st Feb", "date:2027-02-31"), now, cal, "work").reason, "malformed");
});

// ---- Scenario fixtures (spec §15) at engine level --------------------------------------------

const viewer = { profileId: "me", actorId: "a-me", name: "Deva Rao" };
const RAVI = { profileId: "ravi", actorId: "a-ravi", name: "Ravi Kumar", connected: true };
const RAVI2 = { profileId: "ravi2", actorId: "a-ravi2", name: "Ravi Teja", connected: true };
const PRIYA = { profileId: "priya", actorId: "a-priya", name: "Priya Shah", connected: true };
const thing = (over) => ({
  kind: "task", action: "", participants: [], assign_shape: "none", action_time: null, event_time: null, recurrence: null,
  pace: null, pace_phrase: null, activity_type: null, mode: null, waits_on: null, tone_harsh: false, addresses_group: false,
  question: null, confidence: 0.9, ...over,
});
const plan = (text, things, { now, candidates = [RAVI, PRIYA], selections = {}, cal = defaultCalendar(IST), extra = {} } = {}) =>
  buildDraftPlan({
    text, mode: "work", interpretation: { things, forwarded: false, gibberish: false, ...extra }, selections, candidates, viewer,
    now: now ?? at("2026-10-13", "14:30"), cal,
  });

test("T2 / C1 L8: Call CA about GST → My Court, Next, no time", () => {
  const p = plan("Call CA about GST", [thing({ action: "Call CA about GST", participants: [{ mention: "CA", role: "mentioned" }] })]);
  assert.equal(p.court.kind, "my_court");
  assert.equal(p.things[0].lane.lane, "next");
  assert.equal(p.things[0].lane.rule, "L8");
  assert.equal(p.response.interrupt, null);
});

test("T15 / C5 L3: remind me to follow up with Ravi tomorrow → My Court, Ravi receives nothing", () => {
  const text = "Remind me to follow up with Ravi on dispatch tomorrow";
  const p = plan(text, [thing({ action: "follow up with Ravi on dispatch", participants: [{ mention: "Ravi", role: "mentioned" }], action_time: expr("tomorrow", "tomorrow") })]);
  assert.equal(p.court.kind, "my_court");
  assert.equal(p.court.rule, "C5");
  assert.equal(p.things[0].lane.lane, "next", "the day before: tomorrow's end of day is 1.4 working days away");
  const onTheDay = plan(text, [thing({ action: "follow up with Ravi on dispatch", participants: [{ mention: "Ravi", role: "mentioned" }], action_time: expr("tomorrow", "today") })], { now: at("2026-10-14", "09:00") });
  assert.equal(onTheDay.things[0].lane.lane, "now", "on the day: ≤ 1 working day (L3)");
  assert.equal(onTheDay.things[0].lane.rule, "L3");
});

test("C3 L1: Ravi dispatch 40 bags DAP kal urgent → With Others to Ravi, Now", () => {
  const text = "Ravi dispatch 40 bags DAP to Suryapet dealer kal urgent";
  const p = plan(text, [thing({ action: "dispatch 40 bags DAP to Suryapet dealer", participants: [{ mention: "Ravi", role: "doer" }], assign_shape: "single", action_time: expr("kal", "tomorrow"), pace: "urgent", pace_phrase: "urgent" })]);
  assert.equal(p.court.kind, "with_others");
  assert.equal(p.court.holders[0].profileId, "ravi");
  assert.equal(p.things[0].lane.lane, "now");
  assert.equal(p.things[0].lane.rule, "L1");
});

test("C6: waiting for Ravi's stock numbers → private With Others", () => {
  const text = "Waiting for Ravi's stock numbers";
  const p = plan(text, [thing({ action: "stock numbers", participants: [{ mention: "Ravi", role: "tracked" }] })]);
  assert.equal(p.court.kind, "with_others");
  assert.equal(p.court.privateWait, true);
});

test("T7 / C10 V1.2 L0: two Ravis → Inbox, both faces shown, no lane, no guessing", () => {
  const text = "Send the price list to Ravi";
  const p = plan(text, [thing({ action: "Send the price list", participants: [{ mention: "Ravi", role: "doer" }], assign_shape: "single" })], { candidates: [RAVI, RAVI2, PRIYA] });
  assert.equal(p.court.kind, "inbox");
  assert.equal(p.things[0].lane.lane, "none");
  assert.equal(p.response.interrupt.id, "V1.2:ravi");
  assert.deepEqual(p.response.interrupt.fixes.filter((f) => f.fix.type === "choose_person").map((f) => f.label), ["Ravi Kumar", "Ravi Teja"]);
  const chosen = plan(text, [thing({ action: "Send the price list", participants: [{ mention: "Ravi", role: "doer" }], assign_shape: "single" })], { candidates: [RAVI, RAVI2], selections: { people: { ravi: "ravi2" } } });
  assert.equal(chosen.court.kind, "with_others");
  assert.equal(chosen.court.holders[0].profileId, "ravi2");
});

test("unconnected or unknown names never become recipients", () => {
  const stranger = { profileId: "suresh", actorId: "a-s", name: "Suresh", connected: false };
  assert.equal(resolveMention("Suresh", "doer", [stranger], viewer, {}).status, "not_connected");
  assert.equal(resolveMention("Raavi", "doer", [RAVI], viewer, {}).status, "ambiguous", "near spelling needs confirmation");
  assert.equal(resolveMention("Zed", "doer", [RAVI], viewer, {}).status, "unknown");
  const p = plan("Suresh send invoice", [thing({ action: "send invoice", participants: [{ mention: "Suresh", role: "doer" }], assign_shape: "single" })], { candidates: [stranger] });
  assert.equal(p.court.kind, "inbox");
  assert.match(p.response.interrupt.id, /^CONN:/);
});

test("model names not present in the typed text are discarded (grounding)", () => {
  const p = plan("Send the deck", [thing({ action: "Send the deck", participants: [{ mention: "Priya", role: "doer" }], assign_shape: "single", action_time: expr("tomorrow", "tomorrow") })]);
  assert.equal(p.court.kind, "my_court");
  assert.equal(p.things[0].draft.actionTime, null);
});

test("T6 / C7: Ravi and Priya finish the scheme deck → ask who holds the pen", () => {
  const text = "Ravi and Priya finish the scheme deck";
  const t = thing({ action: "finish the scheme deck", participants: [{ mention: "Ravi", role: "doer" }, { mention: "Priya", role: "doer" }], assign_shape: "shared" });
  const p = plan(text, [t]);
  assert.equal(p.court.kind, "ask_owner");
  assert.equal(p.response.interrupt.id, "C7");
  const owned = plan(text, [t], { selections: { owner: "priya" } });
  assert.equal(owned.court.kind, "with_others");
  assert.equal(owned.court.holders[0].profileId, "priya");
});

test("T5 / C8: one Thing per person for independent work", () => {
  const text = "Ravi and Priya submit expense claims by Friday";
  const p = plan(text, [thing({ action: "submit expense claims", participants: [{ mention: "Ravi", role: "doer" }, { mention: "Priya", role: "doer" }], assign_shape: "each", action_time: expr("by Friday", "weekday:fri", null, { boundary: "by" }) })]);
  assert.equal(p.court.kind, "group");
  assert.equal(p.court.holders.length, 2);
  assert.equal(p.things[0].lane.lane, "next", "Tuesday 14:30 → Friday 18:30 is > 1 and ≤ 5 working days");
});

test("T8 / L10 V2.2: urgent but 3 weeks out → asks, shown as Next", () => {
  const text = "Urgent, Kharif scheme deck by the 30th";
  const t = thing({ action: "Kharif scheme deck", pace: "urgent", pace_phrase: "Urgent", action_time: expr("by the 30th", "date:2026-11-30", null, { boundary: "by" }) });
  const p = plan(text, [t]);
  assert.equal(p.things[0].lane.lane, "next");
  assert.equal(p.things[0].lane.rule, "L10");
  assert.equal(p.response.interrupt.id, "V2.2");
  const answered = plan(text, [t], { selections: { paceConflict: "pace" } });
  assert.equal(answered.things[0].lane.lane, "now");
  assert.equal(answered.response.interrupt, null);
});

test("T4 / L6 F3: breakfast with Ravi at 20:00 → ghost 09:00 tomorrow, stays in the mode it was tossed from, Next until accepted, then Now", () => {
  const text = "Breakfast with Ravi";
  const t = thing({ action: "Breakfast with Ravi", participants: [{ mention: "Ravi", role: "mentioned" }], activity_type: "meal.breakfast" });
  const now = at("2026-10-13", "20:00");
  const p = plan(text, [t], { now });
  assert.equal(p.things[0].draft.mode, "work", "production bug: Things tossed in Work vanished into Home");
  assert.equal(local(p.things[0].draft.inferredTime.at), "2026-10-14 09:00");
  assert.equal(p.things[0].lane.lane, "next");
  assert.equal(p.things[0].lane.rule, "L6");
  const accepted = plan(text, [t], { now, selections: { acceptInferred: true } });
  assert.equal(accepted.things[0].lane.lane, "now");
});

test("T3 / V2.1: action after event → R2 for self, R4 when shared, with fixes and Keep it", () => {
  const text = "Book movie ticket day after tomorrow for today";
  const base = { action: "Book movie ticket", action_time: expr("day after tomorrow", "day_after_tomorrow"), event_time: expr("today", "today"), activity_type: "entertainment.movie" };
  const self = plan(text, [thing(base)]);
  assert.equal(self.response.interrupt.id, "V2.1");
  assert.equal(self.response.interrupt.level, 2);
  assert.ok(self.response.interrupt.fixes.some((f) => f.fix.type === "keep"));
  const shared = plan(`Ravi ${text}`, [thing({ ...base, participants: [{ mention: "Ravi", role: "doer" }], assign_shape: "single" })]);
  assert.equal(shared.response.interrupt.level, 4);
});

test("V0.1 / C0c: two actions → split offer; choosing split makes two Things", () => {
  const text = "Call Ravi and send invoice to Priya";
  const things = [
    thing({ action: "Call Ravi", participants: [{ mention: "Ravi", role: "mentioned" }] }),
    thing({ action: "send invoice", participants: [{ mention: "Priya", role: "doer" }], assign_shape: "single" }),
  ];
  const p = plan(text, things);
  assert.equal(p.court.kind, "split");
  assert.equal(p.response.interrupt.id, "V0.1");
  const split = plan(text, things, { selections: { split: "split" } });
  assert.equal(split.things.length, 2);
  assert.equal(split.things[0].court.kind, "my_court");
  assert.equal(split.things[1].court.kind, "with_others");
});

test("C0a: a question creates nothing; C2: a thought goes to Inbox/Later", () => {
  const q = plan("Whos on stale other than me", [thing({ kind: "question", question: { about_person: null, exclude_self: true, state: "stale", window: "any" } })]);
  assert.equal(q.court.kind, "answer");
  assert.equal(q.things.length, 1);
  const thought = plan("Maybe a new scheme for Kharif dealers?", [thing({ kind: "thought", action: "new scheme for Kharif dealers" })]);
  assert.equal(thought.court.kind, "inbox");
  assert.equal(thought.things[0].lane.lane, "later");
  assert.equal(thought.things[0].lane.rule, "L9");
});

test("end of week asks which day (decision D8)", () => {
  const text = "Send the report by end of week";
  const t = thing({ action: "Send the report", action_time: expr("end of week", "end_of_week", null, { boundary: "by" }) });
  const p = plan(text, [t]);
  assert.match(p.response.interrupt.id, /^END_OF_WEEK/);
  const chosen = plan(text, [t], { selections: { dayChoices: { "0:action": "2026-10-16" } } });
  assert.equal(chosen.things[0].draft.actionTime.date, "2026-10-16");
  assert.equal(chosen.response.interrupt, null);
});

// ---- Runtime projections (§16.3, §16.4) ----------------------------------------------------

const schedule = (over) => ({
  thingId: "t1", textRaw: "x", mode: "work", kind: "task", senderProfileId: "me", holderProfileId: "ravi", state: "open",
  inboxReason: null, privateWait: false, groupId: null, chain: [], pace: "normal", paceResolution: null, actionTime: null,
  eventTime: null, activityType: null, recurrence: null, promiseAt: null, snoozeUntil: null, blockedOn: null,
  lastActivityAt: at("2026-10-13", "10:00"), lastNudgeAt: null, nudgeCountCycle: 0, breakthroughUsed: false,
  createdAt: at("2026-10-13", "10:00"), ...over,
});

test("T12 / M8 F1=false: a Normal Thing with no response for 2 working days stays Next; sender sees STALE", () => {
  const cal = defaultCalendar(IST);
  const s = schedule({});
  const now = at("2026-10-15", "11:00");
  assert.equal(computeHolderLane(s, cal, now).lane, "next");
  assert.equal(isStale(s, cal, now), true);
  assert.equal(computeSenderConcern(s, cal, now), "stale");
});

test("T11 / M5: promise missed → holder Now, sender PROMISE_MISSED", () => {
  const cal = defaultCalendar(IST);
  const s = schedule({ state: "promised", promiseAt: at("2026-10-15", "18:00") });
  const now = at("2026-10-15", "18:30");
  assert.equal(computeHolderLane(s, cal, now).lane, "now");
  assert.equal(computeSenderConcern(s, cal, now), "promise_missed");
  assert.equal(computeSenderConcern(s, cal, at("2026-10-14", "10:00")), "on_track");
});

test("T13 / M10 C15: third-party blocker leaves lanes, sender calm 'blocked'", () => {
  const cal = defaultCalendar(IST);
  const s = schedule({ state: "blocked", blockedOn: { kind: "third_party", note: "waiting on transporter" } });
  assert.equal(computeHolderLane(s, cal, at("2026-10-20", "10:00")).lane, "none");
  assert.equal(computeSenderConcern(s, cal, at("2026-10-20", "10:00")), "blocked");
});

test("M1 / L5: a far anchor sits in Later then rises with time; snooze hides until wake", () => {
  const cal = defaultCalendar(IST);
  const anchor = { at: at("2026-10-30", "18:30"), date: "2026-10-30", precision: "date", source: "typed", accepted: true, phrase: "30th" };
  const s = schedule({ actionTime: anchor });
  assert.equal(computeHolderLane(s, cal, at("2026-10-13", "10:00")).lane, "later");
  assert.equal(computeHolderLane(s, cal, at("2026-10-26", "10:00")).lane, "next");
  assert.equal(computeHolderLane(s, cal, at("2026-10-30", "10:00")).lane, "now");
  assert.equal(computeHolderLane({ ...s, snoozeUntil: at("2026-10-14", "09:00") }, cal, at("2026-10-13", "12:00")).lane, "hidden");
});

test("a first name shared by me and a connection is ambiguous, never silently 'me'", () => {
  const me = { profileId: "me", actorId: "a-me", name: "Ravi Rao" };
  const other = { profileId: "ravi", actorId: "a-ravi", name: "Ravi Kumar", connected: true };
  assert.equal(resolveMention("Ravi", "doer", [other], me, {}).status, "ambiguous");
  assert.equal(resolveMention("Ravi", "doer", [], me, {}).status, "self");
  assert.equal(resolveMention("Ravi Rao", "doer", [other], me, {}).status, "self");
});
