import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test, mock } from "node:test";
import { createElement as h, act } from "react";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Each request gets a controllable SSE body so tests decide exactly when events arrive.
let streams = [];
const enc = new TextEncoder();
const frame = (turnId, seq, event) =>
  enc.encode(`event: ${event.type}\ndata: ${JSON.stringify({ turnId, seq, ...event })}\n\n`);
function openStream(question) {
  let controller;
  const body = new ReadableStream({ start: (c) => (controller = c) });
  const entry = { question, controller, seq: 0, turnId: `turn-${streams.length + 1}` };
  entry.send = (event) => controller.enqueue(frame(entry.turnId, ++entry.seq, event));
  entry.close = () => controller.close();
  entry.response = new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  streams.push(entry);
  return entry;
}
const answerOf = (text, intent = "scope_summary") => ({
  intent, answer_markdown: text, citations: [], actions: [], freshness: { timezone: "UTC", is_partial: false },
});

mock.module("@/hooks/useSession", { namedExports: { useSession: () => ({ user: { id: "viewer" } }) } });
mock.module("@/features/lists/use-lists", { namedExports: { useLists: () => ({ lists: [] }) } });
mock.module("@/features/people/directory", { namedExports: { useAvatarUrl: () => null, matchAvatarByName: () => null } });
mock.module("@/integrations/supabase/proxy", { namedExports: { toProxiedUrl: (url) => url } });
mock.module("sonner", { namedExports: { toast: { success() {}, warning() {}, error() {} } } });
mock.module("@/features/court/assistant/AssistantAnswerGroups", {
  defaultExport: ({ groups, onOpenThing }) => h('div', null, ...groups.map((group) =>
    h('section', { key: group.key }, h('h3', null, group.title), ...group.thing_ids.map((id) =>
      h('button', { key: id, onClick: () => onOpenThing(id) }, `Open ${id}`),
    )),
  )),
});
let pending = null;
mock.module("@/lib/authed-fetch", {
  namedExports: {
    authedFetch: async (url, init) => {
      const body = JSON.parse(init.body);
      const entry = pending ? pending(body) : openStream(body.question);
      return entry.response;
    },
  },
});
const { MagicBoxAssistant } = await import("@/features/court/MagicBoxAssistant");

function setup(question = "whats up today", props = {}) {
  streams = [];
  pending = null;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const base = { question, requestKey: 1, context: "work", onOpenThing() {}, onAsk() {}, onClose() {}, ...props };
  const ui = render(h(QueryClientProvider, { client: qc }, h(MagicBoxAssistant, base)));
  const rerender = (next) =>
    ui.rerender(h(QueryClientProvider, { client: qc }, h(MagicBoxAssistant, { ...base, ...next })));
  return { ui, qc, rerender };
}
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

test("status labels follow real server events and disappear on the answer", async () => {
  const { ui, qc } = setup();
  try {
    await waitFor(() => assert.equal(streams.length, 1));
    const s = streams[0];
    assert.equal(ui.queryByText("Checking your Court"), null, "nothing is claimed before the server says so");
    await act(async () => { s.send({ type: "accepted" }); });
    assert.equal(ui.queryByText("Checking your Court"), null);
    await act(async () => { s.send({ type: "status", stage: "reading_facts", text: "Checking your Court" }); });
    await ui.findByText("Checking your Court");
    assert.equal(ui.queryByText("Asking the language model"), null, "a fast turn never claims a model call");
    await act(async () => {
      s.send({ type: "answer", answer: answerOf("Today: 1 overdue."), facts: { scope: null, things: [], nudge_recommendations: [] } });
      s.send({ type: "completed" });
      s.close();
    });
    await ui.findByText("Today: 1 overdue.");
    assert.equal(ui.queryByText("Checking your Court"), null);
  } finally { cleanup(); qc.clear(); }
});

test("an instant greeting shows no preamble at all", async () => {
  const { ui, qc } = setup("hi");
  try {
    await waitFor(() => assert.equal(streams.length, 1));
    const s = streams[0];
    await act(async () => {
      s.send({ type: "accepted" });
      s.send({ type: "answer", answer: answerOf("Hi. What would you like to look at in your Court?", "clarification"), facts: { scope: null, things: [], nudge_recommendations: [] } });
      s.send({ type: "completed" });
      s.close();
    });
    await ui.findByText(/^Hi\. What would you like/);
    assert.equal(ui.queryByText(/Checking|Connecting|Asking/), null);
  } finally { cleanup(); qc.clear(); }
});

