import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(new URL("../supabase/migrations/20260924180000_list_overview_counts.sql", import.meta.url), "utf8");
const owner = "11111111-1111-1111-1111-111111111111";
const member = "22222222-2222-2222-2222-222222222222";
const outsider = "33333333-3333-3333-3333-333333333333";
const list = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

test("T06 List counts match visible Thing rows and deny outsiders", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
        AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      CREATE TABLE public.lists (id uuid PRIMARY KEY);
      CREATE TABLE public.things (id uuid PRIMARY KEY, list_id uuid, work_status text NOT NULL);
      CREATE TABLE public.list_viewers (list_id uuid, profile_id uuid);
      GRANT USAGE ON SCHEMA public, auth TO authenticated;
      GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
      ALTER TABLE public.lists ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.things ENABLE ROW LEVEL SECURITY;
      CREATE POLICY list_visible ON public.lists TO authenticated USING (
        EXISTS (SELECT 1 FROM public.list_viewers v WHERE v.list_id=id AND v.profile_id=auth.uid())
      );
      CREATE POLICY thing_visible ON public.things TO authenticated USING (
        EXISTS (SELECT 1 FROM public.list_viewers v WHERE v.list_id=things.list_id AND v.profile_id=auth.uid())
      );
    `);
    await db.exec(migration);
    await db.exec(`
      INSERT INTO public.lists VALUES ('${list}');
      INSERT INTO public.list_viewers VALUES ('${list}','${owner}'),('${list}','${member}');
      INSERT INTO public.things VALUES
        ('aaaaaaaa-0000-0000-0000-000000000001','${list}','sorted'),
        ('aaaaaaaa-0000-0000-0000-000000000002','${list}','under_progress'),
        ('aaaaaaaa-0000-0000-0000-000000000003','${list}','cancelled');
      SET ROLE authenticated;
    `);
    for (const profile of [owner, member]) {
      await db.exec(`SET request.jwt.claim.sub = '${profile}'`);
      const result = await db.query(`SELECT * FROM public.get_list_overview_counts(ARRAY['${list}']::uuid[])`);
      assert.deepEqual(result.rows[0], { list_id: list, thing_count: 3, done_count: 1, in_progress_count: 1 });
    }
    await db.exec(`SET request.jwt.claim.sub = '${outsider}'`);
    assert.equal((await db.query(`SELECT * FROM public.get_list_overview_counts(ARRAY['${list}']::uuid[])`)).rows.length, 0);
    await assert.rejects(db.query(`SELECT * FROM public.get_list_overview_counts(array_fill('${list}'::uuid, ARRAY[501]))`), /1\.\.500 List IDs/);
    const rights = await db.query(`SELECT
      has_function_privilege('anon','public.get_list_overview_counts(uuid[])','EXECUTE') AS anon,
      has_function_privilege('authenticated','public.get_list_overview_counts(uuid[])','EXECUTE') AS authenticated`);
    assert.deepEqual(rights.rows[0], { anon: false, authenticated: true });
  } finally {
    await db.close();
  }
});
