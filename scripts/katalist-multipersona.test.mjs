import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { getThingCapabilities } from "@/domain/capabilities";
import { partitionCourt } from "@/domain/thing";
import {
  setDemoActorForTests,
  currentDemoActorId,
  resolveDemoActorId,
  resolveDemoPerson,
} from "@/features/demo/identities";
import { canDemoActorViewThing } from "@/features/demo/visibility";
import { courtFixtures } from "@/features/court/fixtures";
import { listFixtures } from "@/features/lists/fixtures";
import { bucketFixtures } from "@/features/buckets/fixtures";
import {
  tossLocalThing,
  catchLocal,
  setPaceLocal,
  setDueLocal,
  reassignLocal,
  shredLocal,
  restoreLocal,
  getThing,
  getShredded,
  getLists,
  createListLocal,
  getNotifications,
  markNotificationsRead,
  nudgeLocal,
  isRecentlyNudged,
  canNudge,
  createBucketLocal,
  getBuckets,
  addBucketRef,
  removeBucketRef,
  getBucketRefs,
  getGhostCandidate,
  dismissGhost,
  resetDemoLocalStateForTests,
  setStatusLocal,
} from "@/features/things/local-state";

afterEach(() => {
  resetDemoLocalStateForTests();
  setDemoActorForTests(null);
});

const CANONICAL_LISTS = {
  "Android Release": "l1",
  "Mobile App Launch": "l2",
  "Website Launch": "l3",
  "Q3 Marketing Plan": "l4",
  "Office Move Checklist": "l5",
};

test("a generated local persona keeps its own actor id instead of falling back to Priya", () => {
  const session = {
    user: {
      id: "demo-local-919876543210",
      user_metadata: {
        persona_key: "local-919876543210",
        actor_id: "p-local-919876543210",
        display_name: "Naga Reddy",
        initials: "NR",
      },
    },
  };

  assert.equal(resolveDemoActorId(session), "p-local-919876543210");
  assert.deepEqual(resolveDemoPerson(session), {
    id: "p-local-919876543210",
    name: "Naga Reddy",
    initials: "NR",
  });
});

test("SCENARIO A — assign → catch → pace", () => {
  resetDemoLocalStateForTests();
  setDemoActorForTests("p-priya");
  assert.equal(currentDemoActorId(), "p-priya");

  const thing = tossLocalThing({
    title: "Cross user test",
    context: "work",
    assigneeId: "p-arjun",
  });
  const thingId = thing.id;
  assert.equal(thing.creator.id, "p-priya");
  assert.equal(thing.owner.id, "p-priya");
  assert.equal(thing.assignee.id, "p-arjun");
  assert.equal(thing.acknowledgement, "waiting_for_catch");
  assert.equal(thing.personalPace, null);

  const priyaCourt = partitionCourt([getThing(thingId)], "p-priya");
  assert.equal(priyaCourt.theirs.some((t) => t.id === thingId), true);
  assert.equal(getThingCapabilities(getThing(thingId), "p-priya").canCatch, false);

  setDemoActorForTests("p-arjun");
  const same = getThing(thingId);
  assert.ok(same);
  assert.equal(same.id, thingId);
  assert.equal(getThingCapabilities(same, "p-arjun").canCatch, true);
  catchLocal(thingId);
  assert.equal(getThing(thingId).acknowledgement, "caught");
  setPaceLocal(thingId, "later");
  assert.equal(getThing(thingId).personalPace, "later");

  setDemoActorForTests("p-priya");
  const after = getThing(thingId);
  assert.equal(after.id, thingId);
  assert.equal(after.assignee.id, "p-arjun");
  assert.equal(after.personalPace, "later");
  assert.equal(getThingCapabilities(after, "p-priya").canSetPace, false);
});

