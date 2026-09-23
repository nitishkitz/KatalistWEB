import assert from "node:assert/strict";
import { test } from "node:test";
import { getThingCapabilities } from "@/domain/capabilities";

/**
 * E02: "establish same-Thing cross-surface capability tests" before
 * extracting ThingDetailContent's shared sections. getThingCapabilities is
 * a pure function called identically from every surface (Court, Bucket
 * detail, List detail, Nudges, the Bridge) -- ThingDetailContent itself
 * calls it once per render regardless of `variant`, so pinning its
 * contract here is what actually protects "the same Thing looks the same
 * regardless of which surface opened it," not a per-surface render test.
 */
function makeThing(overrides = {}) {
  return {
    id: "thing-1",
    title: "Thing",
    workStatus: "not_started",
    acknowledgement: "waiting_for_catch",
    personalPace: null,
    ownerImportance: "next",
    creator: { id: "creator-1", name: "Creator" },
    owner: { id: "owner-1", name: "Owner" },
    assignee: { id: "assignee-1", name: "Assignee" },
    cancelledAt: null,
    ...overrides,
  };
}

test("null actor (unauthenticated/unresolved identity): no capability requiring an actor is ever true", () => {
  const caps = getThingCapabilities(makeThing(), null);
  assert.equal(caps.isOwner, false);
  assert.equal(caps.isAssignee, false);
  assert.equal(caps.canCatch, false);
  assert.equal(caps.canSetPace, false);
  assert.equal(caps.canSetImportance, false);
  assert.equal(caps.canSetDue, false);
  assert.equal(caps.canSetStatus, false);
  assert.equal(caps.canAssign, false);
  assert.equal(caps.canReassign, false);
  assert.equal(caps.canNudge, false);
  assert.equal(caps.canSort, false);
  assert.equal(caps.canCancel, false);
  assert.equal(caps.canComment, false, "canComment requires a resolved actor");
  assert.equal(caps.canAddToBucket, false);
});

test("owner (not the assignee): can manage the Thing, but cannot catch/pace/sort it themselves", () => {
  const caps = getThingCapabilities(makeThing(), "owner-1");
  assert.equal(caps.isOwner, true);
  assert.equal(caps.isAssignee, false);
  assert.equal(caps.canSetImportance, true);
  assert.equal(caps.canSetDue, true);
  assert.equal(caps.canAssign, true);
  assert.equal(caps.canReassign, true, "owner can reassign even while it's still waiting for catch");
  assert.equal(caps.canNudge, true, "owner can nudge since they are not the assignee");
  assert.equal(caps.canCancel, true);
  assert.equal(caps.canCatch, false, "catching is the assignee's action, not the owner's");
  assert.equal(caps.canSetPace, false);
  assert.equal(caps.canSort, false);
});

test("assignee who has not yet caught it (waiting_for_catch): can only catch", () => {
  const caps = getThingCapabilities(makeThing(), "assignee-1");
  assert.equal(caps.isAssignee, true);
  assert.equal(caps.canCatch, true);
  assert.equal(caps.canSetPace, false, "pace requires having caught it first");
  assert.equal(caps.canSort, false, "sort requires having caught it first");
  assert.equal(caps.canSetStatus, false);
  assert.equal(caps.canReassign, false, "an assignee who hasn't caught it yet cannot reassign");
});

test("assignee who has caught it (acknowledgement: caught): can pace/sort/set status/reassign, never catch again", () => {
  const caps = getThingCapabilities(makeThing({ acknowledgement: "caught" }), "assignee-1");
  assert.equal(caps.canCatch, false, "already caught -- catching again is not a thing");
  assert.equal(caps.canSetPace, true);
  assert.equal(caps.canSort, true);
  assert.equal(caps.canSetStatus, true);
  assert.equal(caps.canReassign, true, "a caught assignee can also hand it off");
});

