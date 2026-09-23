import assert from "node:assert/strict";
import { test, mock } from "node:test";

/**
 * Batch C1/P1: fetchListDetail must preserve the same eligibility
 * rules the old fetchLists()-based path applied (unarchived,
 * kind = "list"), while fetching only the requested row instead of
 * the whole context. A mock whose .eq()/.is() ignore their arguments
 * cannot prove filter preservation, so this fixture set actually
 * tracks and asserts on the filter calls made against each row.
 */

let scenario = "normal-task-list";

function makeRow(overrides = {}) {
  return {
    id: "list-1",
    name: "Groceries",
    context: "work",
    owner_profile_id: "owner-1",
    updated_at: new Date().toISOString(),
    description: null,
    cover_storage_path: null,
    archived_at: null,
    kind: "list",
    ...overrides,
  };
}

let baseQueryCount = 0;

function makeQueryNode() {
  const filters = { eq: {}, is: {} };
  const node = {
    select: () => node,
    eq: (col, val) => {
      filters.eq[col] = val;
      return node;
    },
    is: (col, val) => {
      filters.is[col] = val;
      return node;
    },
    maybeSingle: () => {
      baseQueryCount += 1;

      if (scenario === "permission-failure") {
        return Promise.resolve({ data: null, error: new Error("permission denied for table lists") });
      }
      if (scenario === "missing-kind-column") {
        // First call always includes kind — simulate the column not existing.
        if ("kind" in filters.eq) {
          return Promise.resolve({ data: null, error: new Error('column "kind" does not exist') });
        }
        // Fallback call: no kind filter, but id/archived_at must still be present.
        assert.equal(filters.eq.id, "list-1", "fallback must still filter by exact id");
        assert.equal(filters.is.archived_at, null, "fallback must still require archived_at IS NULL");
        return Promise.resolve({ data: makeRow(), error: null });
      }

      // Every other scenario: kind + archived_at + id must all be present on the primary query.
      assert.equal(filters.eq.id, "list-1", "must filter by exact id");
      assert.equal(filters.eq.kind, "list", "must filter by kind = list");
      assert.equal(filters.is.archived_at, null, "must require archived_at IS NULL");

      if (scenario === "normal-task-list") return Promise.resolve({ data: makeRow(), error: null });
      if (scenario === "archived-list") return Promise.resolve({ data: null, error: null });
      if (scenario === "dm-group-row") return Promise.resolve({ data: null, error: null });
      if (scenario === "missing-row") return Promise.resolve({ data: null, error: null });
      throw new Error(`unhandled scenario: ${scenario}`);
    },
  };
  return node;
}

let mapperCalled = false;
let mapperShouldThrow = false;

mock.module("@/integrations/supabase/client", {
  namedExports: {
    supabase: { from: () => makeQueryNode() },
  },
});
mock.module("@/features/lists/map-list-rows", {
  namedExports: {
    mapDbListRows: async (qc, profileId, rows) => {
      mapperCalled = true;
      if (mapperShouldThrow) throw new Error("mapper failed");
      return rows.map((r) => ({ id: r.id, name: r.name, thingCount: 0 }));
    },
  },
});

const { fetchListDetail } = await import("@/features/lists/fetch-list-detail");

function reset(next) {
  scenario = next;
  baseQueryCount = 0;
  mapperCalled = false;
  mapperShouldThrow = false;
}

test("normal task List: exact id + archive/kind filters, mapped result, one base query", async () => {
  reset("normal-task-list");
  const row = await fetchListDetail({}, "owner-1", "list-1");
  assert.equal(row.id, "list-1");
  assert.equal(row.name, "Groceries");
  assert.equal(baseQueryCount, 1, "primary path must issue exactly one base query");
  assert.equal(mapperCalled, true);
});

test("archived List: no result, mapper not called", async () => {
  reset("archived-list");
  const row = await fetchListDetail({}, "owner-1", "list-1");
  assert.equal(row, null);
  assert.equal(mapperCalled, false, "an archived List must not reach the mapper");
});

test("DM/group row: not resolved as a task List on a schema supporting kind", async () => {
  reset("dm-group-row");
  const row = await fetchListDetail({}, "owner-1", "list-1");
  assert.equal(row, null, "a non-'list'-kind row must not resolve as a task List");
});

test("missing row: resolves to null", async () => {
  reset("missing-row");
  const row = await fetchListDetail({}, "owner-1", "list-1");
  assert.equal(row, null);
});

test("missing kind column: narrow fallback, same id/archive constraints, at most two base queries", async () => {
  reset("missing-kind-column");
  const row = await fetchListDetail({}, "owner-1", "list-1");
  assert.equal(row.id, "list-1");
  assert.equal(baseQueryCount, 2, "compatibility fallback must issue at most two base queries");
});

test("permission/network failure: rejects, does not trigger the compatibility fallback", async () => {
  reset("permission-failure");
  await assert.rejects(fetchListDetail({}, "owner-1", "list-1"), /permission denied/);
  assert.equal(baseQueryCount, 1, "a non-kind error must not trigger a second query");
});

test("mapper failure: rejects rather than returning a successful empty detail", async () => {
  reset("normal-task-list");
  mapperShouldThrow = true;
  await assert.rejects(fetchListDetail({}, "owner-1", "list-1"), /mapper failed/);
});
