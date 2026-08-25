import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";

import { getThingCapabilities } from "@/domain/capabilities";
import { partitionCourt } from "@/domain/thing";
import { setDemoActorForTests } from "@/features/demo/identities";
import { mapNotificationRow } from "@/features/notifications/use-notifications";
import {
  catchLocal,
  getActivity,
  getThing,
  reassignLocal,
  resetDemoLocalStateForTests,
  tossLocalThing,
} from "@/features/things/local-state";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const owner = { id: "a", name: "Rahul", initials: "RM" };
const assignee = { id: "b", name: "Priya", initials: "PS" };
const stranger = { id: "c", name: "Stranger", initials: "ST" };

function thing(partial = {}) {
  return {
    id: "t1",
    title: "Send final deck",
    creator: owner,
    owner,
    assignee,
    acknowledgement: "waiting_for_catch",
    workStatus: "not_started",
    ownerImportance: "next",
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

function source(rel) {
  return readFileSync(join(root, rel), "utf8");
}

function assertCatchSurface(rel, label) {
  const src = source(rel);
  const usesShared = src.includes("CatchActionButton");
  const usesInline =
    /getThingCapabilities/.test(src) && /canCatch/.test(src) && /rpcCatchThing/.test(src);
  assert.ok(usesShared || usesInline, `${label} must gate Catch on capabilities and call catch_thing`);
  assert.match(src, /CatchActionButton|>Catch<|>Catch\s|["'`]Catch["'`]/, `${label} must expose a Catch action`);
  assert.equal(src.includes("Caught It"), false, `${label} must not hide Catch behind Caught It`);
}

afterEach(() => {
  resetDemoLocalStateForTests();
  setDemoActorForTests(null);
});

test("Catch action button authorizes through capabilities and catch_thing", () => {
  const src = source("src/features/things/CatchActionButton.tsx");
  assert.match(src, /getThingCapabilities/);
  assert.match(src, /canCatch/);
  assert.match(src, /rpcCatchThing/);
  assert.match(src, /Catch \$\{thing\.title\}|>Catch</);
});

test("Court card, mobile card, list row, and Thing Detail all expose Catch", () => {
  assertCatchSurface("src/features/court/CourtThingCard.tsx", "Court card");
  assertCatchSurface("src/features/court/ThingCard.tsx", "mobile Court card");
  assertCatchSurface("src/components/katalist/ThingRow.tsx", "List row");
  assertCatchSurface("src/features/things/ThingDetailSheet.tsx", "Thing Detail");
});

test("Self Toss lands in NOW and Catch is eligible until caught", () => {
  setDemoActorForTests("p-priya");
  const self = tossLocalThing({ title: "Self catch", context: "work", assigneeId: "p-priya" });
  const court = partitionCourt([self], "p-priya");
  assert.equal(court.now.some((row) => row.id === self.id), true);
  assert.equal(court.theirs.some((row) => row.id === self.id), false);
  const waiting = getThingCapabilities(self, "p-priya");
  assert.equal(waiting.canCatch, true);
  assert.equal(waiting.isAssignee, true);
  assert.equal(waiting.isOwner, true);
  catchLocal(self.id);
  const after = getThing(self.id);
  assert.equal(after.acknowledgement, "caught");
  assert.equal(after.workStatus, "not_started");
  assert.equal(after.personalPace, "next");
  assert.ok(after.caughtAt);
  assert.equal(getThingCapabilities(after, "p-priya").canCatch, false);
  assert.equal(getThing(self.id).acknowledgement, "caught");
});

test("Delegated Toss: assignee can Catch; creator and stranger cannot", () => {
  setDemoActorForTests("p-priya");
  const delegated = tossLocalThing({
    title: "Delegated catch",
    context: "work",
    assigneeId: "p-arjun",
  });
  assert.equal(getThingCapabilities(delegated, "p-priya").canCatch, false);
  assert.equal(getThingCapabilities(delegated, "p-mike").canCatch, false);
  assert.equal(getThingCapabilities(delegated, null).canCatch, false);
  const creatorCourt = partitionCourt([delegated], "p-priya");
  assert.equal(creatorCourt.theirs.some((row) => row.id === delegated.id), true);
  assert.equal(creatorCourt.now.some((row) => row.id === delegated.id), false);
  setDemoActorForTests("p-arjun");
  const assigneeCourt = partitionCourt([getThing(delegated.id)], "p-arjun");
  assert.equal(assigneeCourt.now.some((row) => row.id === delegated.id), true);
  assert.equal(getThingCapabilities(getThing(delegated.id), "p-arjun").canCatch, true);
  catchLocal(delegated.id);
  assert.equal(getThing(delegated.id).acknowledgement, "caught");
});

test("Reassign before Catch moves eligibility to the new assignee", () => {
  setDemoActorForTests("p-priya");
  const row = tossLocalThing({ title: "Reassign catch", context: "work", assigneeId: "p-arjun" });
  assert.equal(getThingCapabilities(row, "p-arjun").canCatch, true);
  reassignLocal(row.id, "p-sarah");
  const moved = getThing(row.id);
  assert.equal(moved.assignee.id, "p-sarah");
  assert.equal(moved.acknowledgement, "waiting_for_catch");
  assert.equal(getThingCapabilities(moved, "p-arjun").canCatch, false);
  assert.equal(getThingCapabilities(moved, "p-priya").canCatch, false);
  assert.equal(getThingCapabilities(moved, "p-sarah").canCatch, true);
});

test("Double Catch is idempotent and does not duplicate history", () => {
  setDemoActorForTests("p-priya");
  const row = tossLocalThing({ title: "Double catch", context: "work", assigneeId: "p-priya" });
  catchLocal(row.id);
  const first = getThing(row.id);
  const events = getActivity(row.id).filter((event) => event.event === "caught");
  assert.equal(events.length, 1);
  catchLocal(row.id);
  const second = getThing(row.id);
  assert.equal(second.acknowledgement, "caught");
  assert.equal(second.caughtAt, first.caughtAt);
  assert.equal(getActivity(row.id).filter((event) => event.event === "caught").length, 1);
});

test("Notification deep-link opens the Thing so Catch can be authorized there", () => {
  const thingId = "11111111-1111-4111-8111-111111111111";
  assert.equal(
    mapNotificationRow({
      id: "n1",
      title: "Assigned",
      body: "Catch this",
      read_at: null,
      created_at: "2026-08-25T00:00:00Z",
      thing_id: thingId,
      list_id: null,
    }).path,
    `/?thing=${thingId}`,
  );
  const indexSrc = source("src/routes/index.tsx");
  assert.match(indexSrc, /ThingDetailSheet/);
  assert.match(indexSrc, /thing:/);
  const detail = source("src/features/things/ThingDetailSheet.tsx");
  assert.match(detail, /canCatch/);
  assert.match(detail, /CatchActionButton|rpcCatchThing/);
});

test("Capability predicate stays assignee + waiting + non-terminal", () => {
  assert.equal(getThingCapabilities(thing(), "b").canCatch, true);
  assert.equal(getThingCapabilities(thing(), "a").canCatch, false);
  assert.equal(getThingCapabilities(thing(), stranger.id).canCatch, false);
  assert.equal(getThingCapabilities(thing({ acknowledgement: "caught" }), "b").canCatch, false);
  assert.equal(
    getThingCapabilities(thing({ workStatus: "sorted", acknowledgement: "waiting_for_catch" }), "b")
      .canCatch,
    false,
  );
});
