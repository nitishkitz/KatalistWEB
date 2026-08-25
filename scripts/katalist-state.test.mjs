import assert from "node:assert/strict";
import { test } from "node:test";
import { laneOf, partitionCourt } from "@/domain/thing";

const me = { id: "me", name: "Me", initials: "ME" };
const them = { id: "them", name: "Arjun", initials: "AM" };

test("mine lanes exclude theirs", () => {
  const things = [
    { id: "1", assignee: me, owner: me, acknowledgement: "caught", personalPace: "now", ownerImportance: "later", workStatus: "not_started", cancelledAt: null },
    { id: "2", assignee: them, owner: me, acknowledgement: "waiting_for_catch", personalPace: null, ownerImportance: "now", workStatus: "not_started", cancelledAt: null },
  ];
  const p = partitionCourt(things, "me");
  assert.equal(p.now.length, 1);
  assert.equal(p.now[0].id, "1");
  assert.equal(p.theirs.length, 1);
  assert.equal(p.theirs[0].id, "2");
  assert.ok(!p.now.some((t) => p.theirs.includes(t)));
});

test("waiting for catch uses owner importance until Catch", () => {
  assert.equal(
    laneOf({ acknowledgement: "waiting_for_catch", personalPace: null, ownerImportance: "later" }),
    "later",
  );
  assert.equal(
    laneOf({ acknowledgement: "waiting_for_catch", personalPace: null, ownerImportance: "now" }),
    "now",
  );
  assert.equal(
    laneOf({ acknowledgement: "waiting_for_catch", personalPace: null, ownerImportance: "next" }),
    "next",
  );
});

test("caught uses personal pace, not owner importance", () => {
  const thing = { acknowledgement: "caught", personalPace: "later", ownerImportance: "now" };
  assert.equal(laneOf(thing), "later");
});

test("sorted things leave court", () => {
  const things = [
    { id: "1", assignee: me, owner: me, acknowledgement: "caught", personalPace: "now", ownerImportance: "now", workStatus: "sorted", cancelledAt: null },
  ];
  const p = partitionCourt(things, "me");
  assert.equal(p.now.length, 0);
  assert.equal(p.theirs.length, 0);
});

test("empty live result stays empty", () => {
  const p = partitionCourt([], "me");
  assert.equal(p.now.length + p.next.length + p.later.length + p.theirs.length, 0);
});

test("visible-not-owned list Thing is not THEIRS", () => {
  const otherOwner = { id: "other", name: "Other", initials: "OT" };
  const things = [
    { id: "seen", assignee: them, owner: otherOwner, acknowledgement: "caught", personalPace: "now", ownerImportance: "now", workStatus: "not_started", cancelledAt: null },
  ];
  const p = partitionCourt(things, "me");
  assert.equal(p.theirs.length, 0);
  assert.equal(p.mine.length, 0);
});
