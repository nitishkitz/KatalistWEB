import assert from "node:assert/strict";
import { test } from "node:test";
import { getThingCapabilities } from "../src/domain/capabilities.ts";

const owner = { id: "a", name: "Rahul", initials: "RM" };
const assignee = { id: "b", name: "Priya", initials: "PS" };

function thing(partial) {
  return {
    id: "t1",
    title: "Send final deck",
    creator: owner,
    owner,
    assignee,
    acknowledgement: "waiting_for_catch",
    workStatus: "not_started",
    ownerImportance: "now",
    personalPace: null,
    dueAt: null,
    dueHasTime: false,
    context: "work",
    listId: "l1",
    listName: "Android Release",
    cancelledAt: null,
    sortedAt: null,
    caughtAt: null,
    updatedAt: new Date().toISOString(),
    ...partial,
  };
}

test("Owner cannot Catch THEIRS", () => {
  const caps = getThingCapabilities(thing({}), "a");
  assert.equal(caps.canCatch, false);
});

test("Owner cannot change other's Pace", () => {
  const caps = getThingCapabilities(thing({ acknowledgement: "caught", personalPace: "later" }), "a");
  assert.equal(caps.canSetPace, false);
});

test("Owner cannot Sort other's assigned Thing", () => {
  const caps = getThingCapabilities(thing({ acknowledgement: "caught" }), "a");
  assert.equal(caps.canSort, false);
});

test("Assignee waiting can Catch", () => {
  assert.equal(getThingCapabilities(thing({}), "b").canCatch, true);
});

test("Assignee waiting cannot Pace", () => {
  assert.equal(getThingCapabilities(thing({}), "b").canSetPace, false);
});

test("Assignee caught can Pace", () => {
  assert.equal(getThingCapabilities(thing({ acknowledgement: "caught" }), "b").canSetPace, true);
});

test("Assignee caught can Sort", () => {
  assert.equal(getThingCapabilities(thing({ acknowledgement: "caught" }), "b").canSort, true);
});

test("Creator-only cannot mutate", () => {
  const caps = getThingCapabilities(thing({}), "creator-only");
  assert.equal(caps.canCatch, false);
  assert.equal(caps.canSetPace, false);
  assert.equal(caps.canSetImportance, false);
  assert.equal(caps.canSort, false);
  assert.equal(caps.canReassign, false);
});

test("Terminal cannot mutate", () => {
  const caps = getThingCapabilities(thing({ workStatus: "sorted", acknowledgement: "caught" }), "b");
  assert.equal(caps.canCatch, false);
  assert.equal(caps.canSetPace, false);
  assert.equal(caps.canSort, false);
});

test("View Only cannot workflow-mutate", () => {
  const caps = getThingCapabilities(thing({ acknowledgement: "caught" }), null);
  assert.equal(caps.canCatch, false);
  assert.equal(caps.canSetPace, false);
  assert.equal(caps.canSort, false);
  assert.equal(caps.canReassign, false);
});

test("Due is owner only", () => {
  const waiting = thing({});
  assert.equal(getThingCapabilities(waiting, "a").canSetDue, true);
  assert.equal(getThingCapabilities(waiting, "b").canSetDue, false);
  const caught = thing({ acknowledgement: "caught" });
  assert.equal(getThingCapabilities(caught, "a").canSetDue, true);
  assert.equal(getThingCapabilities(caught, "b").canSetDue, false);
});

test("Assignee after Catch can Sort; Owner of another's Thing cannot", () => {
  const caught = thing({ acknowledgement: "caught" });
  assert.equal(getThingCapabilities(caught, "b").canSort, true);
  assert.equal(getThingCapabilities(caught, "a").canSort, false);
});

test("Owner can Cancel; assignee-only cannot", () => {
  const caught = thing({ acknowledgement: "caught" });
  assert.equal(getThingCapabilities(caught, "a").canCancel, true);
  assert.equal(getThingCapabilities(caught, "b").canCancel, false);
  const self = thing({
    owner: assignee,
    assignee,
    acknowledgement: "caught",
  });
  assert.equal(getThingCapabilities(self, "b").canCancel, true);
});

test("Sorted Thing cannot mutate", () => {
  const sorted = thing({ workStatus: "sorted", acknowledgement: "caught", personalPace: "now" });
  const owner = getThingCapabilities(sorted, "a");
  const assigneeCaps = getThingCapabilities(sorted, "b");
  for (const caps of [owner, assigneeCaps]) {
    assert.equal(caps.canCatch, false);
    assert.equal(caps.canSetPace, false);
    assert.equal(caps.canSetImportance, false);
    assert.equal(caps.canSetDue, false);
    assert.equal(caps.canSetStatus, false);
    assert.equal(caps.canSort, false);
    assert.equal(caps.canCancel, false);
    assert.equal(caps.terminal, true);
  }
});

test("Cancelled Thing cannot mutate", () => {
  const cancelled = thing({ workStatus: "cancelled", cancelledAt: new Date().toISOString() });
  const owner = getThingCapabilities(cancelled, "a");
  const assigneeCaps = getThingCapabilities(cancelled, "b");
  for (const caps of [owner, assigneeCaps]) {
    assert.equal(caps.canCatch, false);
    assert.equal(caps.canSetPace, false);
    assert.equal(caps.canSetImportance, false);
    assert.equal(caps.canSetDue, false);
    assert.equal(caps.canSetStatus, false);
    assert.equal(caps.canSort, false);
    assert.equal(caps.canCancel, false);
    assert.equal(caps.terminal, true);
  }
});