test("a late answer from an earlier question never replaces the current one", async () => {
  const { ui, qc, rerender } = setup("What is overdue?");
  try {
    await waitFor(() => assert.equal(streams.length, 1));
    const first = streams[0];
    await act(async () => { first.send({ type: "accepted" }); });
    rerender({ question: "Who needs a nudge?", requestKey: 2 });
    await waitFor(() => assert.equal(streams.length, 2));
    const second = streams[1];
    await act(async () => {
      second.send({ type: "accepted" });
      second.send({ type: "answer", answer: answerOf("SECOND"), facts: { scope: null, things: [], nudge_recommendations: [] } });
      second.send({ type: "completed" });
      second.close();
    });
    await ui.findByText("SECOND");
    // The first stream answers after it was superseded.
    await act(async () => {
      try {
        first.send({ type: "answer", answer: answerOf("STALE"), facts: { scope: null, things: [], nudge_recommendations: [] } });
        first.send({ type: "completed" });
        first.close();
      } catch { /* the request was aborted, which is the intended outcome */ }
    });
    await tick();
    assert.equal(ui.queryByText("STALE"), null);
    assert.ok(ui.getByText("SECOND"));
  } finally { cleanup(); qc.clear(); }
});

test("switching context cancels the turn and ignores its late answer", async () => {
  const { ui, qc, rerender } = setup("What is overdue?");
  try {
    await waitFor(() => assert.equal(streams.length, 1));
    const work = streams[0];
    await act(async () => { work.send({ type: "accepted" }); });
    rerender({ context: "home" });
    await waitFor(() => assert.equal(streams.length, 2));
    assert.equal(streams[1].question, "What is overdue?");
    await act(async () => {
      try { work.send({ type: "answer", answer: answerOf("WORK DATA"), facts: { scope: null, things: [], nudge_recommendations: [] } }); work.send({ type: "completed" }); work.close(); } catch { /* aborted */ }
    });
    await tick();
    assert.equal(ui.queryByText("WORK DATA"), null);
  } finally { cleanup(); qc.clear(); }
});

test("the answer is never rewritten by a timer and the panel does not poll", async () => {
  assert.doesNotMatch(readFileSync(new URL("../src/features/court/MagicBoxAssistant.tsx", import.meta.url), "utf8"), /refetchInterval/);
  const { ui, qc } = setup();
  try {
    await waitFor(() => assert.equal(streams.length, 1));
    const s = streams[0];
    await act(async () => {
      s.send({ type: "accepted" });
      s.send({ type: "answer", answer: answerOf("STABLE"), facts: { scope: null, things: [], nudge_recommendations: [] } });
      s.send({ type: "completed" });
      s.close();
    });
    await ui.findByText("STABLE");
    await tick(); await tick();
    assert.equal(streams.length, 1, "no background refetch");
  } finally { cleanup(); qc.clear(); }
});

test("suggested questions stay disabled until the turn is terminal", async () => {
  const { ui, qc } = setup("blah", {});
  try {
    await waitFor(() => assert.equal(streams.length, 1));
    const s = streams[0];
    await act(async () => {
      s.send({ type: "accepted" });
      s.send({ type: "answer", answer: answerOf("Out of scope.", "unsupported"), facts: { scope: null, things: [], nudge_recommendations: [] } });
    });
    const chip = await ui.findByRole("button", { name: "Who needs a nudge?" });
    assert.equal(chip.disabled, true, "disabled until final validation");
    await act(async () => { s.send({ type: "completed" }); s.close(); });
    await waitFor(() => assert.equal(ui.getByRole("button", { name: "Who needs a nudge?" }).disabled, false));
  } finally { cleanup(); qc.clear(); }
});

test("a stream that ends without a terminal event is reported, not silently accepted", async () => {
  const { ui, qc } = setup();
  try {
    await waitFor(() => assert.equal(streams.length, 1));
    const s = streams[0];
    await act(async () => { s.send({ type: "accepted" }); s.close(); });
    const alert = await ui.findByRole("alert");
    assert.match(alert.textContent, /closed before the answer finished/);
    // Try again starts a fresh turn.
    fireEvent.click(ui.getByRole("button", { name: "Try again" }));
    await waitFor(() => assert.equal(streams.length, 2));
  } finally { cleanup(); qc.clear(); }
});

test("a server error event shows its message and no answer", async () => {
  const { ui, qc } = setup();
  try {
    await waitFor(() => assert.equal(streams.length, 1));
    const s = streams[0];
    await act(async () => { s.send({ type: "accepted" }); s.send({ type: "error", code: "x", message: "Katalist took too long to read your data." }); s.close(); });
    assert.match((await ui.findByRole("alert")).textContent, /took too long/);
  } finally { cleanup(); qc.clear(); }
});

test('person results open the selected Thing and omit generic question chips', async () => {
  const opened = [];
  const { ui, qc } = setup('who is stale and show their assigned Things', { onOpenThing: (id) => opened.push(id) });
  try {
    await waitFor(() => assert.equal(streams.length, 1));
    const s = streams[0];
    await act(async () => {
      s.send({ type: 'accepted' });
      s.send({ type: 'answer', answer: { ...answerOf('Their assigned Things are below.', 'stale_items'), groups: [
        { key: 'person:a', title: 'Ajjju', thing_ids: ['t1', 't2'], total: 2 },
        { key: 'person:b', title: 'Narayana', thing_ids: ['t3'], total: 1 },
      ] }, facts: { scope: null, things: [], nudge_recommendations: [] } });
      s.send({ type: 'completed' }); s.close();
    });
    fireEvent.click(await ui.findByRole('button', { name: 'Open t3' }));
    assert.deepEqual(opened, ['t3']);
    assert.equal(ui.queryByRole('group', { name: 'Suggested questions' }), null);
    assert.equal(ui.queryByText(/Partial result:/), null);
  } finally { cleanup(); qc.clear(); }
});

