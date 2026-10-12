// SYNTHETIC benchmark: injected delays stand in for Supabase and Sarvam. It measures how the new turn
// controller orders work, not real latency. Run: node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs scripts/coey-synthetic-bench.mjs
import { runCoeyTurn } from "../server/lib/assistant-stream.ts";
import { answerAssistantQuestion } from "../server/lib/assistant.ts";

const FACTS_MS = 400, MODEL_MS = 1800;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const facts = {
  schema_version: "katalist.assistant.facts.v1", generated_at: "x",
  freshness: { source_max_updated_at: null, timezone: "UTC", is_partial: false },
  viewer: { profile_id: "v", actor_id: "me", display_name: "Me", context: "work" },
  scope: { type: "work", id: null, label: "Work", context: "work" },
  summary: { active_count: 3, completed_count: 0, cancelled_count: 0, not_started_count: 3, in_progress_count: 0, overdue_count: 1, due_today_count: 0, waiting_for_catch_count: 0, unassigned_count: 3 },
  people: [], workload: [], lists: [], nudge_recommendations: [],
  things: [{ id: "T1", title: "Line chart", list_id: null, status: "not_started", acknowledgement: "none", due_at: "2026-10-01T00:00:00Z", is_overdue: true, assignee_actor_id: null, assignee_name: null, owner_actor_id: null, updated_at: "2026-10-10T00:00:00Z", citation_label: "Line chart" }],
};
process.env.SARVAM_API_KEY = "bench";
globalThis.fetch = async () => { await sleep(MODEL_MS); return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answer_markdown: "Model answer.", confidence: "high", citations: [] }) } }] }), { status: 200, headers: { "content-type": "application/json" } }); };
const deps = (answer) => ({ client: {}, userId: "u", resolveScope: async () => ({ kind: "none" }), verifyChoice: async () => null, buildFacts: async () => { await sleep(FACTS_MS); return facts; }, answer, log: () => {} });
async function measure(question, answer) {
  const t0 = performance.now(); const at = {};
  await runCoeyTurn({ question, context: "work", history: [] }, deps(answer), "t", (e) => { at[e.type] ??= performance.now() - t0; if (e.type === "status") at[`status:${e.stage}`] ??= performance.now() - t0; }, new AbortController().signal);
  return { firstStatus: at["status:reading_facts"] === undefined ? null : Math.round(at["status:reading_facts"]), firstText: Math.round(at.text_delta ?? at.answer), total: Math.round(at.completed) };
}
// "Previous behaviour" stand-in: every question loads facts, then calls the model when a key exists.
const oldStyle = (_f, q, h, s) => answerAssistantQuestion(_f, "which item is the riskiest for launch?", h, s);
const rows = [];
for (const q of ["hi", "whats up today", "What is overdue?", "which item is the riskiest for the launch?"]) {
  const next = await measure(q, answerAssistantQuestion);
  const old = await (async () => { const t0 = performance.now(); await sleep(FACTS_MS); await oldStyle(facts, q, []); return Math.round(performance.now() - t0); })();
  rows.push({ question: q, previous_total_ms: old, new_first_status_ms: next.firstStatus, new_first_text_ms: next.firstText, new_total_ms: next.total });
}
console.table(rows);
console.log(JSON.stringify({ synthetic: true, FACTS_MS, MODEL_MS, rows }));
