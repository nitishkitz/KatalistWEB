import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeQuestion, routeCoeyQuestion } from "../server/lib/assistant-routing.ts";
import {
  buildFastAnswer,
  buildGreetingAnswer,
  buildOutOfScopeAnswer,
  rankAttention,
} from "../server/lib/assistant-fast-answer.ts";

const NOW = Date.parse("2026-10-12T06:00:00Z"); // 11:30 in Asia/Kolkata
const thing = (id, over = {}) => ({
  id,
  title: `Thing ${id}`,
  list_id: null,
  status: "not_started",
  acknowledgement: "none",
  due_at: null,
  is_overdue: false,
  assignee_actor_id: null,
  assignee_name: null,
  owner_actor_id: null,
  updated_at: "2026-10-10T00:00:00Z",
  citation_label: `Thing ${id}`,
  ...over,
});
const summary = (o = {}) => ({
  active_count: 0, completed_count: 0, cancelled_count: 0, not_started_count: 0, in_progress_count: 0,
  overdue_count: 0, due_today_count: 0, waiting_for_catch_count: 0, unassigned_count: 0, ...o,
});
const facts = (things, extra = {}) => ({
  schema_version: "katalist.assistant.facts.v1",
  generated_at: "x",
  freshness: { source_max_updated_at: null, timezone: "Asia/Kolkata", is_partial: false },
  viewer: { profile_id: "p", actor_id: "me", display_name: "Nithesh Kumar", context: "work" },
  scope: { type: "work", id: null, label: "Work", context: "work" },
  summary: summary({ active_count: things.length }),
  people: [], workload: [], lists: [], nudge_recommendations: [],
  things,
  ...extra,
});

const busy = facts([
  thing("late1", { is_overdue: true, due_at: "2026-10-09T05:00:00Z" }),
  thing("late2", { is_overdue: true, due_at: "2026-10-11T05:00:00Z", assignee_actor_id: "me" }),
  // 23:00 IST today = 17:30Z today, inside the viewer's day but after "now"
  thing("today1", { due_at: "2026-10-12T17:30:00Z" }),
  // 00:30 IST on 13 Oct = 19:00Z on 12 Oct: tomorrow in Kolkata, still "today" in UTC
  thing("tomorrow1", { due_at: "2026-10-12T19:00:00Z" }),
  thing("wait1", { acknowledgement: "waiting_for_catch" }),
  thing("done1", { status: "sorted", is_overdue: false }),
  thing("quiet1"),
]);

test("screenshot prompts route without the capability sentence path", () => {
  assert.deepEqual(routeCoeyQuestion("whats up today", []), { kind: "fast", intent: "attention_items", today: true });
  assert.deepEqual(routeCoeyQuestion("What's up today?", []), { kind: "fast", intent: "attention_items", today: true });
  assert.equal(routeCoeyQuestion("hi", []).kind, "greeting");
  assert.equal(routeCoeyQuestion("Hi!", []).kind, "greeting");
  assert.deepEqual(routeCoeyQuestion("What needs my attention?", []), { kind: "fast", intent: "attention_items" });
  assert.deepEqual(routeCoeyQuestion("Who needs a nudge?", []), { kind: "fast", intent: "nudge_recommendation" });
  assert.deepEqual(routeCoeyQuestion("What is overdue?", []), { kind: "fast", intent: "overdue_items" });
  assert.deepEqual(routeCoeyQuestion("What changed this week?", []), { kind: "fast", intent: "recent_activity" });
});

test("spelling and apostrophe variants normalize", () => {
  assert.equal(normalizeQuestion("Wats up TODYA?"), "whats up today".replace("today", "today"));
  for (const q of ["whats up today", "wat's up today", "What’s up today", "WHATS UP"])
    assert.equal(routeCoeyQuestion(q, []).kind, "fast", q);
  assert.equal(routeCoeyQuestion("what is overdu", []).intent, "overdue_items");
  assert.equal(routeCoeyQuestion("whats needs my atention", []).intent, "attention_items");
  assert.equal(routeCoeyQuestion("hii", []).kind, "greeting");
  assert.equal(routeCoeyQuestion("good morning", []).kind, "greeting");
});

