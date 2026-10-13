import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h, act } from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InteractionBlockerProvider } from "@/components/katalist/InteractionBlockerProvider";

// Live composer path end to end in the DOM: interpretation (mocked Sarvam
// endpoint) → plan → clarification → explicit Toss → atomic create RPC.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const calendar = { timezone: "Asia/Kolkata", workDays: [1, 2, 3, 4, 5, 6], workStart: 540, workEnd: 1110, offSaturdays: [], holidays: [], festivals: [], leave: [], homeStart: 420, homeEnd: 1320 };
const candidates = [
  { profileId: "ravi", actorId: "a-ravi", name: "Ravi Kumar", connected: true },
  { profileId: "ravi2", actorId: "a-ravi2", name: "Ravi Teja", connected: true },
  { profileId: "priya", actorId: "a-priya", name: "Priya Shah", connected: true },
];
mock.module("@/features/context/use-app-context", { namedExports: { useAppContext: () => ({ context: "work", setContext: async () => {} }) } });
mock.module("@/features/lists/use-lists", { namedExports: { useLists: () => ({ lists: [] }) } });
mock.module("@/features/buckets/use-buckets", { namedExports: { useBuckets: () => ({ buckets: [] }) } });
mock.module("@/lib/session-mode", { namedExports: { isPreviewMode: () => false, isPreviewSession: () => false } });
mock.module("@/features/court/coey/use-coey-context", {
  namedExports: {
    useCoeyContext: () => ({ ready: true, error: null, viewer: { profileId: "me", actorId: "a-me", name: "Deva Rao" }, candidates, calendar, holderCals: {}, dismissedCounts: {} }),
    recordDismissal: async () => {},
  },
});
const rpcCalls = [];
mock.module("@/integrations/supabase/client", {
  namedExports: {
    supabase: {
      rpc: async (fn, args) => {
        rpcCalls.push({ fn, args });
        if (fn === "coey_create_things") return { data: { things: args.p_items.map((_, index) => ({ index, thing_id: `t-${rpcCalls.length}-${index}`, group_id: null })) }, error: null };
        return { data: null, error: null };
      },
      auth: { getSession: async () => ({ data: { session: null } }) },
    },
  },
});
mock.module("@/features/things/rpc", { namedExports: { rpcCreateThing: async () => ({ id: "x" }), rpcAddToBucket: async () => {}, isUuid: () => true } });
mock.module("@/features/thing-references/rpc", { namedExports: { rpcAddThingReferences: async () => {} } });
mock.module("@/features/court/MagicBoxAssistant", {
  namedExports: { MagicBoxAssistant: ({ question, onClose }) => h("section", { "aria-label": "Magic Box assistant" }, question, h("button", { onClick: onClose }, "Close assistant answer")) },
});

const thing = (over) => ({ kind: "task", action: "", participants: [], assign_shape: "none", action_time: null, event_time: null, recurrence: null, pace: null, pace_phrase: null, activity_type: null, mode: "work", waits_on: null, tone_harsh: false, addresses_group: false, question: null, confidence: 0.9, ...over });
const READINGS = {
  "Call Ravi about GST": [thing({ action: "Call Ravi about GST", participants: [{ mention: "Ravi", role: "mentioned" }] })],
  "Ravi send the price list": [thing({ action: "send the price list", participants: [{ mention: "Ravi", role: "doer" }], assign_shape: "single" })],
  "Whos on stale other than me": [thing({ kind: "question", question: { about_person: null, exclude_self: true, state: "stale", window: "any" } })],
  "Rohit get documnts": [thing({ action: "get documnts", participants: [] })],
};
let failNext = false;
mock.module("@/lib/authed-fetch", {
  namedExports: {
    authedFetch: async (_url, init) => {
      const body = JSON.parse(init.body);
      if (failNext) return new Response(JSON.stringify({ ok: false, schema_version: body.schema_version, request_id: body.request_id, draft_revision: body.draft_revision, reason: "timeout", latency_ms: 1200 }), { status: 200 });
      const things = READINGS[body.text];
      return new Response(JSON.stringify({ ok: true, schema_version: body.schema_version, request_id: body.request_id, draft_revision: body.draft_revision, latency_ms: 300, interpretation: { forwarded: false, gibberish: false, things } }), { status: 200 });
    },
  },
});

const { MagicBox } = await import("@/features/court/MagicBox");
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 520)); });
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
function mount() {
  const qc = newClient();
  const ui = render(h(QueryClientProvider, { client: qc }, h(InteractionBlockerProvider, null, h(MagicBox, {}))));
  return { ui, qc };
}
const type = (ui, value) => act(async () => fireEvent.change(ui.getByLabelText("Magic Box"), { target: { value } }));
const created = () => rpcCalls.filter((c) => c.fn === "coey_create_things");

