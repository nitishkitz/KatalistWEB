import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(new URL("../supabase/migrations/20260924120000_bounded_chat_and_notification_claims.sql", import.meta.url), "utf8");
const listId = "11111111-1111-1111-1111-111111111111";
const owner = "22222222-2222-2222-2222-222222222222";
const member = "33333333-3333-3333-3333-333333333333";
const outsider = "44444444-4444-4444-4444-444444444444";
const messageId = "55555555-5555-5555-5555-555555555555";

test("T04 SQL enforces member mentions and uniquely claims a persisted message push", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE public.lists (id uuid PRIMARY KEY, owner_profile_id uuid NOT NULL);
      CREATE TABLE public.list_members (list_id uuid NOT NULL, profile_id uuid NOT NULL);
      CREATE TABLE public.list_messages (
        id uuid PRIMARY KEY, list_id uuid NOT NULL REFERENCES public.lists(id),
        author_profile_id uuid NOT NULL, body text NOT NULL, kind text NOT NULL DEFAULT 'message',
        attachment jsonb, mentioned_profile_ids uuid[] NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz, pinned_at timestamptz
      );
      CREATE TABLE public.thing_comments (id uuid PRIMARY KEY, thing_id uuid, created_at timestamptz, deleted_at timestamptz);
      CREATE TABLE public.thing_activity (id uuid PRIMARY KEY, thing_id uuid, created_at timestamptz);
    `);
    await db.exec(migration);
    await db.exec(`
      INSERT INTO public.lists VALUES ('${listId}','${owner}');
      INSERT INTO public.list_members VALUES ('${listId}','${member}');
    `);
    await db.exec(`INSERT INTO public.list_messages(id,list_id,author_profile_id,body,mentioned_profile_ids)
      VALUES ('${messageId}','${listId}','${owner}','hi',ARRAY['${member}']::uuid[]);`);
    await assert.rejects(db.exec(`INSERT INTO public.list_messages(id,list_id,author_profile_id,body,mentioned_profile_ids)
      VALUES ('66666666-6666-6666-6666-666666666666','${listId}','${owner}','bad',ARRAY['${outsider}']::uuid[]);`), /mentions must belong/);

    const first = await db.query(`SELECT public.claim_list_message_push('${messageId}') AS accepted`);
    const second = await db.query(`SELECT public.claim_list_message_push('${messageId}') AS accepted`);
    assert.equal(first.rows[0].accepted, true);
    assert.equal(second.rows[0].accepted, false);
    const claims = await db.query("SELECT count(*)::int AS count FROM public.message_push_claims");
    assert.equal(claims.rows[0].count, 1);
    const privileges = await db.query(`SELECT
      has_function_privilege('anon','public.claim_list_message_push(uuid)','EXECUTE') AS anon,
      has_function_privilege('authenticated','public.claim_list_message_push(uuid)','EXECUTE') AS authenticated,
      has_function_privilege('service_role','public.claim_list_message_push(uuid)','EXECUTE') AS service_role`);
    assert.deepEqual(privileges.rows[0], { anon: false, authenticated: false, service_role: true });
  } finally {
    await db.close();
  }
});
