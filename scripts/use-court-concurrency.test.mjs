import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { QueryClient } from "@tanstack/react-query";

/**
 * Batch C1: fetchCourt used to call supabase.auth.getUser() to get the
 * current user's id — even though useCourt() already has it from
 * useSession() — then used that id to look up the actor row, then only
 * *after* that resolved, queried Things (which doesn't need the actor id
 * at all; it only needs `context`). Now: no redundant getUser() call
 * (the profile id is passed in), and the actor lookup and the things
 * query run concurrently. Same deterministic event-order approach as
 * scripts/map-thing-rows-concurrency.test.mjs, for the same reason (a
 * wall-clock threshold is flaky and was the wrong tool here too).
 */

const DELAY_MS = 5;

function delay(value) {
  return new Promise((resolve) => setTimeout(() => resolve(value), DELAY_MS));
}

function makeTracker() {
  const events = [];
  return {
    events,
    track: (name, promiseFactory) => {
      events.push(`${name}:start`);
      return promiseFactory().then((value) => {
        events.push(`${name}:end`);
        return value;
      });
    },
  };
}

test("fetchCourt runs the actor lookup and the Things query concurrently, without calling auth.getUser()", async () => {
  const { events, track } = makeTracker();

  const mapMock = mock.module("@/features/things/map-thing-rows", {
    namedExports: {
      mapDbThingRows: (rows) => Promise.resolve(rows.map((r) => ({ id: r.id, title: "mapped" }))),
      THING_COLUMNS: "id",
      THING_OVERVIEW_COLUMNS: "id",
    },
  });

  const chainableActor = () => {
    const node = {
      select: () => node,
      eq: () => node,
      maybeSingle: () => track("actor-lookup", () => delay({ data: { id: "actor-1" }, error: null })),
    };
    return node;
  };
  const chainableThings = () => {
    const node = {
      select: () => node,
      eq: () => node,
      is: () => node,
      abortSignal: () => node,
      then: (resolve) => {
        track("things-query", () => delay({ data: [{ id: "t1" }], error: null })).then(resolve);
      },
    };
    return node;
  };
  let getUserCalled = false;
  const clientMock = mock.module("@/integrations/supabase/client", {
    namedExports: {
      supabase: {
        auth: {
          getUser: () => {
            getUserCalled = true;
            return Promise.resolve({ data: { user: { id: "profile-1" } } });
          },
        },
        from: (table) => (table === "actors" ? chainableActor() : chainableThings()),
      },
    },
  });

  try {
    const { fetchCourt } = await import("@/features/court/fetch-court");
    const qc = new QueryClient();
    const result = await fetchCourt("work", "profile-1", qc);

    assert.equal(getUserCalled, false, "fetchCourt must not call supabase.auth.getUser() — the caller already has the profile id");

    // Deterministic concurrency proof: both lookups start before either
    // finishes.
    const firstEndIndex = events.findIndex((e) => e.endsWith(":end"));
    const startedBeforeAnyEnd = new Set(events.slice(0, firstEndIndex).filter((e) => e.endsWith(":start")));
    assert.deepEqual(
      startedBeforeAnyEnd,
      new Set(["actor-lookup:start", "things-query:start"]),
      `expected the actor lookup and Things query to start before either resolved; event order was: ${events.join(", ")}`,
    );

    assert.equal(result.myActorId, "actor-1");
    assert.deepEqual(result.things, [{ id: "t1", title: "mapped" }]);
  } finally {
    mapMock.restore();
    clientMock.restore();
  }
});
