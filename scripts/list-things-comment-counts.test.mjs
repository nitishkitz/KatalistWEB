import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h } from "react";
import { act } from "react";
import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * T05: useListThings() (the real, non-preview List route) hand-rolled its
 * own Supabase select + mapping and never computed comment counts at all --
 * `commentCount`/`unreadCommentCount` were always `undefined` for a real
 * session, so the List route's own unread-comment badges never rendered.
 * It now reuses the same `mapDbThingRows` mapping Court uses, which does
 * compute (and viewer-scope) these counts.
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

mock.module("@/hooks/useSession", {
  namedExports: {
    useSession: () => ({ session: { user: { id: "profile-1", user_metadata: {} } }, user: { id: "profile-1" } }),
    getStoredDemoSession: () => null,
  },
});
mock.module("@/features/people/resolve-actors", {
  namedExports: { personOrSomeone: () => ({ id: "someone", name: "Someone", initials: "S" }), resolveActorPeople: async () => new Map() },
});
mock.module("@/lib/session-mode", { namedExports: { isPreviewSession: () => false } });
mock.module("@/features/things/local-state", {
  namedExports: { getListById: () => null, getMergedThings: () => [] },
});
mock.module("@/features/things/use-local-version", { namedExports: { useLocalVersion: () => 0 } });
mock.module("@/features/court/use-court", { namedExports: { useCourt: () => ({ myActorId: "actor-me" }) } });
mock.module("@/features/things/personal-shred", {
  namedExports: {
    usePersonalShred: () => ({ thingIds: new Set(), listIds: new Set() }),
    excludePersonallyShreddedThings: (things) => things,
    isPersonallyShreddedList: () => false,
  },
});

let mapDbThingRowsCalls = [];
mock.module("@/features/things/map-thing-rows", {
  namedExports: {
    THING_COLUMNS: "id,title",
    THING_OVERVIEW_COLUMNS: "id,title",
    mapDbThingRows: (rows, myActorId) => {
      mapDbThingRowsCalls.push({ rows, myActorId });
      return Promise.resolve(rows.map((r) => ({ id: r.id, title: "mapped", commentCount: 3, unreadCommentCount: 2 })));
    },
  },
});
mock.module("@/integrations/supabase/client", {
  namedExports: {
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({
            abortSignal: () => Promise.resolve({ data: [{ id: "thing-1" }], error: null }),
          }),
        }),
      }),
    },
  },
});

const { useListThings } = await import("@/features/lists/use-list-things");

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } },
  });
}

test("useListThings() reuses mapDbThingRows so real (non-preview) List things carry comment counts", async () => {
  let latest;
  function Probe() {
    latest = useListThings("list-1");
    return null;
  }

  const qc = newClient();
  render(h(QueryClientProvider, { client: qc }, h(Probe)));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });

  assert.equal(mapDbThingRowsCalls.length, 1, "the real-mode fetch must route through mapDbThingRows");
  assert.equal(mapDbThingRowsCalls[0].myActorId, "actor-me", "the viewer's actor id must be passed through for viewer-scoped unread comparisons");

  const thing = latest.things.find((t) => t.id === "thing-1");
  assert.ok(thing, "the fetched Thing must be present");
  assert.equal(thing.commentCount, 3, "comment counts must reach the List route's Thing objects");
  assert.equal(thing.unreadCommentCount, 2, "unread comment counts must reach the List route's Thing objects");

  cleanup();
  qc.clear();
});
