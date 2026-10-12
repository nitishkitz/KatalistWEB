import assert from "node:assert/strict";
import { test } from "node:test";
import { createCoeyEventStream, runCoeyTurn } from "../server/lib/assistant-stream.ts";
import { decodeCoeyEvent } from "../server/lib/assistant-turn.ts";
import { DeadlineError } from "../server/lib/assistant-limits.ts";
import { applyCoeyEvent, initialTurnState } from "../src/features/court/assistant/turn-state.ts";

const thing = (id, over = {}) => ({
  id, title: `Thing ${id}`, list_id: null, status: "not_started", acknowledgement: "none", due_at: null,
  is_overdue: false, assignee_actor_id: null, assignee_name: null, owner_actor_id: null,
  updated_at: "2026-10-10T00:00:00Z", citation_label: `Thing ${id}`, ...over,
});
const facts = {
  schema_version: "katalist.assistant.facts.v1", generated_at: "x",
  freshness: { source_max_updated_at: null, timezone: "UTC", is_partial: false },
  viewer: { profile_id: "v", actor_id: "me", display_name: "Me", context: "work" },
  scope: { type: "work", id: null, label: "Work", context: "work" },
  summary: { active_count: 1, completed_count: 0, cancelled_count: 0, not_started_count: 1, in_progress_count: 0, overdue_count: 1, due_today_count: 0, waiting_for_catch_count: 0, unassigned_count: 0 },
  people: [], workload: [], lists: [], nudge_recommendations: [],
  things: [thing("T1", { is_overdue: true, due_at: "2026-10-01T00:00:00Z" })],
};

function deps(overrides = {}) {
  const calls = { facts: 0, answer: 0, scope: 0 };
  return {
    calls,
    deps: {
      client: {}, userId: "u1",
      resolveScope: async () => { calls.scope += 1; return { kind: "none" }; },
      verifyChoice: async () => null,
      buildFacts: async () => { calls.facts += 1; return facts; },
      answer: async () => {
        calls.answer += 1;
        return { schema_version: "katalist.assistant.answer.v1", intent: "scope_summary", answer_markdown: "Model prose", confidence: "high", citations: [], actions: [], freshness: facts.freshness };
      },
      log: () => {},
      ...overrides,
    },
  };
}
const input = (question, extra = {}) => ({ question, context: "work", history: [], ...extra });
async function collect(question, d, extra = {}, signal = new AbortController().signal) {
  const events = [];
  await runCoeyTurn(input(question, extra), d, "turn-1", (e) => events.push(e), signal, 7);
  return events;
}
const types = (events) => events.map((e) => e.type);

test("a fast answer streams accepted, status, facts_ready, grounded text, answer, completed and never calls the model", async () => {
  const { deps: d, calls } = deps();
  const events = await collect("What is overdue?", d);
  assert.deepEqual(types(events), ["accepted", "status", "facts_ready", "text_delta", "answer", "completed"]);
  assert.equal(events[1].stage, "reading_facts");
  assert.ok(!events.some((e) => e.type === "status" && e.stage === "calling_model"));
  assert.deepEqual(events.map((e) => e.seq), [1, 2, 3, 4, 5, 6]);
  assert.ok(events.every((e) => e.turnId === "turn-1"));
  assert.equal(events[4].facts.things[0].id, "T1");
  assert.equal(events[4].facts.nudge_recommendations.length, 0);
  assert.equal(events[5].timings.authMs, 7);
  assert.equal(events[5].timings.route, "fast");
  assert.equal(calls.facts, 1);
});

test("a greeting reads no facts, shows no status and answers at once", async () => {
  const { deps: d, calls } = deps();
  const events = await collect("hi", d);
  assert.deepEqual(types(events), ["accepted", "text_delta", "answer", "completed"]);
  assert.equal(calls.facts + calls.scope + calls.answer, 0);
  assert.match(events[2].answer.answer_markdown, /^Hi\./);
});

test("a model turn reports calling_model only when a key exists and never streams model text", async () => {
  const old = process.env.SARVAM_API_KEY;
  process.env.SARVAM_API_KEY = "k";
  try {
    const { deps: d, calls } = deps();
    const events = await collect("which item is the riskiest for the launch?", d);
    assert.deepEqual(types(events), ["accepted", "status", "facts_ready", "status", "answer", "completed"]);
    assert.equal(events[3].stage, "calling_model");
    assert.ok(!events.some((e) => e.type === "text_delta"), "validated model prose arrives only in the answer event");
    assert.equal(events[4].answer.answer_markdown, "Model prose");
    assert.equal(calls.answer, 1);
  } finally {
    if (old === undefined) delete process.env.SARVAM_API_KEY; else process.env.SARVAM_API_KEY = old;
  }
});

test("without a key no calling_model status is claimed", async () => {
  const old = process.env.SARVAM_API_KEY, oldAlt = process.env.CODE_ACTIVITY_SARVAM_API_KEY;
  delete process.env.SARVAM_API_KEY; delete process.env.CODE_ACTIVITY_SARVAM_API_KEY;
  try {
    const { deps: d } = deps();
    const events = await collect("which item is the riskiest for the launch?", d);
    assert.ok(!events.some((e) => e.type === "status" && e.stage === "calling_model"));
  } finally {
    if (old !== undefined) process.env.SARVAM_API_KEY = old;
    if (oldAlt !== undefined) process.env.CODE_ACTIVITY_SARVAM_API_KEY = oldAlt;
  }
});