test("not every what-question is a summary", () => {
  const route = routeCoeyQuestion("what is the riskiest thing on my plate for the launch", []);
  assert.equal(route.kind, "model");
  assert.equal(routeCoeyQuestion("give me a summary", []).kind, "fast");
  assert.equal(routeCoeyQuestion("which of these is blocked and why", []).kind, "model");
});

test("follow-ups go to the model; out-of-scope and empty are clarified", () => {
  const history = [{ role: "user", content: "what is overdue" }, { role: "assistant", content: "2 overdue" }];
  assert.equal(routeCoeyQuestion("why is that one late", history).kind, "model");
  assert.deepEqual(routeCoeyQuestion("what is the weather in Pune", []), { kind: "clarify", intent: "unsupported" });
  assert.equal(routeCoeyQuestion("   ", []).kind, "clarify");
  assert.equal(routeCoeyQuestion("???", []).kind, "clarify");
  // Katalist vocabulary wins over an out-of-scope word.
  assert.notEqual(routeCoeyQuestion("which task has a news deadline", []).kind, "clarify");
});

test("greeting is conversational, uses no facts and never lists counts or capabilities", () => {
  for (const q of ["hi", "hello", "good morning", "thanks", "how are you"]) {
    const a = buildGreetingAnswer(q, "Nithesh Kumar");
    assert.ok(a.answer_markdown.length > 5);
    assert.doesNotMatch(a.answer_markdown, /\d/);
    assert.doesNotMatch(a.answer_markdown, /I can summarize/i);
    assert.deepEqual(a.groups, undefined);
    assert.deepEqual(a.actions, []);
  }
  assert.match(buildGreetingAnswer("hi", "Nithesh Kumar").answer_markdown, /^Hi, Nithesh\./);
  assert.match(buildGreetingAnswer("hi", "You").answer_markdown, /^Hi\./);
});

test("whats up today ranks overdue, due-today and waiting from real facts in the viewer timezone", () => {
  const rows = rankAttention(busy, NOW);
  assert.deepEqual(rows.map((r) => r.thing.id), ["late2", "late1", "today1", "wait1"]);
  assert.ok(!rows.some((r) => r.thing.id === "tomorrow1"), "00:30 IST tomorrow is not due today");
  const a = buildFastAnswer("attention_items", busy, "whats up today", { today: true, now: NOW });
  assert.match(a.answer_markdown, /^Today: 2 overdue, 1 due today, 1 waiting for a response\./);
  assert.deepEqual(a.groups.map((g) => g.key), ["overdue", "due_today", "waiting"]);
  const known = new Set(busy.things.map((t) => t.id));
  for (const c of a.citations) assert.ok(known.has(c.id));
  assert.ok(a.citations.length <= 3);
  assert.equal(a.citations[0].id, "late2", "the viewer's own overdue Thing ranks first");
  for (const act of a.actions) assert.ok(act.target_ids.every((id) => known.has(id)));
});

test("attention, overdue and nudge answers", () => {
  const att = buildFastAnswer("attention_items", busy, "What needs my attention?", { now: NOW });
  assert.match(att.answer_markdown, /2 overdue, 1 due today, 1 waiting/);
  assert.ok(att.groups.length > 0);
  const od = buildFastAnswer("overdue_items", busy, "What is overdue?", { now: NOW });
  assert.match(od.answer_markdown, /^2 Things overdue\./);
  assert.deepEqual(od.groups[0].thing_ids.sort(), ["late1", "late2"]);
  const nudge = buildFastAnswer(
    "nudge_recommendation",
    facts(busy.things, {
      nudge_recommendations: [
        { actor_id: "a1", display_name: "Ajju", score: 9, reason_codes: [], eligible_thing_ids: ["late1"], eligible_thing_count: 1, overdue_thing_count: 1, last_nudged_at: null, can_nudge: true },
        { actor_id: "a2", display_name: "Blocked", score: 99, reason_codes: [], eligible_thing_ids: [], eligible_thing_count: 0, overdue_thing_count: 0, last_nudged_at: null, can_nudge: false },
      ],
    }),
    "Who needs a nudge?",
  );
  assert.deepEqual(nudge.actions.map((a) => a.id), ["nudge-a1"]);
  assert.match(nudge.answer_markdown, /Ajju/);
  assert.doesNotMatch(nudge.answer_markdown, /Blocked/);
});

