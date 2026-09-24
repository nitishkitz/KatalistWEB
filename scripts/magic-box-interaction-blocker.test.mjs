import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h } from "react";
import { act } from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InteractionBlockerProvider } from "@/components/katalist/InteractionBlockerProvider";
import { useInteractionBlocker } from "@/components/katalist/use-interaction-blocker";

/**
 * T03: MagicBox previously registered no interaction blocker at all --
 * unlike ThingDetailContent's own comment composer, a dirty (unsent)
 * capture in Magic Box, or a file still processing, could be silently
 * interrupted (e.g. by Morning Brief's auto-open) with no warning.
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

mock.module("@/features/context/use-app-context", {
  namedExports: { useAppContext: () => ({ context: "work" }) },
});
mock.module("@/features/people/use-assignable", {
  namedExports: { useAssignablePeople: () => [] },
});
mock.module("@/features/lists/use-lists", {
  namedExports: { useLists: () => ({ lists: [] }) },
});
mock.module("@/features/buckets/use-buckets", {
  namedExports: { useBuckets: () => ({ buckets: [] }) },
});
mock.module("@/lib/session-mode", {
  namedExports: { isPreviewMode: () => false, isPreviewSession: () => false },
});
mock.module("@/features/people/directory", {
  namedExports: { useAvatarUrl: () => null, matchAvatarByName: () => null },
});
mock.module("@/features/things/rpc", {
  namedExports: {
    rpcAddToBucket: async () => {},
    rpcCreateThing: async () => ({ id: "new-thing-1" }),
  },
});
mock.module("@/lib/file-utils", {
  namedExports: {
    processFileForUpload: () => new Promise(() => {}), // never resolves -- models a file still processing
  },
});

const { MagicBox } = await import("@/features/court/MagicBox");

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
}

function Probe({ onBlocked }) {
  const { isBlocked } = useInteractionBlocker();
  onBlocked(isBlocked);
  return null;
}

function Harness({ qc, onBlocked }) {
  return h(
    QueryClientProvider,
    { client: qc },
    h(InteractionBlockerProvider, null, h(Probe, { onBlocked }), h(MagicBox, {})),
  );
}

test("T03: typing unsent text into Magic Box registers the interaction blocker, and clears once emptied", async () => {
  const qc = newClient();
  let blocked = false;
  const { container } = render(h(Harness, { qc, onBlocked: (v) => (blocked = v) }));
  assert.equal(blocked, false, "not blocked before any input");

  const input = container.querySelector("input[type='text'], input:not([type])");
  await act(async () => {
    fireEvent.change(input, { target: { value: "call the vet" } });
  });
  assert.equal(blocked, true, "unsent Magic Box text must block Morning Brief's auto-open");

  await act(async () => {
    fireEvent.change(input, { target: { value: "" } });
  });
  assert.equal(blocked, false, "clearing the text releases the blocker");

  cleanup();
  qc.clear();
});

test("T03: a file still processing (not yet attached) also registers the interaction blocker", async () => {
  const qc = newClient();
  let blocked = false;
  const { container } = render(h(Harness, { qc, onBlocked: (v) => (blocked = v) }));

  const fileInput = container.querySelector('input[type="file"]');
  assert.ok(fileInput, "Magic Box must have a file input");
  await act(async () => {
    fireEvent.change(fileInput, { target: { files: [new File(["x"], "photo.png", { type: "image/png" })] } });
  });
  assert.equal(blocked, true, "a file still processing must block Morning Brief's auto-open, even before it's attached");

  cleanup();
  qc.clear();
});
