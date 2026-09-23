import assert from "node:assert/strict";
import { test, mock } from "node:test";

/**
 * Batch C1: fetchBuckets' Things query and Lists query both depend only
 * on bucket_items' output, not on each other, but previously awaited
 * things-then-lists sequentially; same for their two mapper calls
 * (mapDbThingRows / mapDbListRows), which each only need their own rows.
 * Same deterministic event-order approach as the other C1 tests in this
 * directory — a wall-clock threshold would be flaky and was the wrong
 * tool for proving concurrency in the earlier version of this batch.
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

test("fetchBuckets runs the Things/Lists queries concurrently, and their mappers concurrently", async () => {
  const { events, track } = makeTracker();

  const mapThingsMock = mock.module("@/features/things/map-thing-rows", {
    namedExports: {
      mapDbThingRows: (rows) => track("map-things", () => delay(rows.map((r) => ({ id: r.id, title: "t", workStatus: "not_started" })))),
      THING_COLUMNS: "id",
    },
  });
  const mapListsMock = mock.module("@/features/lists/map-list-rows", {
    namedExports: {
      mapDbListRows: (qc, profileId, rows) => track("map-lists", () => delay(rows.map((r) => ({ id: r.id, name: "l", members: [] })))),
    },
  });

  const chainable = (name, result) => {
    const node = {
      select: () => node,
      eq: () => node,
      is: () => node,
      in: () => node,
      then: (resolve) => {
        track(name, () => delay(result)).then(resolve);
      },
    };
    return node;
  };
  const clientMock = mock.module("@/integrations/supabase/client", {
    namedExports: {
      supabase: {
        from: (table) => {
          if (table === "buckets") return chainable("buckets-query", { data: [{ id: "b1", name: "Bucket 1", context: "work", updated_at: new Date().toISOString() }], error: null });
          if (table === "bucket_items") return chainable("bucket-items-query", { data: [{ bucket_id: "b1", thing_id: "t1", list_id: "l1" }], error: null });
          if (table === "things") return chainable("things-query", { data: [{ id: "t1" }], error: null });
          if (table === "lists") return chainable("lists-query", { data: [{ id: "l1" }], error: null });
          throw new Error(`unexpected table: ${table}`);
        },
      },
    },
  });

  try {
    const { fetchBuckets } = await import("@/features/buckets/fetch-buckets");
    const buckets = await fetchBuckets({}, "work", "profile-1");

    // Deterministic concurrency proof #1: the Things and Lists queries
    // both start before either resolves (they only run after
    // bucket-items-query resolves, which is a genuine dependency and
    // stays sequential).
    const queriesStart = events.indexOf("things-query:start");
    const queriesEnd = events.findIndex((e, i) => i > queriesStart - 1 && (e === "things-query:end" || e === "lists-query:end"));
    const startedBeforeEitherQueryEnded = new Set(events.slice(queriesStart, queriesEnd).filter((e) => e.endsWith(":start")));
    assert.deepEqual(
      startedBeforeEitherQueryEnded,
      new Set(["things-query:start", "lists-query:start"]),
      `expected the Things and Lists queries to start together; event order was: ${events.join(", ")}`,
    );

    // Deterministic concurrency proof #2: the two mappers both start
    // before either finishes.
    const mapStart = events.indexOf("map-things:start");
    const mapEnd = events.findIndex((e, i) => i > mapStart - 1 && (e === "map-things:end" || e === "map-lists:end"));
    const startedBeforeEitherMapEnded = new Set(events.slice(mapStart, mapEnd).filter((e) => e.endsWith(":start")));
    assert.deepEqual(
      startedBeforeEitherMapEnded,
      new Set(["map-things:start", "map-lists:start"]),
      `expected mapDbThingRows and mapDbListRows to start together; event order was: ${events.join(", ")}`,
    );

    // Output assertions.
    assert.equal(buckets.length, 1);
    assert.equal(buckets[0].id, "b1");
    assert.equal(buckets[0].thingCount, 1);
    assert.equal(buckets[0].listCount, 1);
  } finally {
    mapThingsMock.restore();
    mapListsMock.restore();
    clientMock.restore();
  }
});
