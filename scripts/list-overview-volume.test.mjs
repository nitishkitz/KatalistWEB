import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { performance } from "node:perf_hooks";

let requests = 0;
mock.module("@/integrations/supabase/rpcs", {
  namedExports: {
    callUngeneratedRpc: async (_name, args) => {
      requests++;
      return { error: null, data: args.p_list_ids.map((list_id) => ({
        list_id, thing_count: 0, done_count: 0, in_progress_count: 0,
      })) };
    },
  },
});
mock.module("@/features/people/directory", {
  namedExports: { fetchProfileIdentitiesByIds: async () => [], matchAvatarByName: () => null },
});
mock.module("@/integrations/supabase/client", { namedExports: { supabase: {} } });

const { fetchListCounts } = await import("@/features/lists/map-list-rows");

for (const count of [0, 10, 100]) {
  test(`List fixture ${count} rows uses a bounded aggregate`, async (t) => {
    requests = 0;
    const ids = Array.from({ length: count }, (_, index) => `list-${index}`);
    const started = performance.now();
    const result = await fetchListCounts(ids);
    const elapsed = performance.now() - started;
    assert.equal(result.size, count);
    assert.equal(requests, count ? 1 : 0);
    t.diagnostic(`fixture=${count} aggregateRequests=${requests} adapterMs=${elapsed.toFixed(2)} (mocked transport, not live latency)`);
  });
}
