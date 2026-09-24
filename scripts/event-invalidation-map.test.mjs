import assert from "node:assert/strict";
import { test } from "node:test";
import { targetsForEvent, targetKey } from "@/features/realtime/event-invalidation-map";

test("incomplete Things payload keeps the broad authority fallback", () => {
  const targets = targetsForEvent({ table: "things" });
  const flat = targets.map((t) => t[0]);
  assert.deepEqual(flat, [
    "court", "thing", "list-things", "lists", "list", "buckets", "bucket",
    "bucket-items", "nudges", "nudge-history", "catchup", "trophy", "notifications",
    "notifications-unread", "accessible-things", "doorman",
  ]);
});

test("thing_comments -> thing-comments, thing, court", () => {
  assert.deepEqual(targetsForEvent({ table: "thing_comments" }).map((t) => t[0]), ["thing-comments", "thing", "court"]);
});

test("profile_object_state routes to the personal-surfaces sentinel, not a static list", () => {
  const targets = targetsForEvent({ table: "profile_object_state" });
  assert.deepEqual(targets, [["__personal-surfaces__"]]);
});

test("every RealtimeTable has a routing entry (no silently-unhandled table)", () => {
  const tables = [
    "things", "thing_comments", "thing_activity", "nudges", "notifications",
    "list_messages", "bucket_items", "list_members", "list_meetings", "profile_object_state",
  ];
  for (const table of tables) {
    const targets = targetsForEvent({ table });
    assert.ok(targets.length > 0, `expected at least one target for ${table}`);
  }
});

test("targetKey is stable for equal targets and distinguishes different ones", () => {
  assert.equal(targetKey(["court"]), targetKey(["court"]));
  assert.notEqual(targetKey(["court"]), targetKey(["thing"]));
});

// C-06 (audit): list_members previously routed to only ["list", "lists"] --
// a membership change (in particular a revocation) never invalidated Hub's
// conversation sidebar/detail, List chat, Hub/List files, or meetings, so
// none of those mounted surfaces ever attempted the refetch that would
// discover "no longer accessible" via RLS.
test("list_members -> every List-scoped surface that could show now-inaccessible content, not just List detail/index", () => {
  const flat = targetsForEvent({ table: "list_members" }).map((t) => t[0]);
  for (const expected of [
    "list",
    "lists",
    "list-messages",
    "hub-conversations",
    "hub-conversation",
    "hub-files",
    "list-meetings",
    "upcoming-meetings",
  ]) {
    assert.ok(flat.includes(expected), `list_members must invalidate "${expected}"`);
  }
});

test("list_messages -> also invalidates hub-conversation (the Hub detail view of the same List), not only the sidebar index", () => {
  const flat = targetsForEvent({ table: "list_messages" }).map((t) => t[0]);
  assert.ok(flat.includes("hub-conversation"));
  assert.ok(flat.includes("hub-conversations"));
});

test("Thing updates narrow detail and refresh both old and new List parents", () => {
  const targets = targetsForEvent({ table: "things", eventType: "UPDATE",
    old: { id: "thing-1", list_id: "list-old" }, new: { id: "thing-1", list_id: "list-new" } });
  assert.ok(targets.some((target) => targetKey(target) === targetKey(["thing", "thing-1"])));
  assert.ok(targets.some((target) => targetKey(target) === targetKey(["list", "list-old"])));
  assert.ok(targets.some((target) => targetKey(target) === targetKey(["list", "list-new"])));
  assert.ok(targets.some((target) => targetKey(target) === targetKey(["list-things", "list-old"])));
  assert.ok(targets.some((target) => targetKey(target) === targetKey(["list-things", "list-new"])));
  assert.ok(!targets.some((target) => targetKey(target) === targetKey(["thing"])));
  assert.ok(!targets.some((target) => targetKey(target) === targetKey(["list"])));
});

test("primary-key-only List membership DELETE retains broad authority refresh", () => {
  const targets = targetsForEvent({ table: "list_members", eventType: "DELETE", old: { id: "membership-1" } });
  for (const family of ["list", "list-messages", "hub-conversation", "hub-files", "list-meetings"])
    assert.ok(targets.some((target) => targetKey(target) === targetKey([family])));
});

test("known List, Bucket, comment and activity IDs keep unrelated detail quiet", () => {
  for (const [table, row, expected] of [
    ["list_messages", { list_id: "list-1" }, ["list-messages", "list-1"]],
    ["bucket_items", { bucket_id: "bucket-1" }, ["bucket", "bucket-1"]],
    ["thing_comments", { thing_id: "thing-1" }, ["thing-comments", "thing-1"]],
    ["thing_activity", { thing_id: "thing-1" }, ["thing-activity", "thing-1"]],
  ]) {
    const targets = targetsForEvent({ table, new: row });
    assert.ok(targets.some((target) => targetKey(target) === targetKey(expected)), `${table} must target its detail`);
    assert.ok(!targets.some((target) => targetKey(target) === targetKey([expected[0]])), `${table} must not broad-invalidate that detail family`);
  }
});
