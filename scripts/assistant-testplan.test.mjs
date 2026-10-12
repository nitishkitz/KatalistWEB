import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { classifyAssistantIntent, answerAssistantQuestion, validateCitations } from "../server/lib/assistant.ts";

let authMode = "ok";
mock.module("@tanstack/react-router", { namedExports: { createFileRoute: () => (config) => config } });
mock.module("@/lib/assistant-route.server", {
  namedExports: {
    requireAssistantUser: async () => {
      if (authMode === "none") throw Response.json({ message: "Authentication required." }, { status: 401 });
      return { userId: "u1", client: { from() { throw new Error("db down"); }, rpc: async () => ({ error: { message: "x" } }) } };
    },
    assistantJson: (body, status = 200) => Response.json(body, { status }),
  },
});
const query = (await import("../src/routes/api/assistant/query.ts")).Route.server.handlers.POST;
const preview = (await import("../src/routes/api/assistant/action/preview.ts")).Route.server.handlers.POST;
const confirm = (await import("../src/routes/api/assistant/action/confirm.ts")).Route.server.handlers.POST;
const post = (handler, body, raw) => handler({ request: new Request("http://x/api", { method: "POST", body: raw ?? JSON.stringify(body), headers: { "content-type": "application/json" } }) });

test("4.1 intent classification: case, punctuation, synonyms, blank and unsupported", () => {
  assert.equal(classifyAssistantIntent("What is happening here?"), "scope_summary");
  assert.equal(classifyAssistantIntent("what IS overdue"), "overdue_items");
  assert.equal(classifyAssistantIntent("Who needs a nudge?"), classifyAssistantIntent("WHO NEEDS A NUDGE"));
  assert.equal(classifyAssistantIntent("Who needs a reminder?"), "nudge_recommendation");
  assert.equal(classifyAssistantIntent("   "), "clarification");
  assert.equal(classifyAssistantIntent("Make me a coffee"), "unsupported");
  assert.equal(classifyAssistantIntent("Which one is most urgent?"), "attention_items");
});

test("9.4 API robustness: invalid JSON, empty body, bad question and missing auth are controlled errors", async () => {
  for (const handler of [query, preview, confirm]) {
    assert.equal((await post(handler, null, "{not json")).status, 400);
    assert.equal((await post(handler, null, "null")).status, 400);
  }
  assert.equal((await post(query, { question: "" })).status, 400);
  assert.equal((await post(query, { question: "x".repeat(801) })).status, 400);
  assert.equal((await post(query, { question: 42 })).status, 400);
  authMode = "none";
  for (const handler of [query, preview, confirm]) assert.equal((await post(handler, { question: "hi" })).status, 401);
  authMode = "ok";
});