test('activity window and limits stay behind a single keyboard-operable details disclosure', async () => {
  const { ui, qc } = setup('What changed yesterday?');
  try {
    await waitFor(() => assert.equal(streams.length, 1));
    const s = streams[0];
    await act(async () => {
      s.send({ type: 'accepted' });
      s.send({ type: 'answer', answer: {
        ...answerOf('60 recorded changes yesterday.', 'recent_activity'),
        freshness: { timezone: 'Asia/Kolkata', is_partial: true, partial_reason: 'Only the latest 60 activity events were included.' },
        sources: [{ kind: 'activity', label: 'Activity, yesterday (Oct 11 to Oct 12, Asia/Kolkata)', count: 60 }],
      }, facts: { scope: null, things: [], nudge_recommendations: [] } });
      s.send({ type: 'completed' }); s.close();
    });
    await ui.findByText('Answer details · limited data');
    const details = ui.container.querySelector('details');
    assert.equal(details.open, false);
    assert.ok(details.querySelector('div').textContent.includes('Only the latest 60'));
    assert.equal(ui.queryByText(/Partial result:/), null);
    assert.equal(ui.queryByRole('group', { name: 'Suggested questions' }), null);
    details.querySelector('summary').focus();
    assert.equal(document.activeElement, details.querySelector('summary'));
    fireEvent.click(details.querySelector('summary'));
    assert.equal(details.open, true);
  } finally { cleanup(); qc.clear(); }
});

test('unchanged Court refetches do not show a change warning, but changed data does', async () => {
  const { ui, qc } = setup('What is overdue?');
  try {
    qc.setQueryData(['court', 'viewer'], { things: [{ id: 't1', title: 'Original' }] });
    await waitFor(() => assert.equal(streams.length, 1));
    const s = streams[0];
    await act(async () => {
      s.send({ type: 'accepted' });
      s.send({ type: 'answer', answer: answerOf('One overdue Thing.'), facts: { scope: null, things: [], nudge_recommendations: [] } });
      s.send({ type: 'completed' }); s.close();
    });
    await ui.findByText('One overdue Thing.');
    await tick();
    await act(async () => qc.setQueryData(['court', 'viewer'], { things: [{ id: 't1', title: 'Original', assignee: { avatarUrl: '/new-signed-avatar.png' } }] }));
    assert.equal(ui.queryByText('Court changed since this answer.'), null);
    await tick();
    await act(async () => qc.setQueryData(['court', 'viewer'], { things: [{ id: 't1', title: 'Changed' }] }));
    await ui.findByText('Court changed since this answer.');
  } finally { cleanup(); qc.clear(); }
});

test('a person confirmation sends the selected actor and then opens only the returned Thing', async () => {
  const opened=[];
  const {ui,qc,rerender}=setup("show me narayana's things",{onOpenThing:id=>opened.push(id)});
  try{
    await waitFor(()=>assert.equal(streams.length,1));
    const first=streams[0];
    await act(async()=>{
      first.send({type:'accepted'});
      first.send({type:'answer',answer:{...answerOf('Do you mean Narayana Kammari?','person_selection_required'),person_candidates:[{actor_id:'narayana-id',display_name:'Narayana Kammari'}],groups:[]},facts:{scope:null,things:[],nudge_recommendations:[]}});
      first.send({type:'completed'});first.close();
    });
    const requests=[];
    pending=body=>{requests.push(body);return openStream(body.question);};
    fireEvent.click(await ui.findByRole('button',{name:'Yes, Narayana Kammari'}));
    await waitFor(()=>assert.equal(streams.length,2));
    assert.equal(requests[0].personChoice,'narayana-id');
    const second=streams[1];
    await act(async()=>{
      second.send({type:'accepted'});
      second.send({type:'answer',answer:{...answerOf('Narayana has 2 active Things.','person_items'),groups:[{key:'person:narayana-id',title:'Narayana Kammari',thing_ids:['n1','n2'],total:2}]},facts:{scope:null,things:[],nudge_recommendations:[]}});
      second.send({type:'completed'});second.close();
    });
    fireEvent.click(await ui.findByRole('button',{name:'Open n2'}));
    assert.deepEqual(opened,['n2']);
    assert.equal(ui.queryByRole('group',{name:'Suggested questions'}),null);
    rerender({question:"show me ajjju's things",requestKey:2});
    await waitFor(()=>assert.equal(streams.length,3));
    assert.equal(requests[1].personChoice,undefined,'a previous person choice must not leak into a new question');
  }finally{cleanup();qc.clear();}
});