test("a mentioned name stays with me: Call Ravi about GST is my own Thing in Next, and Ravi receives nothing", async () => {
  const { ui, qc } = mount();
  rpcCalls.length = 0;
  try {
    await type(ui, "Call Ravi about GST");
    await settle();
    assert.ok(ui.getByLabelText("What Coey understood").textContent.includes("You"));
    assert.ok(ui.getByRole("button", { name: /Lane next/i }));
    assert.equal(ui.queryByLabelText("Magic Box clarification"), null, "no blocking question");
    await act(async () => fireEvent.click(ui.getByRole("button", { name: "Toss Thing" })));
    await settle();
    const [call] = created();
    assert.equal(call.args.p_items.length, 1);
    assert.equal(call.args.p_items[0].holder_profile_id, undefined);
    assert.equal(call.args.p_items[0].title, "Call Ravi about GST");
    assert.equal(call.args.p_items[0].text_raw, "Call Ravi about GST");
    assert.match(call.args.p_items[0].rule_id, /^C5\+L8$/);
  } finally { cleanup(); qc.clear(); }
});

test("two Ravis: Coey asks with both names, Toss creates nothing until one is chosen, then it goes to that Ravi", async () => {
  const { ui, qc } = mount();
  rpcCalls.length = 0;
  try {
    await type(ui, "Ravi send the price list");
    await settle();
    const question = ui.getByLabelText("Magic Box clarification");
    assert.ok(question.textContent.includes("Which Ravi do you mean?"));
    assert.ok(question.textContent.includes("Ravi Kumar") && question.textContent.includes("Ravi Teja"));
    await act(async () => fireEvent.click(ui.getByRole("button", { name: "Toss Thing" })));
    await settle();
    assert.equal(created().length, 0, "send never guesses a recipient");
    await act(async () => fireEvent.click(ui.getByLabelText(/Ravi Teja/)));
    await act(async () => fireEvent.click(ui.getByRole("button", { name: "Continue" })));
    assert.equal(ui.queryByLabelText("Magic Box clarification"), null);
    await act(async () => fireEvent.click(ui.getByRole("button", { name: "Toss Thing" })));
    await settle();
    assert.equal(created().length, 1);
    assert.equal(created()[0].args.p_items[0].holder_profile_id, "ravi2");
  } finally { cleanup(); qc.clear(); }
});

test("a question typed in Toss mode opens Ask and creates nothing", async () => {
  const { ui, qc } = mount();
  rpcCalls.length = 0;
  try {
    await type(ui, "Whos on stale other than me");
    await settle();
    assert.ok(ui.getByLabelText("What Coey understood").textContent.includes("nothing is created"));
    await act(async () => fireEvent.keyDown(ui.getByLabelText("Magic Box"), { key: "Enter" }));
    await settle();
    assert.ok(ui.getByRole("region", { name: "Magic Box assistant" }).textContent.includes("Whos on stale other than me"));
    assert.equal(created().length, 0);
  } finally { cleanup(); qc.clear(); }
});

test("spelling is never rewritten; the microphone is not shown", async () => {
  const { ui, qc } = mount();
  rpcCalls.length = 0;
  try {
    await type(ui, "Rohit get documnts");
    fireEvent.blur(ui.getByLabelText("Magic Box"));
    assert.equal(ui.getByLabelText("Magic Box").value, "Rohit get documnts");
    await settle();
    assert.equal(ui.queryByRole("button", { name: /voice|microphone|mic/i }), null);
    await act(async () => fireEvent.click(ui.getByRole("button", { name: "Toss Thing" })));
    await settle();
    assert.equal(created()[0].args.p_items[0].text_raw, "Rohit get documnts");
    assert.equal(created()[0].args.p_items[0].title, "Get documnts");
  } finally { cleanup(); qc.clear(); }
});

test("when Coey can't read the line, the draft stays; Keep it to myself saves a private Inbox capture", async () => {
  const { ui, qc } = mount();
  rpcCalls.length = 0;
  failNext = true;
  try {
    await type(ui, "Call Ravi about GST");
    await settle();
    assert.ok(ui.getByRole("status").textContent.includes("Your text is safe"));
    await act(async () => fireEvent.click(ui.getByRole("button", { name: "Toss Thing" })));
    await settle();
    assert.equal(created().length, 0, "no silent fallback creates a Thing");
    assert.equal(ui.getByLabelText("Magic Box").value, "Call Ravi about GST");
    await act(async () => fireEvent.click(ui.getByRole("button", { name: "Keep it to myself" })));
    await settle();
    const item = created()[0].args.p_items[0];
    assert.equal(item.inbox_reason, "unresolved_capture");
    assert.equal(item.holder_profile_id, undefined);
  } finally { failNext = false; cleanup(); qc.clear(); }
});
