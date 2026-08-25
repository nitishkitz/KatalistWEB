import assert from "node:assert/strict";
import { test } from "node:test";
import * as model from "@/features/lists/list-board-model";

const person = (id) => ({ id, name: id, initials: id.slice(0, 2).toUpperCase() });
const thing = (overrides = {}) => ({
  id: overrides.id ?? crypto.randomUUID(),
  title: "Plan launch",
  creator: person("me"),
  owner: person("me"),
  assignee: person("me"),
  acknowledgement: "caught",
  workStatus: "not_started",
  ownerImportance: "next",
  personalPace: "next",
  dueAt: null,
  dueHasTime: false,
  context: "work",
  listId: "list-1",
  listName: "Launch",
  cancelledAt: null,
  sortedAt: null,
  caughtAt: "2026-08-25T00:00:00Z",
  createdAt: "2026-08-24T00:00:00Z",
  updatedAt: "2026-08-25T00:00:00Z",
  ...overrides,
});

test("List view includes all authorized assignees without ownership scope", () => {
  assert.equal(typeof model.deriveListView, "function");
  const input = [thing({ id: "mine" }), thing({ id: "theirs", assignee: person("sam") })];
  assert.deepEqual(model.deriveListView({ things: input, status: "all", assigneeId: null, query: "", now: new Date() }).flat.map((t) => t.id).sort(), ["mine", "theirs"]);
});

test("Waiting uses Owner Importance while Caught uses My Pace", () => {
  const board = model.deriveListView({
    things: [
      thing({ id: "waiting", acknowledgement: "waiting_for_catch", personalPace: null, ownerImportance: "later" }),
      thing({ id: "caught", personalPace: "now" }),
    ],
    status: "all", assigneeId: null, query: "", now: new Date(),
  });
  assert.deepEqual(board.now.map((t) => t.id), ["caught"]);
  assert.deepEqual(board.later.map((t) => t.id), ["waiting"]);
});

test("filters compose and expose involved assignees", () => {
  const sam = person("sam");
  const board = model.deriveListView({
    things: [thing({ id: "due-sam", title: "Due item", assignee: sam, dueAt: "2026-08-24T00:00:00Z" }), thing({ id: "other", title: "Unrelated", assignee: sam })],
    status: "due", assigneeId: "sam", query: "due", now: new Date("2026-08-25T00:00:00Z"),
  });
  assert.deepEqual(board.flat.map((t) => t.id), ["due-sam"]);
  assert.deepEqual(board.assignees.map((p) => p.id), ["sam"]);
});

test("only current assignee Caught active Things can drag", () => {
  assert.equal(model.canDragListThing(thing(), "me"), true);
  assert.equal(model.canDragListThing(thing({ acknowledgement: "waiting_for_catch" }), "me"), false);
  assert.equal(model.canDragListThing(thing({ assignee: person("sam") }), "me"), false);
  assert.equal(model.canDragListThing(thing({ workStatus: "sorted" }), "me"), false);
});
