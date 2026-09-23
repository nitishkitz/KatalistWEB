import assert from "node:assert/strict";
import { test } from "node:test";
import { targetsForEvent, targetKey } from "@/features/realtime/event-invalidation-map";

test("things -> the same 13 targets use-realtime.ts already invalidates today", () => {
  const targets = targetsForEvent({ table: "things" });
  const flat = targets.map((t) => t[0]);
  assert.deepEqual(flat, [
    "court", "thing", "list-things", "lists", "list", "buckets", "bucket",
    "bucket-items", "nudges", "nudge-history", "catchup", "trophy", "notifications",
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