test("SCENARIO B — reassign reset", () => {
  resetDemoLocalStateForTests();
  setDemoActorForTests("p-priya");
  const thing = tossLocalThing({
    title: "Reassign test",
    context: "work",
    assigneeId: "p-arjun",
  });
  const thingId = thing.id;
  setDemoActorForTests("p-arjun");
  catchLocal(thingId);
  setPaceLocal(thingId, "later");
  setDemoActorForTests("p-priya");
  reassignLocal(thingId, "p-sarah");
  const after = getThing(thingId);
  assert.equal(after.id, thingId);
  assert.equal(after.creator.id, "p-priya");
  assert.equal(after.owner.id, "p-priya");
  assert.equal(after.assignee.id, "p-sarah");
  assert.equal(after.acknowledgement, "waiting_for_catch");
  assert.equal(after.personalPace, null);
  assert.equal(after.caughtAt, null);
  setDemoActorForTests("p-sarah");
  const sarahThing = getThing(thingId);
  assert.equal(getThingCapabilities(sarahThing, "p-sarah").canCatch, true);
  assert.equal(getThingCapabilities(sarahThing, "p-sarah").canSetPace, false);
});

test("SCENARIO C — shred / restore persona scope and live authority", () => {
  resetDemoLocalStateForTests();
  setDemoActorForTests("p-priya");
  const thing = tossLocalThing({
    title: "Shred me",
    context: "work",
    assigneeId: "p-arjun",
  });
  const thingId = thing.id;
  assert.throws(() => shredLocal(thingId, "thing"));
  assert.ok(getThing(thingId));

  setDemoActorForTests("p-arjun");
  assert.throws(() => shredLocal(thingId, "thing"));
  assert.ok(getThing(thingId));

  catchLocal(thingId);
  setStatusLocal(thingId, "sorted");
  const snapshot = { ...getThing(thingId) };
  shredLocal(thingId, "thing");
  assert.equal(getThing(thingId), undefined);
  assert.ok(getShredded().some((s) => s.id === thingId && s.kind === "thing" && s.status === "sorted"));

  setDemoActorForTests("p-priya");
  assert.equal(getShredded().some((s) => s.id === thingId), false);
  assert.ok(getThing(thingId));
  assert.equal(getThing(thingId).workStatus, "sorted");

  restoreLocal(thingId, "thing");
  const restored = getThing(thingId);
  assert.ok(restored);
  assert.equal(restored.assignee.id, snapshot.assignee.id);
  assert.equal(restored.workStatus, "sorted");
  assert.equal(restored.acknowledgement, snapshot.acknowledgement);

  const list = createListLocal("Shred list", "work");
  assert.throws(() => shredLocal(list.id, "list"));
  assert.ok(getLists().some((l) => l.id === list.id));
});

test("SCENARIO D — notification recipient isolation", () => {
  resetDemoLocalStateForTests();
  setDemoActorForTests("p-priya");
  const thing = tossLocalThing({
    title: "Notify Arjun",
    context: "work",
    assigneeId: "p-arjun",
  });
  setDemoActorForTests("p-arjun");
  const arjunNotes = getNotifications();
  assert.ok(arjunNotes.some((n) => n.thingId === thing.id));
  setDemoActorForTests("p-sarah");
  assert.equal(getNotifications().some((n) => n.thingId === thing.id), false);
  setDemoActorForTests("p-arjun");
  markNotificationsRead();
  assert.ok(getNotifications().every((n) => n.read));
  setDemoActorForTests("p-sarah");
  setDemoActorForTests("p-arjun");
  assert.ok(getNotifications().every((n) => n.read));
});

test("SCENARIO E — due permission", () => {
  resetDemoLocalStateForTests();
  setDemoActorForTests("p-priya");
  const thing = tossLocalThing({
    title: "Due test",
    context: "work",
    assigneeId: "p-arjun",
  });
  const due = new Date().toISOString();
  setDueLocal(thing.id, due, false);
  assert.equal(getThing(thing.id).dueAt, due);

  setDemoActorForTests("p-arjun");
  catchLocal(thing.id);
  assert.throws(() => setDueLocal(thing.id, new Date().toISOString(), true));
});