test("raw model JSON can never reach the client as text", async () => {
  const { deps: d } = deps({
    answer: async () => ({ schema_version: "katalist.assistant.answer.v1", intent: "scope_summary", answer_markdown: "Clean", confidence: "high", citations: [], actions: [], freshness: facts.freshness }),
  });
  const events = await collect("which item is the riskiest for the launch?", d);
  const wire = JSON.stringify(events);
  assert.ok(!wire.includes('{\\"answer_markdown'));
  assert.ok(!events.some((e) => e.type === "text_delta" && /^\s*[{[]/.test(e.text)));
});

test("scope selection answers carry no facts and still end with one terminal event", async () => {
  const { deps: d, calls } = deps({
    resolveScope: async () => ({ kind: "ambiguous", candidates: [{ type: "list", id: "L1", label: "Nithesh", context: "work" }, { type: "bucket", id: "B1", label: "Nithesh", context: "work" }] }),
  });
  const events = await collect("what is overdue in Nithesh", d);
  const answer = events.find((e) => e.type === "answer");
  assert.equal(answer.answer.intent, "scope_selection_required");
  assert.equal(calls.facts, 0);
  assert.equal(events.filter((e) => e.type === "completed" || e.type === "error").length, 1);
});

test("an unavailable scope choice and facts timeouts end in exactly one error event", async () => {
  const bad = await collect("What is overdue?", deps().deps, { scopeChoice: { type: "list", id: "gone" } });
  assert.equal(bad.at(-1).type, "error");
  assert.equal(bad.at(-1).code, "scope_unavailable");
  const slow = await collect("What is overdue?", deps({ buildFacts: async () => { throw new DeadlineError("facts_timeout"); } }).deps);
  assert.equal(slow.at(-1).code, "facts_timeout");
  const boom = await collect("What is overdue?", deps({ buildFacts: async () => { throw new Error("db password=secret"); } }).deps);
  assert.equal(boom.at(-1).code, "assistant_failed");
  assert.ok(!JSON.stringify(boom).includes("secret"), "internal error text is never sent");
  for (const events of [bad, slow, boom]) assert.equal(events.filter((e) => e.type === "completed" || e.type === "error").length, 1);
});

test("an abort stops the turn: no further events and the model signal is the aborted one", async () => {
  const controller = new AbortController();
  const events = [];
  let modelSignal;
  const { deps: d } = deps({
    buildFacts: async () => { controller.abort(); return facts; },
    answer: async (_f, _q, _h, signal) => { modelSignal = signal; throw new Error("should not run"); },
  });
  await runCoeyTurn(input("What is overdue?"), d, "t", (e) => events.push(e), controller.signal);
  assert.ok(!types(events).includes("answer"));
  assert.ok(!types(events).includes("completed"));
  assert.equal(modelSignal, undefined);
});

test("the SSE body round-trips through the client reducer and emits exactly one terminal frame", async () => {
  const { answerAssistantQuestion } = await import("../server/lib/assistant.ts");
  const { deps: d } = deps({ answer: answerAssistantQuestion });
  const stream = createCoeyEventStream((send, signal) => runCoeyTurn(input("What is overdue?"), d, "turn-9", send, signal));
  const text = await new Response(stream).text();
  const frames = text.split("\n\n").filter(Boolean);
  let state = initialTurnState;
  for (const frame of frames) {
    const data = frame.split("\n").find((l) => l.startsWith("data: ")).slice(6);
    state = applyCoeyEvent(state, decodeCoeyEvent(data));
  }
  assert.equal(state.terminal, "completed");
  assert.equal(state.answer.intent, "overdue_items");
  assert.equal(frames.filter((f) => f.startsWith("event: completed") || f.startsWith("event: error")).length, 1);
});

test("cancelling the body aborts the running turn and malformed provider output becomes a labelled fallback, not a crash", async () => {
  let aborted = false;
  const stream = createCoeyEventStream(async (send, signal) => {
    await new Promise((resolve) => signal.addEventListener("abort", () => { aborted = true; resolve(); }));
  });
  const reader = stream.getReader();
  await reader.cancel();
  assert.equal(aborted, true);

  // Provider returns garbage: the answer layer degrades with a notice; the stream still completes once.
  const { answerAssistantQuestion } = await import("../server/lib/assistant.ts");
  const old = process.env.SARVAM_API_KEY, oldFetch = globalThis.fetch;
  process.env.SARVAM_API_KEY = "k";
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: "<<garbage" } }] }), { status: 200, headers: { "content-type": "application/json" } });
  try {
    const { deps: d } = deps({ answer: answerAssistantQuestion });
    const events = await collect("which item is the riskiest for the launch?", d);
    assert.match(events.find((e) => e.type === "answer").answer.notice, /could not be read/);
    assert.equal(events.at(-1).type, "completed");
  } finally {
    globalThis.fetch = oldFetch;
    if (old === undefined) delete process.env.SARVAM_API_KEY; else process.env.SARVAM_API_KEY = old;
  }
});
