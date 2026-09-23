import assert from "node:assert/strict";
import { test, mock } from "node:test";

/**
 * Batch C1 error-propagation requirement: a failed list_members or
 * Things read must reject mapDbListRows(), not silently present as
 * "this List has no members/Things". Cover-URL signing stays
 * nonblocking (it already fails open internally via its own try/catch)
 * — not tested here as a failure case, since that's the one query this
 * requirement deliberately excludes.
 */

let failingTable = null;

const chainable = (table) => {
  const node = {
    select: () => node,
    in: () => node,
    then: (resolve) => {
      if (table === failingTable) {
        resolve({ data: null, error: new Error(`${table} read failed`) });
        return;
      }
      const byTable = {
        list_members: [{ list_id: "list-1", profile_id: "owner-1", role: "owner" }],
        things: [{ id: "t1", list_id: "list-1", work_status: "sorted" }],
      };
      resolve({ data: byTable[table] ?? [], error: null });
    },
  };
  return node;
};

mock.module("@/integrations/supabase/client", {
  namedExports: {
    supabase: {
      storage: { from: () => ({ createSignedUrls: async () => ({ data: [] }) }) },
      from: (table) => chainable(table),
    },
  },
});
mock.module("@/features/people/directory", {
  namedExports: {
    getProfileIdentities: async () => [{ id: "owner-1", display_name: "Ada", avatar_url: null }],
    matchAvatarByName: () => null,
  },
});

const { mapDbListRows } = await import("@/features/lists/map-list-rows");

const row = {
  id: "list-1",
  name: "Groceries",
  context: "work",
  owner_profile_id: "owner-1",
  updated_at: new Date().toISOString(),
  description: null,
  cover_storage_path: null,
};

test("mapDbListRows rejects when the list_members read fails, instead of returning a memberless List", async () => {
  failingTable = "list_members";
  try {
    await assert.rejects(mapDbListRows({}, "owner-1", [row]), /list_members read failed/);
  } finally {
    failingTable = null;
  }
});

test("mapDbListRows rejects when the Things read fails, instead of silently reporting zero Things", async () => {
  failingTable = "things";
  try {
    await assert.rejects(mapDbListRows({}, "owner-1", [row]), /things read failed/);
  } finally {
    failingTable = null;
  }
});

test("sanity: mapDbListRows still succeeds when nothing fails", async () => {
  const [mapped] = await mapDbListRows({}, "owner-1", [row]);
  assert.equal(mapped.id, "list-1");
  assert.equal(mapped.thingCount, 1);
});