test("9.4 action routes reject unknown types, bad UUIDs, duplicates and oversize target lists", async () => {
  const id = "11111111-1111-1111-1111-111111111111";
  const bad = [
    { type: "delete_everything", targetIds: [id] },
    { type: "set_status", targetIds: ["not-a-uuid"], params: { status: "sorted" } },
    { type: "set_status", targetIds: [id, id], params: { status: "sorted" } },
    { type: "set_status", targetIds: [], params: { status: "sorted" } },
    { type: "set_status", targetIds: Array.from({ length: 21 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`), params: { status: "sorted" } },
    { type: "set_status", targetIds: [id], params: { status: "cancelled" } },
    { type: "set_status", targetIds: [id] },
  ];
  for (const body of bad) assert.equal((await post(preview, body)).status, 400, JSON.stringify(body).slice(0, 60));
});

test("9.4 a database failure becomes a controlled, non-HTML error", async () => {
  const res = await post(query, { question: "What is happening here?", listId: "11111111-1111-1111-1111-111111111111" });
  assert.ok([502, 504].includes(res.status));
  assert.match(res.headers.get("content-type"), /json/);
});

test("9.2 payload limits: model answers and citations are bounded", async () => {
  const facts = {
    schema_version: "katalist.assistant.facts.v1", generated_at: "x",
    freshness: { source_max_updated_at: null, timezone: "UTC", is_partial: false },
    viewer: { profile_id: "v", display_name: "Me", context: "work" },
    scope: { type: "work", id: null, label: "Work", context: "work" },
    summary: { active_count: 30, completed_count: 0, cancelled_count: 0, not_started_count: 30, in_progress_count: 0, overdue_count: 0, due_today_count: 0, waiting_for_catch_count: 0, unassigned_count: 0 },
    people: [], workload: [], lists: [], nudge_recommendations: [],
    things: Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, title: `T${i}`, list_id: null, status: "not_started", acknowledgement: "none", due_at: null, is_overdue: false, assignee_actor_id: null, assignee_name: null, owner_actor_id: null, updated_at: "x", citation_label: `T${i}` })),
  };
  assert.equal(validateCitations(facts.things.map((t) => ({ id: t.id })), facts).length, 20);
  const oldKey = process.env.SARVAM_API_KEY, oldFetch = globalThis.fetch;
  process.env.SARVAM_API_KEY = "k";
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answer_markdown: "a".repeat(9000), citations: [] }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
  try {
    const answer = await answerAssistantQuestion(facts, "What is happening?", [{ role: "user", content: "x".repeat(5000) }]);
    assert.ok(answer.answer_markdown.length <= 2100);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.SARVAM_API_KEY; else process.env.SARVAM_API_KEY = oldKey;
  }
});

const { sanitizeAssistantHistory, buildAssistantFacts } = await import("../server/lib/assistant.ts");
const { readBoundedJson, PayloadTooLargeError } = await import("../server/lib/assistant-limits.ts");
const { previewAssistantAction, confirmAssistantAction, parseActionRequest, ActionError } = await import("../server/lib/assistant-actions.ts");

test("5.2 history: latest six valid turns, invalid roles and types dropped, content capped", () => {
  const turns = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `t${i}` }));
  const out = sanitizeAssistantHistory([...turns, { role: "system", content: "evil" }, { role: "user", content: 5 }, null, "x", { role: "user", content: "  " }]);
  assert.deepEqual(out.map((t) => t.content), ["t4", "t5", "t6", "t7", "t8", "t9"]);
  assert.equal(sanitizeAssistantHistory([{ role: "user", content: "a".repeat(5000) }])[0].content.length, 1200);
  assert.deepEqual(sanitizeAssistantHistory("nope"), []);
  assert.deepEqual(sanitizeAssistantHistory(undefined), []);
  assert.equal(sanitizeAssistantHistory(turns.slice(0, 1)).length, 1);
});

test("9.4 oversized bodies are rejected before parsing, and routes only expose POST", async () => {
  const big = "x".repeat(70 * 1024);
  await assert.rejects(readBoundedJson(new Request("http://x", { method: "POST", body: JSON.stringify({ q: big }) })), PayloadTooLargeError);
  assert.equal((await post(query, { question: "hi", pad: big })).status, 413);
  for (const route of ["query", "action/preview", "action/confirm"])
    assert.deepEqual(Object.keys((await import(`../src/routes/api/assistant/${route}.ts`)).Route.server.handlers), ["POST"]);
});

function factsClient({ things = [], profile = { display_name: "Me", timezone: "UTC", active_context: "work" }, fail } = {}) {
  const data = { things, profiles: profile, nudges: [], thing_assignments: [], lists: [] };
  return {
    from(table) {
      const q = { then: (resolve) => resolve(fail ? { data: null, error: { message: "boom" } } : { data: data[table] ?? [] }) };
      for (const m of ["select", "eq", "in", "is", "not", "order", "limit", "gt"]) q[m] = () => q;
      q.maybeSingle = async () => ({ data: data[table] });
      return q;
    },
    rpc: async () => ({ data: [] }),
  };
}
const thingRow = (i, extra = {}) => ({ id: `t${i}`, title: `T${i}`, list_id: null, context: "work", work_status: "not_started", acknowledgement: "none", due_at: null, due_has_time: false, current_assignee_actor_id: null, owner_actor_id: null, updated_at: "2026-10-01T00:00:00Z", created_at: "2026-10-01T00:00:00Z", ...extra });

test("4.2 facts: exactly 100 and 99 Things, empty scope, bad timezone, invalid due date", async () => {
  const build = (opts) => buildAssistantFacts(factsClient(opts), "u1", { context: "work" });
  assert.equal((await build({ things: Array.from({ length: 100 }, (_, i) => thingRow(i)) })).freshness.is_partial, true);
  assert.equal((await build({ things: Array.from({ length: 99 }, (_, i) => thingRow(i)) })).freshness.is_partial, false);
  const empty = await build({ things: [] });
  assert.equal(empty.summary.active_count, 0);
  assert.equal(empty.things.length, 0);
  assert.equal((await build({ profile: { display_name: "Me", timezone: null, active_context: "work" } })).freshness.timezone, "UTC");
  assert.equal((await build({ profile: { display_name: "Me", timezone: "Not/AZone", active_context: "work" } })).freshness.timezone, "UTC");
  const bad = await build({ things: [thingRow(1, { due_at: "garbage" }), thingRow(2, { due_at: null, work_status: "cancelled" }), thingRow(3, { work_status: "sorted" })] });
  assert.equal(bad.summary.overdue_count, 0);
  assert.equal(bad.summary.cancelled_count, 1);
  assert.equal(bad.summary.completed_count, 1);
});

test("9.4 a Supabase error on the facts read is a controlled JSON failure, not a crash", async () => {
  await assert.rejects(buildAssistantFacts(factsClient({ fail: true }), "u1", { context: "work" }));
});

const A = "11111111-1111-1111-1111-111111111111";
const ACTOR = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
function actionClient({ rows, nudgeable = [{ thing_id: A, to_actor_id: ACTOR }] }) {
  const calls = [];
  return { calls, from() { const q = {}; for (const m of ["select", "in", "eq", "is"]) q[m] = () => q; q.limit = async () => ({ data: rows }); q.maybeSingle = async () => ({ data: null }); return q; }, rpc: async (name, args) => { if (name === "list_nudgeable_things") return { data: nudgeable }; if (name === "list_assignable_people") return { data: [{ actor_id: ACTOR }] }; calls.push(name); return { data: {} }; } };
}
const base = { id: A, title: "T", context: "work", work_status: "not_started", acknowledgement: "none", due_at: null, current_assignee_actor_id: ACTOR };

test("7.2 confirmations: expired, permission lost, assignment changed, completed meanwhile", async () => {
  const req = parseActionRequest({ type: "prepare_nudge", targetIds: [A], params: { actorId: ACTOR } });
  const preview = await previewAssistantAction(actionClient({ rows: [base] }), "u1", req);
  assert.ok(preview.token);
  const lost = actionClient({ rows: [] });
  assert.equal((await confirmAssistantAction(lost, "u1", { token: preview.token, idempotencyKey: "perm-lost-1" })).results[0].state, "rejected");
  assert.equal(lost.calls.length, 0);
  const reassigned = actionClient({ rows: [{ ...base, current_assignee_actor_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" }] });
  assert.equal((await confirmAssistantAction(reassigned, "u1", { token: preview.token, idempotencyKey: "reassign-1" })).results[0].state, "rejected");
  const done = actionClient({ rows: [{ ...base, work_status: "sorted" }] });
  assert.equal((await confirmAssistantAction(done, "u1", { token: preview.token, idempotencyKey: "completed-1" })).results[0].state, "rejected");
  assert.equal(reassigned.calls.length + done.calls.length, 0);
  const realNow = Date.now;
  Date.now = () => realNow() + 6 * 60 * 1000;
  try {
    await assert.rejects(confirmAssistantAction(actionClient({ rows: [base] }), "u1", { token: preview.token, idempotencyKey: "expired-1" }), (e) => e instanceof ActionError && e.status === 410);
  } finally { Date.now = realNow; }
  await assert.rejects(confirmAssistantAction(actionClient({ rows: [base] }), "u1", { token: undefined, idempotencyKey: "nologin-123" }), ActionError);
});

test("attention and overdue answers return server-decided groups, due-date ordered, closed Things excluded", async () => {
  const old = process.env.SARVAM_API_KEY;
  delete process.env.SARVAM_API_KEY; delete process.env.CODE_ACTIVITY_SARVAM_API_KEY;
  const mk = (i, extra = {}) => ({ id: `t${i}`, title: `Task ${i}`, list_id: null, status: "not_started", acknowledgement: "caught", due_at: null, is_overdue: false, assignee_actor_id: "a", assignee_name: "Ajjju", owner_actor_id: null, updated_at: "x", citation_label: `Task ${i}`, ...extra });
  const things = [
    ...Array.from({ length: 10 }, (_, i) => mk(i, { acknowledgement: "waiting_for_catch" })),
    mk(20, { is_overdue: true, due_at: "2026-10-09T00:00:00Z" }),
    mk(21, { is_overdue: true, due_at: "2026-10-06T00:00:00Z" }),
    mk(22, { status: "sorted", acknowledgement: "waiting_for_catch" }),
  ];
  const facts = {
    schema_version: "katalist.assistant.facts.v1", generated_at: "x",
    freshness: { source_max_updated_at: null, timezone: "UTC", is_partial: false },
    viewer: { profile_id: "v", display_name: "Me", context: "work" },
    scope: { type: "work", id: null, label: "Work", context: "work" },
    summary: { active_count: 12, completed_count: 1, cancelled_count: 0, not_started_count: 12, in_progress_count: 0, overdue_count: 2, due_today_count: 0, waiting_for_catch_count: 10, unassigned_count: 0 },
    people: [], workload: [], lists: [], nudge_recommendations: [], things,
  };
  try {
    const attention = await answerAssistantQuestion(facts, "What needs my attention?");
    // Intentional change (hybrid fast path): counts plus the top-ranked real Things instead of counts only.
    assert.match(attention.answer_markdown, /^2 overdue, 10 waiting for a response\. Start with \*\*Task 21\*\* \(overdue\)/);
    assert.deepEqual(attention.groups.map((g) => [g.key, g.total, g.thing_ids.length]), [["waiting", 10, 10], ["overdue", 2, 2]]);
    assert.equal(attention.groups.flatMap((g) => g.thing_ids).includes("t22"), false);
    const overdue = await answerAssistantQuestion(facts, "Which items are overdue?");
    assert.deepEqual(overdue.groups[0].thing_ids, ["t21", "t20"]);
    const summary = await answerAssistantQuestion(facts, "What is happening here?");
    assert.deepEqual(summary.groups, []);
  } finally { if (old !== undefined) process.env.SARVAM_API_KEY = old; }
});
