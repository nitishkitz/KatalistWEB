import assert from "node:assert/strict";
import { test, mock } from "node:test";

/**
 * Batch C1/P2 read-error policy: comment counts are stats, not
 * decorative — a failed thing_comments read must be distinguishable
 * from "this Thing genuinely has zero comments", not silently
 * collapsed to the same 0. mapDbThingRows represents this as
 * commentCount/unreadCommentCount: undefined on failure, vs. 0 on a
 * successful empty read. The failure must not blank the rest of the
 * row (title, listName, etc. still resolve) or the rest of the batch.
 */

const row = (overrides = {}) => ({
  id: "t1",
  title: "Thing 1",
  acknowledgement: "waiting_for_catch",
  work_status: "not_started",
  owner_importance: "next",
  assignee_personal_pace: null,
  due_at: null,
  due_has_time: false,
  context: "work",
  list_id: null,
  creator_actor_id: "a1",
  owner_actor_id: "a1",
  current_assignee_actor_id: "a1",
  cancelled_at: null,
  sorted_at: null,
  caught_at: null,
  updated_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  notes: null,
  ...overrides,
});

let commentsShouldFail = false;

const peopleMock = mock.module("@/features/people/resolve-actors", {
  namedExports: {
    resolveActorPeople: async () => new Map([["a1", { id: "a1", name: "Ada", initials: "A" }]]),
    personOrSomeone: (people, id) => people.get(id) ?? { id, name: "Someone", initials: "S" },
  },
});
const attachmentsMock = mock.module("@/features/things/attachments", {
  namedExports: {
    fetchRealAttachments: async () => new Map(),
  },
});
const clientMock = mock.module("@/integrations/supabase/client", {
  namedExports: {
    supabase: {
      from: (table) => {
        const node = {
          select: () => node,
          in: () => node,
          is: () => node,
          eq: () => node,
          then: (resolve) => {
            if (table === "thing_comments" && commentsShouldFail) {
              resolve({ data: null, error: new Error("thing_comments read failed") });
              return;
            }
            resolve({ data: [], error: null });
          },
        };
        return node;
      },
    },
  },
});

const { mapDbThingRows } = await import("@/features/things/map-thing-rows");

test("a successful comments read with zero rows reports commentCount: 0", async () => {
  commentsShouldFail = false;
  const [thing] = await mapDbThingRows([row()], "a1");
  assert.equal(thing.commentCount, 0);
  assert.equal(thing.unreadCommentCount, 0);
});

test("a failed comments read reports commentCount: undefined (unavailable), not 0, and does not blank the rest of the row", async () => {
  commentsShouldFail = true;
  try {
    const [thing] = await mapDbThingRows([row()], "a1");
    assert.equal(thing.commentCount, undefined, "unavailable must not masquerade as a confirmed zero");
    assert.equal(thing.unreadCommentCount, undefined);
    assert.equal(thing.id, "t1", "the rest of the row must still resolve despite the comment-count failure");
    assert.equal(thing.title, "Thing 1");
    assert.equal(thing.creator.name, "Ada");
  } finally {
    commentsShouldFail = false;
  }
});

test("cleanup", () => {
  peopleMock.restore();
  attachmentsMock.restore();
  clientMock.restore();
});
