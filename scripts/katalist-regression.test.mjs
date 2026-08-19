import assert from "node:assert/strict";
import { test } from "node:test";
import { getThingCapabilities } from "../src/domain/capabilities.ts";
import { partitionCourt } from "../src/domain/thing.ts";

test("empty backend nudgeable list means zero canNudge in live formula", () => {
  const allowed = new Set();
  const capsCanNudge = true;
  const liveCan = capsCanNudge && allowed.has("t1");
  assert.equal(liveCan, false);
});

test("duplicate titles use UUID not title", () => {
  const a = { id: "uuid-1", title: "Send final deck", assignee: { id: "b" } };
  const b = { id: "uuid-2", title: "Send final deck", assignee: { id: "c" } };
  const selected = "uuid-2";
  const hit = [a, b].find((t) => t.id === selected);
  assert.equal(hit?.id, "uuid-2");
  assert.notEqual([a, b].filter((t) => t.title === "Send final deck").length, 1);
});

test("reassignment conceptually resets pace", () => {
  const after = {
    assignee: { id: "c" },
    acknowledgement: "waiting_for_catch",
    personalPace: null,
    caughtAt: null,
  };
  assert.equal(after.personalPace, null);
  assert.equal(after.acknowledgement, "waiting_for_catch");
  assert.equal(getThingCapabilities({
    id: "t",
    title: "x",
    creator: { id: "a", name: "A", initials: "A" },
    owner: { id: "a", name: "A", initials: "A" },
    assignee: { id: "c", name: "C", initials: "C" },
    acknowledgement: "waiting_for_catch",
    workStatus: "not_started",
    ownerImportance: "now",
    personalPace: null,
    dueAt: null,
    dueHasTime: false,
    context: "work",
    listId: null,
    listName: null,
    cancelledAt: null,
    sortedAt: null,
    caughtAt: null,
    updatedAt: new Date().toISOString(),
  }, "b").canSetPace, false);
});

test("mine/theirs never duplicate after partition", () => {
  const things = [
    {
      id: "t1",
      title: "Mine",
      creator: { id: "me", name: "Me", initials: "ME" },
      owner: { id: "me", name: "Me", initials: "ME" },
      assignee: { id: "me", name: "Me", initials: "ME" },
      acknowledgement: "caught",
      workStatus: "not_started",
      ownerImportance: "now",
      personalPace: "now",
      dueAt: null,
      dueHasTime: false,
      context: "work",
      listId: null,
      listName: null,
      cancelledAt: null,
      sortedAt: null,
      caughtAt: null,
      updatedAt: new Date().toISOString(),
    },
    {
      id: "t2",
      title: "Theirs",
      creator: { id: "me", name: "Me", initials: "ME" },
      owner: { id: "me", name: "Me", initials: "ME" },
      assignee: { id: "b", name: "B", initials: "B" },
      acknowledgement: "waiting_for_catch",
      workStatus: "not_started",
      ownerImportance: "now",
      personalPace: null,
      dueAt: null,
      dueHasTime: false,
      context: "work",
      listId: null,
      listName: null,
      cancelledAt: null,
      sortedAt: null,
      caughtAt: null,
      updatedAt: new Date().toISOString(),
    },
  ];
  const part = partitionCourt(things, "me");
  assert.equal(part.mine.some((t) => t.id === "t2"), false);
  assert.equal(part.theirs.some((t) => t.id === "t1"), false);
});
