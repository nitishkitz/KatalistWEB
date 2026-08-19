import assert from "node:assert/strict";
import { test } from "node:test";

function laneOf(thing) {
  if (thing.acknowledgement === "waiting_for_catch") return "now";
  return thing.personalPace ?? "next";
}

function isActiveThing(thing) {
  return thing.workStatus !== "sorted" && thing.workStatus !== "cancelled" && !thing.cancelledAt;
}

function partitionCourt(things, myActorId) {
  const active = things.filter(isActiveThing);
  const mine = active.filter((t) => t.assignee.id === myActorId);
  const theirs = active.filter((t) => t.assignee.id !== myActorId);
  return {
    now: mine.filter((t) => laneOf(t) === "now"),
    next: mine.filter((t) => laneOf(t) === "next"),
    later: mine.filter((t) => laneOf(t) === "later"),
    theirs,
  };
}

const me = { id: "me", name: "Me", initials: "ME" };
const them = { id: "them", name: "Arjun", initials: "AM" };

test("mine lanes exclude theirs", () => {
  const things = [
    { id: "1", assignee: me, acknowledgement: "caught", personalPace: "now", ownerImportance: "later", workStatus: "not_started", cancelledAt: null },
    { id: "2", assignee: them, acknowledgement: "waiting_for_catch", personalPace: null, ownerImportance: "now", workStatus: "not_started", cancelledAt: null },
  ];
  const p = partitionCourt(things, "me");
  assert.equal(p.now.length, 1);
  assert.equal(p.now[0].id, "1");
  assert.equal(p.theirs.length, 1);
  assert.equal(p.theirs[0].id, "2");
  assert.ok(!p.now.some((t) => p.theirs.includes(t)));
});

test("waiting for catch is incoming NOW, not owner importance", () => {
  const thing = { acknowledgement: "waiting_for_catch", personalPace: null, ownerImportance: "later" };
  assert.equal(laneOf(thing), "now");
});

test("caught uses personal pace, not owner importance", () => {
  const thing = { acknowledgement: "caught", personalPace: "later", ownerImportance: "now" };
  assert.equal(laneOf(thing), "later");
});

test("sorted things leave court", () => {
  const things = [
    { id: "1", assignee: me, acknowledgement: "caught", personalPace: "now", ownerImportance: "now", workStatus: "sorted", cancelledAt: null },
  ];
  const p = partitionCourt(things, "me");
  assert.equal(p.now.length, 0);
  assert.equal(p.theirs.length, 0);
});

test("empty live result stays empty", () => {
  const p = partitionCourt([], "me");
  assert.equal(p.now.length + p.next.length + p.later.length + p.theirs.length, 0);
});
