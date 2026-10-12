import assert from "node:assert/strict";
import { test } from "node:test";
import { answerAssistantQuestion } from "../server/lib/assistant.ts";

const mk = (id, extra = {}) => ({
  id, title: `Thing ${id}`, list_id: null, status: "not_started", acknowledgement: "none", due_at: null,
  is_overdue: false, assignee_actor_id: "a1", assignee_name: "Ajju", owner_actor_id: null,
  updated_at: "2026-10-10T00:00:00Z", citation_label: `Thing ${id}`, ...extra,
});
const facts = {
  schema_version: "katalist.assistant.facts.v1", generated_at: "x",
  freshness: { source_max_updated_at: null, timezone: "UTC", is_partial: false },
  viewer: { profile_id: "v", actor_id: "me", display_name: "Me", context: "work" },
  scope: { type: "work", id: null, label: "Work", context: "work" },
  summary: { active_count: 2, completed_count: 0, cancelled_count: 0, not_started_count: 2, in_progress_count: 0, overdue_count: 1, due_today_count: 0, waiting_for_catch_count: 0, unassigned_count: 0 },
  people: [{ actor_id: "a1", display_name: "Ajju", active_count: 2, overdue_count: 1, waiting_for_catch_count: 0 }],
  workload: [], lists: [], nudge_recommendations: [],
  things: [mk("T1", { is_overdue: true, due_at: "2026-10-01T00:00:00Z" }), mk("T2")],
};

async function withModel(impl, run, key = "k") {
  const oldKey = process.env.SARVAM_API_KEY, oldAlt = process.env.CODE_ACTIVITY_SARVAM_API_KEY, oldFetch = globalThis.fetch;
  if (key) process.env.SARVAM_API_KEY = key; else delete process.env.SARVAM_API_KEY;
  delete process.env.CODE_ACTIVITY_SARVAM_API_KEY;
  let calls = 0;
  globalThis.fetch = async (...args) => { calls += 1; return impl(...args); };
  try { return await run(() => calls); } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.SARVAM_API_KEY; else process.env.SARVAM_API_KEY = oldKey;
    if (oldAlt !== undefined) process.env.CODE_ACTIVITY_SARVAM_API_KEY = oldAlt;
  }
}
const modelReply = (content) => async () =>
  new Response(JSON.stringify({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] }), {
    status: 200, headers: { "content-type": "application/json" },
  });

test("a first-turn open question reaches the model and its validated prose is used", async () => {
  await withModel(modelReply({ answer_markdown: "Thing T1 is the riskiest because it is late.", confidence: "high", citations: [{ id: "T1" }] }), async (calls) => {
    const a = await answerAssistantQuestion(facts, "which item is the riskiest for the launch?", []);
    assert.equal(calls(), 1);
    assert.match(a.answer_markdown, /riskiest because it is late/);
    assert.deepEqual(a.citations.map((c) => c.id), ["T1"]);
    assert.equal(a.notice, undefined);
  });
});

test("greeting, fast and clarify questions never call the model", async () => {
  await withModel(modelReply({ answer_markdown: "SHOULD NOT APPEAR" }), async (calls) => {
    for (const q of ["hi", "whats up today", "What is overdue?", "what is the weather in Pune"]) {
      const a = await answerAssistantQuestion(facts, q, []);
      assert.doesNotMatch(a.answer_markdown, /SHOULD NOT APPEAR/);
    }
    assert.equal(calls(), 0);
  });
});

test("429, 5xx, html, invalid JSON and network failure fall back to grounded data with an honest notice", async () => {
  const cases = [
    [async () => new Response("rate", { status: 429 }), /busy/],
    [async () => new Response("x", { status: 503 }), /unavailable/],
    [async () => new Response("<html/>", { status: 200, headers: { "content-type": "text/html" } }), /unexpected response/],
    [modelReply("this is not json"), /could not be read/],
    [async () => { throw new TypeError("network"); }, /could not be reached/],
    [async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); }, /took too long/],
  ];
  for (const [impl, notice] of cases) {
    await withModel(impl, async () => {
      const a = await answerAssistantQuestion(facts, "which item is the riskiest for the launch?", []);
      assert.match(a.notice, notice);
      assert.match(a.answer_markdown, /active Things/, "grounded data answer, not a canned capability sentence");
      assert.doesNotMatch(a.answer_markdown, /I can summarize/);
    });
  }
});

test("without a key the model path is honest that it used data only", async () => {
  await withModel(modelReply({}), async (calls) => {
    const a = await answerAssistantQuestion(facts, "which item is the riskiest for the launch?", []);
    assert.equal(calls(), 0);
    assert.match(a.notice, /not configured/);
    assert.match(a.answer_markdown, /2 active Things/);
  }, "");
});

test("invented Thing ids, citations and actions are stripped; success claims never create actions", async () => {
  await withModel(
    modelReply({
      answer_markdown: "Done. I sent the nudge to Ajju.",
      citations: [{ id: "T1" }, { id: "INVENTED" }],
      suggested_actions: [
        { type: "open_thing", target_ids: ["INVENTED"] },
        { type: "prepare_nudge", target_ids: ["T1"], params: { actor_id: "ghost" } },
        { type: "delete_everything", target_ids: ["T1"] },
        { type: "open_thing", target_ids: ["T2"] },
      ],
    }),
    async () => {
      const a = await answerAssistantQuestion(facts, "can you open the thing that has no deadline", []);
      assert.deepEqual(a.citations.map((c) => c.id), ["T1"]);
      const ids = a.actions.flatMap((x) => x.target_ids);
      assert.ok(!ids.includes("INVENTED"));
      assert.ok(!a.actions.some((x) => x.type === "prepare_nudge" || x.type === "delete_everything"));
      assert.ok(a.actions.some((x) => x.type === "open_thing" && x.target_ids[0] === "T2"));
    },
  );
});

test("an aborted request throws instead of returning a stale fallback", async () => {
  const controller = new AbortController();
  await withModel(async (_u, init) => { controller.abort(); init.signal.throwIfAborted(); }, async () => {
    await assert.rejects(answerAssistantQuestion(facts, "which item is the riskiest for the launch?", [], controller.signal));
  });
});

test("longer substantive answers are kept up to the size limit", async () => {
  const long = "A".repeat(1500);
  await withModel(modelReply({ answer_markdown: long, confidence: "medium" }), async () => {
    const a = await answerAssistantQuestion(facts, "explain the workload across my team in detail", []);
    assert.equal(a.answer_markdown.length, 1500);
    assert.equal(a.confidence, "medium");
  });
  await withModel(modelReply({ answer_markdown: "B".repeat(5000) }), async () => {
    const a = await answerAssistantQuestion(facts, "explain the workload across my team in detail", []);
    assert.equal(a.answer_markdown.length, 2000);
  });
});

test("follow-ups after a turn use the model", async () => {
  await withModel(modelReply({ answer_markdown: "Because its due date passed." }), async (calls) => {
    const history = [{ role: "user", content: "what is overdue" }, { role: "assistant", content: "1 Thing" }];
    const a = await answerAssistantQuestion(facts, "why is that one late", history);
    assert.equal(calls(), 1);
    assert.match(a.answer_markdown, /due date passed/);
  });
});
