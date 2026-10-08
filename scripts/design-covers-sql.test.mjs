import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

/**
 * Stage 5 database rules: private cover storage policies, cover association RPCs and the
 * Thing -> designs read, on PGlite. The Stage 2 migration and the List helpers are the real
 * files/definitions; `storage.*` is a stand-in for Supabase Storage (bucket row, object rows,
 * `foldername`), so this proves the POLICY LOGIC, not Supabase Storage's real behavior
 * (signed URLs, bucket size/MIME enforcement, object deletion).
 */
const stage2 = readFileSync(new URL("../supabase/migrations/20261009100000_design_resources.sql", import.meta.url), "utf8");
const stage5 = readFileSync(new URL("../supabase/migrations/20261009110000_design_covers_and_thing_designs.sql", import.meta.url), "utf8");

const OWNER = "11111111-1111-1111-1111-111111111111";
const COLLAB = "22222222-2222-2222-2222-222222222222";
const VIEWER = "33333333-3333-3333-3333-333333333333";
const OUTSIDER = "44444444-4444-4444-4444-444444444444";
const OTHER_OWNER = "55555555-5555-5555-5555-555555555555";
const LIST = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTHER_LIST = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const THING = "cccccccc-0000-0000-0000-000000000001";
const OTHER_THING = "cccccccc-0000-0000-0000-000000000002";
const KEY = "AbCdEf1234567890xyZ123";
const URL_A = `https://www.figma.com/design/${KEY}/N?node-id=1-2`;
const URL_B = `https://www.figma.com/design/${KEY}/N?node-id=1-3`;
const FILE = "cover1.png";

