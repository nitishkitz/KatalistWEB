import assert from "node:assert/strict";
import { test, mock } from "node:test";

/**
 * In its own file: fetch-bucket-items-concurrency.test.mjs already
 * imports @/features/buckets/fetch-bucket-items once, and ES module
 * instances are cached — a module already evaluated with one mock of
 * its `supabase` import keeps that binding even if a *later* test in the
 * same file/process calls mock.module() again for the same specifier.
 * A separate file gets its own fresh module cache.
 */
test("fetchBucketItems returns an empty list without querying Things/Lists when there are no bucket_items", async () => {
  const clientMock = mock.module("@/integrations/supabase/client", {
    namedExports: {
      supabase: {
        from: (table) => {
          if (table === "bucket_items") {
            const node = {
              select: () => node,
              eq: () => node,
              abortSignal: () => node,
              then: (resolve) => resolve({ data: [], error: null }),
            };
            return node;
          }
          throw new Error(`fetchBucketItems should not query ${table} when bucket_items is empty`);
        },
      },
    },
  });

  try {
    const { fetchBucketItems } = await import("@/features/buckets/fetch-bucket-items");
    const items = await fetchBucketItems({}, "b1", "profile-1");
    assert.deepEqual(items, []);
  } finally {
    clientMock.restore();
  }
});
