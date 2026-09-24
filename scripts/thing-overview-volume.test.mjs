import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { performance } from "node:perf_hooks";

let rpcCalls = 0;
let signedBatches = 0;
mock.module("@/integrations/supabase/rpcs", {
  namedExports: {
    callUngeneratedRpc: (_name, args) => {
      rpcCalls++;
      return Promise.resolve({
        error: null,
        data: args.p_thing_ids.map((thing_id) => ({
          thing_id, comment_count: 0, unread_comment_count: 0,
          attachment_count: 0, preview_attachment: null,
        })),
      });
    },
  },
});
mock.module("@/features/things/read-state", {
  namedExports: { getThingLastReadAt: () => 0 },
});
mock.module("@/features/things/attachments", {
  namedExports: {
    signThingAttachmentPaths: async (paths) => {
      if (paths.length) signedBatches++;
      return new Map();
    },
  },
});

const { fetchThingOverviewStats } = await import("@/features/things/fetch-thing-overview-stats");

for (const count of [0, 30, 300]) {
  test(`Court overview fixture ${count} Things uses bounded aggregate requests`, async (t) => {
    rpcCalls = 0;
    signedBatches = 0;
    const rows = Array.from({ length: count }, (_, index) => ({ id: `thing-${index}`, context: "work" }));
    const start = performance.now();
    const stats = await fetchThingOverviewStats(rows, "actor-1");
    const elapsedMs = performance.now() - start;
    assert.equal(stats.size, count);
    assert.equal(rpcCalls, count ? 1 : 0, "one RPC for up to 500 Things, not one per card");
    assert.equal(signedBatches, 0, "no preview paths means no Storage requests");
    t.diagnostic(`fixture=${count} aggregateRequests=${rpcCalls} signingRequests=${signedBatches} adapterMs=${elapsedMs.toFixed(2)} (mocked transport, not live latency)`);
  });
}
