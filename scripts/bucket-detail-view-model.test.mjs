import assert from "node:assert/strict";
import test from "node:test";
import {
  bucketPeople,
  bucketThingColumns,
  filterBucketThings,
} from "@/features/buckets/bucket-detail-view-model";

const person = (id, name) => ({ id, name, initials: name.slice(0, 2).toUpperCase() });

function thing(overrides = {}) {
  return {
    id: "thing-1",
    title: "Prepare launch notes",
    creator: person("creator", "Priya"),
    owner: person("owner", "Rahul"),
    assignedBy: person("assigner", "Maya"),
    assignee: person("assignee", "Arjun"),
    acknowledgement: "caught",
    workStatus: "sorted",
    ownerImportance: "now",
    personalPace: "later",
    dueAt: null,
    dueHasTime: false,
    context: "work",
    listId: null,
    listName: null,
    cancelledAt: null,
    sortedAt: "2026-08-25T10:00:00.000Z",
    caughtAt: "2026-08-25T09:00:00.000Z",
    updatedAt: "2026-08-25T10:00:00.000Z",
    ...overrides,
  };
}

test("Bucket columns keep My Pace and work status separate from acknowledgement and Owner Importance", () => {
  const columns = bucketThingColumns(thing());

  assert.deepEqual(columns, {
    assignment: {
      from: person("assigner", "Maya"),
      to: person("assignee", "Arjun"),
      selfAssigned: false,
    },
    pace: "later",
    status: "sorted",
  });
});

test("Bucket assignment flow preserves self-assignment without inventing another person", () => {
  const me = person("me", "Nithesh");
  assert.deepEqual(bucketThingColumns(thing({ assignedBy: me, assignee: me })).assignment, {
    from: me,
    to: me,
    selfAssigned: true,
  });
});

test("Bucket avatar choices include every involved person and put the current actor first", () => {
  const current = person("assignee", "Arjun");
  const second = thing({
    id: "thing-2",
    creator: current,
    assignedBy: person("other", "Zoya"),
  });

  assert.deepEqual(
    bucketPeople([thing(), second], current.id).map((candidate) => candidate.id),
    ["assignee", "assigner", "creator", "owner", "other"],
  );
});

test("selecting a Bucket avatar finds Things where that person is creator, owner, assigner, or assignee", () => {
  const maya = person("maya", "Maya");
  const source = [
    thing({ id: "created", creator: maya }),
    thing({ id: "owned", owner: maya }),
    thing({ id: "assigned", assignedBy: maya }),
    thing({ id: "received", assignee: maya }),
    thing({ id: "unrelated" }),
  ];

  assert.deepEqual(
    filterBucketThings(source, "", maya.id).map((candidate) => candidate.id),
    ["created", "owned", "assigned", "received"],
  );
});

test("Bucket search includes title, list, assigner, and assignee while composing with avatar selection", () => {
  const maya = person("maya", "Maya");
  const source = [
    thing({ id: "match", assignedBy: maya, listName: "Launch" }),
    thing({ id: "wrong-person", title: "Maya follow-up" }),
  ];

  assert.deepEqual(
    filterBucketThings(source, "launch", maya.id).map((candidate) => candidate.id),
    ["match"],
  );
  assert.deepEqual(
    filterBucketThings(source, "maya", maya.id).map((candidate) => candidate.id),
    ["match"],
  );
});
