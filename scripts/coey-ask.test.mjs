import assert from "node:assert/strict";
import { test } from "node:test";
import { parseStructuredQuery, structuredAnswer } from "../server/lib/coey/ask.ts";
import { defaultCalendar, zonedInstant } from "../src/domain/coey/calendar.ts";

const IST = "Asia/Kolkata";
const now = zonedInstant("2026-10-15", 11 * 60, IST);
const old = new Date(zonedInstant("2026-10-12", 10 * 60, IST)).toISOString();
const ME = "a-me", RAVI = "a-ravi", RAVI2 = "a-ravi2", PRIYA = "a-priya";
const thing = (id, owner, assignee, over = {}) => ({
  id, title: id, list_id: null, status: "not_started", acknowledgement: "waiting_for_catch", due_at: null, is_overdue: false,
  assignee_actor_id: assignee, assignee_name: { [ME]: "Deva Rao", [RAVI]: "Ravi Kumar", [RAVI2]: "Ravi Teja", [PRIYA]: "Priya Shah" }[assignee],
  owner_actor_id: owner, updated_at: old, citation_label: id, ...over,
});
const facts = {
  schema_version: "katalist.assistant.facts.v1", generated_at: new Date(now).toISOString(),
  freshness: { source_max_updated_at: null, timezone: IST, is_partial: false },
  viewer: { profile_id: "me", actor_id: ME, display_name: "Deva Rao", context: "work" },
  scope: { type: "work", id: null, label: "Work", context: "work" },
  summary: {}, workload: [], lists: [], nudge_recommendations: [],
  people: [{ actor_id: RAVI, display_name: "Ravi Kumar" }, { actor_id: RAVI2, display_name: "Ravi Teja" }, { actor_id: PRIYA, display_name: "Priya Shah" }],
  things: [
    thing("sent-to-ravi", ME, RAVI),
    thing("sent-to-priya-fresh", ME, PRIYA),
    thing("mine", ME, ME),
    thing("from-priya-to-me", PRIYA, ME),
    thing("priya-to-ravi", PRIYA, RAVI),
    thing("sorted", ME, RAVI, { status: "sorted" }),
  ],
};
const cal = defaultCalendar(IST);
const sched = (thingId, lastActivityAt) => ({
  schedule: { thingId, textRaw: thingId, mode: "work", kind: "task", senderProfileId: "me", holderProfileId: "x", state: "open", inboxReason: null,
    privateWait: false, groupId: null, chain: [], pace: "normal", paceResolution: null, actionTime: null, eventTime: null, activityType: null,
    recurrence: null, promiseAt: null, snoozeUntil: null, blockedOn: null, lastActivityAt, lastNudgeAt: null, nudgeCountCycle: 0,
    breakthroughUsed: false, createdAt: lastActivityAt },
  cal,
});
const schedules = new Map([
  ["sent-to-ravi", sched("sent-to-ravi", zonedInstant("2026-10-12", 10 * 60, IST))],
  ["sent-to-priya-fresh", sched("sent-to-priya-fresh", zonedInstant("2026-10-15", 10 * 60, IST))],
]);
const q = (over) => ({ about_person: null, exclude_self: false, state: "any", window: "any", ...over });
const ids = (answer) => answer.groups.flatMap((g) => g.thing_ids).sort();

test("“whos on stale other than me”: only Things I sent that are past cadence, never my own, never others' pairs", () => {
  const answer = structuredAnswer(facts, q({ state: "stale", exclude_self: true }), schedules, undefined, now);
  assert.deepEqual(ids(answer), ["sent-to-ravi"]);
  assert.equal(answer.answer_markdown, "1 Thing you sent is past its usual follow-up time with others.");
  assert.doesNotMatch(answer.answer_markdown, /stale|overdue|behind|hasn't|inactive/i, "speaks about Things, not people");
  assert.ok(!ids(answer).includes("priya-to-ravi"), "someone else's delegation is never characterised");
});

test("self exclusion and waiting-on-me are fields, not phrase matches", () => {
  assert.deepEqual(ids(structuredAnswer(facts, q({ exclude_self: true }), schedules, undefined, now)), ["priya-to-ravi", "sent-to-priya-fresh", "sent-to-ravi"]);
  assert.deepEqual(ids(structuredAnswer(facts, q({ state: "waiting_on_me" }), schedules, undefined, now)), ["from-priya-to-me", "mine"]);
  assert.deepEqual(ids(structuredAnswer(facts, q({ state: "waiting_on_others" }), schedules, undefined, now)), ["sent-to-priya-fresh", "sent-to-ravi"]);
});

test("a named person resolves exactly; a shared first name asks which; an unknown name says so", () => {
  const priya = structuredAnswer(facts, q({ about_person: "Priya" }), schedules, undefined, now);
  assert.equal(priya.intent, "person_items");
  assert.deepEqual(ids(priya), ["sent-to-priya-fresh"]);
  const ravi = structuredAnswer(facts, q({ about_person: "Ravi" }), schedules, undefined, now);
  assert.equal(ravi.intent, "person_selection_required");
  assert.deepEqual(ravi.person_candidates.map((c) => c.display_name), ["Ravi Kumar", "Ravi Teja"]);
  const chosen = structuredAnswer(facts, q({ about_person: "Ravi" }), schedules, RAVI, now);
  assert.deepEqual(ids(chosen), ["priya-to-ravi", "sent-to-ravi"]);
  assert.equal(structuredAnswer(facts, q({ about_person: "Zubin" }), schedules, undefined, now).intent, "person_not_found");
});

test("results only reference Things in the authorized facts; malformed queries are rejected", () => {
  const all = structuredAnswer(facts, q({}), schedules, undefined, now);
  for (const id of ids(all)) assert.ok(facts.things.some((t) => t.id === id));
  assert.equal(parseStructuredQuery({ state: "drop table", window: "any" }), null);
  assert.deepEqual(parseStructuredQuery({ about_person: " Ravi ", exclude_self: true, state: "stale", window: "any" }), { about_person: "Ravi", exclude_self: true, state: "stale", window: "any" });
});
