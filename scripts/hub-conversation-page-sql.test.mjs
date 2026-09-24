import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(new URL("../supabase/migrations/20260924170000_hub_conversation_page.sql", import.meta.url), "utf8");
const countsMigration = readFileSync(new URL("../supabase/migrations/20260924190000_hub_unread_counts.sql", import.meta.url), "utf8");
const owner = "11111111-1111-1111-1111-111111111111";
const member = "22222222-2222-2222-2222-222222222222";
const outsider = "33333333-3333-3333-3333-333333333333";
const first = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const second = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

test("T06 Hub page is bounded, latest-only, and invoker/RLS scoped", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
        AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      CREATE TABLE public.lists (
        id uuid PRIMARY KEY, name text NOT NULL, kind text NOT NULL,
        owner_profile_id uuid NOT NULL, updated_at timestamptz NOT NULL, archived_at timestamptz
      );
      CREATE TABLE public.list_messages (
        id uuid PRIMARY KEY, list_id uuid NOT NULL, body text NOT NULL, kind text NOT NULL,
        created_at timestamptz NOT NULL, author_profile_id uuid NOT NULL,
        attachment jsonb, deleted_at timestamptz, mentioned_profile_ids uuid[] NOT NULL DEFAULT '{}'
      );
      CREATE TABLE public.list_viewers (list_id uuid NOT NULL, profile_id uuid NOT NULL);
      GRANT USAGE ON SCHEMA public, auth TO authenticated;
      GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
      ALTER TABLE public.lists ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.list_messages ENABLE ROW LEVEL SECURITY;
      CREATE POLICY list_visible ON public.lists TO authenticated USING (
        EXISTS (SELECT 1 FROM public.list_viewers v WHERE v.list_id=id AND v.profile_id=auth.uid())
      );
      CREATE POLICY message_visible ON public.list_messages TO authenticated USING (
        EXISTS (SELECT 1 FROM public.list_viewers v WHERE v.list_id=list_messages.list_id AND v.profile_id=auth.uid())
      );
    `);
    await db.exec(migration);
    await db.exec(countsMigration);
    await db.exec(`
      INSERT INTO public.lists VALUES
        ('${first}','First','dm','${owner}','2026-09-24T09:00:00Z',NULL),
        ('${second}','Second','group','${owner}','2026-09-24T08:00:00Z',NULL);
      INSERT INTO public.list_viewers VALUES
        ('${first}','${owner}'),('${first}','${member}'),('${second}','${owner}');
      INSERT INTO public.list_messages (id,list_id,body,kind,created_at,author_profile_id,attachment,deleted_at) VALUES
        ('aaaaaaaa-0000-0000-0000-000000000001','${first}','old body','message','2026-09-24T09:10:00Z','${owner}',NULL,NULL),
        ('aaaaaaaa-0000-0000-0000-000000000002','${first}','latest body','message','2026-09-24T10:10:00Z','${member}',NULL,NULL),
        ('aaaaaaaa-0000-0000-0000-000000000003','${first}','deleted body','message','2026-09-24T12:00:00Z','${owner}',NULL,now()),
        ('aaaaaaaa-0000-0000-0000-000000000004','${second}',repeat('P',1000),'message','2026-09-24T11:00:00Z','${owner}',NULL,NULL);
      UPDATE public.list_messages SET mentioned_profile_ids=ARRAY['${owner}']::uuid[]
        WHERE id='aaaaaaaa-0000-0000-0000-000000000002';
      SET ROLE authenticated;
    `);
    await db.exec(`SET request.jwt.claim.sub = '${owner}'`);
    const page = await db.query("SELECT * FROM public.get_hub_conversation_page(1,NULL,NULL)");
    assert.equal(page.rows.length, 2, "one extra summary signals a next page");
    assert.deepEqual(page.rows.map((row) => row.id), [second, first]);
    assert.equal(page.rows[0].last_body.length, 240, "a rail preview must not transfer an unbounded message body");
    assert.equal(page.rows[1].last_body, "latest body", "older and deleted bodies are not returned");
    const ownerCounts = await db.query(`SELECT * FROM public.get_hub_unread_counts(ARRAY['${first}']::uuid[], ARRAY['2026-09-24T09:00:00Z']::timestamptz[])`);
    assert.deepEqual(ownerCounts.rows[0], { list_id: first, unread_count: 1, mention_count: 1 });
    // A new top conversation arrives between pages. Cursor pagination must
    // still advance after the old boundary rather than repeating/skipping it.
    await db.exec(`RESET ROLE;
      INSERT INTO public.lists VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','New','group','${owner}','2026-09-24T12:30:00Z',NULL);
      INSERT INTO public.list_viewers VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','${owner}');
      SET ROLE authenticated;`);
    const next = await db.query(`SELECT * FROM public.get_hub_conversation_page(1,'${new Date(page.rows[0].sort_at).toISOString()}','${page.rows[0].id}')`);
    assert.deepEqual(next.rows.map((row) => row.id), [first], "cursor pages remain ordered after the first result");
    await db.exec(`SET request.jwt.claim.sub = '${member}'`);
    const memberPage = await db.query("SELECT * FROM public.get_hub_conversation_page(100,NULL,NULL)");
    assert.deepEqual(memberPage.rows.map((row) => row.id), [first]);
    const memberCounts = await db.query(`SELECT * FROM public.get_hub_unread_counts(ARRAY['${first}']::uuid[], ARRAY['2026-09-24T09:00:00Z']::timestamptz[])`);
    assert.deepEqual(memberCounts.rows[0], { list_id: first, unread_count: 1, mention_count: 0 }, "self-authored latest message is excluded");
    await db.exec(`SET request.jwt.claim.sub = '${outsider}'`);
    assert.equal((await db.query("SELECT * FROM public.get_hub_conversation_page(100,NULL,NULL)")).rows.length, 0);
    assert.equal((await db.query(`SELECT * FROM public.get_hub_unread_counts(ARRAY['${first}']::uuid[], ARRAY[NULL]::timestamptz[])`)).rows.length, 0);
    await assert.rejects(db.query("SELECT * FROM public.get_hub_conversation_page(101,NULL,NULL)"), /invalid Hub page bounds/);
    const rights = await db.query(`SELECT
      has_function_privilege('anon','public.get_hub_conversation_page(integer,timestamptz,uuid)','EXECUTE') AS anon,
      has_function_privilege('authenticated','public.get_hub_conversation_page(integer,timestamptz,uuid)','EXECUTE') AS authenticated,
      has_function_privilege('anon','public.get_hub_unread_counts(uuid[],timestamptz[])','EXECUTE') AS counts_anon,
      has_function_privilege('authenticated','public.get_hub_unread_counts(uuid[],timestamptz[])','EXECUTE') AS counts_authenticated`);
    assert.deepEqual(rights.rows[0], { anon: false, authenticated: true, counts_anon: false, counts_authenticated: true });
  } finally {
    await db.close();
  }
});
