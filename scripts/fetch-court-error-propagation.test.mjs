import assert from "node:assert/strict";
import { test, mock } from "node:test";

/**
 * Batch C1: the actor lookup in fetchCourt is not decorative — its
 * result (myActorId) drives partitionCourt()'s "mine" vs "theirs"
 * split. A failed lookup must reject, not silently resolve to null
 * (which would make both partitions look empty despite Things having
 * loaded fine — a false-empty state). A legitimate "this profile has
 * no actor row yet" is not an error, though, and must keep resolving
 * with myActorId: null — .maybeSingle() already distinguishes the two
 * cases (no matching row -> { data: null, error: null }; an actual
 * failure -> { data: null, error: <Error> }).
 */

let actorScenario = "ok"; // "ok" | "missing" | "error"

const chainableActor = () => {
  const node = {
    select: () => node,
    eq: () => node,
    maybeSingle: () => {
      if (actorScenario === "error") return Promise.resolve({ data: null, error: new Error("actors read failed") });
      if (actorScenario === "missing") return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: { id: "actor-1" }, error: null });
    },
  };
  return node;
};
const chainableThings = () => {
  const node = {
    select: () => node,
    eq: () => node,
    is: () => node,
    then: (resolve) => resolve({ data: [{ id: "t1" }], error: null }),
  };
  return node;
};

mock.module("@/integrations/supabase/client", {
  namedExports: {
    supabase: {
      from: (table) => (table === "actors" ? chainableActor() : chainableThings()),
    },
  },
});
mock.module("@/features/things/map-thing-rows", {
  namedExports: {
    mapDbThingRows: (rows) => Promise.resolve(rows.map((r) => ({ id: r.id, title: "mapped" }))),
    THING_COLUMNS: "id",
  },
});

const { fetchCourt } = await import("@/features/court/fetch-court");

test("fetchCourt rejects when the actor read fails, instead of silently emptying both Court partitions", async () => {
  actorScenario = "error";
  try {
    await assert.rejects(fetchCourt("work", "profile-1"), /actors read failed/);
  } finally {
    actorScenario = "ok";
  }
});

test("fetchCourt still resolves with myActorId: null when the profile legitimately has no actor row yet", async () => {
  actorScenario = "missing";
  try {
    const result = await fetchCourt("work", "profile-1");
    assert.equal(result.myActorId, null);
    assert.equal(result.things.length, 1);
  } finally {
    actorScenario = "ok";
  }
});

test("sanity: fetchCourt still succeeds when the actor read succeeds", async () => {
  const result = await fetchCourt("work", "profile-1");
  assert.equal(result.myActorId, "actor-1");
});
