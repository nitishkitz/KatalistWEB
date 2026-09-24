import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(new URL("../supabase/migrations/20260925100000_realtime_publication_coverage.sql", import.meta.url), "utf8");
const expected = ["lists", "list_members", "list_meetings", "buckets", "bucket_items", "thing_attachments", "profile_object_state"];

test("T07 publication migration includes every newly watched table and is idempotent", async () => {
  const db = new PGlite();
  try {
    for (const table of expected) await db.exec(`CREATE TABLE public.${table} (id uuid PRIMARY KEY)`);
    await db.exec("CREATE PUBLICATION supabase_realtime");
    await db.exec(migration);
    await db.exec(migration);
    const { rows } = await db.query("SELECT tablename FROM pg_catalog.pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' ORDER BY tablename");
    assert.deepEqual(rows.map((row) => row.tablename), [...expected].sort());
  } finally {
    await db.close();
  }
});
