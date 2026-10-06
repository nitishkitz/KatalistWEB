import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h } from "react";
import { act } from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InteractionBlockerProvider } from "@/components/katalist/InteractionBlockerProvider";

/**
 * T09/E05: a file that failed validation/processing (processFileForUpload
 * throwing) used to be silently dropped -- a toast, then gone, with no
 * visible chip and no way to retry without re-opening the OS file picker.
 * This verifies: the failed file gets its own visible chip (not silently
 * dropped), Retry re-runs processing on the SAME File and, on success,
 * moves it into the attached list, Remove discards it, and a successful
 * file is never affected by a sibling's failure.
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

let shouldFail = true;
mock.module("@/lib/file-utils", {
  namedExports: {
    getClipboardFiles: () => [],
    formatFileSize: () => "2 KB",
    processFileForUpload: async (file) => {
      if (shouldFail) throw new Error(`${file.name} could not be processed`);
      return { id: `processed-${file.name}`, name: file.name, type: "other", sizeLabel: "2 KB" };
    },
  },
});

const { MagicBox } = await import("@/features/court/MagicBox");

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } },
  });
}

function Harness({ qc }) {
  return h(QueryClientProvider, { client: qc }, h(InteractionBlockerProvider, null, h(MagicBox, null)));
}

function pickFile(container, name) {
  const fileInput = container.querySelector('input[type="file"]');
  const file = new File(["x"], name, { type: "text/plain" });
  fireEvent.change(fileInput, { target: { files: [file] } });
}

test("a file that fails processing gets its own visible chip instead of being silently dropped", async () => {
  shouldFail = true;
  const qc = newClient();
  const { container, getByText } = render(h(Harness, { qc }));

  await act(async () => {
    pickFile(container, "bad-file.txt");
    await new Promise((r) => setTimeout(r, 20));
  });

  assert.ok(getByText("bad-file.txt"), "the failed file must still show a chip");
  assert.ok(getByText("Failed"), "the chip must truthfully say it failed, not silently vanish");

  cleanup();
  qc.clear();
});

test("Retry re-runs processing on the same File and moves it into the attached list on success", async () => {
  shouldFail = true;
  const qc = newClient();
  const { container, getByLabelText, getByText, queryByText } = render(h(Harness, { qc }));

  await act(async () => {
    pickFile(container, "retry-me.txt");
    await new Promise((r) => setTimeout(r, 20));
  });
  assert.ok(getByText("Failed"));

  shouldFail = false;
  await act(async () => {
    fireEvent.click(getByLabelText("Retry retry-me.txt"));
    await new Promise((r) => setTimeout(r, 20));
  });

  assert.equal(queryByText("Failed"), null, "the failed chip must be gone after a successful retry");
  assert.ok(getByText("retry-me.txt"), "the file must now appear as a normal attached chip");

  cleanup();
  qc.clear();
});

test("Remove discards a failed file without needing a retry", async () => {
  shouldFail = true;
  const qc = newClient();
  const { container, getByLabelText, queryByText } = render(h(Harness, { qc }));

  await act(async () => {
    pickFile(container, "unwanted.txt");
    await new Promise((r) => setTimeout(r, 20));
  });

  await act(async () => {
    fireEvent.click(getByLabelText("Remove unwanted.txt"));
  });

  assert.equal(queryByText("unwanted.txt"), null);

  cleanup();
  qc.clear();
});

test("one file failing does not affect a sibling file that already succeeded", async () => {
  const qc = newClient();
  const { container, getByText } = render(h(Harness, { qc }));

  shouldFail = false;
  await act(async () => {
    pickFile(container, "good-file.txt");
    await new Promise((r) => setTimeout(r, 20));
  });
  assert.ok(getByText("good-file.txt"));

  shouldFail = true;
  await act(async () => {
    pickFile(container, "bad-file-2.txt");
    await new Promise((r) => setTimeout(r, 20));
  });

  // The first file must still be there, untouched by the second failing.
  assert.ok(getByText("good-file.txt"));
  assert.ok(getByText("bad-file-2.txt"));
  assert.ok(getByText("Failed"));

  cleanup();
  qc.clear();
});
