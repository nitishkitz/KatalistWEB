import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { performance } from "node:perf_hooks";

let requests = 0;
mock.module("@/integrations/supabase/rpcs", { namedExports: {
  callUngeneratedRpc: async (_name, args) => {
    requests++;
    return { error: null, data: args.p_bucket_ids.map((bucket_id) => ({
      bucket_id, progress_completed: 0, progress_total: 0,
    })) };
  },
} });
mock.module("@/integrations/supabase/client", { namedExports: { supabase: {} } });
mock.module("@/features/things/map-thing-rows", { namedExports: {
  THING_OVERVIEW_COLUMNS: "id", mapDbThingRows: async () => [],
} });
mock.module("@/features/lists/map-list-rows", { namedExports: { mapDbListRows: async () => [] } });
mock.module("@/features/people/actor-query", { namedExports: { getActorId: async () => null } });

const { fetchBucketProgress } = await import("@/features/buckets/fetch-buckets");

for (const count of [0, 10, 100]) {
  test(`Bucket fixture ${count} rows uses bounded progress requests`, async (t) => {
    requests = 0;
    const ids = Array.from({ length: count }, (_, index) => `bucket-${index}`);
    const started = performance.now();
    const result = await fetchBucketProgress(ids);
    const elapsed = performance.now() - started;
    assert.equal(result.length, count);
    assert.equal(requests, count ? 1 : 0);
    t.diagnostic(`fixture=${count} progressRequests=${requests} adapterMs=${elapsed.toFixed(2)} (mocked transport, not live latency)`);
  });
}
