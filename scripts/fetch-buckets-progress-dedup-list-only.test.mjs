import assert from "node:assert/strict";
import { test, mock } from "node:test";

/**
 * G03: companion test to fetch-buckets-progress-dedup.test.mjs, kept in
 * its own file -- a module already evaluated with one mock of its
 * `supabase`/mapper imports keeps those bindings even if a LATER test in
 * the same file/process calls mock.module() again for the same
 * specifier. A separate file gets its own fresh module cache.
 */
mock.module("@/features/things/map-thing-rows", {
  namedExports: {
    mapDbThingRows: async (rows) =>
      rows.map((r) => ({ id: r.id, title: `Thing ${r.id}`, workStatus: r.work_status ?? "not_started", assignee: {}, owner: {} })),
    THING_COLUMNS: "id",
  },
});
mock.module("@/features/lists/map-list-rows", {
  namedExports: {
    mapDbListRows: async (qc, profileId, rows) =>
      rows.map((r) => ({ id: r.id, name: `List ${r.id}`, thingCount: 2, doneCount: 1, members: [] })),
  },
});

// `in` records which column was filtered on, so a table queried more
// than once with different filters (here, "things" by "id" for direct
// items vs by "list_id" for list members) can return different rows for
// each -- more robust than assuming a fixed call order.
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

test("sanity: a Thing that is ONLY a list member (not also a direct item) is still counted", async () => {
  const byTable = {
    buckets: { data: [{ id: "b1", name: "Bucket 1", context: "work", updated_at: new Date().toISOString() }], error: null },
    bucket_items: { data: [{ bucket_id: "b1", thing_id: null, list_id: "l1" }], error: null },
    lists: { data: [{ id: "l1" }], error: null },
  };
  const listMemberThings = {
    data: [
      { id: "list-only-thing-1", list_id: "l1", work_status: "sorted" },
      { id: "list-only-thing-2", list_id: "l1", work_status: "not_started" },
    ],
    error: null,
  };
  const clientMock = mock.module("@/integrations/supabase/client", {
    namedExports: {
      supabase: {
        from: (table) => {
          if (table === "things") {
            return chainableByColumn({ id: { data: [], error: null }, list_id: listMemberThings });
          }
          return chainable(table, byTable);
        },
      },
    },
  });

  try {
    const { fetchBuckets } = await import("@/features/buckets/fetch-buckets");
    const buckets = await fetchBuckets({}, "work", "profile-1");
    assert.equal(buckets[0].progressTotal, 2);
    assert.equal(buckets[0].progressCompleted, 1);
  } finally {
    clientMock.restore();
  }
});
