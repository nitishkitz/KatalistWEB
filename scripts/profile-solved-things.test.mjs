import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { QueryClient } from "@tanstack/react-query";

/**
 * Profile "Things sorted" list: currently solved Things, each once.
 * Membership = current assignee is the signed-in actor, Sorted, not
 * cancelled, both contexts. Failures must reject, never become an empty list.
 */

let actorResult = { value: "actor-1" };
let tableRows = [];
let queryError = null;
let countResult = 0;
const calls = [];

mock.module("@/features/people/actor-query", {
  namedExports: {
    getActorId: async (_qc, profileId) => {
      calls.push(["getActorId", profileId]);
      if (actorResult.error) throw actorResult.error;
      return actorResult.value;
    },
  },
});

const builder = () => {
  const record = { filters: [], orders: [], range: null, head: false };
  calls.push(["query", record]);
  const node = {
    select: (_cols, opts) => {
      record.columns = _cols;
      record.head = Boolean(opts?.head);
      return node;
    },
    eq: (k, v) => (record.filters.push(["eq", k, v]), node),
    is: (k, v) => (record.filters.push(["is", k, v]), node),
    order: (k, o) => (record.orders.push([k, o]), node),
    range: (a, b) => ((record.range = [a, b]), node),
    abortSignal: () => node,
    then: (resolve) =>
      resolve(
        queryError
          ? { data: null, count: null, error: queryError }
          : record.head
            ? { data: null, count: countResult, error: null }
            : { data: tableRows.slice(record.range[0], record.range[1] + 1), error: null },
      ),
  };
  return node;
};

mock.module("@/integrations/supabase/client", {
  namedExports: { supabase: { from: (table) => (assert.equal(table, "things"), builder()) } },
});
mock.module("@/features/things/map-thing-rows", {
  namedExports: {
    THING_OVERVIEW_COLUMNS: "id,title",
    mapDbThingRows: async (rows) => rows.map((r) => ({ id: r.id })),
  },
});

const { fetchSolvedThings, fetchSolvedThingCount, solvedThingsFromLocal, SOLVED_THINGS_PAGE_SIZE } = await import(
  "@/features/me/fetch-solved-things"
);

const makeRows = (n) => Array.from({ length: n }, (_, i) => ({ id: `t-${String(n - i).padStart(3, "0")}` }));
const lastQuery = () => calls.filter((c) => c[0] === "query").at(-1)[1];

test("membership filters use the resolved actor, Sorted, not cancelled, with no context filter", async () => {
  calls.length = 0;
  actorResult = { value: "actor-1" };
  tableRows = makeRows(3);
  await fetchSolvedThings("profile-1", new QueryClient(), 0);
  assert.deepEqual(calls[0], ["getActorId", "profile-1"]);
  const q = lastQuery();
  assert.deepEqual(q.filters, [
    ["eq", "current_assignee_actor_id", "actor-1"],
    ["eq", "work_status", "sorted"],
    ["is", "cancelled_at", null],
  ]);
  assert.equal(q.filters.some((f) => f[1] === "context"), false);
  assert.deepEqual(q.orders, [
    ["sorted_at", { ascending: false, nullsFirst: false }],
    ["id", { ascending: false }],
  ]);
});

test("page boundaries: 30 and 60 rows have no next page; 31 and 61 do", async () => {
  actorResult = { value: "actor-1" };
  for (const [total, page, expectRows, expectMore] of [
    [30, 0, 30, false],
    [31, 0, 30, true],
    [60, 1, 30, false],
    [61, 1, 30, true],
  ]) {
    tableRows = makeRows(total);
    const result = await fetchSolvedThings("profile-1", new QueryClient(), page);
    assert.equal(result.things.length, expectRows, `${total} rows, page ${page}`);
    assert.equal(result.hasMore, expectMore, `${total} rows, page ${page}`);
    assert.deepEqual(lastQuery().range, [page * SOLVED_THINGS_PAGE_SIZE, page * SOLVED_THINGS_PAGE_SIZE + SOLVED_THINGS_PAGE_SIZE]);
  }
});

test("a profile with no actor returns zero rows and zero count without querying things", async () => {
  actorResult = { value: null };
  calls.length = 0;
  assert.deepEqual(await fetchSolvedThings("profile-1", new QueryClient(), 0), { things: [], hasMore: false });
  assert.equal(await fetchSolvedThingCount("profile-1", new QueryClient()), 0);
  assert.equal(calls.some((c) => c[0] === "query"), false);
});

test("an actor lookup error and a query error both reject instead of returning an empty list", async () => {
  actorResult = { error: new Error("actor lookup failed") };
  await assert.rejects(fetchSolvedThings("profile-1", new QueryClient(), 0), /actor lookup failed/);
  await assert.rejects(fetchSolvedThingCount("profile-1", new QueryClient()), /actor lookup failed/);
  actorResult = { value: "actor-1" };
  queryError = new Error("things read failed");
  try {
    await assert.rejects(fetchSolvedThings("profile-1", new QueryClient(), 0), /things read failed/);
    await assert.rejects(fetchSolvedThingCount("profile-1", new QueryClient()), /things read failed/);
  } finally {
    queryError = null;
  }
});

test("the count query is count-only and uses the identical membership filters", async () => {
  actorResult = { value: "actor-1" };
  countResult = 42;
  assert.equal(await fetchSolvedThingCount("profile-1", new QueryClient()), 42);
  const q = lastQuery();
  assert.equal(q.head, true);
  assert.deepEqual(q.filters, [
    ["eq", "current_assignee_actor_id", "actor-1"],
    ["eq", "work_status", "sorted"],
    ["is", "cancelled_at", null],
  ]);
});

test("preview equivalent: same membership, newest first, nulls last, id as tie-break", () => {
  const t = (id, assignee, workStatus, sortedAt, cancelledAt = null) => ({
    id, assignee: { id: assignee }, workStatus, sortedAt, cancelledAt,
  });
  const result = solvedThingsFromLocal(
    [
      t("a", "me", "sorted", "2026-10-01T00:00:00Z"),
      t("b", "me", "sorted", "2026-10-03T00:00:00Z"),
      t("c", "me", "sorted", null),
      t("d", "me", "sorted", "2026-10-03T00:00:00Z"),
      t("e", "other", "sorted", "2026-10-04T00:00:00Z"),
      t("f", "me", "under_progress", null),
      t("g", "me", "sorted", "2026-10-05T00:00:00Z", "2026-10-06T00:00:00Z"),
    ],
    "me",
  ).map((x) => x.id);
  assert.deepEqual(result, ["d", "b", "a", "c"]);
});
