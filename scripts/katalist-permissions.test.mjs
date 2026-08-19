import assert from "node:assert/strict";
import { test } from "node:test";

function getThingCapabilities(thing, myActorId) {
  const terminal = thing.workStatus === "sorted" || thing.workStatus === "cancelled" || Boolean(thing.cancelledAt);
  const isAssignee = Boolean(myActorId && thing.assignee.id === myActorId);
  const isOwner = Boolean(myActorId && thing.owner.id === myActorId);
  const caught = thing.acknowledgement === "caught";
  const waiting = thing.acknowledgement === "waiting_for_catch";
  return {
    canCatch: Boolean(isAssignee && waiting && !terminal),
    canSetPace: Boolean(isAssignee && caught && !terminal),
    canSetImportance: Boolean(isOwner && !terminal),
    canNudge: Boolean(isOwner && !isAssignee && !terminal),
    isAssignee,
    isOwner,
  };
}

const owner = { id: "a", name: "Rahul" };
const assignee = { id: "b", name: "Priya" };

test("THEIRS owner cannot Catch", () => {
  const thing = {
    owner,
    assignee,
    acknowledgement: "waiting_for_catch",
    workStatus: "not_started",
    cancelledAt: null,
  };
  const caps = getThingCapabilities(thing, "a");
  assert.equal(caps.canCatch, false);
  assert.equal(caps.canSetPace, false);
  assert.equal(caps.canSetImportance, true);
});

test("assignee waiting can Catch, cannot set Pace", () => {
  const thing = {
    owner,
    assignee,
    acknowledgement: "waiting_for_catch",
    workStatus: "not_started",
    cancelledAt: null,
  };
  const caps = getThingCapabilities(thing, "b");
  assert.equal(caps.canCatch, true);
  assert.equal(caps.canSetPace, false);
});

test("assignee after Catch can set Pace, Catch hidden", () => {
  const thing = {
    owner,
    assignee,
    acknowledgement: "caught",
    workStatus: "not_started",
    cancelledAt: null,
  };
  const caps = getThingCapabilities(thing, "b");
  assert.equal(caps.canCatch, false);
  assert.equal(caps.canSetPace, true);
  const ownerCaps = getThingCapabilities(thing, "a");
  assert.equal(ownerCaps.canSetPace, false);
});

test("creator-only has no catch/pace/importance", () => {
  const thing = {
    owner,
    assignee,
    acknowledgement: "waiting_for_catch",
    workStatus: "not_started",
    cancelledAt: null,
  };
  const caps = getThingCapabilities(thing, "creator-only");
  assert.equal(caps.canCatch, false);
  assert.equal(caps.canSetPace, false);
  assert.equal(caps.canSetImportance, false);
});
