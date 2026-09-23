import assert from "node:assert/strict";
import { test, mock } from "node:test";

/**
 * Batch C1: useList()'s queryFn used to fetch the one List row it
 * needed, then call fetchLists() for the entire context and re-find
 * it by id — an unnecessary full-context waterfall for a single-row
 * lookup. fetchListDetail() now maps the directly fetched row.
 */

let listsQueryCount = 0;

mock.module("@/integrations/supabase/client", {
  namedExports: {
    supabase: {
      from: (table) => {
        if (table !== "lists") throw new Error(`unexpected table: ${table}`);
        listsQueryCount += 1;
        const node = {
          select: () => node,
          eq: () => node,
          maybeSingle: () =>
            Promise.resolve({
              data: {
                id: "list-1",
                name: "Groceries",
                context: "work",
                owner_profile_id: "owner-1",
                updated_at: new Date().toISOString(),
                description: null,
                cover_storage_path: null,
              },
              error: null,
            }),
        };
        return node;
      },
    },
  },
});
mock.module("@/features/lists/map-list-rows", {
  namedExports: {
    mapDbListRows: async (profileId, rows) => rows.map((r) => ({ id: r.id, name: r.name, thingCount: 0 })),
  },
});

const { fetchListDetail } = await import("@/features/lists/fetch-list-detail");

test("fetchListDetail issues exactly one lists query, not a full-context refetch", async () => {
  listsQueryCount = 0;
  const row = await fetchListDetail("owner-1", "list-1");
  assert.equal(listsQueryCount, 1, `expected exactly one 'lists' query; got ${listsQueryCount}`);
  assert.equal(row.id, "list-1");
  assert.equal(row.name, "Groceries");
});
