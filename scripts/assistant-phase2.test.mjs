import assert from "node:assert/strict";
import { test } from "node:test";
import { answerAssistantQuestion } from "../server/lib/assistant.ts";

const facts = {
  schema_version: "katalist.assistant.facts.v1",
  generated_at: "2026-10-12T00:00:00.000Z",
  freshness: { source_max_updated_at: null, timezone: "UTC", is_partial: false },
  viewer: { profile_id: "viewer", display_name: "Me", context: "work" },
  scope: { type: "list", id: "list-1", label: "Payments", context: "work" },
  summary: { active_count: 1, completed_count: 0, cancelled_count: 0, not_started_count: 1, in_progress_count: 0, overdue_count: 0, due_today_count: 0, waiting_for_catch_count: 0, unassigned_count: 0 },
  people: [],
  things: [],
  nudge_recommendations: [],
};

test("Phase 2 includes only bounded follow-up history in the model prompt", async () => {
  const oldKey = process.env.SARVAM_API_KEY;
  const oldFetch = globalThis.fetch;
  process.env.SARVAM_API_KEY = "test-key";
  let prompt = "";
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(init.body);
    prompt = payload.messages[1].content;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answer_markdown: "The payment is still active.", confidence: "high", citations: [] }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const history = Array.from({ length: 10 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `turn-${index}` }));
    const answer = await answerAssistantQuestion(facts, "What is still active?", history);
    assert.equal(answer.answer_markdown, "The payment is still active.");
    assert.match(prompt, /turn-9/);
    assert.doesNotMatch(prompt, /turn-0/);
    assert.match(prompt, /LATEST QUESTION: What is still active\?/);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.SARVAM_API_KEY;
    else process.env.SARVAM_API_KEY = oldKey;
  }
});
