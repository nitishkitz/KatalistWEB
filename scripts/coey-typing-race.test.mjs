// Regression for review finding 4: pressing Toss before the typing pause must not cancel its own request.
import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { act } from "react";
import { renderHook, cleanup } from "@testing-library/react";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let calls = 0;
mock.module("@/lib/authed-fetch", { namedExports: { authedFetch: async (_url, init) => {
  calls++;
  const body = JSON.parse(init.body);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, 650);
    init.signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("aborted")); }, { once: true });
  });
  return new Response(JSON.stringify({ ok: true, schema_version: body.schema_version, request_id: body.request_id, draft_revision: body.draft_revision, latency_ms: 650, interpretation: { things: [], gibberish: false, forwarded: false } }));
} } });
const { useCoeyInterpretation } = await import("@/features/court/coey/use-coey-interpretation");

test("Send right after typing gets the reading it awaited, with one request", async () => {
  const { result } = renderHook(() => useCoeyInterpretation("Call the bank", "work", true));
  let send;
  await act(async () => { send = result.current.resolveNow(); });
  let outcome;
  await act(async () => { outcome = await send; });
  await act(async () => { await new Promise((r) => setTimeout(r, 800)); });
  assert.equal(outcome.status, "ready");
  assert.equal(calls, 1);
  assert.equal(result.current.state.status, "ready");
  cleanup();
});
