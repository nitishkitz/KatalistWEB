import assert from "node:assert/strict";
import { test, mock } from "node:test";

/**
 * G03: fetchBuckets' progress denominator/numerator used to be
 * activeDirectThings.length/sortedCount PLUS each referenced List's own
 * (unrelated) thingCount/doneCount, added together with no
 * cross-referencing -- a Thing that is BOTH a direct bucket item AND a
 * member of a referenced List was counted twice. This proves the fix:
 * the same Thing appearing both ways is counted once. The actual dedup
 * guarantee now lives in get_bucket_progress SQL and its PGlite test; this
 * test proves the client consumes that exact aggregate without re-adding
 * List totals and double-counting it.
 */
mock.module("@/features/things/map-thing-rows", {
  namedExports: {
    mapDbThingRows: async (rows) =>
      rows.map((r) => ({ id: r.id, title: `Thing ${r.id}`, workStatus: r.work_status ?? "not_started", assignee: {}, owner: {} })),
    THING_COLUMNS: "id",
    THING_OVERVIEW_COLUMNS: "id",
  },
});
mock.module("@/features/people/actor-query", { namedExports: { getActorId: async () => "actor-1" } });
mock.module("@/integrations/supabase/rpcs", { namedExports: {
  callUngeneratedRpc: () => ({ abortSignal: async () => ({ data: [{ bucket_id: "b1", progress_completed: 1, progress_total: 1 }], error: null }) }),
} });
mock.module("@/features/lists/map-list-rows", {
  namedExports: {
    // thingCount/doneCount mirror the SAME underlying rows fetch-buckets'
    // own listMemberThingRows query will also see -- exactly the
    // real-world overlap condition (a list's aggregate counts summarizing
    // a Thing that ALSO happens to be a direct bucket item).
    mapDbListRows: async (qc, profileId, rows) =>
      rows.map((r) => ({ id: r.id, name: `List ${r.id}`, thingCount: 2, doneCount: 1, members: [] })),
  },
});

const chainable = (table, byTable) => {
  const node = {
    select: () => node,
    eq: () => node,
    is: () => node,
    in: (_col, _values) => node,
    abortSignal: () => node,
    then: (resolve) => resolve(byTable[table] ?? { data: [], error: null }),
  };
  return node;
};

// `in` records which column was filtered on, so "things" (queried once by
// "id" for direct items, once by "list_id" for list members) can return
// different rows for each -- robust regardless of which one fires first
// or whether either is skipped (fetchBuckets skips a query entirely when
// its id list is empty).
const chainableByColumn = (resultsByColumn) => {
  const node = {
    select: () => node,
    eq: () => node,
    is: () => node,
    abortSignal: () => node,
    in: (col) => {
      node.__col = col;
      return node;
    },
    then: (resolve) => resolve(resultsByColumn[node.__col] ?? { data: [], error: null }),
  };
  return node;
};

test("a Thing that is both a direct bucket item AND a member of a referenced List is counted once, not twice", async () => {
  const byTable = {
    buckets: { data: [{ id: "b1", name: "Bucket 1", context: "work", updated_at: new Date().toISOString() }], error: null },
    bucket_items: {
      data: [
        { bucket_id: "b1", thing_id: "shared-thing", list_id: null },
        { bucket_id: "b1", thing_id: null, list_id: "l1" },
      ],
      error: null,
    },
    lists: { data: [{ id: "l1" }], error: null },
  };

  // Models the real-world overlap: "shared-thing" is both a direct bucket
  // item (found via the "id" filter) and a member of the referenced list
  // l1 (found via the "list_id" filter).
  const clientMock = mock.module("@/integrations/supabase/client", {
    namedExports: {
      supabase: {
        from: (table) => {
          if (table === "things") {
            return chainableByColumn({
              id: { data: [{ id: "shared-thing", work_status: "sorted" }], error: null },
              list_id: { data: [{ id: "shared-thing", list_id: "l1", work_status: "sorted" }], error: null },
            });
          }
          return chainable(table, byTable);
        },
      },
    },
  });

  try {
    const { fetchBuckets } = await import("@/features/buckets/fetch-buckets");
    const buckets = await fetchBuckets({}, "work", "profile-1");

    assert.equal(buckets.length, 1);
    assert.equal(
      buckets[0].progressTotal,
      1,
      "the shared Thing must be counted once in the denominator, not once as a direct item plus once via the list",
    );
    assert.equal(buckets[0].progressCompleted, 1, "and once in the numerator (it's sorted)");
  } finally {
    clientMock.restore();
  }
});
