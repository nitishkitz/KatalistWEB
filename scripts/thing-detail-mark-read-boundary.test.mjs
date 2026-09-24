import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h } from "react";
import { act } from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InteractionBlockerProvider } from "@/components/katalist/InteractionBlockerProvider";

/**
 * T05: markThingAsRead() used to fire unconditionally the instant a Thing
 * opened -- regardless of which tab was showing (Comments vs Activity) or
 * whether comments had actually loaded -- anchored to wall-clock now().
 * That could mark a comment "read" that the viewer never actually looked
 * at (e.g. opening straight to the Activity tab, or before the Comments
 * page finishes loading). Now ThingDetailContent only marks read once its
 * own Comments tab is selected AND has successfully loaded, anchored to
 * the latest LOADED comment's own timestamp.
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Already shaped like the REAL fetchThingCommentsPage's own resolved
// ThingComment output (id/body/author/authorActorId/at/avatarUrl), not raw
// DB rows -- mocking this module wholesale bypasses the real function's
// own name-resolution/body-parsing, so the mock must supply what it would
// have produced.
let commentRows = [];

mock.module("@/hooks/useSession", {
  namedExports: {
    useSession: () => ({ session: { user: { id: "profile-1", user_metadata: {} } }, user: { id: "profile-1" } }),
  },
});
mock.module("@/lib/session-mode", { namedExports: { isPreviewSession: () => false, isPreviewMode: () => false } });
mock.module("@/features/demo/identities", {
  namedExports: { currentDemoPerson: () => ({ name: "Demo" }), currentDemoActorId: () => "demo-actor", demoDirectory: () => [] },
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
    rpcComment: async () => {},
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
mock.module("@/features/things/fetch-thing-history", {
  namedExports: {
    fetchThingCommentsPage: async () => ({ rows: commentRows, nextCursor: null }),
    fetchThingActivityPage: async () => ({ rows: [], nextCursor: null }),
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
mock.module("@/integrations/supabase/client", {
  namedExports: {
    supabase: {
      from: () => {
        const node = { select: () => node, eq: () => node, is: () => node, update: () => node, then: (resolve) => resolve({ data: null, error: null }) };
        return node;
      },
    },
  },
});

const { ThingDetailContent } = await import("@/features/things/ThingDetailContent");
const { getThingLastReadAt } = await import("@/features/things/read-state");

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
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } },
  });
}

function Harness({ qc, thingId }) {
  return h(
    QueryClientProvider,
    { client: qc },
    h(InteractionBlockerProvider, null, h(ThingDetailContent, { initialThing: makeThing(thingId, `Thing ${thingId}`) })),
  );
}

test("T05: opening a Thing on the Comments tab (the default) with loaded comments marks read, anchored to the latest comment's own timestamp", async () => {
  const latestAt = "2026-01-01T12:00:00.000Z";
  commentRows = [
    { id: "c1", body: "first", author: "Someone", authorActorId: "actor-other", at: "2026-01-01T10:00:00.000Z" },
    { id: "c2", body: "second", author: "Someone", authorActorId: "actor-other", at: latestAt },
  ];
  const qc = newClient();
  render(h(Harness, { qc, thingId: "thing-a" }));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });

  const lastRead = getThingLastReadAt("thing-a", "actor-me");
  assert.equal(lastRead, new Date(latestAt).getTime(), "must be anchored to the latest LOADED comment's own timestamp, not wall-clock now");

  cleanup();
  qc.clear();
});

test("T05: opening a Thing on the Activity tab does NOT mark comments as read", async () => {
  commentRows = [{ id: "c1", body: "unseen", author: "Someone", authorActorId: "actor-other", at: "2026-01-01T10:00:00.000Z" }];
  const qc = newClient();
  const { getByText } = render(h(Harness, { qc, thingId: "thing-b" }));

  await act(async () => {
    fireEvent.click(getByText("activity"));
    await new Promise((r) => setTimeout(r, 50));
  });

  assert.equal(
    getThingLastReadAt("thing-b", "actor-me"),
    0,
    "viewing the Activity tab must not mark the Comments boundary as read -- the viewer never looked at the comment",
  );

  cleanup();
  qc.clear();
});
