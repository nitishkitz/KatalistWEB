import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import { partitionCourt } from "@/domain/thing";
import { setDemoActorForTests } from "@/features/demo/identities";
import {
  addCommentLocal,
  addListMessage,
  accessibleDemoThings,
  catchLocal,
  createListLocal,
  getActivity,
  getComments,
  getListMessages,
  getLists,
  getShredded,
  getThing,
  resetDemoLocalStateForTests,
  restoreLocal,
  setStatusLocal,
  shredLocal,
  tossLocalThing,
} from "@/features/things/local-state";

afterEach(() => {
  resetDemoLocalStateForTests();
  setDemoActorForTests(null);
});

test("THEIRS is owner-based tracking — A owns assigned B, C merely-visible is neither", () => {
  resetDemoLocalStateForTests();
  setDemoActorForTests("p-priya");
  const delegated = tossLocalThing({ title: "Delegated to Arjun", context: "work", assigneeId: "p-arjun" });
  const mine = tossLocalThing({ title: "Priya holds", context: "work", assigneeId: "p-priya" });

  const priyaCourt = partitionCourt(accessibleDemoThings("work"), "p-priya");
  assert.equal(priyaCourt.theirs.some((t) => t.id === delegated.id), true);
  assert.equal(priyaCourt.mine.some((t) => t.id === delegated.id), false);
  assert.equal(priyaCourt.mine.some((t) => t.id === mine.id), true);
  assert.equal(priyaCourt.theirs.some((t) => t.id === mine.id), false);

  setDemoActorForTests("p-arjun");
  const arjunCourt = partitionCourt(accessibleDemoThings("work"), "p-arjun");
  assert.equal(arjunCourt.mine.some((t) => t.id === delegated.id), true);
  assert.equal(arjunCourt.theirs.some((t) => t.id === delegated.id), false);

  setDemoActorForTests("p-mike");
  assert.equal(getThing(delegated.id), undefined);
  const mikeCourt = partitionCourt(accessibleDemoThings("work"), "p-mike");
  assert.equal(mikeCourt.mine.some((t) => t.id === delegated.id), false);
  assert.equal(mikeCourt.theirs.some((t) => t.id === delegated.id), false);
});

test("List owner who does not own the Thing sees it in List, not THEIRS", () => {
  resetDemoLocalStateForTests();
  setDemoActorForTests("p-arjun");
  const onPriyaList = tossLocalThing({
    title: "Arjun owns on Priya list",
    context: "work",
    listId: "l1",
    assigneeId: "p-rahul",
  });
  assert.equal(onPriyaList.owner.id, "p-arjun");
  assert.equal(onPriyaList.listId, "l1");

  setDemoActorForTests("p-priya");
  assert.ok(getThing(onPriyaList.id));
  assert.ok(getLists().some((l) => l.id === "l1"));
  const priyaCourt = partitionCourt(accessibleDemoThings("work"), "p-priya");
  assert.equal(priyaCourt.theirs.some((t) => t.id === onPriyaList.id), false);
  assert.equal(priyaCourt.mine.some((t) => t.id === onPriyaList.id), false);
});

test("Demo shred: owner/assignee cannot shred active; terminal and merely-visible can", () => {
  resetDemoLocalStateForTests();
  setDemoActorForTests("p-priya");
  const held = tossLocalThing({ title: "Active owned", context: "work", assigneeId: "p-arjun" });
  assert.throws(() => shredLocal(held.id, "thing"));

  setDemoActorForTests("p-arjun");
  assert.throws(() => shredLocal(held.id, "thing"));
  catchLocal(held.id);
  setStatusLocal(held.id, "sorted");
  shredLocal(held.id, "thing");
  assert.equal(getThing(held.id), undefined);
  assert.ok(getShredded().some((s) => s.id === held.id && s.status === "sorted"));

  setDemoActorForTests("p-priya");
  assert.ok(getThing(held.id));
  restoreLocal(held.id, "thing");
  assert.equal(getThing(held.id).workStatus, "sorted");

  const listVisible = tossLocalThing({
    title: "Mike can see via list",
    context: "work",
    listId: "l2",
    assigneeId: "p-arjun",
  });
  setDemoActorForTests("p-mike");
  assert.ok(getThing(listVisible.id));
  shredLocal(listVisible.id, "thing");
  assert.equal(getThing(listVisible.id), undefined);
  setDemoActorForTests("p-priya");
  assert.ok(getThing(listVisible.id));
});

test("Demo shred: List owner blocked; non-owner member can shred personally", () => {
  resetDemoLocalStateForTests();
  setDemoActorForTests("p-priya");
  assert.throws(() => shredLocal("l1", "list"));
  assert.ok(getLists().some((l) => l.id === "l1"));

  setDemoActorForTests("p-rahul");
  shredLocal("l1", "list");
  assert.equal(getLists().some((l) => l.id === "l1"), false);
  setDemoActorForTests("p-priya");
  assert.ok(getLists().some((l) => l.id === "l1"));

  setDemoActorForTests("p-priya");
  shredLocal("l4", "list");
  assert.equal(getLists().some((l) => l.id === "l4"), false);
  setDemoActorForTests("p-sarah");
  assert.ok(getLists().some((l) => l.id === "l4"));
});

