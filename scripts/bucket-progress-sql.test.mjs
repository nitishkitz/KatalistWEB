import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(new URL("../supabase/migrations/20260924200000_bucket_progress.sql", import.meta.url), "utf8");
const owner = "11111111-1111-1111-1111-111111111111";
const outsider = "22222222-2222-2222-2222-222222222222";
const bucket = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const empty = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const list = "cccccccc-cccc-cccc-cccc-cccccccccccc";

test("T06 bucket progress deduplicates direct/list Things under invoker RLS", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
        AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      CREATE TABLE public.buckets (id uuid PRIMARY KEY, owner_profile_id uuid NOT NULL);
      CREATE TABLE public.bucket_items (bucket_id uuid NOT NULL, thing_id uuid, list_id uuid);
      CREATE TABLE public.things (id uuid PRIMARY KEY, list_id uuid, work_status text NOT NULL);
      CREATE TABLE public.thing_viewers (thing_id uuid NOT NULL, profile_id uuid NOT NULL);
      GRANT USAGE ON SCHEMA public, auth TO authenticated;
      GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
      ALTER TABLE public.buckets ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.bucket_items ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.things ENABLE ROW LEVEL SECURITY;
      CREATE POLICY bucket_owner ON public.buckets TO authenticated USING (owner_profile_id=auth.uid());
      CREATE POLICY item_owner ON public.bucket_items TO authenticated USING (
        EXISTS (SELECT 1 FROM public.buckets b WHERE b.id=bucket_id AND b.owner_profile_id=auth.uid())
      );
      CREATE POLICY thing_visible ON public.things TO authenticated USING (
        EXISTS (SELECT 1 FROM public.thing_viewers v WHERE v.thing_id=id AND v.profile_id=auth.uid())
      );
    `);
    await db.exec(migration);
    await db.exec(`
      INSERT INTO public.buckets VALUES ('${bucket}','${owner}'),('${empty}','${owner}');
      INSERT INTO public.things VALUES
        ('aaaaaaaa-0000-0000-0000-000000000001','${list}','sorted'),
        ('aaaaaaaa-0000-0000-0000-000000000002','${list}','not_started'),
        ('aaaaaaaa-0000-0000-0000-000000000003','${list}','cancelled');
      INSERT INTO public.thing_viewers VALUES
        ('aaaaaaaa-0000-0000-0000-000000000001','${owner}'),
        ('aaaaaaaa-0000-0000-0000-000000000002','${owner}'),
        ('aaaaaaaa-0000-0000-0000-000000000003','${owner}');
      INSERT INTO public.bucket_items VALUES
        ('${bucket}','aaaaaaaa-0000-0000-0000-000000000001',NULL),
        ('${bucket}',NULL,'${list}');
      SET ROLE authenticated;
      SET request.jwt.claim.sub = '${owner}';
    `);
    const result = await db.query(`SELECT * FROM public.get_bucket_progress(ARRAY['${bucket}','${empty}']::uuid[]) ORDER BY bucket_id`);
    assert.deepEqual(result.rows, [
      { bucket_id: bucket, progress_completed: 1, progress_total: 2 },
      { bucket_id: empty, progress_completed: 0, progress_total: 0 },
    ]);
    await db.exec(`SET request.jwt.claim.sub = '${outsider}'`);
    assert.equal((await db.query(`SELECT * FROM public.get_bucket_progress(ARRAY['${bucket}']::uuid[])`)).rows.length, 0);
    await assert.rejects(db.query(`SELECT * FROM public.get_bucket_progress(array_fill('${bucket}'::uuid, ARRAY[501]))`), /1\.\.500 Bucket IDs/);
    const rights = await db.query(`SELECT
      has_function_privilege('anon','public.get_bucket_progress(uuid[])','EXECUTE') AS anon,
      has_function_privilege('authenticated','public.get_bucket_progress(uuid[])','EXECUTE') AS authenticated`);
    assert.deepEqual(rights.rows[0], { anon: false, authenticated: true });
  } finally {
    await db.close();
  }
});
