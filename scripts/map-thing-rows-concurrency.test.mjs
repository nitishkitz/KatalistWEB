import assert from "node:assert/strict";
import { test, mock } from "node:test";

/**
 * Batch C1: mapDbThingRows makes four independent lookups per call
 * (actor/people resolution, list-name resolution, comment counts, real
 * attachments) — none of their results depend on each other, only the
 * final per-row assembly does. This proves they run concurrently by
 * recording the *order* of start/end events from each mocked dependency,
 * not by measuring wall-clock time — a timing threshold is inherently
 * flaky (CI load, scheduler jitter) and was also based on a wrong
 * assumption (that every leg is a single step; list-name resolution has
 * its own internal RPC-then-table fallback). Event ordering is
 * deterministic regardless of how long each mock's delay actually takes.
 *
 * This reduces serialized *latency*, not request *volume* — the same
 * network calls still happen; live latency/backend-load validation is
 * explicitly deferred until it can be measured against a real backend.
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

test("mapDbThingRows starts its four independent lookups before any of them resolves", async () => {
  const { events, track } = makeTracker();

  const peopleMock = mock.module("@/features/people/resolve-actors", {
    namedExports: {
      resolveActorPeople: () =>
        track("people", () => delay(new Map([["a1", { id: "a1", name: "Ada", initials: "A" }]]))),
      personOrSomeone: (people, id) => people.get(id) ?? { id, name: "Someone", initials: "S" },
    },
  });
  const attachmentsMock = mock.module("@/features/things/attachments", {
    namedExports: {
      fetchRealAttachments: () => track("attachments", () => delay(new Map())),
    },
  });
  const authedFetchMock = mock.module("@/lib/authed-fetch", {
    namedExports: {
      // Never actually called in this test: `typeof window === "undefined"`
      // in Node skips straight to the RPC step — asserted below.
      authedFetch: () => track("authedFetch", () => delay({ ok: false })),
    },
  });
  const rpcsMock = mock.module("@/integrations/supabase/rpcs", {
    namedExports: {
      // Resolves the list name fully on this one step, so the internal
      // table-fallback step never fires — asserted below.
      callUngeneratedRpc: () =>
        track("resolve-list-names-rpc", () => delay({ data: [{ id: "l1", name: "Groceries" }], error: null })),
    },
  });
  const chainable = (name, result) => {
    const node = {
      select: () => node,
      in: () => node,
      is: () => node,
      eq: () => node,
      then: (resolve) => {
        track(name, () => delay(result)).then(resolve);
      },
    };
    return node;
  };
  const clientMock = mock.module("@/integrations/supabase/client", {
    namedExports: {
      supabase: {
        from: (table) =>
          table === "thing_comments"
            ? chainable("comments", { data: [], error: null })
            : chainable("lists-table-fallback", { data: [], error: null }),
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

    const [thing] = await mapDbThingRows([row], "a1");

    // Deterministic concurrency proof: the four independent top-level
    // legs must all have *started* before any of them *finished* — i.e.
    // they were genuinely in flight together, not queued behind each
    // other. This holds regardless of how long each mock's delay is.
    const firstEndIndex = events.findIndex((e) => e.endsWith(":end"));
    const startedBeforeAnyEnd = new Set(events.slice(0, firstEndIndex).filter((e) => e.endsWith(":start")));
    assert.deepEqual(
      startedBeforeAnyEnd,
      new Set(["people:start", "attachments:start", "comments:start", "resolve-list-names-rpc:start"]),
      `expected all four independent lookups to start before any resolved; event order was: ${events.join(", ")}`,
    );

    // authedFetch is skipped outside a browser (no `window`) — list-name
    // resolution goes straight to its RPC step in this test.
    assert.ok(!events.some((e) => e.startsWith("authedFetch")), "authedFetch should not run without window");
    // The table fallback should never fire since the RPC mock already
    // resolved the list name — confirms list-name resolution's own
    // internal fallback chain is otherwise unchanged by this refactor.
    assert.ok(
      !events.some((e) => e.startsWith("lists-table-fallback")),
      "table fallback should not run when the RPC already resolved the list name",
    );

    // Output assertions: the mapped Thing actually reflects each of the
    // four lookups' results, not just that they ran.
    assert.equal(thing.id, "t1");
    assert.equal(thing.title, "Thing 1");
    assert.equal(thing.listName, "Groceries", "list name resolved via the RPC mock");
    assert.equal(thing.creator.name, "Ada", "person resolution flows through to the mapped Thing");
    assert.equal(thing.commentCount, 0);
    assert.equal(thing.unreadCommentCount, 0);
    assert.equal(thing.files, undefined, "no real attachments and no notes-derived files for this row");
  } finally {
    peopleMock.restore();
    attachmentsMock.restore();
    authedFetchMock.restore();
    rpcsMock.restore();
    clientMock.restore();
  }
});
