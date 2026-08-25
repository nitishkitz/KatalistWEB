import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { domainErrorMessage } from "@/lib/domain-error";
import * as bucketSurface from "@/features/buckets/bucket-items-surface";

const migrationUrl = new URL(
  "../supabase/migrations/20260825102421_bucket_reference_idempotency.sql",
  import.meta.url,
);

test("plain Supabase errors retain their safe database message", () => {
  const error = {
    code: "23505",
    message: "That Thing is already in this Bucket.",
    details: "duplicate key value violates a unique constraint",
    hint: null,
  };

  assert.equal(domainErrorMessage(error), "That Thing is already in this Bucket.");
});

test("one Thing resolves every Bucket that references it", () => {
  assert.equal(typeof bucketSurface.selectedBucketIds, "function");
  const buckets = [
    { id: "bucket-a", thingIds: ["thing-1"] },
    { id: "bucket-b", thingIds: ["thing-2", "thing-1"] },
    { id: "bucket-c", thingIds: [] },
  ];

  assert.deepEqual(
    [...bucketSurface.selectedBucketIds(buckets, "thing-1")].sort(),
    ["bucket-a", "bucket-b"],
  );
});

test("duplicate Add returns an existing Bucket reference before inserting", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /SELECT[\s\S]+INTO v_item[\s\S]+FROM public\.bucket_items/i);
  assert.match(sql, /IF FOUND THEN[\s\S]+RETURN v_item;[\s\S]+END IF;/i);
  assert.match(sql, /INSERT INTO public\.bucket_items/i);
});
