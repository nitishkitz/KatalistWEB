import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h } from "react";
import { act } from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InteractionBlockerProvider } from "@/components/katalist/InteractionBlockerProvider";

/** Drafts remain scoped to their List/context. Destination is communicated
 * by the placeholder; the user requested removal of the persistent row. */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

mock.module("@/features/context/use-app-context", {
  namedExports: { useAppContext: () => ({ context: "work", setContext: async () => {} }) },
});
mock.module("@/features/people/use-assignable", { namedExports: { useAssignablePeople: () => [] } });
mock.module("@/features/court/coey/use-coey-context", {
  namedExports: {
    useCoeyContext: () => ({ ready: false, error: null, viewer: null, candidates: [], calendar: { timezone: "Asia/Kolkata", workDays: [1, 2, 3, 4, 5, 6], workStart: 540, workEnd: 1110, offSaturdays: [], holidays: [], festivals: [], leave: [], homeStart: 420, homeEnd: 1320 }, holderCals: {}, dismissedCounts: {} }),
    recordDismissal: async () => {},
  },
});
mock.module("@/features/lists/use-lists", { namedExports: { useLists: () => ({ lists: [] }) } });
mock.module("@/features/buckets/use-buckets", { namedExports: { useBuckets: () => ({ buckets: [] }) } });
mock.module("@/lib/session-mode", { namedExports: { isPreviewMode: () => true, isPreviewSession: () => true } });
const createdThings = [];
mock.module("@/features/things/rpc", {
  namedExports: { rpcCreateThing: async (input) => { createdThings.push(input); return { id: "new-thing" }; }, rpcAddToBucket: async () => {} },
});
mock.module("@/features/court/MagicBoxAssistant", {
  namedExports: { MagicBoxAssistant: ({ question, onClose }) => h('section', { 'aria-label': 'Magic Box assistant' }, question, h('button', { onClick: onClose }, 'Close assistant answer')) },
});

const { MagicBox } = await import("@/features/court/MagicBox");

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } },
  });
}

function Harness({ qc, listId, listName }) {
  return h(
    QueryClientProvider,
    { client: qc },
    h(InteractionBlockerProvider, null, h(MagicBox, { listId, listName })),
  );
}

test("the composer keeps the destination in its placeholder without the removed destination text", async () => {
  const qc = newClient();
  const { getByLabelText, queryByText } = render(h(Harness, { qc, listName: "Website Launch" }));
  await act(async () => {});

  assert.equal(getByLabelText("Magic Box").placeholder, "Toss into Website Launch…");
  assert.equal(queryByText("Website Launch"), null);
  assert.equal(queryByText("work"), null);

  cleanup();
  qc.clear();
});

test("with no destination List, the composer omits the removed Court destination label", async () => {
  const qc = newClient();
  const { queryByText } = render(h(Harness, { qc }));
  await act(async () => {});

  assert.equal(queryByText("Court"), null);

  cleanup();
  qc.clear();
});

test("typed text survives unmount/remount of the same composer (session draft, not plain component state)", async () => {
  const qc = newClient();
  const first = render(h(Harness, { qc, listId: "list-1", listName: "Website Launch" }));
  const input = first.getByLabelText("Magic Box");

  await act(async () => {
    fireEvent.change(input, { target: { value: "Ship the release notes" } });
  });
  assert.equal(input.value, "Ship the release notes");

  first.unmount();

  const second = render(h(Harness, { qc, listId: "list-1", listName: "Website Launch" }));
  await act(async () => {});
  const restoredInput = second.getByLabelText("Magic Box");
  assert.equal(restoredInput.value, "Ship the release notes", "the draft must survive unmount/remount for the same List");

  cleanup();
  qc.clear();
});

test("a different destination List does not see another List's draft", async () => {
  const qc = newClient();
  const listA = render(h(Harness, { qc, listId: "list-a", listName: "List A" }));
  await act(async () => {
    fireEvent.change(listA.getByLabelText("Magic Box"), { target: { value: "Only for List A" } });
  });
  listA.unmount();

  const listB = render(h(Harness, { qc, listId: "list-b", listName: "List B" }));
  await act(async () => {});
  assert.equal(listB.getByLabelText("Magic Box").value, "", "a different List's composer must not inherit List A's draft");

  cleanup();
  qc.clear();
});

test('Magic Box supports multiline drafts and Shift+Enter never submits', async () => {
  const qc = newClient();
  const ui = render(h(Harness, { qc }));
  createdThings.length = 0;
  try {
    const box = ui.getByLabelText('Magic Box');
    assert.equal(box.tagName, 'TEXTAREA');
    await act(async () => fireEvent.change(box, { target: { value: 'Finish the release notes' } }));
    await act(async () => fireEvent.keyDown(box, { key: 'Enter', shiftKey: true }));
    assert.deepEqual(createdThings, []);
    await act(async () => fireEvent.change(box, { target: { value: 'Finish the release notes\nInclude the migration checklist' } }));
    assert.equal(box.value, 'Finish the release notes\nInclude the migration checklist');
    ui.unmount();
    const next = render(h(Harness, { qc }));
    assert.equal(next.getByLabelText('Magic Box').value, 'Finish the release notes\nInclude the migration checklist');
  } finally { cleanup(); qc.clear(); }
});
