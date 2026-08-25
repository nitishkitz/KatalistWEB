import assert from "node:assert/strict";
import test from "node:test";
import { deriveListView } from "@/features/lists/list-board-model";

const person = { id: "me", name: "Me", initials: "ME" };
function thing(id, acknowledgement, workStatus) {
  return { id, title: id, creator: person, owner: person, assignee: person, acknowledgement, workStatus, ownerImportance: "next", personalPace: "next", dueAt: null, dueHasTime: false, context: "work", listId: "list", listName: "List", cancelledAt: workStatus === "cancelled" ? "2026-08-25T00:00:00Z" : null, sortedAt: workStatus === "sorted" ? "2026-08-25T00:00:00Z" : null, caughtAt: acknowledgement === "caught" ? "2026-08-25T00:00:00Z" : null, updatedAt: "2026-08-25T00:00:00Z" };
}
const things = [thing("waiting", "waiting_for_catch", "not_started"), thing("not-started", "caught", "not_started"), thing("progress", "caught", "under_progress"), thing("sorted", "caught", "sorted"), thing("cancelled", "caught", "cancelled")];

test("List status filters expose every persisted work/acknowledgement state", () => {
  const view = (status) => deriveListView({ things, status, assigneeId: null, query: "", now: new Date() }).flat.map((row) => row.id);
  assert.deepEqual(view("waiting"), ["waiting"]);
  assert.deepEqual(view("not_started"), ["not-started"]);
  assert.deepEqual(view("progress"), ["progress"]);
  assert.deepEqual(view("sorted"), ["sorted"]);
  assert.deepEqual(view("cancelled"), ["cancelled"]);
});
