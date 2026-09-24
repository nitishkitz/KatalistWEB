import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { QueryClient } from "@tanstack/react-query";

/**
 * Batch C1: fetchTrophyStats had two independent-but-sequential shapes:
 * (1) the activity aggregate and the shredded-objects lookup don't
 * depend on each other at all; (2) the three name-resolution queries
 * (things/lists/buckets) each depend only on shreddedRows, not on each
 * other. Same deterministic event-order approach as the other C1 tests.
 */

const DELAY_MS = 5;

function delay(value) {
  return new Promise((resolve) => setTimeout(() => resolve(value), DELAY_MS));
}

function makeTracker() {
  const events = [];
  return {
    events,
    track: (name, promiseFactory) => {
      events.push(`${name}:start`);
      return promiseFactory().then((value) => {
        events.push(`${name}:end`);
        return value;
      });
    },
  };
}

test("fetchTrophyStats runs the bounded activity aggregate and Shred lookup concurrently, then the three name lookups concurrently", async () => {
  const { events, track } = makeTracker();

  const chainable = (name, result) => {
    const node = {
      select: () => node,
      eq: () => node,
      in: () => node,
      not: () => node,
      order: () => node,
      limit: () => node,
      maybeSingle: () => track(name, () => delay(result)),
      then: (resolve) => {
        track(name, () => delay(result)).then(resolve);
      },
    };
    return node;
  };

  const clientMock = mock.module("@/integrations/supabase/client", {
    namedExports: {
      supabase: {
        from: (table) => {
          if (table === "profile_object_state")
            return chainable("shredded-query", {
              data: [
                { object_id: "t1", object_type: "thing", shredded_at: new Date().toISOString() },
                { object_id: "l1", object_type: "list", shredded_at: new Date().toISOString() },
                { object_id: "b1", object_type: "bucket", shredded_at: new Date().toISOString() },
              ],
              error: null,
            });
          if (table === "things") return chainable("things-names", { data: [{ id: "t1", title: "My Thing" }], error: null });
          if (table === "lists") return chainable("lists-names", { data: [{ id: "l1", name: "My List" }], error: null });
          if (table === "buckets") return chainable("buckets-names", { data: [{ id: "b1", name: "My Bucket" }], error: null });
          throw new Error(`unexpected table: ${table}`);
        },
      },
    },
  });
  const rpcMock = mock.module("@/integrations/supabase/rpcs", {
    namedExports: {
      callUngeneratedRpc: (name) => {
        assert.equal(name, "get_trophy_activity_stats");
        return track("activity-aggregate", () => delay({
          data: [{ sorted_count: 1, caught_count: 0, weekly_count: 1, streak_days: 1 }], error: null,
        }));
      },
    },
  });

  try {
    const { fetchTrophyStats } = await import("@/features/me/use-trophy");
    const stats = await fetchTrophyStats("profile-1", new QueryClient());

    // Proof #1: the aggregate and Shred lookup both
    // start before either resolves.
    const start1 = events.indexOf("activity-aggregate:start");
    const end1 = events.findIndex((e, i) => i > start1 - 1 && (e === "activity-aggregate:end" || e === "shredded-query:end"));
    const startedBeforeEitherEnded1 = new Set(events.slice(start1, end1).filter((e) => e.endsWith(":start")));
    assert.ok(
      startedBeforeEitherEnded1.has("activity-aggregate:start") && startedBeforeEitherEnded1.has("shredded-query:start"),
      `expected the activity aggregate and shredded lookup to start together; event order was: ${events.join(", ")}`,
    );

    // Proof #2: the three name-resolution queries all start before any
    // of them resolves.
    const start2 = events.indexOf("things-names:start");
    const end2 = events.findIndex(
      (e, i) => i > start2 - 1 && (e === "things-names:end" || e === "lists-names:end" || e === "buckets-names:end"),
    );
    const startedBeforeAnyEnded2 = new Set(events.slice(start2, end2).filter((e) => e.endsWith(":start")));
    assert.deepEqual(
      startedBeforeAnyEnded2,
      new Set(["things-names:start", "lists-names:start", "buckets-names:start"]),
      `expected the three name lookups to start together; event order was: ${events.join(", ")}`,
    );

    // Output assertions.
    assert.equal(stats.sorted, 1);
    assert.equal(stats.caught, 0);
    assert.equal(stats.shredded.length, 3);
    assert.deepEqual(
      stats.shredded.find((s) => s.id === "t1"),
      { id: "t1", title: "My Thing", kind: "thing" },
    );
    assert.deepEqual(
      stats.shredded.find((s) => s.id === "l1"),
      { id: "l1", title: "My List", kind: "list" },
    );
    assert.deepEqual(
      stats.shredded.find((s) => s.id === "b1"),
      { id: "b1", title: "My Bucket", kind: "bucket" },
    );
  } finally {
    rpcMock.restore();
    clientMock.restore();
  }
});
