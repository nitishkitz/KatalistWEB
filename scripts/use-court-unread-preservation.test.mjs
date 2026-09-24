import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h } from "react";
import { act } from "react";
import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * T05: useCourt() used to zero out a Thing's already-correctly-computed
 * unreadCommentCount whenever the viewer had EVER read that Thing before
 * (`lastRead > 0`), with no check on *when* relative to the comments the
 * server actually counted. That discarded genuinely new unread comments
 * that arrived after a Thing had once been read. The fix only zeroes the
 * count when the read happened at-or-after the data currently being
 * displayed was fetched (query.dataUpdatedAt) -- otherwise the server's own
 * count (already computed against this exact lastRead at fetch time) is
 * left alone.
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

mock.module("@/hooks/useSession", {
  namedExports: {
    useSession: () => ({ session: { user: { id: "profile-1", user_metadata: {} } }, user: { id: "profile-1" } }),
  },
});
mock.module("@/lib/session-mode", { namedExports: { isPreviewSession: () => false, isPreviewMode: () => false } });
mock.module("@/features/context/use-app-context", { namedExports: { useAppContext: () => ({ context: "work" }) } });
mock.module("@/features/demo/identities", {
  namedExports: { currentDemoActorId: () => "demo-actor", currentDemoPerson: () => ({ name: "Demo" }) },
});
mock.module("@/features/things/local-state", {
  namedExports: { accessibleDemoThings: () => [], getComments: () => [], getSnoozedIds: () => new Set() },
});
mock.module("@/features/things/use-local-version", { namedExports: { useLocalVersion: () => 0 } });
mock.module("@/features/things/personal-shred", {
  namedExports: {
    usePersonalShred: () => ({ thingIds: new Set(), listIds: new Set() }),
    excludePersonallyShreddedThings: (things) => things,
  },
});
mock.module("@/features/things/personal-snooze", {
  namedExports: {
    usePersonalSnooze: () => ({ until: new Map() }),
    excludeSnoozedThings: (things) => things,
  },
});

let courtThings = [];
mock.module("@/features/court/fetch-court", {
  namedExports: {
    fetchCourt: async () => ({ things: courtThings, myActorId: "actor-me" }),
  },
});

const { useCourt } = await import("@/features/court/use-court");
const { markThingAsRead } = await import("@/features/things/read-state");

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } },
  });
}

function Harness({ qc, onResult }) {
  const result = useCourt();
  onResult(result);
  return null;
}

async function renderCourt(qc) {
  let latest;
  render(h(QueryClientProvider, { client: qc }, h(Harness, { qc, onResult: (r) => (latest = r) })));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
  return () => latest;
}

function makeThing(id, unreadCommentCount) {
  const me = { id: "actor-me", name: "Me", initials: "ME" };
  return {
    id,
    unreadCommentCount,
    workStatus: "under_progress",
    acknowledgement: "caught",
    dueAt: null,
    assignee: me,
    owner: me,
    creator: me,
  };
}

test("a comment that arrives after a Thing was last read stays unread, even though the Thing has been read before", async () => {
  window.localStorage.clear();
  courtThings = [makeThing("thing-x", 1)];

  // Read the Thing well BEFORE this fetch happens.
  markThingAsRead("thing-x", "actor-me", Date.now() - 60_000);

  const qc = newClient();
  const getResult = await renderCourt(qc);

  const thing = getResult().all.find((t) => t.id === "thing-x");
  assert.ok(thing, "Thing must be present in the result");
  assert.equal(
    thing.unreadCommentCount,
    1,
    "a comment counted as unread by the server AFTER the last read must not be silently zeroed just because the Thing has been read before",
  );

  cleanup();
  qc.clear();
});

test("marking a Thing read after its data was fetched does optimistically zero the badge", async () => {
  window.localStorage.clear();
  courtThings = [makeThing("thing-y", 1)];

  const qc = newClient();
  const getResult = await renderCourt(qc);
  assert.equal(getResult().all.find((t) => t.id === "thing-y").unreadCommentCount, 1);

  // Now mark it read -- AFTER the fetch that produced this data.
  await act(async () => {
    markThingAsRead("thing-y", "actor-me");
    await new Promise((r) => setTimeout(r, 10));
  });

  assert.equal(
    getResult().all.find((t) => t.id === "thing-y").unreadCommentCount,
    0,
    "a read that happens after the currently-displayed fetch should still optimistically clear the badge",
  );

  cleanup();
  qc.clear();
});