test("empty scope and quiet scope answer honestly without invented counts", () => {
  const empty = facts([], { scope: { type: "list", id: "L", label: "Payments", context: "work" } });
  assert.match(buildFastAnswer("attention_items", empty, "whats up today", { today: true, now: NOW }).answer_markdown, /Nothing is active in Payments/);
  const quiet = facts([thing("q1"), thing("q2")]);
  const a = buildFastAnswer("attention_items", quiet, "What needs my attention?", { now: NOW });
  assert.match(a.answer_markdown, /^Nothing needs attention right now\. 2 Things active, none overdue or due today\./);
  assert.deepEqual(a.citations, []);
  assert.equal(buildFastAnswer("overdue_items", quiet, "What is overdue?", { now: NOW }).answer_markdown, "Nothing is overdue.");
});

test("recent activity answer cites only known Things", () => {
  const withActivity = facts(busy.things, {
    activity: {
      window: { from: "2026-10-05T00:00:00Z", to: "2026-10-12T00:00:00Z", label: "the last 7 days", timezone: "Asia/Kolkata" },
      events: [
        { thing_id: "late1", summary: "Status changed", actor: "Ajju" },
        { thing_id: "ghost", summary: "Removed Thing", actor: "X" },
      ],
      comments: [], nudges: [], truncated: false, event_limit: 50,
    },
  });
  const a = buildFastAnswer("recent_activity", withActivity, "What changed this week?", { now: NOW });
  assert.deepEqual(a.citations.map((c) => c.id), ["late1"]);
  assert.match(a.answer_markdown, /during the last 7 days/);
});

test("out-of-scope answer is honest and distinct from a greeting", () => {
  const a = buildOutOfScopeAnswer("what is the weather");
  assert.equal(a.intent, "unsupported");
  assert.match(a.answer_markdown, /outside what I can see in Katalist/);
  assert.equal(buildOutOfScopeAnswer("???").intent, "clarification");
});

test("the stale-person request is fast and returns open assigned Things grouped by actual actor", async () => {
  const { answerAssistantQuestion } = await import('../server/lib/assistant.ts');
  const { wantsActivity } = await import('../server/lib/assistant-activity.ts');
  const question = 'who is in stale, and i need to see the thing assigned to them';
  assert.deepEqual(routeCoeyQuestion(question, [{ role: 'assistant', content: 'Earlier answer' }]), { kind: 'fast', intent: 'stale_items' });
  assert.equal(wantsActivity(question, 'stale_items'), false);
  assert.equal(wantsActivity('Show Things assigned to Rahul', 'scope_summary'), false);
  assert.equal(wantsActivity('Who assigned this yesterday?', 'recent_activity'), true);
  const data = facts([
    thing('stale-a', { assignee_actor_id: 'a', assignee_name: 'Ajjju', updated_at: '2026-10-08T11:00:00Z' }),
    thing('fresh-a', { assignee_actor_id: 'a', assignee_name: 'Ajjju', updated_at: '2026-10-12T09:00:00Z' }),
    thing('done-a', { assignee_actor_id: 'a', status: 'sorted', updated_at: '2026-10-01T00:00:00Z' }),
    thing('stale-b', { assignee_actor_id: 'b', assignee_name: 'Narayana', updated_at: '2026-10-08T00:00:00Z' }),
    thing('fresh-c', { assignee_actor_id: 'c', assignee_name: 'Rahul', updated_at: '2026-10-12T00:00:00Z' }),
    thing('invalid-date', { assignee_actor_id: 'd', updated_at: 'not-a-date' }),
    thing('unassigned', { updated_at: '2026-10-01T00:00:00Z' }),
  ], { generated_at: '2026-10-12T12:00:00Z' });
  const answer = await answerAssistantQuestion(data, question);
  assert.equal(answer.intent, 'stale_items');
  assert.match(answer.answer_markdown, /2 people.*3\+ days/);
  assert.equal(answer.notice, undefined, 'the result requires no model or activity history');
  assert.deepEqual(answer.groups.map((g) => [g.key, g.title, g.thing_ids, g.total]), [
    ['person:a', 'Ajjju', ['stale-a', 'fresh-a'], 2], ['person:b', 'Narayana', ['stale-b'], 1],
  ]);
  assert.deepEqual(answer.groups[0].notes, { 'stale-a': 'No update for 3+ days' });
  assert.deepEqual(answer.actions, [], 'showing results creates no writes');
  assert.ok(answer.citations.every((c) => ['stale-a', 'fresh-a', 'stale-b'].includes(c.id)));
});

