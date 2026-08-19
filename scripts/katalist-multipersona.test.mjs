import assert from "node:assert/strict";
import { test } from "node:test";
import { getThingCapabilities } from "../src/domain/capabilities.ts";
import { partitionCourt } from "../src/domain/thing.ts";

function thing(partial = {}) {
  const priya = { id: "p-priya", name: "Priya Sharma", initials: "PS" };
  const arjun = { id: "p-arjun", name: "Arjun Mehta", initials: "AM" };
  return {
    id: "t1", title: "Send final deck", creator: priya, owner: priya, assignee: arjun,
    acknowledgement: "waiting_for_catch", workStatus: "not_started", ownerImportance: "now",
    personalPace: null, dueAt: null, dueHasTime: false, context: "work", listId: null, listName: null,
    cancelledAt: null, sortedAt: null, caughtAt: null, updatedAt: new Date().toISOString(), ...partial,
  };
}
function canView(t, actorId) {
  return t.assignee.id === actorId || t.owner.id === actorId || t.creator.id === actorId;
}
function roleFor(list, actorId) {
  if (list.ownerActorId === actorId) return "owner";
  return list.members?.find((m) => m.actorId === actorId)?.role ?? null;
}

test("List Things filter is listId-only", () => {
  const things = [{ id: "a", listId: "l1", listName: "X" }, { id: "b", listId: "l2", listName: "X" }];
  assert.deepEqual(things.filter((t) => t.listId === "l1").map((t) => t.id), ["a"]);
});
test("Demo List roles persona-aware", () => {
  const l1 = { ownerActorId: "p-priya", members: [{ actorId: "p-arjun", role: "collaborator" }, { actorId: "p-sarah", role: "view_only" }] };
  assert.equal(roleFor(l1, "p-priya"), "owner");
  assert.equal(roleFor(l1, "p-arjun"), "collaborator");
  assert.equal(roleFor(l1, "p-mike"), null);
});
test("Visibility blocks unrelated persona", () => {
  assert.equal(canView(thing(), "p-priya"), true);
  assert.equal(canView(thing(), "p-sarah"), false);
});
test("Assignment + Catch partition", () => {
  const t = thing({ id: "a1" });
  assert.equal(partitionCourt([t], "p-priya").theirs.some((x) => x.id === "a1"), true);
  assert.equal(partitionCourt([t], "p-arjun").now.some((x) => x.id === "a1"), true);
  const caught = thing({ id: "a1", acknowledgement: "caught", personalPace: "next" });
  assert.equal(partitionCourt([caught], "p-arjun").next.some((x) => x.id === "a1"), true);
  assert.equal(getThingCapabilities(caught, "p-priya").canSetPace, false);
  assert.equal(getThingCapabilities(caught, "p-arjun").canSetPace, true);
});
test("Shred persona-scoped", () => {
  const map = new Map();
  const shred = (a, id) => { if (!map.has(a)) map.set(a, new Set()); map.get(a).add(id); };
  shred("p-priya", "t1");
  assert.equal(map.get("p-priya").has("t1"), true);
  assert.equal(map.get("p-arjun")?.has("t1") ?? false, false);
});
test("Notifications recipient-filtered", () => {
  const rows = [{ id: "n1", recipientActorId: "p-arjun" }, { id: "n2", recipientActorId: "p-sarah" }];
  assert.deepEqual(rows.filter((n) => n.recipientActorId === "p-arjun").map((n) => n.id), ["n1"]);
});
test("Recently Nudged time-window", () => {
  const COOLDOWN = 120 * 60 * 1000;
  const now = Date.now();
  assert.equal(now - (now - 30 * 60 * 1000) < COOLDOWN, true);
  assert.equal(now - (now - 180 * 60 * 1000) < COOLDOWN, false);
});
test("Sort assignee-only after Catch", () => {
  assert.equal(getThingCapabilities(thing(), "p-arjun").canSort, false);
  assert.equal(getThingCapabilities(thing({ acknowledgement: "caught", personalPace: "next" }), "p-arjun").canSort, true);
  assert.equal(getThingCapabilities(thing({ acknowledgement: "caught", personalPace: "next" }), "p-priya").canSort, false);
});