test("owner who is also the assignee (self-assigned): owner powers plus catch/pace once caught, and canNudge is false", () => {
  const self = makeThing({ owner: { id: "p1", name: "P" }, assignee: { id: "p1", name: "P" } });
  const waiting = getThingCapabilities(self, "p1");
  assert.equal(waiting.isOwner, true);
  assert.equal(waiting.isAssignee, true);
  assert.equal(waiting.canCatch, true);
  assert.equal(waiting.canNudge, false, "nudging yourself makes no sense -- canNudge requires isOwner && !isAssignee");

  const caughtSelf = makeThing({
    owner: { id: "p1", name: "P" },
    assignee: { id: "p1", name: "P" },
    acknowledgement: "caught",
  });
  const caught = getThingCapabilities(caughtSelf, "p1");
  assert.equal(caught.canSetPace, true);
  assert.equal(caught.canSort, true);
});

test("unrelated actor (neither owner nor assignee): can comment and add to bucket, nothing else", () => {
  const caps = getThingCapabilities(makeThing(), "someone-else");
  assert.equal(caps.isOwner, false);
  assert.equal(caps.isAssignee, false);
  assert.equal(caps.canCatch, false);
  assert.equal(caps.canSetPace, false);
  assert.equal(caps.canSetImportance, false);
  assert.equal(caps.canSetDue, false);
  assert.equal(caps.canAssign, false);
  assert.equal(caps.canReassign, false);
  assert.equal(caps.canNudge, false);
  assert.equal(caps.canCancel, false);
  assert.equal(caps.canComment, true);
  assert.equal(caps.canAddToBucket, true);
  assert.equal(caps.canShred, true, "an unrelated actor can shred (personally hide) it for themselves");
});

for (const workStatus of ["sorted", "cancelled"]) {
  test(`terminal state (workStatus: ${workStatus}): owner and assignee both lose every mutating capability except reopen/shred`, () => {
    const thing = makeThing({ workStatus, acknowledgement: "caught" });
    const ownerCaps = getThingCapabilities(thing, "owner-1");
    assert.equal(ownerCaps.terminal, true);
    assert.equal(ownerCaps.canSetImportance, false);
    assert.equal(ownerCaps.canSetDue, false);
    assert.equal(ownerCaps.canAssign, false);
    assert.equal(ownerCaps.canReassign, false);
    assert.equal(ownerCaps.canCancel, false, "already terminal -- cannot cancel again");
    assert.equal(ownerCaps.canNudge, false);

    const assigneeCaps = getThingCapabilities(thing, "assignee-1");
    assert.equal(assigneeCaps.canCatch, false);
    assert.equal(assigneeCaps.canSetPace, false);
    assert.equal(assigneeCaps.canSort, false);
    assert.equal(assigneeCaps.canSetStatus, false);
  });
}

test("cancelledAt alone (without workStatus === \"cancelled\") is still treated as terminal", () => {
  const caps = getThingCapabilities(makeThing({ cancelledAt: "2026-01-01T00:00:00Z" }), "owner-1");
  assert.equal(caps.terminal, true, "cancelledAt is an independent terminal signal, not just a mirror of workStatus");
});

test("reopen is owner-only and only available while actually cancelled", () => {
  const cancelled = makeThing({ workStatus: "cancelled" });
  assert.equal(getThingCapabilities(cancelled, "owner-1").canReopen, true);
  assert.equal(getThingCapabilities(cancelled, "assignee-1").canReopen, false, "reopen is owner-only, not assignee-accessible");

  const sortedNotCancelled = makeThing({ workStatus: "sorted" });
  assert.equal(getThingCapabilities(sortedNotCancelled, "owner-1").canReopen, false, "sorted (not cancelled) has no reopen action");
});

test("revoked access is modeled by the caller no longer resolving myActorId, not by a fifth capabilities state", () => {
  // getThingCapabilities itself has no notion of "revoked" -- a caller
  // whose access was revoked (e.g. removed from a shared List) simply
  // stops being able to resolve their own actor id for this Thing, which
  // is the same shape as the "null actor" case already covered above.
  // This test exists so that contract is explicit, not implied.
  const before = getThingCapabilities(makeThing(), "assignee-1");
  assert.equal(before.canCatch, true);
  const afterRevocation = getThingCapabilities(makeThing(), null);
  assert.equal(afterRevocation.canCatch, false);
});
