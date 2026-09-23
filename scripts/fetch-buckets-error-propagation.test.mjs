import assert from "node:assert/strict";
import { test, mock } from "node:test";

/**
 * Batch C1 error-propagation requirement: a failed bucket_items, Things,
 * or Lists read must reject fetchBuckets(), not silently present as
 * "this bucket has nothing in it" (an empty array). All three queries
 * are mocked once for this whole file (a `failingTable` switch each test
 * sets before calling fetchBuckets, since the module under test is only
 * ever imported once — imported instances keep the `supabase` binding
 * captured at their first import, so later mock.module() calls for the
 * same specifier don't reach an already-imported module).
 */

let failingTable = null;

const chainable = (table) => {
  const node = {
    select: () => node,
    eq: () => node,
    is: () => node,
    in: () => node,
    then: (resolve) => {
      if (table === failingTable) {
        resolve({ data: null, error: new Error(`${table} read failed`) });
        return;
      }
      const byTable = {
        buckets: [{ id: "b1", name: "Bucket 1", context: "work", updated_at: new Date().toISOString() }],
        bucket_items: [{ bucket_id: "b1", thing_id: "t1", list_id: "l1" }],
        things: [{ id: "t1" }],
        lists: [{ id: "l1" }],
      };
      resolve({ data: byTable[table] ?? [], error: null });
    },
  };
  return node;
};

mock.module("@/integrations/supabase/client", {
  namedExports: {
    supabase: { from: (table) => chainable(table) },
  },
});
mock.module("@/features/things/map-thing-rows", {
  namedExports: {
    mapDbThingRows: async (rows) => rows.map((r) => ({ id: r.id, title: "t", workStatus: "not_started" })),
    THING_COLUMNS: "id",
  },
});
mock.module("@/features/lists/map-list-rows", {
  namedExports: {
    mapDbListRows: async (qc, profileId, rows) => rows.map((r) => ({ id: r.id, name: "l", members: [] })),
  },
});

const { fetchBuckets } = await import("@/features/buckets/fetch-buckets");

test("fetchBuckets rejects when the bucket_items read fails, instead of returning an empty bucket", async () => {
  failingTable = "bucket_items";
  try {
    await assert.rejects(fetchBuckets({}, "work", "profile-1"), /bucket_items read failed/);
  } finally {
    failingTable = null;
  }
});

test("fetchBuckets rejects when the Things read fails, instead of silently omitting Things", async () => {
  failingTable = "things";
  try {
    await assert.rejects(fetchBuckets({}, "work", "profile-1"), /things read failed/);
  } finally {
    failingTable = null;
  }
});

test("fetchBuckets rejects when the Lists read fails, instead of silently omitting Lists", async () => {
  failingTable = "lists";
  try {
    await assert.rejects(fetchBuckets({}, "work", "profile-1"), /lists read failed/);
  } finally {
    failingTable = null;
  }
});

test("sanity: fetchBuckets still succeeds when nothing fails", async () => {
  const buckets = await fetchBuckets({}, "work", "profile-1");
  assert.equal(buckets.length, 1);
  assert.equal(buckets[0].id, "b1");
});
