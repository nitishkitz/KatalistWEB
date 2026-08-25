import assert from "node:assert/strict";
import test from "node:test";
import { bucketPinned, orderBuckets } from "@/features/buckets/bucket-pinning";

test("new buckets are unpinned and persisted pinned_at controls the state", () => {
  assert.equal(bucketPinned({ pinned_at: null }), false);
  assert.equal(bucketPinned({ pinned_at: "2026-08-25T10:00:00Z" }), true);
});

test("pinned buckets sort first without inventing pin state from list position", () => {
  const ordered = orderBuckets([
    { id: "new", pinnedAt: null, updatedAt: "2026-08-25T12:00:00Z" },
    { id: "old-pinned", pinnedAt: "2026-08-25T09:00:00Z", updatedAt: "2026-08-25T09:00:00Z" },
  ]);
  assert.deepEqual(ordered.map((row) => row.id), ["old-pinned", "new"]);
});
