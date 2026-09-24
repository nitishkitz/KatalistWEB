import assert from "node:assert/strict";
import { test, mock } from "node:test";

/**
 * Batch C1: fetchBucketItems' Things (+ its mapper) and Lists lookups
 * both depend only on bucket_items' output, not on each other, but
 * previously awaited things-then-lists sequentially. Same deterministic
 * event-order approach as the other C1 tests in this directory.
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

test("fetchBucketItems runs the Things and Lists lookups concurrently", async () => {
  const { events, track } = makeTracker();

  const mapThingsMock = mock.module("@/features/things/map-thing-rows", {
    namedExports: {
      mapDbThingRows: (rows) =>
        track("map-things", () => delay(rows.map((r) => ({ id: r.id, title: "t" })))),
      THING_COLUMNS: "id",
    },
  });
  const mapListsMock = mock.module("@/features/lists/map-list-rows", {
    namedExports: {
      mapDbListRows: (qc, profileId, rows) => track("map-lists", () => delay(rows.map((r) => ({ id: r.id, name: "l" })))),
    },
  });

  const chainable = (name, result) => {
    const node = {
      select: () => node,
      eq: () => node,
      in: () => node,
      abortSignal: () => node,
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
          if (table === "bucket_items")
            return chainable("bucket-items-query", { data: [{ thing_id: "t1", list_id: null }, { thing_id: null, list_id: "l1" }], error: null });
          if (table === "things") return chainable("things-query", { data: [{ id: "t1" }], error: null });
          if (table === "lists") return chainable("lists-query", { data: [{ id: "l1" }], error: null });
          throw new Error(`unexpected table: ${table}`);
        },
      },
    },
  });

  try {
    const { fetchBucketItems } = await import("@/features/buckets/fetch-bucket-items");
    const items = await fetchBucketItems({}, "b1", "profile-1");

    // Deterministic concurrency proof: the Things query and Lists query
    // both start before either resolves.
    const start = events.indexOf("things-query:start");
    const firstEnd = events.findIndex((e, i) => i > start - 1 && (e === "things-query:end" || e === "lists-query:end"));
    const startedBeforeEitherEnded = new Set(events.slice(start, firstEnd).filter((e) => e.endsWith(":start")));
    assert.deepEqual(
      startedBeforeEitherEnded,
      new Set(["things-query:start", "lists-query:start"]),
      `expected the Things and Lists lookups to start together; event order was: ${events.join(", ")}`,
    );

    // Output assertions.
    assert.equal(items.length, 2);
    assert.deepEqual(
      items.find((i) => i.kind === "thing"),
      { kind: "thing", thingId: "t1", thing: { id: "t1", title: "t" } },
    );
    assert.deepEqual(
      items.find((i) => i.kind === "list"),
      { kind: "list", listId: "l1", list: { id: "l1", name: "l" } },
    );
  } finally {
    mapThingsMock.restore();
    mapListsMock.restore();
    clientMock.restore();
  }
});
