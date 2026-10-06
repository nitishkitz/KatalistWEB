import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h } from "react";
import { act } from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InteractionBlockerProvider } from "@/components/katalist/InteractionBlockerProvider";

/**
 * T09 independent-review fix: file processing and Toss are async and can
 * outlive a destination switch (Work<->Home, or a different List) that
 * happens on the SAME mounted MagicBox instance while they're in flight --
 * unlike scripts/magic-box-draft-and-destination.test.mjs (which only
 * covers unmount/remount for a different List), this exercises a
 * re-render with a changed `listId` prop while an operation is still
 * pending, which is the actual race the independent review flagged: a
 * slow upload or Toss started for the OLD destination resolving AFTER the
 * switch must not append a file to, or clear, the NEW destination's draft.
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

mock.module("@/features/context/use-app-context", {
  namedExports: { useAppContext: () => ({ context: "work", setContext: async () => {} }) },
});
mock.module("@/features/people/use-assignable", { namedExports: { useAssignablePeople: () => [] } });
mock.module("@/features/lists/use-lists", { namedExports: { useLists: () => ({ lists: [] }) } });
mock.module("@/features/buckets/use-buckets", { namedExports: { useBuckets: () => ({ buckets: [] }) } });
mock.module("@/lib/session-mode", { namedExports: { isPreviewMode: () => true, isPreviewSession: () => true } });

let resolveCreateThing;
mock.module("@/features/things/rpc", {
  namedExports: {
    rpcCreateThing: () =>
      new Promise((resolve) => {
        resolveCreateThing = resolve;
      }),
    rpcAddToBucket: async () => {},
  },
});

let resolveProcessFile;
mock.module("@/lib/file-utils", {
  namedExports: {
    getClipboardFiles: () => [],
    formatFileSize: () => "1 KB",
    processFileForUpload: () =>
      new Promise((resolve) => {
        resolveProcessFile = resolve;
      }),
  },
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

test("a file picked for the old destination does not get appended to a new destination's attachments once processing finishes", async () => {
  const qc = newClient();
  const { container, rerender, getByText, queryByText, getByLabelText } = render(
    h(Harness, { qc, listId: "list-a", listName: "List A" }),
  );

  const fileInput = container.querySelector('input[type="file"]');
  await act(async () => {
    fireEvent.change(fileInput, {
      target: { files: [new File(["x"], "for-list-a.txt", { type: "text/plain" })] },
    });
  });

  // Switch destination BEFORE the slow processFileForUpload resolves.
  rerender(h(Harness, { qc, listId: "list-b", listName: "List B" }));
  await act(async () => {});
  assert.ok(getByText("List B"), "must now show the new destination");

  // Now let the stale operation resolve.
  await act(async () => {
    resolveProcessFile({ id: "processed-1", name: "for-list-a.txt", type: "other", sizeLabel: "1 KB" });
    await new Promise((r) => setTimeout(r, 20));
  });

  assert.equal(
    queryByText("for-list-a.txt"),
    null,
    "a file processed for the OLD destination must not appear in the NEW destination's attachments",
  );

  cleanup();
  qc.clear();
});

test("a Toss that completes after the destination has switched does not clear the new destination's unsent draft", async () => {
  const qc = newClient();
  const { rerender, getByLabelText } = render(h(Harness, { qc, listId: "list-a", listName: "List A" }));

  const inputA = getByLabelText("Magic Box");
  await act(async () => {
    fireEvent.change(inputA, { target: { value: "toss for list A" } });
    fireEvent.keyDown(inputA, { key: "Enter" });
  });

  // Switch destination while the Toss RPC is still pending.
  rerender(h(Harness, { qc, listId: "list-b", listName: "List B" }));
  await act(async () => {});
  const inputB = getByLabelText("Magic Box");
  await act(async () => {
    fireEvent.change(inputB, { target: { value: "already typing into list B" } });
  });

  // Now let the stale Toss resolve.
  await act(async () => {
    resolveCreateThing({ id: "new-thing" });
    await new Promise((r) => setTimeout(r, 20));
  });

  assert.equal(
    getByLabelText("Magic Box").value,
    "already typing into list B",
    "a Toss started for the OLD destination must not wipe the NEW destination's in-progress draft once it resolves",
  );

  cleanup();
  qc.clear();
});