test("no stale assignee returns an honest empty result with no unrelated rows", () => {
  const data = facts([thing('fresh', { assignee_actor_id: 'a', updated_at: '2026-10-12T11:00:00Z' })], { generated_at: '2026-10-12T12:00:00Z' });
  const answer = buildFastAnswer('stale_items', data, 'who is stale');
  assert.deepEqual(answer.groups, []);
  assert.match(answer.answer_markdown, /No assigned active Things/);
});

test('stale queries excluding me remove my rows, citations and count throughout the answer path', async () => {
  const { answerAssistantQuestion } = await import('../server/lib/assistant.ts');
  const data = facts([
    thing('mine', { assignee_actor_id: 'me', assignee_name: 'Nithesh', updated_at: '2026-10-01T00:00:00Z' }),
    thing('ajju', { assignee_actor_id: 'a', assignee_name: 'Ajjju', updated_at: '2026-10-01T00:00:00Z' }),
    thing('narayana', { assignee_actor_id: 'b', assignee_name: 'Narayana', updated_at: '2026-10-01T00:00:00Z' }),
  ], { generated_at: '2026-10-12T12:00:00Z' });
  for (const suffix of ['other than me', 'except me', 'excluding myself', 'not me']) {
    const answer = await answerAssistantQuestion(data, `who is on stale ${suffix}`);
    assert.match(answer.answer_markdown, /2 people/);
    assert.deepEqual(answer.groups.map(g => g.title), ['Ajjju', 'Narayana']);
    assert.ok(answer.groups.every(g => !g.thing_ids.includes('mine')));
    assert.ok(answer.citations.every(c => c.id !== 'mine'));
  }
  const all = await answerAssistantQuestion(data, 'who is stale');
  assert.equal(all.groups.length, 3, 'unqualified queries still include the viewer');
});

test('named stale requests select that assignee, accept possessives, and exclude fresh Things', async () => {
  const { answerAssistantQuestion } = await import('../server/lib/assistant.ts');
  const data = facts([
    thing('mine', { assignee_actor_id: 'me', assignee_name: 'Nithesh', updated_at: '2026-10-01T00:00:00Z' }),
    thing('ajju', { assignee_actor_id: 'a', assignee_name: 'Ajjju', updated_at: '2026-10-01T00:00:00Z' }),
    thing('narayana-stale', { assignee_actor_id: 'b', assignee_name: 'Narayana Kammari', updated_at: '2026-10-01T00:00:00Z' }),
    thing('narayana-fresh', { assignee_actor_id: 'b', assignee_name: 'Narayana Kammari', updated_at: '2026-10-12T11:00:00Z' }),
  ], { generated_at: '2026-10-12T12:00:00Z' });
  for (const name of ['narayanas', "Narayana's", 'Narayana’s', 'Narayana Kammari']) {
    const answer = await answerAssistantQuestion(data, `show me ${name} stale`, [], undefined, 'b');
    assert.match(answer.answer_markdown, /Narayana Kammari.*1 stale Thing/);
    assert.deepEqual(answer.groups.map(g => [g.title, g.thing_ids]), [['Narayana Kammari', ['narayana-stale']]]);
    assert.deepEqual(answer.citations.map(c => c.id), ['narayana-stale']);
  }
  const assigned = await answerAssistantQuestion(data, 'show me Narayanas stale and all assigned Things', [], undefined, 'b');
  assert.deepEqual(assigned.groups[0].thing_ids, ['narayana-stale', 'narayana-fresh']);
});