test("getThing / comments / activity are visibility-gated; stranger cannot mutate", () => {
  resetDemoLocalStateForTests();
  setDemoActorForTests("p-priya");
  const thing = tossLocalThing({ title: "Priya to Arjun", context: "work", assigneeId: "p-arjun" });
  addCommentLocal(thing.id, "owner note");
  assert.ok(getComments(thing.id).some((c) => c.body === "owner note"));
  assert.ok(getActivity(thing.id).length >= 1);

  setDemoActorForTests("p-arjun");
  assert.ok(getThing(thing.id));
  assert.ok(getComments(thing.id).some((c) => c.body === "owner note"));

  setDemoActorForTests("p-mike");
  assert.equal(getThing(thing.id), undefined);
  assert.equal(getComments(thing.id).length, 0);
  assert.equal(getActivity(thing.id).length, 0);
  assert.throws(() => addCommentLocal(thing.id, "stranger"));
  assert.throws(() => setStatusLocal(thing.id, "under_progress"));
});

test("List Thing creation: owner/collaborator pass; view-only and non-member throw; list is authoritative", () => {
  resetDemoLocalStateForTests();
  setDemoActorForTests("p-priya");
  const owned = tossLocalThing({ title: "Owner create", context: "home", listId: "l1", listName: "Standalone" });
  assert.equal(owned.listId, "l1");
  assert.equal(owned.listName, "Android Release");
  assert.equal(owned.context, "work");
  assert.notEqual(owned.listName, "Standalone");

  const homeList = createListLocal("Home chores", "home");
  const inherited = tossLocalThing({ title: "Inherit home", context: "work", listId: homeList.id, listName: "Standalone" });
  assert.equal(inherited.context, "home");
  assert.equal(inherited.listId, homeList.id);
  assert.equal(inherited.listName, "Home chores");

  assert.throws(() => tossLocalThing({ title: "View only blocked", context: "work", listId: "l4" }));

  setDemoActorForTests("p-rahul");
  const collab = tossLocalThing({ title: "Collab create", context: "home", listId: "l1" });
  assert.equal(collab.listName, "Android Release");
  assert.equal(collab.context, "work");
  assert.equal(collab.owner.id, "p-rahul");

  setDemoActorForTests("p-mike");
  assert.throws(() => tossLocalThing({ title: "Non-member blocked", context: "work", listId: "l1" }));
});

test("List chat: owner/collaborator post; view-only and non-member blocked; reads do not leak", () => {
  resetDemoLocalStateForTests();
  setDemoActorForTests("p-priya");
  addListMessage("l2", "secret from owner");
  assert.ok(getListMessages("l2").some((m) => m.body === "secret from owner"));

  setDemoActorForTests("p-mike");
  addListMessage("l2", "collab reply");
  assert.ok(getListMessages("l2").some((m) => m.body === "collab reply"));

  setDemoActorForTests("p-arjun");
  assert.ok(getListMessages("l2").some((m) => m.body === "secret from owner"));
  assert.throws(() => addListMessage("l2", "view only blocked"));

  setDemoActorForTests("p-sarah");
  assert.equal(getListMessages("l2").length, 0);
  assert.throws(() => addListMessage("l2", "stranger leak"));
});

test("Recently Shredded does not implicitly restore the first item", () => {
  const src = readFileSync(new URL("../src/routes/me.tsx", import.meta.url), "utf8");
  assert.equal(src.includes("stats.shredded[0]"), false);
  assert.match(src, /setPanel\("shredded"\)/);
  assert.match(src, /Nothing shredded yet/);
  assert.match(src, /Restore/);
});

test("Demo avatar upload is omitted and cannot write live storage", () => {
  const meSrc = readFileSync(new URL("../src/routes/me.tsx", import.meta.url), "utf8");
  const profileSrc = readFileSync(new URL("../src/features/me/use-profile.ts", import.meta.url), "utf8");
  assert.match(meSrc, /demoSession/);
  assert.match(profileSrc, /app_metadata\?\.provider === "demo"/);
  assert.match(profileSrc, /Photos are demo-only/);
});

test("List member/owner identities use public_identities, not nested profiles", () => {
  const listsSrc = readFileSync(new URL("../src/features/lists/use-lists.ts", import.meta.url), "utf8");
  const bucketSrc = readFileSync(new URL("../src/features/buckets/use-bucket-items.ts", import.meta.url), "utf8");
  const mapperSrc = readFileSync(new URL("../src/features/lists/map-list-rows.ts", import.meta.url), "utf8");
  assert.equal(listsSrc.includes("profiles(display_name"), false);
  assert.equal(bucketSrc.includes("profiles(display_name"), false);
  assert.match(mapperSrc, /public_identities/);
  assert.match(mapperSrc, /owner_profile_id/);
  assert.match(mapperSrc, /Owned by you/);
  assert.equal(/\bemail\b/.test(mapperSrc), false);
  assert.equal(/\bphone\b/.test(mapperSrc), false);
});
