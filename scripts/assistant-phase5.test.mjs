import assert from "node:assert/strict";
import { test } from "node:test";
import { parseActivityWindow, startOfDayInZone, summarizeEvent, wantsActivity, loadActivityFacts } from "../server/lib/assistant-activity.ts";
import { answerAssistantQuestion } from "../server/lib/assistant.ts";

test("relative windows follow the viewer's timezone", () => {
  // 2026-10-12 20:00 UTC is already Oct 13 01:30 in Kolkata.
  const now = Date.parse("2026-10-12T20:00:00Z");
  const kolkata = parseActivityWindow("what changed yesterday?", "Asia/Kolkata", now);
  assert.equal(kolkata.from, "2026-10-11T18:30:00.000Z");
  assert.equal(kolkata.to, "2026-10-12T18:30:00.000Z");
  const utc = parseActivityWindow("what changed yesterday?", "UTC", now);
  assert.equal(utc.from, "2026-10-11T00:00:00.000Z");
  assert.equal(parseActivityWindow("anything recent", "UTC", now).label, "the last 7 days");
  assert.equal(startOfDayInZone(Date.parse("2026-03-08T20:00:00Z"), "America/New_York"), Date.parse("2026-03-08T05:00:00Z"));
});

test("this week starts on Monday in the viewer's timezone", () => {
  const w = parseActivityWindow("what changed this week", "UTC", Date.parse("2026-10-14T12:00:00Z"));
  assert.equal(w.from, "2026-10-12T00:00:00.000Z");
});

test("event summaries use only recorded detail and never invent a previous value", () => {
  const name = (id) => (id === "a" ? "Ajju" : "a teammate");
  assert.equal(summarizeEvent("work_status_changed", { work_status: "under_progress" }, name), "Status set to In Progress");
  assert.equal(summarizeEvent("reassigned", { from_actor_id: "a", to_actor_id: "z" }, name), "Reassigned from Ajju to a teammate");
  assert.equal(wantsActivity("When was this last nudged?", "scope_summary"), true);
  assert.equal(wantsActivity("How many are overdue?", "overdue_items"), false);
});

test("activity reads are bounded, scoped to given Things, and flag truncation", async () => {
  const seen = {};
  const q = (table) => {
    const o = {};
    for (const m of ["select", "in", "is", "gte", "lt", "order"]) o[m] = (...a) => ((seen[`${table}.${m}`] = a), o);
    o.limit = async (n) => {
      seen[`${table}.limit`] = n;
      if (table === "thing_activity")
        return { data: Array.from({ length: n }, (_, i) => ({ thing_id: "t1", actor_id: "a", event: "nudged", detail: {}, created_at: `2026-10-1${i % 9}T00:00:00Z` })) };
      return { data: [] };
    };
    return o;
  };
  const window = parseActivityWindow("recent", "UTC", Date.parse("2026-10-12T00:00:00Z"));
  const facts = await loadActivityFacts({ from: q }, ["t1"], window, () => "Ajju");
  assert.equal(facts.events.length, 60);
  assert.equal(facts.truncated, true);
  assert.deepEqual(seen["thing_activity.in"], ["thing_id", ["t1"]]);
  assert.deepEqual(seen["thing_comments.is"], ["deleted_at", null]);
});

test("activity answers keep the window in source metadata without repeating it in prose", async () => {
  const old = process.env.SARVAM_API_KEY;
  delete process.env.SARVAM_API_KEY;
  delete process.env.CODE_ACTIVITY_SARVAM_API_KEY;
  const window = { from: "2026-10-11T00:00:00.000Z", to: "2026-10-12T00:00:00.000Z", label: "yesterday", timezone: "UTC" };
  const facts = {
    schema_version: "katalist.assistant.facts.v1", generated_at: "x",
    freshness: { source_max_updated_at: null, timezone: "UTC", is_partial: false },
    viewer: { profile_id: "v", display_name: "Me", context: "work" },
    scope: { type: "work", id: null, label: "Work", context: "work" },
    summary: { active_count: 1, completed_count: 0, cancelled_count: 0, not_started_count: 1, in_progress_count: 0, overdue_count: 0, due_today_count: 0, waiting_for_catch_count: 0, unassigned_count: 0 },
    people: [], workload: [], lists: [], nudge_recommendations: [],
    things: [{ id: "t1", title: "Fix payments", list_id: null, status: "not_started", acknowledgement: "none", due_at: null, is_overdue: false, assignee_actor_id: null, assignee_name: null, owner_actor_id: null, updated_at: "x", citation_label: "Fix payments" }],
    activity: { window, events: [{ thing_id: "t1", event: "nudged", actor: "Ajju", occurred_at: "2026-10-11T10:00:00Z", summary: "Nudged" }], comments: [], nudges: [], truncated: false, event_limit: 60 },
  };
  try {
    const answer = await answerAssistantQuestion(facts, "What changed yesterday?");
    assert.doesNotMatch(answer.answer_markdown, /Activity window:|Partial:|UTC/);
    assert.deepEqual(answer.groups, [{ key: "changed", title: "Changed", thing_ids: ["t1"], total: 1, notes: { t1: "Nudged by Ajju" } }]);
    assert.ok(answer.sources.some((s) => s.kind === "activity"));
    assert.match(answer.sources.find((s) => s.kind === "activity").label, /yesterday.*Oct 11.*Oct 12.*UTC/);
    assert.equal(answer.citations[0].id, "t1");
  } finally {
    if (old !== undefined) process.env.SARVAM_API_KEY = old;
  }
});
