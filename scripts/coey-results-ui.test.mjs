import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h, act } from "react";
import { render, cleanup, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const calls = [];
let failCatch = false;
mock.module("@/features/things/rpc", {
  namedExports: {
    rpcCatchAndStart: async (id) => { calls.push(["catch", id]); if (failCatch) throw new Error("only the assignee can catch"); },
    rpcSortThing: async (id) => calls.push(["sort", id]),
    rpcNudgeThing: async (id, reason) => calls.push(["nudge", id, reason]),
    rpcUnsnoozeThing: async (id) => calls.push(["unsnooze", id]),
  },
});
const { CoeyResults } = await import("@/features/court/assistant/results/CoeyResults");

const rec = (id, over = {}) => ({ id, title: id, from: "Sudheer", holder: "You", relation: "in_your_court", lifecycle: "waiting_for_catch", lane: "now",
  due_at: null, promise_at: null, snoozed_until: null, follow_up: null, file_count: 0, actions: [{ kind: "catch", status: "available" }, { kind: "open", status: "available" }], ...over });
const presentation = {
  version: 1, scope: { mode: "work", label: "Work court" },
  summary: { heading: "5 Things in your court", description: "Start with the one due today." },
  blocks: [
    { type: "counts", items: [{ label: "in your court", count: 2 }, { label: "with others", count: 1 }, { label: "snoozed", count: 1 }] },
    { type: "thing_list", groups: [
      { key: "now", title: "Now", total: 1, records: [rec("Submit all the findings", { due_at: new Date(Date.now() + 3600_000).toISOString() })] },
      { key: "next", title: "Next", total: 1, records: [rec("Review this image", { lifecycle: "in_progress", lane: "next", file_count: 1, actions: [{ kind: "mark_sorted", status: "available" }, { kind: "open", status: "available" }] })] },
      { key: "with_others", title: "Waiting with others", total: 1, records: [rec("Please review the mobile figma", { from: "You", holder: "Sudheer", relation: "you_sent", lane: null,
        actions: [{ kind: "nudge", status: "unavailable", reason: "Too soon to nudge — it was sent or changed only a few hours ago." }, { kind: "open", status: "available" }] })] },
      { key: "snoozed", title: "Snoozed", total: 1, records: [rec("Get all the docs required", { from: "You", lane: null, snoozed_until: new Date(Date.now() + 3600_000).toISOString(), actions: [{ kind: "bring_back", status: "available" }, { kind: "open", status: "available" }] })] },
    ] },
  ],
  completeness: { status: "complete", matched_total: 4, displayed: 4 },
};
const mount = () => {
  const qc = new QueryClient();
  const opened = [];
  const ui = render(h(QueryClientProvider, { client: qc }, h(CoeyResults, { presentation, onOpenThing: (id) => opened.push(id) })));
  return { ui, qc, opened };
};
// The row loads its RPCs on first use; wait until the action has settled (no pending label).
const click = (el) => act(async () => {
  const li = el.closest("li");
  fireEvent.click(el);
  for (let i = 0; i < 200; i++) {
    await new Promise((r) => setTimeout(r, 10));
    if (!/…/.test(li.textContent) && (li.querySelector('[role="status"],[role="alert"]') || i > 150)) break;
  }
});
const row = (ui, title) => ui.getByRole("button", { name: title }).closest("li");

test("the results show the outcome, counts and grouped rows with their real states", () => {
  const { ui, qc } = mount();
  try {
    assert.ok(ui.getByRole("heading", { name: "5 Things in your court" }));
    assert.ok(ui.getByLabelText("Counts").textContent.includes("1 snoozed"));
    for (const g of ["Now · 1", "Next · 1", "Waiting with others · 1", "Snoozed · 1"]) assert.ok(ui.getByLabelText(g));
    assert.match(row(ui, "Submit all the findings").textContent, /From Sudheer·Waiting for Catch.*Due Today/);
    assert.match(row(ui, "Review this image").textContent, /In progress.*1 file/);
    assert.match(row(ui, "Get all the docs required").textContent, /Snoozed until/);
  } finally { cleanup(); qc.clear(); }
});

test("an unavailable Nudge is disabled and says why — the timing rule, not just “not caught”", async () => {
  const { ui, qc } = mount();
  try {
    const r = row(ui, "Please review the mobile figma");
    const nudge = within(r).getByRole("button", { name: /Nudge/ });
    assert.equal(nudge.disabled, true);
    assert.match(r.textContent, /Too soon to nudge — it was sent or changed only a few hours ago\./);
    await act(async () => fireEvent.click(nudge));
    assert.equal(calls.filter((c) => c[0] === "nudge").length, 0);
  } finally { cleanup(); qc.clear(); }
});

test("Catch → Mark Sorted only after the server accepts; Bring back unsnoozes (never catches); failures stay on the row", async () => {
  const { ui, qc, opened } = mount();
  calls.length = 0;
  try {
    const now = row(ui, "Submit all the findings");
    await click(within(now).getByRole("button", { name: "Catch" }));
    assert.deepEqual(calls.at(-1), ["catch", "Submit all the findings"]);
    assert.ok(within(row(ui, "Submit all the findings")).getByRole("button", { name: "Mark Sorted" }));
    assert.match(row(ui, "Submit all the findings").textContent, /In progress.*Caught\. It’s in progress now\./);
    const snoozed = row(ui, "Get all the docs required");
    await click(within(snoozed).getByRole("button", { name: "Bring back" }));
    assert.deepEqual(calls.at(-1), ["unsnooze", "Get all the docs required"]);
    assert.ok(!calls.some((c) => c[0] === "catch" && c[1] === "Get all the docs required"));
    assert.ok(within(row(ui, "Get all the docs required")).getByRole("button", { name: "Catch" }), "still waiting for catch after it comes back");
    await act(async () => fireEvent.click(within(row(ui, "Review this image")).getByRole("button", { name: "Open Thing" })));
    assert.deepEqual(opened, ["Review this image"]);
  } finally { cleanup(); qc.clear(); }
  failCatch = true;
  const second = mount();
  try {
    await click(within(row(second.ui, "Submit all the findings")).getByRole("button", { name: "Catch" }));
    assert.match(within(row(second.ui, "Submit all the findings")).getByRole("alert").textContent, /assignee/);
    assert.ok(within(row(second.ui, "Submit all the findings")).getByRole("button", { name: "Catch" }), "the row keeps its real state");
  } finally { failCatch = false; cleanup(); second.qc.clear(); }
});