async function makeDb() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE SCHEMA katalist_priv; CREATE SCHEMA storage;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE TYPE public.list_role AS ENUM ('collaborator','view_only');
    CREATE TABLE public.profiles (id uuid PRIMARY KEY);
    CREATE TABLE public.lists (id uuid PRIMARY KEY, owner_profile_id uuid NOT NULL REFERENCES public.profiles(id), archived_at timestamptz);
    CREATE TABLE public.list_members (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      list_id uuid NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
      profile_id uuid NOT NULL REFERENCES public.profiles(id),
      role public.list_role NOT NULL DEFAULT 'collaborator', UNIQUE (list_id, profile_id));
    CREATE TABLE public.things (id uuid PRIMARY KEY, list_id uuid REFERENCES public.lists(id) ON DELETE SET NULL);
    CREATE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

    CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text NOT NULL, name text NOT NULL, owner uuid DEFAULT auth.uid());
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS
      $$ SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
    GRANT USAGE ON SCHEMA storage TO authenticated, service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;

    CREATE OR REPLACE FUNCTION katalist_priv.is_list_owner(_list_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path = 'pg_catalog','public','katalist_priv' AS $$
      SELECT EXISTS (SELECT 1 FROM public.lists l WHERE l.id = _list_id AND l.owner_profile_id = auth.uid()); $$;
    CREATE OR REPLACE FUNCTION katalist_priv.is_list_member(_list_id uuid, _roles public.list_role[] DEFAULT NULL) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path = 'pg_catalog','public','katalist_priv' AS $$
      SELECT EXISTS (SELECT 1 FROM public.list_members m WHERE m.list_id = _list_id AND m.profile_id = auth.uid() AND (_roles IS NULL OR m.role = ANY(_roles))); $$;
    CREATE OR REPLACE FUNCTION katalist_priv.can_view_list(_list_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path = 'pg_catalog','public','katalist_priv' AS $$
      SELECT katalist_priv.is_list_owner(_list_id) OR katalist_priv.is_list_member(_list_id); $$;
    GRANT USAGE ON SCHEMA public, auth, katalist_priv TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION katalist_priv.is_list_owner(uuid), katalist_priv.can_view_list(uuid) TO authenticated;
    GRANT EXECUTE ON FUNCTION katalist_priv.is_list_member(uuid, public.list_role[]) TO authenticated;

    INSERT INTO public.profiles VALUES ('${OWNER}'),('${COLLAB}'),('${VIEWER}'),('${OUTSIDER}'),('${OTHER_OWNER}');
    INSERT INTO public.lists VALUES ('${LIST}','${OWNER}',NULL),('${OTHER_LIST}','${OTHER_OWNER}',NULL);
    INSERT INTO public.list_members (list_id, profile_id, role) VALUES ('${LIST}','${COLLAB}','collaborator'),('${LIST}','${VIEWER}','view_only');
    INSERT INTO public.things VALUES ('${THING}','${LIST}'),('${OTHER_THING}','${OTHER_LIST}');
  `);
  await db.exec(stage2);
  await db.exec(stage5);
  return db;
}

const as = async (db, profile, role = "authenticated") =>
  db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${profile ?? ""}', false); SET ROLE ${role};`);
const sys = (db) => db.exec("RESET ROLE");
const q = (db, sql) => db.query(sql);
async function fails(promise) {
  try { await promise; } catch (e) { return { message: e.message, hint: e.hint, code: e.code }; }
  assert.fail("expected the statement to fail");
}
async function addDesign(db, profile = OWNER, url = URL_A, list = LIST) {
  await as(db, profile);
  return (await q(db, `SELECT * FROM public.add_design_resource('${list}', '${url}', 'D')`)).rows[0];
}
const key = (r, file = FILE, list = LIST) => `${list}/${r.id}/${file}`;
const putObject = (db, name) => q(db, `INSERT INTO storage.objects (bucket_id, name) VALUES ('design-covers', '${name}')`);

test("the bucket is private with a 5 MiB limit and image-only MIME types", async () => {
  const db = await makeDb();
  try {
    const b = (await q(db, "SELECT * FROM storage.buckets WHERE id = 'design-covers'")).rows[0];
    assert.equal(b.public, false);
    assert.equal(Number(b.file_size_limit), 5 * 1024 * 1024);
    assert.deepEqual([...b.allowed_mime_types].sort(), ["image/jpeg", "image/png", "image/webp"]);
  } finally { await db.close(); }
});

test("cover paths must be {list}/{design}/{file.ext}; malformed or hostile names are not parsed", async () => {
  const db = await makeDb();
  try {
    const id = "cccccccc-0000-0000-0000-00000000000a";
    const parts = async (name) => (await db.query("SELECT * FROM katalist_priv.design_cover_parts($1)", [name])).rows[0];
    assert.equal((await parts(`${LIST}/${id}/a.png`)).list_id, LIST);
    assert.equal((await parts(`${LIST}/${id}/A_b-1.JPEG`.replace("JPEG", "jpeg"))).resource_id, id);
    for (const bad of [
      `${LIST}/${id}/a.gif`, `${LIST}/${id}/a.PNG`, `${LIST}/${id}/../x.png`, `${LIST}/${id}/sub/a.png`, `${LIST}/not-a-uuid/a.png`,
      `${LIST}/${id}`, `${LIST}/${id}/`, `/${LIST}/${id}/a.png`, `${LIST}/${id}/.png`, `${LIST.toUpperCase()}/${id}/a.png`, "", `staging/${id}/a.png`,
    ]) {
      assert.equal((await parts(bad)).list_id, null, bad);
    }
  } finally { await db.close(); }
});

test("storage policies: only managers upload to an active design in their own List; viewers read; others see nothing", async () => {
  const db = await makeDb();
  try {
    const d = await addDesign(db);
    const name = key(d);
    // Collaborator and owner may upload.
    await as(db, COLLAB);
    await putObject(db, name);
    await as(db, OWNER);
    await putObject(db, key(d, "second.webp"));
    // View-only, outsider, anonymous may not.
    for (const profile of [VIEWER, OUTSIDER]) {
      await as(db, profile);
      assert.equal((await fails(putObject(db, key(d, `x-${profile.slice(0, 2)}.png`)))).code, "42501", profile);
    }
    await as(db, null, "anon");
    await fails(putObject(db, key(d, "anon.png")));
    // Paths pointing at another List's design, or a List the caller does not manage, are denied.
    await as(db, OTHER_OWNER);
    const other = await addDesign(db, OTHER_OWNER, URL_B, OTHER_LIST);
    await as(db, COLLAB);
    assert.equal((await fails(putObject(db, key(other, "x.png", OTHER_LIST)))).code, "42501");
    assert.equal((await fails(putObject(db, `${LIST}/${other.id}/x.png`))).code, "42501", "design id from another List under this List's folder");
    assert.equal((await fails(putObject(db, `${LIST}/cccccccc-0000-0000-0000-0000000000ff/x.png`))).code, "42501", "unknown design");
    assert.equal((await fails(q(db, `INSERT INTO storage.objects (bucket_id, name) VALUES ('design-covers', 'staging/x/y.png')`))).code, "42501");
    // Reads follow List membership.
    for (const profile of [OWNER, COLLAB, VIEWER]) {
      await as(db, profile);
      assert.equal((await q(db, "SELECT * FROM storage.objects WHERE bucket_id = 'design-covers'")).rows.length, 2, profile);
    }
    for (const profile of [OUTSIDER, OTHER_OWNER]) {
      await as(db, profile);
      assert.equal((await q(db, `SELECT * FROM storage.objects WHERE bucket_id = 'design-covers' AND name LIKE '${LIST}/%'`)).rows.length, 0, profile);
    }
    // There is no UPDATE policy, so an object can never be overwritten in place.
    await as(db, OWNER);
    assert.equal((await q(db, `UPDATE storage.objects SET name = '${key(d, "renamed.png")}' WHERE name = '${name}'`)).affectedRows, 0);
    // Deletes: managers only.
    await as(db, VIEWER);
    assert.equal((await q(db, `DELETE FROM storage.objects WHERE name = '${name}'`)).affectedRows, 0);
    await as(db, COLLAB);
    assert.equal((await q(db, `DELETE FROM storage.objects WHERE name = '${name}'`)).affectedRows, 1);
  } finally { await db.close(); }
});

test("uploads to an archived design are denied", async () => {
  const db = await makeDb();
  try {
    const d = await addDesign(db);
    await q(db, `SELECT * FROM public.set_design_resource_archived('${d.id}', true)`);
    assert.equal((await fails(putObject(db, key(d)))).code, "42501");
  } finally { await db.close(); }
});

test("set_design_cover: managers only, key must be this design's, object must exist, returns the previous key", async () => {
  const db = await makeDb();
  try {
    const d = await addDesign(db);
    const other = await addDesign(db, OWNER, URL_B);
    await as(db, COLLAB);
    await putObject(db, key(d));
    await putObject(db, key(d, "v2.png"));
    await putObject(db, key(other));
    const set = async (id, k) => (await q(db, `SELECT public.set_design_cover('${id}', '${k}') AS prev`)).rows[0].prev;
    assert.equal(await set(d.id, key(d)), null, "first cover has no previous");
    assert.equal(await set(d.id, key(d)), null, "re-setting the current key is a no-op");
    assert.equal(await set(d.id, key(d, "v2.png")), key(d), "replacement returns the old key for cleanup");
    assert.equal((await q(db, `SELECT cover_storage_key FROM public.design_resources WHERE id = '${d.id}'`)).rows[0].cover_storage_key, key(d, "v2.png"));
    // Another design's object, another List's path, a missing object, and junk keys are rejected.
    assert.equal((await fails(set(d.id, key(other)))).hint, "cross_list");
    assert.equal((await fails(set(d.id, `${OTHER_LIST}/${d.id}/x.png`))).hint, "cross_list");
    assert.equal((await fails(set(d.id, key(d, "never-uploaded.png")))).hint, "cover_missing");
    assert.equal((await fails(set(d.id, `${LIST}/${d.id}/../x.png`))).hint, "cross_list");
    assert.equal((await fails(q(db, `SELECT public.set_design_cover('${d.id}', NULL)`))).hint, "cross_list");
    // View-only and outsiders cannot change covers, even for a real uploaded object.
    for (const profile of [VIEWER, OUTSIDER]) {
      await as(db, profile);
      const e = await fails(set(d.id, key(d)));
      assert.ok(e.code === "42501" || e.code === "P0002", profile);
    }
    await as(db, null);
    assert.equal((await fails(set(d.id, key(d)))).code, "28000");
    await as(db, null, "anon");
    await fails(set(d.id, key(d)));
  } finally { await db.close(); }
});

test("clear_design_cover returns the previous key; archived designs and non-managers are refused", async () => {
  const db = await makeDb();
  try {
    const d = await addDesign(db);
    await putObject(db, key(d));
    await q(db, `SELECT public.set_design_cover('${d.id}', '${key(d)}')`);
    await as(db, VIEWER);
    assert.equal((await fails(q(db, `SELECT public.clear_design_cover('${d.id}')`))).code, "42501");
    await as(db, OWNER);
    assert.equal((await q(db, `SELECT public.clear_design_cover('${d.id}') AS prev`)).rows[0].prev, key(d));
    assert.equal((await q(db, `SELECT public.clear_design_cover('${d.id}') AS prev`)).rows[0].prev, null, "idempotent");
    await q(db, `SELECT * FROM public.set_design_resource_archived('${d.id}', true)`);
    assert.equal((await fails(q(db, `SELECT public.clear_design_cover('${d.id}')`))).hint, "archived");
    assert.equal((await fails(q(db, `SELECT public.set_design_cover('${d.id}', '${key(d)}')`))).hint, "archived");
  } finally { await db.close(); }
});

test("even privileged writers cannot store a cover key outside the design's own folder", async () => {
  const db = await makeDb();
  try {
    const d = await addDesign(db);
    await sys(db);
    const e = await fails(q(db, `UPDATE public.design_resources SET cover_storage_key = '${OTHER_LIST}/${d.id}/x.png' WHERE id = '${d.id}'`));
    assert.equal(e.code, "23514");
    await q(db, `UPDATE public.design_resources SET cover_storage_key = '${key(d)}' WHERE id = '${d.id}'`);
  } finally { await db.close(); }
});

test("get_thing_designs: List viewers see linked designs (exact frame links preserved); outsiders see none", async () => {
  const db = await makeDb();
  try {
    const a = await addDesign(db, OWNER, URL_A);
    const b = await addDesign(db, OWNER, URL_B);
    await q(db, `SELECT * FROM public.link_design_thing('${a.id}', '${THING}')`);
    await q(db, `SELECT * FROM public.link_design_thing('${b.id}', '${THING}')`);
    const designs = async (profile, thing = THING) => {
      await as(db, profile);
      return (await q(db, `SELECT * FROM public.get_thing_designs('${thing}')`)).rows;
    };
    const mine = await designs(VIEWER);
    assert.deepEqual(mine.map((r) => r.node_id).sort(), ["1-2", "1-3"]);
    assert.deepEqual(mine.map((r) => r.original_url).sort(), [
      `https://www.figma.com/design/${KEY}?node-id=1-2`,
      `https://www.figma.com/design/${KEY}?node-id=1-3`,
    ]);
    assert.equal((await designs(OUTSIDER)).length, 0);
    assert.equal((await designs(OTHER_OWNER)).length, 0);
    assert.equal((await designs(OWNER, OTHER_THING)).length, 0, "a Thing in another List has no links from this List");
    await as(db, null, "anon");
    await fails(q(db, `SELECT * FROM public.get_thing_designs('${THING}')`));
    // Unlinking removes it from the Thing's list.
    await as(db, COLLAB);
    await q(db, `SELECT public.unlink_design_thing('${a.id}', '${THING}')`);
    assert.equal((await designs(COLLAB)).length, 1);
  } finally { await db.close(); }
});
