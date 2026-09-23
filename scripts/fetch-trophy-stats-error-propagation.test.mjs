import assert from "node:assert/strict";
import { test, mock } from "node:test";

/**
 * Batch C1/P2 read-error policy: the actor lookup and the Shred
 * history are stats-bearing reads, not decorative -- a failed read
 * must reject, not silently masquerade as "you haven't sorted/shredded
 * anything" (a false zero). A legitimate "no actor row yet" is not an
 * error (.maybeSingle() -> { data: null, error: null }) and must keep
 * resolving normally. The three name-resolution queries (things/lists/
 * buckets) stay decorative: a failed name lookup degrades to the
 * object_type fallback label rather than rejecting the batch.
 */

let failing = null; // "actor" | "shredded" | null

const chainable = (table, result) => {
  const node = {
    select: () => node,
    eq: () => node,
    in: () => node,
    not: () => node,
    order: () => node,
    limit: () => node,
    maybeSingle: () => {
      if (table === "actor-missing") return Promise.resolve({ data: null, error: null });
      if (failing === "actor" && table === "actors") return Promise.resolve({ data: null, error: new Error("actors read failed") });
      return Promise.resolve(result);
    },
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
        if (table === "actors") return chainable(table, { data: { id: "actor-1" }, error: null });
        if (table === "thing_activity")
          return chainable(table, {
            data: [{ event: "sorted", created_at: new Date().toISOString(), actor_id: "actor-1" }],
            error: null,
          });
        if (table === "profile_object_state") return chainable(table, { data: [], error: null });
        if (table === "things" || table === "lists" || table === "buckets") return chainable(table, { data: [], error: null });
        throw new Error(`unexpected table: ${table}`);
      },
    },
  },
});

const { fetchTrophyStats } = await import("@/features/me/use-trophy");

test("fetchTrophyStats rejects when the actor read fails, instead of silently zeroing every stat", async () => {
  failing = "actor";
  try {
    await assert.rejects(fetchTrophyStats("profile-1"), /actors read failed/);
  } finally {
    failing = null;
  }
});

test("fetchTrophyStats rejects when the Shred-history read fails, instead of reporting an empty shredded list", async () => {
  failing = "shredded";
  try {
    await assert.rejects(fetchTrophyStats("profile-1"), /profile_object_state read failed/);
  } finally {
    failing = null;
  }
});

test("sanity: fetchTrophyStats still succeeds when nothing fails", async () => {
  const stats = await fetchTrophyStats("profile-1");
  assert.equal(stats.sorted, 1);
  assert.deepEqual(stats.shredded, []);
});
