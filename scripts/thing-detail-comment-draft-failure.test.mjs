import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h } from "react";
import { act } from "react";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InteractionBlockerProvider } from "@/components/katalist/InteractionBlockerProvider";

/**
 * R-01 (independent review of E-03): submitComment() used to restore a
 * failed send's draft via a per-call `.mutate(vars, {onError})` callback.
 * React Query does not reliably invoke that per-call callback once the
 * observing component has unmounted (confirmed directly against a real
 * `useMutation`: a bare per-call onError never fired post-unmount, while
 * a hook-level `useMutation({onError})` did). The fix moved the restore
 * into use-thing-comments.ts's own hook-level mutation callbacks, which
 * survive the detail unmounting.
 *
 * This test uses the REAL useThingComments hook and a REAL useMutation
 * (only rpcComment/Supabase/identity are mocked at their own boundary),
 * so it actually exercises the mutation-observer lifecycle the previous
 * test file's fully-mocked `post.mutate` could not.
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let rpcCommentImpl = async () => {};

mock.module("@/hooks/useSession", {
  namedExports: {
    useSession: () => ({ session: { user: { id: "profile-1", user_metadata: {} } }, user: { id: "profile-1" } }),
  },
});
mock.module("@/lib/session-mode", { namedExports: { isPreviewSession: () => false, isPreviewMode: () => false } });
mock.module("@/features/demo/identities", {
  namedExports: { currentDemoPerson: () => ({ name: "Demo" }), currentDemoActorId: () => "demo-actor" },
});
mock.module("@/features/people/resolve-actors", { namedExports: { resolveActorPeople: async () => new Map() } });
mock.module("@/features/things/local-state", {
  namedExports: {
    addCommentLocal: () => {},
    getActivity: () => [],
    getComments: () => [],
    getBucketRefs: () => [],
  },
});
mock.module("@/features/things/use-local-version", { namedExports: { useLocalVersion: () => 0 } });
mock.module("@/features/things/rpc", {
  namedExports: {
    rpcComment: async (...args) => rpcCommentImpl(...args),
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
mock.module("@/integrations/supabase/client", {
  namedExports: {
    supabase: {
      from: () => {
        const node = {
          select: () => node,
          eq: () => node,
          order: async () => ({ data: [], error: null }),
        };
        return node;
      },
    },
  },
});
mock.module("@/features/court/use-court", { namedExports: { useCourt: () => ({ myActorId: "actor-me" }) } });
mock.module("@/features/things/use-thing", { namedExports: { useThing: () => ({ thing: null, isLoading: false }) } });
mock.module("@/features/people/use-assignable", { namedExports: { useAssignablePeople: () => [] } });
mock.module("@/features/people/directory", {
  namedExports: { useAvatarUrl: () => null, matchAvatarByName: () => null },
});
mock.module("@/features/buckets/use-buckets", {
  namedExports: { useBuckets: () => ({ buckets: [], preview: false }) },
});
mock.module("@/features/things/read-state", { namedExports: { markThingAsRead: () => {} } });
mock.module("@/lib/file-utils", {
  namedExports: { processFileForUpload: async (f) => ({ id: f.name, name: f.name, type: "other" }) },
});
mock.module("@/features/things/attachments", {
  namedExports: { uploadThingAttachment: async () => ({ id: "x", name: "x", type: "other" }) },
});
mock.module("@/features/things/query-updates", {
  namedExports: { withOptimisticPatch: (_qc, _id, _patch, fn) => fn },
});
mock.module("@/features/things/personal-shred", { namedExports: { invalidatePersonalSurfaces: async () => {} } });

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
  // gcTime: 0 must be set for BOTH queries and mutations -- they are
  // separate defaults. Mutations default to a 5-minute gcTime, which
  // schedules a real setTimeout that keeps the process alive well past
  // every assertion completing (confirmed directly with a minimal
  // reproduction using no React at all: building a bare mutation with
  // only `mutations: { retry: false }` hangs node --test; adding
  // `gcTime: 0` alongside it exits cleanly). Omitting this on any test
  // that calls a real mutation would hang the whole suite.
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } },
  });
}

function Harness({ qc, thingId }) {
  return h(
    QueryClientProvider,
    { client: qc },
    h(InteractionBlockerProvider, null,
      h(ThingDetailContent, { initialThing: thingId === "thing-a" ? makeThing("thing-a", "Thing A") : makeThing("thing-b", "Thing B") }),
    ),
  );
}

test("R-01: a failed send restores the draft when the detail is UNMOUNTED before the request settles", async () => {
  let rejectFn;
  rpcCommentImpl = () => new Promise((_resolve, reject) => { rejectFn = reject; });
  const qc = newClient();
  const { getByPlaceholderText, getByText, unmount } = render(h(Harness, { qc, thingId: "thing-a" }));

  // Query by placeholder ONCE, before submitting -- the placeholder text
  // itself changes to "Sending…" while the mutation is pending, so
  // re-querying by "Write a comment…" after submit would fail even
  // though the input element itself is still there. Keep the same node
  // reference for every subsequent `.value` check in this test.
  const input = getByPlaceholderText("Write a comment…");
  await act(async () => {
    fireEvent.change(input, { target: { value: "will fail after unmount" } });
  });
  await act(async () => {
    fireEvent.click(getByText("Post"));
  });
  assert.equal(input.value, "", "submit clears the live input optimistically");

  // Unmount the WHOLE detail (and the QueryClientProvider stays mounted --
  // only the component using the mutation goes away) before the request settles.
  unmount();

  await act(async () => {
    rejectFn(new Error("network down"));
    await new Promise((r) => setTimeout(r, 10));
  });

  // Reopen the same Thing: the hook-level onError must have restored the
  // draft into session-drafts.ts regardless of the earlier unmount.
  let getByPlaceholderText2;
  await act(async () => {
    ({ getByPlaceholderText: getByPlaceholderText2 } = render(h(Harness, { qc, thingId: "thing-a" })));
    await new Promise((r) => setTimeout(r, 10));
  });
  assert.equal(
    getByPlaceholderText2("Write a comment…").value,
    "will fail after unmount",
    "the draft must be recovered even though the failure arrived after the original detail had already unmounted",
  );

  cleanup();
  qc.clear();
});

test("R-01: a failed send still restores into the live input when the detail is still mounted on the same Thing", async () => {
  let rejectFn;
  rpcCommentImpl = () => new Promise((_resolve, reject) => { rejectFn = reject; });
  const qc = newClient();
  const { getByPlaceholderText, getByText } = render(h(Harness, { qc, thingId: "thing-a" }));

  const input = getByPlaceholderText("Write a comment…");
  await act(async () => {
    fireEvent.change(input, { target: { value: "will fail" } });
  });
  await act(async () => {
    fireEvent.click(getByText("Post"));
  });

  await act(async () => {
    rejectFn(new Error("network down"));
    await new Promise((r) => setTimeout(r, 10));
  });

  await waitFor(() => {
    assert.equal(getByPlaceholderText("Write a comment…").value, "will fail");
  });

  cleanup();
  qc.clear();
});

test("R-01: a send that fails AFTER switching to a different Thing does not leak into that Thing's live input, and is recovered on switching back", async () => {
  let rejectFn;
  rpcCommentImpl = () => new Promise((_resolve, reject) => { rejectFn = reject; });
  const qc = newClient();
  const { getByRole, getByText, rerender } = render(h(Harness, { qc, thingId: "thing-a" }));

  // Query by role, not placeholder -- useThingComments' `post` mutation
  // observer is shared/rebound across renders (confirmed directly:
  // switching the underlying thingId while a mutation is still pending
  // does not clear that mutation's own isPending), so the placeholder
  // stays "Sending…" (not "Write a comment…") on Thing B's own render
  // too, for as long as A's send is still in flight. The input element
  // itself is the same one regardless of its current placeholder text.
  const inputA = getByRole("textbox");
  await act(async () => {
    fireEvent.change(inputA, { target: { value: "A's message" } });
  });
  await act(async () => {
    fireEvent.click(getByText("Post"));
  });

  await act(async () => {
    rerender(h(Harness, { qc, thingId: "thing-b" }));
  });
  assert.equal(getByRole("textbox").value, "", "B's own draft, unrelated to A's in-flight send");

  await act(async () => {
    rejectFn(new Error("network down"));
    await new Promise((r) => setTimeout(r, 10));
  });

  assert.equal(
    getByRole("textbox").value,
    "",
    "B's live input must not be corrupted by A's failed send resolving while B is displayed",
  );

  await act(async () => {
    rerender(h(Harness, { qc, thingId: "thing-a" }));
  });
  assert.equal(
    getByRole("textbox").value,
    "A's message",
    "A's draft was restored in the background store and is recovered on return",
  );

  cleanup();
  qc.clear();
});

test("follow-up review of R-01: a failed send's rollback/invalidation targets the Thing it was submitted for, not whatever Thing is displayed when it settles", async () => {
  // Independent re-review finding: onError's rollback (`qc.setQueryData`)
  // and onSettled's invalidation both used the hook's outer `thingId`
  // closure -- which useMutation rebinds via setOptions() on every render,
  // same hazard R-01 already fixed for onError's draft-restore body -- so
  // a send that settles AFTER switching to a different Thing could roll
  // Thing A's own optimistic-comment rollback into Thing B's cache, and
  // invalidate/refetch B's query instead of A's.
  let rejectFn;
  rpcCommentImpl = () => new Promise((_resolve, reject) => { rejectFn = reject; });
  // staleTime: Infinity (unlike the shared newClient() helper) so seeding
  // both Things' caches BEFORE ever rendering sticks -- otherwise each
  // Thing's own real (mocked, empty) initial fetch would overwrite the
  // seeded data the instant it mounts, racing this test's own setup.
  // Queries deliberately do NOT use gcTime: 0 here (unlike newClient()) --
  // thing-b's seeded cache entry has no observer until the mid-test
  // switch, and gcTime: 0 would evict an unobserved entry near-instantly
  // (confirmed directly: it was garbage-collected during this test's own
  // earlier `await act()`/setTimeout ticks, before ever being read), well
  // before this test ever mounts a component that observes it. qc.clear()
  // at the end still releases everything regardless of gcTime.
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 60_000, staleTime: Infinity },
      mutations: { retry: false, gcTime: 0 },
    },
  });

  const thingAOriginal = [{ id: "a-existing", body: "A's real comment", author: "Someone", at: "2026-01-01T00:00:00Z" }];
  const thingBOriginal = [{ id: "b-existing", body: "B's real comment", author: "Someone", at: "2026-01-01T00:00:00Z" }];
  qc.setQueryData(["thing-comments", "thing-a"], thingAOriginal);
  qc.setQueryData(["thing-comments", "thing-b"], thingBOriginal);

  const invalidateCalls = [];
  const originalInvalidate = qc.invalidateQueries.bind(qc);
  qc.invalidateQueries = (opts) => {
    invalidateCalls.push(opts?.queryKey);
    return originalInvalidate(opts);
  };

  try {
    const { getByRole, getByText, rerender } = render(h(Harness, { qc, thingId: "thing-a" }));

    const inputA = getByRole("textbox");
    await act(async () => {
      fireEvent.change(inputA, { target: { value: "will fail after switching to B" } });
    });
    await act(async () => {
      fireEvent.click(getByText("Post"));
    });

    // Confirm the optimistic write actually landed on A's cache (proving
    // the setup is exercising the real code path, not a no-op).
    const thingAWhilePending = qc.getQueryData(["thing-comments", "thing-a"]);
    assert.equal(thingAWhilePending.length, 2, "A's cache now has the optimistic comment prepended");

    await act(async () => {
      rerender(h(Harness, { qc, thingId: "thing-b" }));
    });

    await act(async () => {
      rejectFn(new Error("network down"));
      await new Promise((r) => setTimeout(r, 10));
    });

    assert.deepEqual(
      qc.getQueryData(["thing-comments", "thing-b"]),
      thingBOriginal,
      "B's cache must be completely untouched by A's failed send settling while B is displayed",
    );
    assert.deepEqual(
      qc.getQueryData(["thing-comments", "thing-a"]),
      thingAOriginal,
      "A's own cache must be rolled back to its real (pre-optimistic) content, not left with the failed optimistic comment",
    );

    const commentInvalidations = invalidateCalls.filter(
      (key) => Array.isArray(key) && key[0] === "thing-comments",
    );
    assert.deepEqual(
      commentInvalidations,
      [["thing-comments", "thing-a"]],
      "onSettled must invalidate the Thing the mutation was actually submitted for (A), never the Thing merely displayed when it settles (B)",
    );
  } finally {
    // try/finally (unlike this file's other tests) because an assertion
    // failure here must not leave a mounted, uncleaned-up component behind
    // for the NEXT test to trip over (confirmed directly: without this, a
    // failure above left a stray "Thing B" instance mounted, which broke
    // the next test's own getByPlaceholderText query with "found multiple
    // elements").
    cleanup();
    qc.clear();
  }
});

test("R-01: a successful send clears the draft, and shows no restored text on reopen", async () => {
  rpcCommentImpl = async () => {};
  const qc = newClient();
  const { getByPlaceholderText, getByText, unmount } = render(h(Harness, { qc, thingId: "thing-a" }));

  const input = getByPlaceholderText("Write a comment…");
  await act(async () => {
    fireEvent.change(input, { target: { value: "will succeed" } });
  });
  await act(async () => {
    fireEvent.click(getByText("Post"));
    await new Promise((r) => setTimeout(r, 10));
  });

  unmount();
  const { getByPlaceholderText: reopened } = render(h(Harness, { qc, thingId: "thing-a" }));
  assert.equal(reopened("Write a comment…").value, "", "a successful send must not leave anything to restore");

  cleanup();
  qc.clear();
});
