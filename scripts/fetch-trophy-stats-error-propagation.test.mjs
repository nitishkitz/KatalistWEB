import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { QueryClient } from "@tanstack/react-query";

/**
 * T06 read-error policy: the activity aggregate and the Shred
 * history are stats-bearing reads, not decorative -- a failed read
 * must reject, not silently masquerade as "you haven't sorted/shredded
 * anything" (a false zero). A legitimate "no actor row yet" is returned
 * by the aggregate as exact zeros. The three name-resolution queries (things/lists/
 * buckets) stay decorative: a failed name lookup degrades to the
 * object_type fallback label rather than rejecting the batch.
 */

let failing = null; // "activity" | "shredded" | null

const chainable = (table, result) => {
  const node = {
    select: () => node,
    eq: () => node,
    in: () => node,
    not: () => node,
    order: () => node,
    limit: () => node,
    then: (resolve) => {
      if (failing === "shredded" && table === "profile_object_state") {
        resolve({ data: null, error: new Error("profile_object_state read failed") });
        return;
      }
      resolve(result);
    },
  };
  return node;
};

mock.module("@/integrations/supabase/client", {
  namedExports: {
    supabase: {
      from: (table) => {
        if (table === "profile_object_state") return chainable(table, { data: [], error: null });
        if (table === "things" || table === "lists" || table === "buckets") return chainable(table, { data: [], error: null });
        throw new Error(`unexpected table: ${table}`);
      },
    },
  },
});
mock.module("@/integrations/supabase/rpcs", {
  namedExports: {
    callUngeneratedRpc: (name) => {
      assert.equal(name, "get_trophy_activity_stats");
      return Promise.resolve(failing === "activity"
        ? { data: null, error: new Error("activity aggregate read failed") }
        : { data: [{ sorted_count: 1, caught_count: 0, weekly_count: 1, streak_days: 1 }], error: null });
    },
  },
});

const { fetchTrophyStats } = await import("@/features/me/use-trophy");

test("fetchTrophyStats rejects when activity aggregate fails, instead of silently zeroing every stat", async () => {
  failing = "activity";
  try {
    await assert.rejects(fetchTrophyStats("profile-1", new QueryClient()), /activity aggregate read failed/);
  } finally {
    failing = null;
  }
});

test("fetchTrophyStats rejects when the Shred-history read fails, instead of reporting an empty shredded list", async () => {
  failing = "shredded";
  try {
    await assert.rejects(fetchTrophyStats("profile-1", new QueryClient()), /profile_object_state read failed/);
  } finally {
    failing = null;
  }
});

test("sanity: fetchTrophyStats still succeeds when nothing fails", async () => {
  const stats = await fetchTrophyStats("profile-1", new QueryClient());
  assert.equal(stats.sorted, 1);
  assert.deepEqual(stats.shredded, []);
});