test("SCENARIO F — nudge cooldown + terminal", () => {
  resetDemoLocalStateForTests();
  setDemoActorForTests("p-priya");
  const thing = tossLocalThing({
    title: "Nudge test",
    context: "work",
    assigneeId: "p-arjun",
  });
  assert.equal(getThingCapabilities(getThing(thing.id), "p-priya").canNudge, true);
  nudgeLocal(thing.id);
  assert.equal(isRecentlyNudged(thing.id), true);
  assert.throws(() => nudgeLocal(thing.id));
  assert.equal(canNudge(thing.id), false);

  setDemoActorForTests("p-arjun");
  catchLocal(thing.id);
  setStatusLocal(thing.id, "sorted");
  setDemoActorForTests("p-priya");
  assert.throws(() => nudgeLocal(thing.id));
});

test("SCENARIO G — bucket privacy", () => {
  resetDemoLocalStateForTests();
  setDemoActorForTests("p-priya");
  const bucket = createBucketLocal("Private QA", "work");
  assert.ok(getBuckets("work").some((b) => b.id === bucket.id));
  setDemoActorForTests("p-arjun");
  assert.equal(getBuckets("work").some((b) => b.id === bucket.id), false);

  setDemoActorForTests("p-priya");
  const thing = tossLocalThing({ title: "Bucketed", context: "work" });
  addBucketRef(bucket.id, { thingId: thing.id, title: thing.title, kind: "thing" });
  assert.ok(getBucketRefs(bucket.id).some((r) => r.thingId === thing.id));
  removeBucketRef(bucket.id, thing.id);
  assert.equal(getBucketRefs(bucket.id).some((r) => r.thingId === thing.id), false);
  assert.ok(getThing(thing.id));
});

test("SCENARIO H — doorman persona dismissal", () => {
  resetDemoLocalStateForTests();
  setDemoActorForTests("p-priya");
  const ghost = tossLocalThing({
    title: "Home NOW ghost",
    context: "home",
    ownerImportance: "now",
    assigneeId: "p-arjun",
  });
  const seen = getGhostCandidate("work");
  assert.ok(seen && seen.id === ghost.id);
  dismissGhost(ghost.id);
  assert.equal(getGhostCandidate("work")?.id === ghost.id, false);

  setDemoActorForTests("p-arjun");
  const arjunGhost = getGhostCandidate("work");
  assert.ok(arjunGhost && arjunGhost.id === ghost.id);
});

test("List fixture ID consistency", () => {
  for (const t of courtFixtures) {
    if (t.listId && t.listName && CANONICAL_LISTS[t.listName]) {
      assert.equal(t.listId, CANONICAL_LISTS[t.listName], `${t.id} ${t.listName}`);
    }
  }
  for (const l of listFixtures) {
    if (CANONICAL_LISTS[l.name]) assert.equal(l.id, CANONICAL_LISTS[l.name]);
  }
});

test("Bucket fixture previews use canonical IDs", () => {
  for (const b of bucketFixtures) {
    for (const p of b.previews) {
      if (p.kind === "thing") assert.ok(p.thingId, `${b.name} ${p.title}`);
      if (p.kind === "list") assert.ok(p.listId, `${b.name} ${p.title}`);
    }
  }
});

test("setDemoActorForTests wins over session", () => {
  setDemoActorForTests("p-arjun");
  assert.equal(currentDemoActorId(), "p-arjun");
  setDemoActorForTests("p-sarah");
  assert.equal(currentDemoActorId(), "p-sarah");
  setDemoActorForTests("p-priya");
  assert.equal(currentDemoActorId(), "p-priya");
});

test("Visibility helper is real domain function", () => {
  const t = tossLocalThing({ title: "Vis", context: "work", assigneeId: "p-arjun" });
  const lists = getLists();
  assert.equal(canDemoActorViewThing(t, "p-priya", lists), true);
  assert.equal(canDemoActorViewThing(t, "p-arjun", lists), true);
  assert.equal(canDemoActorViewThing(t, "p-mike", lists), false);
});
