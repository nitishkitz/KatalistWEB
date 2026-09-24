import assert from "node:assert/strict";
import { test, mock } from "node:test";

let detailAttachmentReads = 0;
let commentRowReads = 0;
mock.module("@/features/people/resolve-actors", {
  namedExports: {
    resolveActorPeople: async () => new Map([["actor", { id: "actor", name: "Ada", initials: "A" }]]),
    personOrSomeone: (people, id) => people.get(id),
  },
});
mock.module("@/features/things/attachments", {
  namedExports: {
    fetchRealAttachments: async () => { detailAttachmentReads++; return new Map(); },
    signThingAttachmentPaths: async () => new Map(),
  },
});
mock.module("@/features/things/fetch-thing-overview-stats", {
  namedExports: {
    fetchThingOverviewStats: async () => new Map([["thing-1", {
      commentCount: 7, unreadCommentCount: 2, attachmentCount: 3,
      previewFile: { id: "file-1", name: "cover.png", type: "image", url: "https://example.invalid/cover" },
    }]]),
  },
});
mock.module("@/integrations/supabase/client", {
  namedExports: { supabase: { from: () => { commentRowReads++; throw new Error("overview read full rows"); } } },
});

const { mapDbThingRows } = await import("@/features/things/map-thing-rows");

test("overview carries exact counts and one preview without masquerading as full detail", async () => {
  const row = {
    id: "thing-1", title: "Review", acknowledgement: "caught", work_status: "under_progress",
    owner_importance: "next", assignee_personal_pace: "next", due_at: null, due_has_time: false,
    context: "work", list_id: null, creator_actor_id: "actor", owner_actor_id: "actor",
    current_assignee_actor_id: "actor", cancelled_at: null, sorted_at: null, caught_at: null,
    updated_at: "2026-09-24T12:00:00Z", created_at: "2026-09-24T12:00:00Z",
  };
  const [thing] = await mapDbThingRows([row], "actor", "overview");
  assert.equal(thing.detailLevel, "overview");
  assert.equal(thing.description, null);
  assert.equal(thing.commentCount, 7);
  assert.equal(thing.unreadCommentCount, 2);
  assert.equal(thing.attachmentCount, 3);
  assert.deepEqual(thing.files.map(({ id }) => id), ["file-1"]);
  assert.equal(detailAttachmentReads, 0);
  assert.equal(commentRowReads, 0);
});
