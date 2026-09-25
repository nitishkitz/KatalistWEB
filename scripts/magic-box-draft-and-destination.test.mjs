import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h } from "react";
import { act } from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InteractionBlockerProvider } from "@/components/katalist/InteractionBlockerProvider";

/**
 * T09/E05: Magic Box previously (a) never showed the destination List or
 * Work/Home context anywhere persistent -- only as a placeholder that
 * vanished once typing started -- and (b) never used the scoped
 * session-draft mechanism at all, so typed text/attachments were plain
 * component state lost on unmount (e.g. navigating away from a List and
 * back). Both are fixed: a persistent destination row, and a real
 * getDraft/setDraft/clearDraft write-through keyed by (List, or Work/Home
 * context when there's no List).
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

mock.module("@/features/context/use-app-context", {
  namedExports: { useAppContext: () => ({ context: "work", setContext: async () => {} }) },
});
mock.module("@/features/people/use-assignable", { namedExports: { useAssignablePeople: () => [] } });
mock.module("@/features/lists/use-lists", { namedExports: { useLists: () => ({ lists: [] }) } });
mock.module("@/features/buckets/use-buckets", { namedExports: { useBuckets: () => ({ buckets: [] }) } });
mock.module("@/lib/session-mode", { namedExports: { isPreviewMode: () => true, isPreviewSession: () => true } });
mock.module("@/features/things/rpc", {
  namedExports: { rpcCreateThing: async () => ({ id: "new-thing" }), rpcAddToBucket: async () => {} },
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

test("the composer shows a persistent destination row naming the List and Work/Home context, not just a placeholder", async () => {
  const qc = newClient();
  const { getByText } = render(h(Harness, { qc, listName: "Website Launch" }));
  await act(async () => {});

  assert.ok(getByText("Website Launch"), "destination List name must be shown persistently");
  assert.ok(getByText("work"), "Work/Home context must be shown persistently");

  cleanup();
  qc.clear();
});

test("with no destination List, the composer names the destination as Court", async () => {
  const qc = newClient();
  const { getByText } = render(h(Harness, { qc }));
  await act(async () => {});

  assert.ok(getByText("Court"));

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
