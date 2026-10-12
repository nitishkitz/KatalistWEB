import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h } from "react";
import { act } from "react";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";

/**
 * Ask-panel rows: the visible state must come from the server. A tap shows a
 * pending label; the row changes only after the RPC resolves AND the refetched
 * data arrives; a refusal leaves the row as it was with the server's message.
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const calls = [];
let settle;
const pendingRpc = (name) => (id) => {
  calls.push([name, id]);
  return new Promise((resolve, reject) => {
    settle = { resolve, reject };
  });
};
mock.module("@/features/things/rpc", {
  namedExports: {
    rpcCatchAndStart: pendingRpc("catch"),
    rpcSortThing: pendingRpc("sort"),
    rpcNudgeThing: pendingRpc("nudge"),
    rpcSnoozeThing: pendingRpc("snooze"),
  },
});
mock.module("@/features/people/directory", {
  namedExports: {
    useAvatarUrl: (_name, _email, explicit) => explicit ?? null,
    matchAvatarByName: () => null,
    useProfileDirectory: () => [],
    matchProfile: () => undefined,
  },
});

// PersonAvatar reads Vite env for its image proxy; render the same src plainly.
mock.module("@/components/katalist/PersonAvatar", {
  namedExports: { PersonAvatar: ({ name, src }) => (src ? h("img", { src, alt: name }) : h("span", null, name.slice(0, 1))) },
});

const { AssistantThingRow } = await import("../src/features/court/assistant/AssistantThingRow.tsx");
const { useAssistantRowActions } = await import("../src/features/court/assistant/use-assistant-row-actions.ts");

const ME = "me-actor";
const OTHER = "other-actor";
const person = (id, name) => ({ id, name, initials: name.slice(0, 1), avatarUrl: `https://example.test/${id}.png` });
const baseThing = (extra = {}) => ({
  id: "t1", title: "Review the deck", assignee: person(ME, "Nithesh"), owner: person(OTHER, "Ajjju"),
  acknowledgement: "waiting_for_catch", workStatus: "not_started", dueAt: null, dueHasTime: false, ...extra,
});

function Harness({ server, nudge = { allowed: true, loading: false } }) {
  const { data } = useQuery({ queryKey: ["court"], queryFn: async () => ({ ...server.current }) });
  const actions = useAssistantRowActions();
  if (!data) return null;
  return h("ul", null, h(AssistantThingRow, {
    thing: data, myActorId: ME, nudge, pending: actions.pending[data.id], error: actions.errors[data.id],
    onRun: (kind, snooze) => void actions.run(data, kind, snooze), onOpen: () => {},
  }));
}

const clients = [];
function mount(server, nudge) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(qc);
  return render(h(QueryClientProvider, { client: qc }, h(Harness, { server, nudge })));
}

test("Catch: pending until the server confirms, then the refetched data shows Mark Sorted", async () => {
  calls.length = 0;
  const server = { current: baseThing() };
  const view = mount(server);
  await view.findByRole("button", { name: "Catch" });
  fireEvent.click(view.getByRole("button", { name: "Catch" }));
  await view.findByText("Catching…");
  assert.equal(view.queryByRole("button", { name: "Mark Sorted" }), null, "no optimistic change");
  assert.deepEqual(calls, [["catch", "t1"]]);
  server.current = baseThing({ acknowledgement: "caught", workStatus: "under_progress" });
  await act(async () => settle.resolve(null));
  await view.findByRole("button", { name: "Mark Sorted" });
  assert.equal(view.queryByText("Catching…"), null);
  cleanup(); clients.splice(0).forEach((c) => c.clear());
});

test("a server refusal keeps the row unchanged and shows the server's message", async () => {
  const server = { current: baseThing({ acknowledgement: "caught", workStatus: "under_progress" }) };
  const view = mount(server);
  fireEvent.click(await view.findByRole("button", { name: "Mark Sorted" }));
  await view.findByText("Sorting…");
  await act(async () => settle.reject(new Error("only the current assignee can mark this Sorted")));
  const alert = await view.findByRole("alert");
  assert.match(alert.textContent, /current assignee/);
  assert.ok(view.getByRole("button", { name: "Mark Sorted" }), "row stays as the server last reported it");
  cleanup(); clients.splice(0).forEach((c) => c.clear());
});

test("a second tap while pending does not send a second request", async () => {
  calls.length = 0;
  const server = { current: baseThing() };
  const view = mount(server);
  fireEvent.click(await view.findByRole("button", { name: "Catch" }));
  await view.findByText("Catching…");
  assert.equal(view.queryByRole("button", { name: "Catch" }), null, "button replaced by pending label");
  assert.equal(calls.length, 1);
  await act(async () => settle.resolve(null));
  cleanup(); clients.splice(0).forEach((c) => c.clear());
});

test("primary control follows the Court's capability rules and server nudge state", async () => {
  const owned = { assignee: person(OTHER, "Ajjju"), owner: person(ME, "Nithesh") };
  let view = mount({ current: baseThing(owned) });
  assert.ok(await view.findByRole("button", { name: /Nudge/ }));
  cleanup(); clients.splice(0).forEach((c) => c.clear());
  view = mount({ current: baseThing(owned) }, { allowed: true, loading: false, lastNudgedAt: new Date(Date.now() - 14 * 60_000).toISOString() });
  await view.findByText("Nudged 14m ago");
  assert.equal(view.queryByRole("button", { name: /^Nudge$/ }), null);
  cleanup(); clients.splice(0).forEach((c) => c.clear());
  view = mount({ current: baseThing(owned) }, { allowed: false, loading: false });
  assert.equal((await view.findByRole("button", { name: /Nudge/ })).disabled, true, "server says not nudgeable");
  cleanup(); clients.splice(0).forEach((c) => c.clear());
  view = mount({ current: baseThing({ workStatus: "sorted", acknowledgement: "caught" }) });
  await view.findByText("Review the deck");
  assert.equal(view.queryByRole("button", { name: /Catch|Mark Sorted|Nudge/ }), null, "terminal: no primary action");
  cleanup(); clients.splice(0).forEach((c) => c.clear());
});

test("rows show the assignee's avatar and an overdue due date", async () => {
  const view = mount({ current: baseThing({ dueAt: "2026-10-01T09:00:00Z" }) });
  await view.findByText("Review the deck");
  await waitFor(() => assert.ok(view.container.querySelector("img[src='https://example.test/me-actor.png']")));
  assert.match(view.container.textContent, /You·Due Oct 1 · Overdue/);
  cleanup(); clients.splice(0).forEach((c) => c.clear());
});
