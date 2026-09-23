import assert from "node:assert/strict";
import { test, mock } from "node:test";

/**
 * Batch C1 baseline/regression: mapDbThingRows makes four independent
 * lookups per call (actor/people resolution, list-name resolution,
 * comment counts, real attachments) — none of their results depend on
 * each other, only the final per-row assembly does. This measures wall-
 * clock time with each dependency mocked to an artificial delay, so a
 * sequential await chain and a parallelized one are numerically
 * distinguishable without touching a live backend: sequential totals
 * ~= sum of the delays; parallel totals ~= the slowest single delay.
 */

const DELAY_MS = 40;

function delay(value) {
  return new Promise((resolve) => setTimeout(() => resolve(value), DELAY_MS));
}

test("mapDbThingRows fetches its four independent lookups concurrently, not sequentially", async () => {
  const peopleMock = mock.module("@/features/people/resolve-actors", {
    namedExports: {
      resolveActorPeople: () => delay(new Map()),
      personOrSomeone: (people, id) => ({ id, name: "Someone", initials: "S" }),
    },
  });
  const attachmentsMock = mock.module("@/features/things/attachments", {
    namedExports: {
      fetchRealAttachments: () => delay(new Map()),
    },
  });
  const authedFetchMock = mock.module("@/lib/authed-fetch", {
    namedExports: {
      // Resolves the list-name lookup fully on its first (API) attempt, so
      // that chain's own internal fallback steps never fire.
      authedFetch: () => delay({ ok: true, json: async () => ({ lists: [] }) }),
    },
  });
  const rpcsMock = mock.module("@/integrations/supabase/rpcs", {
    namedExports: {
      callUngeneratedRpc: () => delay({ data: null, error: null }),
    },
  });
  const chainable = (result) => {
    const node = {
      select: () => node,
      in: () => node,
      is: () => node,
      eq: () => node,
      then: (resolve) => {
        delay(result).then(resolve);
      },
    };
    return node;
  };
  const clientMock = mock.module("@/integrations/supabase/client", {
    namedExports: {
      supabase: {
        from: () => chainable({ data: [], error: null }),
      },
    },
  });

  try {
    const { mapDbThingRows } = await import("@/features/things/map-thing-rows");
    const row = {
      id: "t1",
      title: "Thing 1",
      acknowledgement: "waiting_for_catch",
      work_status: "not_started",
      owner_importance: "next",
      assignee_personal_pace: null,
      due_at: null,
      due_has_time: false,
      context: "work",
      list_id: "l1",
      creator_actor_id: "a1",
      owner_actor_id: "a1",
      current_assignee_actor_id: "a1",
      cancelled_at: null,
      sorted_at: null,
      caught_at: null,
      updated_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      notes: null,
    };

    const start = Date.now();
    await mapDbThingRows([row], "a1");
    const elapsed = Date.now() - start;

    // Not all four legs are single-step: list-name resolution has its own
    // internal RPC-then-table fallback (this test runs in Node, so the
    // `typeof window` guard skips the first, authedFetch, step), which
    // alone takes ~2 * DELAY_MS when nothing resolves — the worst case
    // exercised here. That's still only *one* of the four legs; running
    // concurrently, the total should track that single slowest leg
    // (~2 * DELAY_MS, ~80ms), not the sum of all four
    // (people + list-names' ~2 steps + comments + attachments,
    // ~5 * DELAY_MS, ~200ms — confirmed against the unmodified code before
    // this fix). The threshold sits well below the sequential sum so this
    // fails loudly against a regression back to sequential awaits.
    assert.ok(
      elapsed < DELAY_MS * 3.5,
      `expected the four independent lookups to run concurrently (~${DELAY_MS * 2}ms, bounded by list-name resolution's own 2-step fallback), took ${elapsed}ms`,
    );
  } finally {
    peopleMock.restore();
    attachmentsMock.restore();
    authedFetchMock.restore();
    rpcsMock.restore();
    clientMock.restore();
  }
});
