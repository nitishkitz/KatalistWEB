import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { isActiveThing, partitionCourt } from "@/domain/thing";
import { getThingCapabilities } from "@/domain/capabilities";
import { setDemoActorForTests } from "@/features/demo/identities";
import {
  addBucketRef,
  catchLocal,
  createBucketLocal,
  createListLocal,
  deleteBucketLocal,
  getBucketRefs,
  getBuckets,
  getListById,
  getThing,
  removeBucketRef,
  renameBucketLocal,
  resetDemoLocalStateForTests,
  setImportanceLocal,
  setPaceLocal,
  setStatusLocal,
  tossLocalThing,
} from "@/features/things/local-state";

afterEach(() => {
  resetDemoLocalStateForTests();
  setDemoActorForTests(null);
});

test("SCENARIO A — add Thing creates a reference to the same canonical object", () => {
  setDemoActorForTests("p-priya");
  const thing = tossLocalThing({ title: "Prepare release notes", context: "work" });
  const bucket = createBucketLocal("Focus B", "work");
  addBucketRef(bucket.id, { thingId: thing.id, title: thing.title, kind: "thing" });

  const refs = getBucketRefs(bucket.id);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].thingId, thing.id);
  assert.equal(refs[0].kind, "thing");
  const resolved = getThing(refs[0].thingId);
  assert.ok(resolved);
  assert.equal(resolved.id, thing.id);
  assert.equal(resolved.title, "Prepare release notes");
  assert.equal(resolved.owner.id, "p-priya");
});

test("SCENARIO B — mutating the Thing updates the Bucket reference (no snapshot)", () => {
  setDemoActorForTests("p-priya");
  const thing = tossLocalThing({ title: "Same object X", context: "work" });
  const bucket = createBucketLocal("Lens", "work");
  addBucketRef(bucket.id, { thingId: thing.id, title: thing.title, kind: "thing" });
  const snapshotTitle = getBucketRefs(bucket.id)[0].title;

  setPaceLocal(thing.id, "later");
  setImportanceLocal(thing.id, "now");
  setStatusLocal(thing.id, "under_progress");

  const ref = getBucketRefs(bucket.id).find((r) => r.thingId === thing.id);
  assert.ok(ref);
  const resolved = getThing(ref.thingId);
  assert.equal(resolved.id, thing.id);
  assert.equal(resolved.personalPace, "later");
  assert.equal(resolved.ownerImportance, "now");
  assert.equal(resolved.workStatus, "under_progress");
  assert.equal(snapshotTitle, "Same object X");
});

test("SCENARIO C — Sorted leaves Court but remains in the Bucket", () => {
  setDemoActorForTests("p-priya");
  const thing = tossLocalThing({
    title: "Ship checklist",
    context: "work",
    assigneeId: "p-arjun",
  });
  const bucket = createBucketLocal("Ship Week", "work");
  addBucketRef(bucket.id, { thingId: thing.id, title: thing.title, kind: "thing" });

  setDemoActorForTests("p-arjun");
  assert.equal(getThingCapabilities(getThing(thing.id), "p-arjun").canCatch, true);
  catchLocal(thing.id);
  assert.equal(getThingCapabilities(getThing(thing.id), "p-arjun").canSort, true);
  setStatusLocal(thing.id, "sorted");

  const after = getThing(thing.id);
  assert.equal(after.workStatus, "sorted");
  assert.equal(isActiveThing(after), false);
  const court = partitionCourt([after], "p-arjun");
  assert.equal(court.now.length + court.next.length + court.later.length + court.theirs.length, 0);

  setDemoActorForTests("p-priya");
  const refs = getBucketRefs(bucket.id);
  assert.ok(refs.some((r) => r.thingId === thing.id));
  assert.equal(getThing(thing.id).workStatus, "sorted");
});

test("SCENARIO D — remove reference does not delete the Thing", () => {
  setDemoActorForTests("p-priya");
  const thing = tossLocalThing({ title: "Keep me", context: "work" });
  const bucket = createBucketLocal("Temp", "work");
  addBucketRef(bucket.id, { thingId: thing.id, title: thing.title, kind: "thing" });
  removeBucketRef(bucket.id, thing.id);
  assert.equal(getBucketRefs(bucket.id).some((r) => r.thingId === thing.id), false);
  assert.ok(getThing(thing.id));
  assert.equal(getThing(thing.id).title, "Keep me");
});

test("SCENARIO E — delete Bucket removes grouping only", () => {
  setDemoActorForTests("p-priya");
  const thing = tossLocalThing({ title: "Underlying Thing", context: "work" });
  const list = createListLocal("Underlying List", "work");
  const bucket = createBucketLocal("Disposable", "work");
  addBucketRef(bucket.id, { thingId: thing.id, title: thing.title, kind: "thing" });
  addBucketRef(bucket.id, { listId: list.id, title: list.name, kind: "list" });

  deleteBucketLocal(bucket.id);
  assert.equal(getBuckets("work").some((b) => b.id === bucket.id), false);
  assert.ok(getThing(thing.id));
  assert.ok(getListById(list.id));
  assert.equal(getListById(list.id).name, "Underlying List");
});

test("SCENARIO F — Bucket is private to its owner persona", () => {
  setDemoActorForTests("p-priya");
  const bucket = createBucketLocal("Priya Private", "work");
  const thing = tossLocalThing({ title: "Hidden membership", context: "work" });
  addBucketRef(bucket.id, { thingId: thing.id, title: thing.title, kind: "thing" });
  assert.ok(getBuckets("work").some((b) => b.id === bucket.id && b.name === "Priya Private"));

  setDemoActorForTests("p-arjun");
  assert.equal(getBuckets("work").some((b) => b.id === bucket.id), false);
  assert.equal(getBuckets().some((b) => b.name === "Priya Private"), false);
  assert.throws(() => renameBucketLocal(bucket.id, "Hijack"));
  assert.throws(() => deleteBucketLocal(bucket.id));
});

test("SCENARIO G — rename keeps id, context, and references", () => {
  setDemoActorForTests("p-priya");
  const thing = tossLocalThing({ title: "Stay", context: "work" });
  const bucket = createBucketLocal("Old Name", "work");
  const originalId = bucket.id;
  addBucketRef(bucket.id, { thingId: thing.id, title: thing.title, kind: "thing" });

  renameBucketLocal(bucket.id, "New Name");
  const renamed = getBuckets("work").find((b) => b.id === originalId);
  assert.ok(renamed);
  assert.equal(renamed.name, "New Name");
  assert.equal(renamed.context, "work");
  assert.ok(getBucketRefs(originalId).some((r) => r.thingId === thing.id));
  assert.throws(() => renameBucketLocal(originalId, "   "));
});

test("SCENARIO H — duplicate add does not create a second reference", () => {
  setDemoActorForTests("p-priya");
  const thing = tossLocalThing({ title: "Once", context: "work" });
  const bucket = createBucketLocal("No dupes", "work");
  addBucketRef(bucket.id, { thingId: thing.id, title: thing.title, kind: "thing" });
  addBucketRef(bucket.id, { thingId: thing.id, title: thing.title, kind: "thing" });
  const thingRefs = getBucketRefs(bucket.id).filter((r) => r.thingId === thing.id);
  assert.equal(thingRefs.length, 1);
});
