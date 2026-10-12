import assert from "node:assert/strict";
import { test } from "node:test";
import { answerAssistantQuestion, classifyAssistantIntent } from "../server/lib/assistant.ts";

const facts = {
  schema_version: "katalist.assistant.facts.v1",
  generated_at: "2026-10-11T00:00:00.000Z",
  freshness: { source_max_updated_at: "2026-10-10T23:00:00.000Z", timezone: "Asia/Kolkata", is_partial: false },
  viewer: { profile_id: "u", display_name: "Me", context: "work" },
  scope: { type: "list", id: "l", label: "Payments", context: "work" },
  summary: { active_count: 3, completed_count: 2, cancelled_count: 0, not_started_count: 1, in_progress_count: 2, overdue_count: 1, due_today_count: 1, waiting_for_catch_count: 2, unassigned_count: 0 },
  people: [{ actor_id: "a", display_name: "Rahul", active_count: 2, overdue_count: 1, waiting_for_catch_count: 2 }],
  things: [{ id: "11111111-1111-1111-1111-111111111111", title: "Verify payment", list_id: "l", status: "under_progress", acknowledgement: "waiting_for_catch", due_at: "2026-10-10T10:00:00.000Z", is_overdue: true, assignee_actor_id: "a", assignee_name: "Rahul", owner_actor_id: "a", updated_at: "2026-10-10T10:00:00.000Z", citation_label: "Verify payment" }],
  nudge_recommendations: [{ actor_id: "a", display_name: "Rahul", score: 9, reason_codes: ["overdue", "waiting_for_catch"], eligible_thing_ids: ["11111111-1111-1111-1111-111111111111"], eligible_thing_count: 1, overdue_thing_count: 1, last_nudged_at: null, can_nudge: true }],
};

test("Phase 1 routes supported Magic Box questions to stable intents", () => {
  assert.equal(classifyAssistantIntent("Who needs a nudge most in Payments?"), "nudge_recommendation");
  assert.equal(classifyAssistantIntent("What is overdue today?"), "overdue_items");
  assert.equal(classifyAssistantIntent("What changed yesterday?"), "recent_activity");
  assert.equal(classifyAssistantIntent("What is happening in this list?"), "scope_summary");
  assert.equal(classifyAssistantIntent("Make me a coffee"), "unsupported");
});

test("Phase 1 fallback answer never invents a nudge target", async () => {
  const previous = process.env.SARVAM_API_KEY;
  delete process.env.SARVAM_API_KEY;
  delete process.env.CODE_ACTIVITY_SARVAM_API_KEY;
  const answer = await answerAssistantQuestion(facts, "Who needs a nudge most?");
  assert.equal(answer.intent, "nudge_recommendation");
  assert.equal(answer.actions[0].type, "prepare_nudge");
  assert.deepEqual(answer.actions[0].target_ids, facts.nudge_recommendations[0].eligible_thing_ids);
  if (previous) process.env.SARVAM_API_KEY = previous;
});

test("nudging one Thing does not suppress another eligible Thing for the same person", async () => {
  const { buildAssistantFacts } = await import("../server/lib/assistant.ts");
  const rows = [1, 2].map((index) => ({ id: `thing-${index}`, title: `Thing ${index}`, list_id: null, context: "work", work_status: "not_started", acknowledgement: "waiting_for_catch", due_at: "2026-01-01T00:00:00Z", due_has_time: true, current_assignee_actor_id: "person", owner_actor_id: "viewer", updated_at: "2026-01-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z" }));
  const client = {
    from(table) {
      const result = table === "profiles" ? { display_name: "Viewer", timezone: "UTC", active_context: "work" } : table === "nudges" ? [{ thing_id: "thing-1", created_at: new Date().toISOString() }] : rows;
      const builder = { select() { return this; }, eq() { return this; }, in() { return this; }, is() { return this; }, gt() { return this; }, not() { return this; }, order() { return this; }, limit() { return this; }, maybeSingle() { return Promise.resolve({ data: result }); }, then(resolve) { return Promise.resolve({ data: result }).then(resolve); } };
      return builder;
    },
    async rpc(name) { return { data: name === "list_assignable_people" ? [{ actor_id: "person", display_name: "Ajju", avatar_url: "/avatars/ajju.jpg" }] : [{ thing_id: "thing-2", to_actor_id: "person" }] }; },
  };
  const result = await buildAssistantFacts(client, "viewer", { context: "work" });
  assert.deepEqual(result.nudge_recommendations[0].eligible_thing_ids, ["thing-2"]);
  assert.equal(result.nudge_recommendations[0].overdue_thing_count, 1);
  assert.equal(result.nudge_recommendations[0].avatar_url, "/avatars/ajju.jpg");
});
