import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createMagicBoxCorrectHandler, createMagicBoxCoeyHandler } from "@/features/ai/magic-box-api.server";
import { createMemoryAiBudget, createPersistentAiBudget } from "@/features/ai/ai-rate-limit.server";
import { correctionPreservesTokens, extractProtectedTokens } from "@/features/ai/protected-tokens";
import { correctMagicBoxText, transcribeMagicBoxAudio } from "@/features/ai/sarvam-client.server";

test("unauthorized correction makes zero Sarvam calls", async () => {
  let calls = 0;
  const handler = createMagicBoxCorrectHandler({
    getUser: async () => null,
    fetchImpl: async () => {
      calls += 1;
      return new Response("{}");
    },
  });
  const res = await handler(new Request("https://x/correct", { method: "POST", body: JSON.stringify({ text: "hello there friend" }) }));
  assert.equal(res.status, 401);
  assert.equal(calls, 0);
});

test("limit exhaustion returns 429 with Retry-After", async () => {
  const budget = createMemoryAiBudget(() => 1_000);
  for (let i = 0; i < 6; i++) await budget({ userId: "u1", operation: "correct" });
  const handler = createMagicBoxCorrectHandler({
    getUser: async () => ({ id: "u1" }),
    enforceBudget: budget,
    fetchImpl: async () => new Response("{}"),
  });
  const res = await handler(
    new Request("https://x/correct", {
      method: "POST",
      headers: { authorization: "Bearer tok", "content-type": "application/json" },
      body: JSON.stringify({ text: "please polish this sentence" }),
    }),
  );
  assert.equal(res.status, 429);
  assert.ok(res.headers.get("retry-after"));
});

test("protected tokens must survive correction exactly", () => {
  const source = 'Send @Rahul the brief.pdf for 3/5 at 4 PM https://katalist.app';
  assert.ok(extractProtectedTokens(source).includes("@Rahul"));
  assert.ok(correctionPreservesTokens(source, "Send @Rahul the brief.pdf for 3/5 at 4 PM https://katalist.app please"));
  assert.equal(correctionPreservesTokens(source, "Send @Someone the notes"), false);
  assert.equal(correctionPreservesTokens(source, source.replace("3/5", "March 5")), false);
  assert.equal(correctionPreservesTokens(source, source.replace("brief.pdf", "deck.docx")), false);
});

test("malformed Sarvam JSON degrades without leaking the API key", async () => {
  const result = await correctMagicBoxText({
    text: "please polish this sentence",
    env: { SARVAM_API_KEY: "sk_secret_do_not_leak" },
    fetchImpl: async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "not-json" } }] }), { status: 200 }),
  });
  assert.equal(result.correctedText, null);
  assert.equal(result.degraded, true);
  assert.equal(JSON.stringify(result).includes("sk_secret"), false);
});

test("Coey disabled spends zero Sarvam credits and still returns fallback copy", async () => {
  let calls = 0;
  const handler = createMagicBoxCoeyHandler({
    getUser: async () => ({ id: "u1" }),
    flags: { correction: true, coey: false, stt: true },
    fetchImpl: async () => {
      calls += 1;
      return new Response("{}");
    },
  });
  const res = await handler(
    new Request("https://x/coey", {
      method: "POST",
      headers: { authorization: "Bearer tok", "content-type": "application/json" },
      body: JSON.stringify({ event: "THING_TOSSED_SELF" }),
    }),
  );
  assert.equal(res.status, 200);
  assert.equal(calls, 0);
  const json = await res.json();
  assert.equal(json.degraded, true);
  assert.ok(json.text);
});

test("default handler invokes the database-aware budget function", async () => {
  const api = readFileSync(new URL("../src/features/ai/magic-box-api.server.ts", import.meta.url), "utf8");
  assert.match(api, /enforceAiBudget/);
  assert.match(api, /options\?\.enforceBudget \?\? enforceAiBudget/);
  assert.equal(api.includes("createMemoryAiBudget()"), false);

  let dbCalls = 0;
  let fallbackCalls = 0;
  const budget = createPersistentAiBudget({
    consumeFromDb: async (input) => {
      dbCalls += 1;
      assert.equal(input.operation, "correct");
      assert.equal(input.userId, "u1");
      return true;
    },
    fallback: async () => {
      fallbackCalls += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    },
  });
  const handler = createMagicBoxCorrectHandler({
    getUser: async () => ({ id: "u1" }),
    enforceBudget: budget,
    fetchImpl: async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '{"correctedText":"please polish this sentence now"}' } }] })),
  });
  await handler(
    new Request("https://x/correct", {
      method: "POST",
      headers: { authorization: "Bearer tok", "content-type": "application/json" },
      body: JSON.stringify({ text: "please polish this sentence" }),
    }),
  );
  assert.equal(dbCalls, 1);
  assert.equal(fallbackCalls, 0);
});

test("timeout aborts the provider fetch signal", async () => {
  let aborted = false;
  const result = await correctMagicBoxText({
    text: "please polish this sentence",
    env: { SARVAM_API_KEY: "sk_secret" },
    timeoutMs: 25,
    fetchImpl: (_url, init) =>
      new Promise((_, reject) => {
        const signal = init?.signal;
        if (!signal) {
          reject(new Error("missing signal"));
          return;
        }
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
        });
      }),
  });
  assert.equal(aborted, true);
  assert.equal(result.degraded, true);
  assert.equal(result.correctedText, null);
});

test("STT timeout aborts the provider fetch signal", async () => {
  let aborted = false;
  const result = await transcribeMagicBoxAudio({
    bytes: new Uint8Array([1, 2, 3, 4]),
    filename: "clip.webm",
    mimeType: "audio/webm",
    env: { SARVAM_API_KEY: "sk_secret" },
    timeoutMs: 25,
    fetchImpl: (_url, init) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
        });
      }),
  });
  assert.equal(aborted, true);
  assert.equal(result.degraded, true);
  assert.equal(result.text, null);
});

test("Sarvam client caps tokens, timeouts, json_object, and never uses a type assertion as validation", () => {
  const src = readFileSync(new URL("../src/features/ai/sarvam-client.server.ts", import.meta.url), "utf8");
  const assist = readFileSync(new URL("../src/features/court/magic-box/useSarvamAssist.ts", import.meta.url), "utf8");
  const sql = readFileSync(new URL("../supabase/migrations/20260824124500_magic_box_ai_rate_limits.sql", import.meta.url), "utf8");
  assert.match(src, /maxTokens: 160/);
  assert.match(src, /maxTokens: 48/);
  assert.match(src, /timeoutMs: input.timeoutMs \?\? 8000/);
  assert.match(src, /35_000/);
  assert.match(src, /controller.abort\(\)/);
  assert.match(src, /signal: controller.signal/);
  assert.match(src, /json_object/);
  assert.match(src, /reasoning_effort: null/);
  assert.match(src, /safeParse/);
  assert.equal(assist.includes("setTimeout"), false);
  assert.equal(assist.includes("MAGIC_BOX_AI_DEBOUNCE"), false);
  assert.match(assist, /requestCorrection/);
  assert.match(sql, /consume_magic_box_ai_budget/);
  assert.match(sql, /service_role/);
  assert.equal(/GRANT EXECUTE[\s\S]*TO authenticated/i.test(sql), false);
});
