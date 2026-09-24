import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(new URL("../supabase/migrations/20260924160000_thing_overview_stats.sql", import.meta.url), "utf8");
const ids = {
  thing: "11111111-1111-1111-1111-111111111111",
  owner: "22222222-2222-2222-2222-222222222222",
  member: "33333333-3333-3333-3333-333333333333",
  viewer: "44444444-4444-4444-4444-444444444444",
  outsider: "55555555-5555-5555-5555-555555555555",
  actorOwner: "66666666-6666-6666-6666-666666666666",
  actorMember: "77777777-7777-7777-7777-777777777777",
  actorViewer: "88888888-8888-8888-8888-888888888888",
};

test("T06 invoker aggregate validates scope and gives owner/member/view-only exact counts without leaking to outsiders", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
        AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      CREATE TYPE public.context_kind AS ENUM ('work','home');
      CREATE TABLE public.actors (id uuid PRIMARY KEY, profile_id uuid NOT NULL);
      CREATE TABLE public.things (id uuid PRIMARY KEY, context public.context_kind NOT NULL);
      CREATE TABLE public.thing_viewers (thing_id uuid NOT NULL, profile_id uuid NOT NULL, role text NOT NULL);
      CREATE TABLE public.thing_comments (
        id uuid PRIMARY KEY, thing_id uuid NOT NULL, author_actor_id uuid NOT NULL,
        created_at timestamptz NOT NULL, deleted_at timestamptz
      );
      CREATE TABLE public.thing_attachments (
        id uuid PRIMARY KEY, thing_id uuid NOT NULL, storage_key text, file_name text NOT NULL,
        mime_type text, byte_size bigint, status text NOT NULL, created_at timestamptz NOT NULL
      );
      GRANT USAGE ON SCHEMA public, auth TO authenticated;
      GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
      ALTER TABLE public.things ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.thing_comments ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.thing_attachments ENABLE ROW LEVEL SECURITY;
      CREATE POLICY thing_visible ON public.things TO authenticated USING (
        EXISTS (SELECT 1 FROM public.thing_viewers v WHERE v.thing_id=id AND v.profile_id=auth.uid())
      );
      CREATE POLICY comment_visible ON public.thing_comments TO authenticated USING (
        EXISTS (SELECT 1 FROM public.thing_viewers v WHERE v.thing_id=thing_comments.thing_id AND v.profile_id=auth.uid())
      );
      CREATE POLICY attachment_visible ON public.thing_attachments TO authenticated USING (
        EXISTS (SELECT 1 FROM public.thing_viewers v WHERE v.thing_id=thing_attachments.thing_id AND v.profile_id=auth.uid())
      );
    `);
    await db.exec(migration);
    await db.exec(`
      INSERT INTO public.actors VALUES
        ('${ids.actorOwner}','${ids.owner}'),('${ids.actorMember}','${ids.member}'),('${ids.actorViewer}','${ids.viewer}');
      INSERT INTO public.things VALUES ('${ids.thing}','work');
      INSERT INTO public.thing_viewers VALUES
        ('${ids.thing}','${ids.owner}','owner'),('${ids.thing}','${ids.member}','member'),
        ('${ids.thing}','${ids.viewer}','view_only');
      INSERT INTO public.thing_comments VALUES
        ('99999999-9999-9999-9999-999999999991','${ids.thing}','${ids.actorOwner}','2026-09-24T10:00:00Z',NULL),
        ('99999999-9999-9999-9999-999999999992','${ids.thing}','${ids.actorViewer}','2026-09-24T11:00:00Z',NULL),
        ('99999999-9999-9999-9999-999999999993','${ids.thing}','${ids.actorMember}','2026-09-24T12:00:00Z',now());
      INSERT INTO public.thing_attachments VALUES
        ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1','${ids.thing}','things/first.pdf','first.pdf','application/pdf',100,'ready','2026-09-24T10:00:00Z'),
        ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2','${ids.thing}','things/second.png','second.png','image/png',200,'ready','2026-09-24T11:00:00Z'),
        ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3','${ids.thing}',NULL,'pending.txt','text/plain',300,'pending','2026-09-24T12:00:00Z');
      SET ROLE authenticated;
    `);
    const query = `SELECT * FROM public.get_thing_overview_stats(
      ARRAY['${ids.thing}']::uuid[], ARRAY['2026-09-24T10:30:00Z']::timestamptz[], 'work'
    )`;
    for (const [profileId, expectedUnread] of [[ids.owner, 1], [ids.member, 1], [ids.viewer, 0]]) {
      await db.exec(`SET request.jwt.claim.sub = '${profileId}'`);
      const result = await db.query(query);
      assert.equal(result.rows.length, 1);
      assert.equal(result.rows[0].comment_count, 2);
      assert.equal(result.rows[0].unread_comment_count, expectedUnread);
      assert.equal(result.rows[0].attachment_count, 2);
      assert.equal(result.rows[0].preview_attachment.file_name, "first.pdf");
    }
    await db.exec(`SET request.jwt.claim.sub = '${ids.outsider}'`);
    assert.equal((await db.query(query)).rows.length, 0);
    assert.equal((await db.query(query.replace("'work'", "'home'"))).rows.length, 0);
    await assert.rejects(db.query(`SELECT * FROM public.get_thing_overview_stats(
      array_fill('${ids.thing}'::uuid, ARRAY[501]), array_fill(NULL::timestamptz, ARRAY[501]), 'work'
    )`), /1\.\.500 Thing IDs/);
    const rights = await db.query(`SELECT
      has_function_privilege('anon','public.get_thing_overview_stats(uuid[],timestamptz[],public.context_kind)','EXECUTE') AS anon,
      has_function_privilege('authenticated','public.get_thing_overview_stats(uuid[],timestamptz[],public.context_kind)','EXECUTE') AS authenticated`);
    assert.deepEqual(rights.rows[0], { anon: false, authenticated: true });
  } finally {
    await db.close();
  }
});
