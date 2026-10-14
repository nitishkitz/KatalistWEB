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

mock.module("@/features/court/coey/use-coey-context", {
  namedExports: {
    useCoeyContext: () => ({ ready: false, error: null, viewer: null, candidates: [], calendar: { timezone: "Asia/Kolkata", workDays: [1, 2, 3, 4, 5, 6], workStart: 540, workEnd: 1110, offSaturdays: [], holidays: [], festivals: [], leave: [], homeStart: 420, homeEnd: 1320 }, holderCals: {}, dismissedCounts: {} }),
    recordDismissal: async () => {},
  },
});
mock.module("@/lib/authed-fetch", { namedExports: { authedFetch: async () => new Response("{}", { status: 503 }) } });
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

function Harness({ qc, listId, listName, onCaptureCommitted }) {
  return h(
    QueryClientProvider,
    { client: qc },
    h(InteractionBlockerProvider, null, h(MagicBox, { listId, listName, onCaptureCommitted })),
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
  assert.equal(getByLabelText("Magic Box").placeholder, "Toss into List B, or ask Coey…", "must now show the new destination");

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

test("a Toss completing in the same destination preserves text edited while it was pending", async () => {
  const qc = newClient();
  const { getByLabelText } = render(h(Harness, { qc, listId: "quality-same-destination", listName: "Quality" }));
  await act(async () => { fireEvent.change(getByLabelText("Magic Box"), { target: { value: "first capture" } }); });
  await act(async () => { fireEvent.keyDown(getByLabelText("Magic Box"), { key: "Enter" }); });
  await act(async () => { fireEvent.change(getByLabelText("Magic Box"), { target: { value: "next thought, do not erase" } }); });
  await act(async () => {
    resolveCreateThing({ id: "quality-created" });
    await new Promise(resolve => setTimeout(resolve, 30));
  });
  assert.equal(getByLabelText("Magic Box").value, "next thought, do not erase");
  cleanup();
  qc.clear();
});

test("onCaptureCommitted emits creation notice immediately upon commit for opted-in caller", async () => {
  const qc = newClient();
  let committedNotice = null;
  const { getByLabelText } = render(
    h(Harness, {
      qc,
      listId: "committed-test",
      listName: "Committed",
      onCaptureCommitted: (notice) => {
        committedNotice = notice;
      },
    }),
  );

  const input = getByLabelText("Magic Box");
  await act(async () => {
    fireEvent.change(input, { target: { value: "A new confirmed task" } });
    fireEvent.keyDown(input, { key: "Enter" });
  });

  await act(async () => {
    resolveCreateThing({ id: "confirmed-1" });
    await new Promise((r) => setTimeout(r, 30));
  });

  assert.ok(committedNotice, "onCaptureCommitted was invoked");
  assert.deepEqual(committedNotice.createdIds, ["confirmed-1"]);
  assert.equal(committedNotice.title, "A new confirmed task");

  cleanup();
  qc.clear();
});

test("an identity switch while a Toss is in flight prevents onCaptureCommitted from emitting (identity guard)", async () => {
  const qc = newClient();
  let committedNotice = null;
  const { getByLabelText } = render(
    h(Harness, {
      qc,
      listId: "identity-race-test",
      listName: "Identity Race",
      onCaptureCommitted: (notice) => {
        committedNotice = notice;
      },
    }),
  );

  const input = getByLabelText("Magic Box");
  await act(async () => {
    fireEvent.change(input, { target: { value: "Task started under user 1" } });
    fireEvent.keyDown(input, { key: "Enter" });
  });

  // Advance identity epoch while Toss RPC is in flight (simulate logout / switch)
  const { advanceIdentityEpoch } = await import("@/features/realtime/identity-cache-policy");
  advanceIdentityEpoch(qc, { kind: "live", profileId: "user-2" });

  await act(async () => {
    resolveCreateThing({ id: "stale-user-thing" });
    await new Promise((r) => setTimeout(r, 30));
  });

  assert.equal(committedNotice, null, "onCaptureCommitted must not emit for a stale identity epoch");

  cleanup();
  qc.clear();
});
