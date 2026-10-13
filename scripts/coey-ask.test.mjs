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
  assert.deepEqual(ids(priya), ["from-priya-to-me", "sent-to-priya-fresh"], "in Priya's court, plus what Priya sent me");
  assert.deepEqual(priya.groups.map((g) => g.title), ["In Priya Shah’s court", "From Priya Shah, in your court"]);
  assert.match(priya.answer_markdown, /1 open Thing with Priya Shah\. 1 Thing from Priya Shah is in your court\./);
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
  assert.deepEqual(parseStructuredQuery({ about_person: " Ravi ", exclude_self: true, state: "stale", window: "any" }), { topic: "things", about_person: "Ravi", exclude_self: true, state: "stale", window: "any" });
});

test("production regressions: an ungrounded time window is dropped; asking about yourself means your own court", async () => {
  const { groundWindow } = await import("../server/lib/coey/ask.ts");
  const pending = { about_person: "Bharat", exclude_self: false, state: "pending", window: "today" };
  assert.equal(groundWindow("what's pending with Bharat?", pending).window, "any");
  assert.equal(groundWindow("what's due today with Bharat", pending).window, "today");
  assert.equal(groundWindow("show Bharat's overdue Things", { ...pending, window: "overdue" }).window, "overdue");
  const self = structuredAnswer(facts, q({ about_person: "Deva" }), schedules, undefined, now);
  assert.equal(self.intent, "person_items");
  assert.deepEqual(ids(self), ["from-priya-to-me", "mine"]);
  assert.match(self.answer_markdown, /in your court/);
});

test("production regression: someone known only as a sender (they sent me Things) is found, not 'can't find'", () => {
  const only = { ...facts, people: [], things: [{ ...thing("from-sudheer", "a-sud", ME), owner_name: "Sudheer" }, { ...thing("from-sudheer-2", "a-sud", ME), owner_name: "Sudheer" }] };
  const a = structuredAnswer(only, q({ about_person: "sudheer" }), schedules, undefined, now);
  assert.equal(a.intent, "person_items");
  assert.equal(a.answer_markdown, "No open Things with Sudheer. 2 Things from Sudheer are in your court.");
  assert.deepEqual(ids(a), ["from-sudheer", "from-sudheer-2"]);
});

test("production regression: “what things are pending from my side waiting to catch” lists only my uncaught Things", () => {
  const f = { ...facts, things: [...facts.things, thing("caught-mine", PRIYA, ME, { acknowledgement: "caught" })] };
  const a = structuredAnswer(f, q({ state: "waiting_for_catch" }), schedules, undefined, now);
  assert.deepEqual(ids(a), ["from-priya-to-me", "mine"]);
  assert.equal(a.answer_markdown, "2 Things in your court are waiting for you to catch.");
  const sent = structuredAnswer(f, q({ state: "waiting_for_catch", exclude_self: true }), schedules, undefined, now);
  assert.ok(!ids(sent).includes("mine") && ids(sent).includes("sent-to-ravi"), "other than me: what others have not caught");
});

test("production regression: “whats this weeks progress” reports sorted, new and open work — not a Thing count", async () => {
  const { progressAnswer, groundWindow } = await import("../server/lib/coey/ask.ts");
  const monday = new Date(zonedInstant("2026-10-12", 12 * 60, IST)).toISOString();
  const lastWeek = new Date(zonedInstant("2026-10-08", 12 * 60, IST)).toISOString();
  const f = { ...facts, things: [
    thing("sorted-this-week", ME, RAVI, { status: "sorted", updated_at: monday, created_at: lastWeek }),
    thing("sorted-last-week", ME, RAVI, { status: "sorted", updated_at: lastWeek, created_at: lastWeek }),
    thing("new-moving", PRIYA, ME, { acknowledgement: "caught", created_at: monday }),
    thing("to-catch", PRIYA, ME, { created_at: lastWeek }),
    thing("late", ME, ME, { acknowledgement: "caught", due_at: lastWeek, created_at: lastWeek }),
    thing("not-mine", PRIYA, RAVI, { status: "sorted", updated_at: monday, created_at: monday }),
  ] };
  const a = progressAnswer(f, q({ topic: "progress", window: "this_week" }), now);
  assert.equal(a.answer_markdown, "This week: 1 Thing sorted, 1 new Thing. Open now: 2 Things in progress, 1 Thing waiting for your catch, 1 Thing past its date.");
  assert.deepEqual(a.groups.map((g) => [g.title, g.thing_ids]), [["Sorted this week", ["sorted-this-week"]], ["Waiting for your catch", ["to-catch"]], ["Past their date", ["late"]]]);
  assert.equal(groundWindow("whats this weeks progress", q({ window: "this_week" })).window, "this_week", "“weeks” keeps the week window");
});

test("topics parse strictly; old clients without a topic mean Things; follow-ups keep the topic", async () => {
  const { mergeFollowUp } = await import("../server/lib/coey/ask.ts");
  assert.equal(parseStructuredQuery({ state: "any", window: "any" }).topic, "things");
  assert.equal(parseStructuredQuery({ topic: "nudge", state: "any", window: "any" }).topic, "nudge");
  assert.equal(parseStructuredQuery({ topic: "weather", state: "any", window: "any" }), null);
  assert.equal(mergeFollowUp(q({ topic: "nudge" }), q({ topic: "things", about_person: "Priya" }), true).topic, "nudge");
});
