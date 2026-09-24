import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h, useState } from "react";
import { act } from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InteractionBlockerProvider } from "@/components/katalist/InteractionBlockerProvider";
import { useInteractionBlocker } from "@/components/katalist/use-interaction-blocker";

/**
 * E-03 (audit): ThingDetailContent's comment/commentAttachments were plain
 * component state, reset only ad hoc (attachments on thing.id change,
 * text never at all) instead of a real per-Thing draft. This renders the
 * REAL component (not a source-string check) to prove:
 *  - a comment typed for one Thing is not visible when the SAME component
 *    instance is handed a different Thing (models CourtDetailModal, the
 *    one render site with no key={thing.id})
 *  - switching back to the first Thing restores its own draft
 *  - a failed send restores the draft, but a send that fails AFTER the
 *    user has already switched to a different Thing does not leak into
 *    that other Thing's live input
 *  - a nonempty draft registers the D03 interaction blocker
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Real useMutation's onError/onSuccess always fire asynchronously (at
// minimum a microtask later, after React has committed the synchronous
// setComment("")/setCommentAttachments([]) that submitComment() does
// before ever calling mutate()) -- never synchronously within the same
// call stack as mutate() itself. Matching that here matters: the fix's
// own "has anything touched this Thing's draft since submit" check reads
// the draft store, which is only updated by an effect that runs after
// the render commits -- a synchronous onError would read stale
// pre-commit state and see a false positive.
let postMutateImpl = (_vars, opts) => queueMicrotask(() => opts?.onSuccess?.());

mock.module("@/features/court/use-court", { namedExports: { useCourt: () => ({ myActorId: "actor-me" }) } });
mock.module("@/hooks/useSession", { namedExports: { useSession: () => ({ user: { id: "profile-1" } }) } });
mock.module("@/features/things/use-thing", { namedExports: { useThing: () => ({ thing: null, isLoading: false }) } });
mock.module("@/features/things/use-thing-comments", {
  namedExports: {
    useThingComments: () => ({
      comments: [],
      activity: [],
      post: {
        isPending: false,
        mutate: (vars, opts) => postMutateImpl(vars, opts),
      },
    }),
  },
});
mock.module("@/features/people/use-assignable", { namedExports: { useAssignablePeople: () => [] } });
mock.module("@/features/people/directory", {
  namedExports: { useAvatarUrl: () => null, matchAvatarByName: () => null },
});
mock.module("@/features/buckets/use-buckets", {
  namedExports: { useBuckets: () => ({ buckets: [], preview: false }) },
});
mock.module("@/features/things/local-state", { namedExports: { getBucketRefs: () => [] } });
mock.module("@/features/things/use-local-version", { namedExports: { useLocalVersion: () => 0 } });
mock.module("@/features/things/read-state", { namedExports: { markThingAsRead: () => {} } });
mock.module("@/lib/session-mode", { namedExports: { isPreviewMode: () => false } });
mock.module("@/lib/file-utils", { namedExports: { processFileForUpload: async (f) => ({ id: f.name, name: f.name, type: "other" }) } });
mock.module("@/features/things/attachments", { namedExports: { uploadThingAttachment: async () => ({ id: "x", name: "x", type: "other" }) } });
mock.module("@/features/things/query-updates", { namedExports: { withOptimisticPatch: (_qc, _id, _patch, fn) => fn } });
mock.module("@/features/things/personal-shred", { namedExports: { invalidatePersonalSurfaces: async () => {} } });
mock.module("@/features/things/rpc", {
  namedExports: {
    isUuid: () => true,
    rpcAddThingFile: async () => {},
    rpcAddToBucket: async () => {},
    rpcAssignOutsideKatalist: async () => ({ path: "/bridge/x" }),
    rpcCancelThing: async () => {},
    rpcCatchThing: async () => {},
    rpcCatchAndStart: async () => {},
    rpcNudgeThing: async () => {},
    rpcReopenThing: async () => {},
    rpcRemoveFromBucket: async () => {},
    rpcReassignThing: async () => {},
    rpcSetDue: async () => {},
    rpcSetPersonalPace: async () => {},
    rpcSetWorkStatus: async () => {},
    rpcShred: async () => {},
    rpcSortThing: async () => {},
  },
});

const { ThingDetailContent } = await import("@/features/things/ThingDetailContent");

function makeThing(id, title) {
  const me = { id: "actor-me", name: "Me", initials: "ME" };
  return {
    id,
    title,
    creator: me,
    owner: me,
    assignee: me,
    acknowledgement: "caught",
    workStatus: "under_progress",
    ownerImportance: "next",
    personalPace: "next",
    dueAt: null,
    dueHasTime: false,
    context: "work",
    listId: null,
    listName: null,
    cancelledAt: null,
    sortedAt: null,
    caughtAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

function Harness({ qc, initialId }) {
  const [thingId, setThingId] = useState(initialId);
  const { isBlocked } = useInteractionBlocker();
  return h(
    QueryClientProvider,
    { client: qc },
    h("div", null,
      h("button", { type: "button", "data-testid": "switch", onClick: () => setThingId((id) => (id === "thing-a" ? "thing-b" : "thing-a")) }),
      h("span", { "data-testid": "blocked" }, isBlocked ? "blocked" : "clear"),
      h(ThingDetailContent, { initialThing: thingId === "thing-a" ? makeThing("thing-a", "Thing A") : makeThing("thing-b", "Thing B") }),
    ),
  );
}

function renderHarness(qc, initialId = "thing-a") {
  return render(h(InteractionBlockerProvider, null, h(Harness, { qc, initialId })));
}

test("E-03: typing a comment for Thing A is not visible after switching (same instance) to Thing B, and is restored on switching back", async () => {
  postMutateImpl = () => {};
  const qc = newClient();
  const { getByPlaceholderText, getByTestId } = renderHarness(qc);

  const inputA = getByPlaceholderText("Write a comment…");
  await act(async () => {
    fireEvent.change(inputA, { target: { value: "hello from A" } });
  });
  assert.equal(inputA.value, "hello from A");

  await act(async () => {
    fireEvent.click(getByTestId("switch"));
  });
  const inputB = getByPlaceholderText("Write a comment…");
  assert.equal(inputB.value, "", "Thing B's own draft (empty) must show, not A's leftover text");

  await act(async () => {
    fireEvent.click(getByTestId("switch"));
  });
  const inputA2 = getByPlaceholderText("Write a comment…");
  assert.equal(inputA2.value, "hello from A", "switching back to A restores A's own draft");

  cleanup();
  qc.clear();
});

test("E-03: a nonempty draft registers the D03 interaction blocker, and clears once emptied", async () => {
  postMutateImpl = () => {};
  const qc = newClient();
  const { getByPlaceholderText, getByTestId } = renderHarness(qc);

  assert.equal(getByTestId("blocked").textContent, "clear");

  const input = getByPlaceholderText("Write a comment…");
  await act(async () => {
    fireEvent.change(input, { target: { value: "draft in progress" } });
  });
  assert.equal(getByTestId("blocked").textContent, "blocked");

  await act(async () => {
    fireEvent.change(input, { target: { value: "" } });
  });
  assert.equal(getByTestId("blocked").textContent, "clear");

  cleanup();
  qc.clear();
});

// R-01 (independent review): the failed-send draft-restore tests that
// used to live here were removed -- they exercised a fully mocked
// `useThingComments`/`post.mutate` that manually invoked `opts.onError`,
// which does not exercise real React Query mutation-observer lifecycle
// at all (per-call `.mutate(vars, {onError})` callbacks do not reliably
// fire once the observing component has unmounted, which a synchronous
// manual invocation can never expose). That behavior is now owned by
// use-thing-comments.ts's own hook-level mutation callbacks and is
// covered with a REAL useMutation/useThingComments in
// scripts/thing-detail-comment-draft-failure.test.mjs.
