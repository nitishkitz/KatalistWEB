// Regressions for review findings 6 (one structured Ask path) and 7 (viewer-local date windows).
import assert from "node:assert/strict";
import { test } from "node:test";
import { runCoeyTurn } from "../server/lib/assistant-stream.ts";
import { localWindows, structuredAnswer } from "../server/lib/coey/ask.ts";
import { zonedInstant } from "../src/domain/coey/calendar.ts";

const IST = "Asia/Kolkata";
const iso = (date, minutes) => new Date(zonedInstant(date, minutes, IST)).toISOString();
const thing = (id, due) => ({ id, title: id, list_id: null, status: "not_started", acknowledgement: "none", due_at: due, is_overdue: false,
  assignee_actor_id: "me", assignee_name: "Me", owner_actor_id: "me", updated_at: due ?? "2026-10-01T00:00:00Z", citation_label: id });

test("7: 'today' and 'this week' are the viewer's local day and Monday–Sunday week, independent of the server timezone", () => {
  // Wednesday 14 Oct 2026, 00:30 IST — still Tuesday 19:00 in UTC.
  const now = zonedInstant("2026-10-14", 30, IST);
  const w = localWindows(now, IST);
  assert.equal(new Date(w.today[0]).toISOString(), iso("2026-10-14", 0));
  assert.equal(new Date(w.week[0]).toISOString(), iso("2026-10-12", 0), "week starts Monday");
  assert.equal(new Date(w.week[1]).toISOString(), iso("2026-10-19", 0), "and ends before next Monday");
  const facts = {
    generated_at: new Date(now).toISOString(), freshness: { source_max_updated_at: null, timezone: IST, is_partial: false },
    viewer: { profile_id: "p", actor_id: "me", display_name: "Me", context: "work" }, people: [],
    things: [
      thing("tue-evening-ist", iso("2026-10-13", 21 * 60)),
      thing("wed-morning-ist", iso("2026-10-14", 9 * 60)),
      thing("monday-this-week", iso("2026-10-12", 10 * 60)),
      thing("next-monday", iso("2026-10-19", 10 * 60)),
      thing("sunday-this-week", iso("2026-10-18", 20 * 60)),
    ],
  };
  const ids = (window) => structuredAnswer(facts, { about_person: null, exclude_self: false, state: "any", window }, new Map(), undefined, now).groups.flatMap((g) => g.thing_ids).sort();
  assert.deepEqual(ids("today"), ["wed-morning-ist"]);
  assert.deepEqual(ids("this_week"), ["monday-this-week", "sunday-this-week", "tue-evening-ist", "wed-morning-ist"]);
});

const facts = {
  generated_at: "2026-10-14T05:00:00.000Z", freshness: { source_max_updated_at: null, timezone: IST, is_partial: false },
  viewer: { profile_id: "p", actor_id: "me", display_name: "Me", context: "work" }, scope: { type: "work", id: null, label: "Work", context: "work" },
  summary: {}, workload: [], lists: [], nudge_recommendations: [],
  people: [{ actor_id: "a-priya", display_name: "Priya Shah" }],
  things: [{ ...thing("for-priya", null), assignee_actor_id: "a-priya", assignee_name: "Priya Shah" }, thing("mine", null)],
};
function deps(interpretQuestion) {
  const calls = { model: 0, interpret: [] };
  return {
    calls,
    deps: {
      client: {}, userId: "u1",
      resolveScope: async () => ({ kind: "none" }), verifyChoice: async () => null, buildFacts: async () => facts,
      answer: async () => { calls.model += 1; return { schema_version: "katalist.assistant.answer.v1", intent: "scope_summary", answer_markdown: "model", confidence: "high", citations: [], actions: [], freshness: facts.freshness }; },
      interpretQuestion: async (q, history) => { calls.interpret.push({ q, earlier: history.filter((h) => h.role === "user").at(-1)?.content }); return interpretQuestion(q); },
      log: () => {},
    },
  };
}
const answerOf = async (question, d, history = []) => {
  const events = [];
  await runCoeyTurn({ question, context: "work", history }, d, "t", (e) => events.push(e), new AbortController().signal);
  return events.find((e) => e.type === "answer")?.answer;
};

test("6: direct Ask and a follow-up use the same structured answer as a question redirected from Toss", async () => {
  const priya = { about_person: "Priya", exclude_self: false, state: "any", window: "any" };
  const { deps: d, calls } = deps((q) => (/priya/i.test(q) ? priya : null));
  const direct = await answerOf("what's with Priya?", d);
  const followUp = await answerOf("and Priya?", d, [{ role: "user", content: "what's pending with Ravi?" }, { role: "assistant", content: "…" }]);
  const { deps: d2 } = deps(() => null);
  const redirected = [];
  await runCoeyTurn({ question: "what's with Priya?", context: "work", history: [], query: priya }, d2, "t", (e) => redirected.push(e), new AbortController().signal);
  const fromToss = redirected.find((e) => e.type === "answer").answer;
  for (const a of [direct, followUp]) {
    assert.equal(a.intent, "person_items");
    assert.deepEqual(a.groups, fromToss.groups);
  }
  assert.equal(calls.model, 0, "no model prose for structured questions");
  assert.equal(calls.interpret[1].earlier, "what's pending with Ravi?", "follow-ups are interpreted with the earlier question as context");
});

test("6: a line that is not a structured question (or interpretation unavailable) keeps the existing answer path", async () => {
  const { deps: d, calls } = deps(() => null);
  const a = await answerOf("draft a nudge for the deck", d);
  assert.equal(a.answer_markdown, "model");
  assert.equal(calls.model, 1);
});
