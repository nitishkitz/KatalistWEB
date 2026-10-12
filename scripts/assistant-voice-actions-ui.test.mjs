import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h, act } from "react";
import { render, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let calls = [];
let confirmGate = null;
let confirmResponse = () => Response.json({ results: [{ id: "T1", title: "Line chart", state: "applied" }] });
let previewExpiresInMs = 5 * 60_000;
let streamAnswer;
const tick = (ms = 20) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

mock.module("@/hooks/useSession", { namedExports: { useSession: () => ({ user: { id: "viewer" } }) } });
mock.module("@/features/lists/use-lists", { namedExports: { useLists: () => ({ lists: [] }) } });
mock.module("@/features/people/directory", { namedExports: { useAvatarUrl: () => null, matchAvatarByName: () => null } });
mock.module("@/integrations/supabase/proxy", { namedExports: { toProxiedUrl: (url) => url } });
mock.module("sonner", { namedExports: { toast: { success() {}, warning() {}, error() {} } } });
mock.module("@/lib/authed-fetch", {
  namedExports: {
    authedFetch: async (url, init) => {
      calls.push(url.replace("/api/assistant/", ""));
      if (url.endsWith("/action/preview"))
        return Response.json({
          ok: true,
          action: { label: "Set status to In progress for 1 Thing", reason: "", targetIds: ["T1"], expiresAt: new Date(Date.now() + previewExpiresInMs).toISOString() },
          targets: [{ id: "T1", title: "Line chart", state: "ready" }],
          token: "signed-token",
        });
      if (url.endsWith("/action/confirm")) {
        if (confirmGate) await confirmGate;
        return confirmResponse();
      }
      return Response.json({ message: "unexpected" }, { status: 500 });
    },
  },
});
const { MagicBoxAssistant } = await import("@/features/court/MagicBoxAssistant");

const write = { id: "set_status-0-T1", type: "set_status", label: "Review status change for 1 Thing", requires_confirmation: true, target_ids: ["T1"], params: { status: "under_progress" } };
const openAction = { id: "open-T1", type: "open_thing", label: "Open Line chart", requires_confirmation: false, target_ids: ["T1"] };
const nudge = { id: "nudge-a1", type: "prepare_nudge", label: "Prepare nudge for Ajju", requires_confirmation: true, target_ids: ["T1"], params: { actorId: "a1" } };
const answerWith = (actions) => ({
  intent: "scope_summary", answer_markdown: "Here is what I found.", citations: [], actions,
  freshness: { timezone: "UTC", is_partial: false },
});
const voiceTurn = (actions, turnId = "t1") => ({
  turnId, lastSeq: 3, status: null, draft: "", answer: answerWith(actions),
  facts: { scope: null, things: [], nudge_recommendations: [] }, proposedActionIds: [], terminal: "completed", error: null,
});

function setup(actions, extra = {}) {
  calls = []; confirmGate = null; previewExpiresInMs = 5 * 60_000;
  confirmResponse = () => Response.json({ results: [{ id: "T1", title: "Line chart", state: "applied" }] });
  const spoken = [], hints = [], opened = [];
  const voice = {
    active: true, phase: "listening", sessionId: "s1", transcript: null, turn: voiceTurn(actions),
    speak: (t) => spoken.push(t), setHint: (x) => hints.push(x), error: null, ...extra,
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const props = { question: "mark the line chart as in progress", requestKey: 1, context: "work", onOpenThing: (id) => opened.push(id), onAsk() {}, onClose() {}, voiceTurnId: "t1" };
  const el = (v, p = {}) => h(QueryClientProvider, { client: qc }, h(MagicBoxAssistant, { ...props, voice: v, ...p }));
  const ui = render(el(voice));
  const say = async (text, turnId) => {
    voice.transcript = { turnId, text };
    await act(async () => { ui.rerender(el({ ...voice })); });
  };
  return { ui, voice, spoken, hints, opened, say, qc, el };
}
const lastHint = (hints) => hints.at(-1);

test("a spoken write is previewed first, read back, and only a spoken yes confirms it exactly once", async () => {
  const { spoken, hints, say, qc } = setup([write]);
  try {
    await waitFor(() => assert.equal(spoken.length, 1));
    assert.match(spoken[0], /Set status to In progress for 1 Thing\. Thing: Line chart\. Say yes to confirm or no to cancel\./);
    assert.deepEqual(calls, ["action/preview"], "nothing is confirmed by the readback");
    await waitFor(() => assert.equal(lastHint(hints).awaitingConfirmation, true));
    let release; confirmGate = new Promise((r) => (release = r));
    await say("yes", "t2");
    await waitFor(() => assert.ok(calls.includes("action/confirm")));
    assert.equal(spoken.length, 1, "no result is spoken before the server answers");
    await say("yes", "t3"); // a second yes while the first is in flight
    release();
    await waitFor(() => assert.equal(spoken.length, 2));
    assert.equal(spoken[1], "Done. 1 Thing updated.");
    assert.equal(calls.filter((c) => c === "action/confirm").length, 1, "double confirm reaches the server once");
  } finally { cleanup(); qc.clear(); }
});

test("a generic yes with no spoken proposal never confirms anything", async () => {
  const { spoken, say, qc } = setup([openAction]);
  try {
    await tick();
    await say("yes", "t2");
    await tick();
    assert.ok(!calls.includes("action/confirm") && !calls.includes("action/preview"));
    assert.equal(spoken.length, 0);
  } finally { cleanup(); qc.clear(); }
});

test("yes after the proposal expires is refused and nothing changes", async () => {
  const s = setup([write]);
  previewExpiresInMs = 60;
  try {
    await waitFor(() => assert.equal(s.spoken.length, 1), { timeout: 2000 });
    await tick(120);
    await s.say("yes", "t2");
    await waitFor(() => assert.match(s.spoken.at(-1), /expired/));
    assert.ok(!calls.includes("action/confirm"));
  } finally { cleanup(); s.qc.clear(); }
});

test("a rejected confirm (changed target or no permission) is spoken as a failure, never as success", async () => {
  const { spoken, say, qc } = setup([write]);
  try {
    await waitFor(() => assert.equal(spoken.length, 1));
    confirmResponse = () => Response.json({ message: "This Thing changed since the preview." }, { status: 409 });
    await say("yes", "t2");
    await waitFor(() => assert.equal(spoken.length, 2));
    assert.match(spoken[1], /^That did not work\. This Thing changed since the preview/);
    assert.doesNotMatch(spoken.join(" "), /Done/);
  } finally { cleanup(); qc.clear(); }
});

test("partial success is spoken as partial", async () => {
  const { spoken, say, qc } = setup([write]);
  try {
    await waitFor(() => assert.equal(spoken.length, 1));
    confirmResponse = () => Response.json({ results: [{ id: "T1", title: "A", state: "applied" }, { id: "T2", title: "B", state: "rejected", message: "No permission" }] });
    await say("yes", "t2");
    await waitFor(() => assert.equal(spoken.length, 2));
    assert.equal(spoken[1], "Done for 1, but 1 could not be changed.");
  } finally { cleanup(); qc.clear(); }
});

test("no cancels without touching the server; a Work to Home switch retires the proposal", async () => {
  const a = setup([write]);
  try {
    await waitFor(() => assert.equal(a.spoken.length, 1));
    await a.say("no", "t2");
    await waitFor(() => assert.match(a.spoken.at(-1), /Cancelled/));
    assert.ok(!calls.includes("action/confirm"));
  } finally { cleanup(); a.qc.clear(); }
  const b = setup([write]);
  try {
    await waitFor(() => assert.equal(b.spoken.length, 1));
    await act(async () => { b.ui.rerender(b.el({ ...b.voice }, { context: "home", requestKey: 2 })); });
    await waitFor(() => assert.equal(lastHint(b.hints).awaitingConfirmation, false));
    await b.say("yes", "t2");
    await tick();
    assert.ok(!calls.includes("action/confirm"), "yes after a context switch cannot confirm the old proposal");
  } finally { cleanup(); b.qc.clear(); }
});

test("open it dispatches the single visible read-only target immediately, without a preview", async () => {
  const { opened, hints, say, qc } = setup([openAction]);
  try {
    await waitFor(() => assert.equal(lastHint(hints).openTarget, true));
    await say("open it", "t2");
    assert.deepEqual(opened, ["T1"]);
    assert.deepEqual(calls, []);
  } finally { cleanup(); qc.clear(); }
});

test("a spoken nudge proposal is left to the on-screen confirmation: no preview or confirm is called", async () => {
  const { spoken, say, qc } = setup([nudge]);
  try {
    await waitFor(() => assert.equal(spoken.length, 1));
    assert.match(spoken[0], /confirm it there\. Nothing is sent until you do/);
    await say("yes", "t2");
    await tick();
    assert.deepEqual(calls, [], "no action endpoint is called, and no nudge can be sent by voice");
  } finally { cleanup(); qc.clear(); }
});

test("with several write proposals nothing is auto-prepared", async () => {
  const second = { ...write, id: "set_due-1-T2", type: "set_due", target_ids: ["T2"], params: { dueAt: "2026-10-20T00:00:00.000Z" } };
  const { spoken, qc } = setup([write, second]);
  try {
    await waitFor(() => assert.equal(spoken.length, 1));
    assert.match(spoken[0], /several changes/);
    assert.deepEqual(calls, []);
  } finally { cleanup(); qc.clear(); }
});
