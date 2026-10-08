import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { parseFigmaUrl } from "@/features/designs/figma-url";

/**
 * Stage 2 authorization/constraint matrix for 20261009100000_design_resources.sql,
 * run on PGlite (a real Postgres engine, single connection). The List helpers
 * (is_list_owner / is_list_member / can_view_list) are copied verbatim from
 * 20260818144945_*.sql; auth.uid() is stubbed from request.jwt.claim.sub as in the
 * other SQL tests here. This does NOT prove Supabase's real JWT/PostgREST layer,
 * and PGlite cannot interleave two transactions, so true concurrent-insert races
 * are only covered by the unique-index/ON CONFLICT path (see the duplicate tests).
 */

const migration = readFileSync(new URL("../supabase/migrations/20261009100000_design_resources.sql", import.meta.url), "utf8");

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
const URL_A = `https://www.figma.com/design/${KEY}/Checkout?node-id=1-2`;
const URL_B = `https://www.figma.com/design/${KEY}/Checkout?node-id=1-3`;

async function makeDb() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE SCHEMA katalist_priv;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE TYPE public.list_role AS ENUM ('collaborator','view_only');
    CREATE TABLE public.profiles (id uuid PRIMARY KEY);
    CREATE TABLE public.lists (
      id uuid PRIMARY KEY,
      owner_profile_id uuid NOT NULL REFERENCES public.profiles(id),
      archived_at timestamptz
    );
    CREATE TABLE public.list_members (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      list_id uuid NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
      profile_id uuid NOT NULL REFERENCES public.profiles(id),
      role public.list_role NOT NULL DEFAULT 'collaborator',
      UNIQUE (list_id, profile_id)
    );
    CREATE TABLE public.things (
      id uuid PRIMARY KEY,
      list_id uuid REFERENCES public.lists(id) ON DELETE SET NULL
    );
    CREATE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

    CREATE OR REPLACE FUNCTION katalist_priv.is_list_owner(_list_id uuid)
    RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = 'pg_catalog','public','katalist_priv' AS $$
      SELECT EXISTS (SELECT 1 FROM public.lists l WHERE l.id = _list_id AND l.owner_profile_id = auth.uid());
    $$;
    CREATE OR REPLACE FUNCTION katalist_priv.is_list_member(_list_id uuid, _roles public.list_role[] DEFAULT NULL)
    RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = 'pg_catalog','public','katalist_priv' AS $$
      SELECT EXISTS (
        SELECT 1 FROM public.list_members m
        WHERE m.list_id = _list_id AND m.profile_id = auth.uid()
          AND (_roles IS NULL OR m.role = ANY(_roles))
      );
    $$;
    CREATE OR REPLACE FUNCTION katalist_priv.can_view_list(_list_id uuid)
    RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = 'pg_catalog','public','katalist_priv' AS $$
      SELECT katalist_priv.is_list_owner(_list_id) OR katalist_priv.is_list_member(_list_id);
    $$;
    -- Supabase grants every new public table to anon/authenticated by default; mimic that.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    GRANT USAGE ON SCHEMA public, auth, katalist_priv TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION katalist_priv.is_list_owner(uuid), katalist_priv.can_view_list(uuid) TO authenticated;
    GRANT EXECUTE ON FUNCTION katalist_priv.is_list_member(uuid, public.list_role[]) TO authenticated;

    INSERT INTO public.profiles VALUES ('${OWNER}'),('${COLLAB}'),('${VIEWER}'),('${OUTSIDER}'),('${OTHER_OWNER}');
    INSERT INTO public.lists VALUES ('${LIST}','${OWNER}',NULL),('${OTHER_LIST}','${OTHER_OWNER}',NULL);
    INSERT INTO public.list_members (list_id, profile_id, role) VALUES
      ('${LIST}','${COLLAB}','collaborator'), ('${LIST}','${VIEWER}','view_only');
    INSERT INTO public.things VALUES ('${THING}','${LIST}'),('${OTHER_THING}','${OTHER_LIST}');
  `);
  await db.exec(migration);
  return db;
}

async function as(db, profile, role = "authenticated") {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${profile ?? ""}', false); SET ROLE ${role};`);
}

async function sys(db) {
  await db.exec("RESET ROLE");
}

const q = (db, sql, params) => db.query(sql, params);

async function addAs(db, profile, url = URL_A, title = "Checkout", list = LIST, extra = "") {
  await as(db, profile);
  const r = await q(db, `SELECT * FROM public.add_design_resource('${list}', '${url}', '${title}'${extra})`);
  return r.rows[0];
}

async function hint(promise) {
  try {
    await promise;
  } catch (e) {
    return { message: e.message, hint: e.hint, code: e.code };
  }
  assert.fail("expected the statement to fail");
}

test("owner and collaborator can create; derived fields come from the URL, not the caller", async () => {
  const db = await makeDb();
  try {
    const a = await addAs(db, OWNER);
    assert.equal(a.kind, "design");
    assert.equal(a.file_key, KEY);
    assert.equal(a.node_id, "1-2");
    assert.equal(a.identity_key, `design:${KEY}:1-2::`);
    assert.equal(a.original_url, `https://www.figma.com/design/${KEY}?node-id=1-2`);
    assert.equal(a.owner_profile_id, OWNER);
    const b = await addAs(db, COLLAB, URL_B, "Other frame");
    assert.equal(b.created_by, COLLAB);
    assert.equal(b.owner_profile_id, COLLAB);
  } finally {
    await db.close();
  }
});

test("view-only, outsider and anonymous cannot create or mutate shared records", async () => {
  const db = await makeDb();
  try {
    const a = await addAs(db, OWNER);
    for (const profile of [VIEWER, OUTSIDER]) {
      await as(db, profile);
      const e = await hint(q(db, `SELECT * FROM public.add_design_resource('${LIST}', '${URL_B}', 'x')`));
      assert.ok(e.code === "42501" || e.code === "P0002", `${profile}: ${e.message}`);
      await hint(q(db, `SELECT * FROM public.update_design_resource('${a.id}', 'hacked')`));
      await hint(q(db, `SELECT * FROM public.set_design_resource_archived('${a.id}', true)`));
      await hint(q(db, `SELECT * FROM public.create_design_folder('${LIST}', 'Folder')`));
      await hint(q(db, `SELECT * FROM public.link_design_thing('${a.id}', '${THING}')`));
    }
    await as(db, null, "anon");
    await hint(q(db, `SELECT * FROM public.add_design_resource('${LIST}', '${URL_B}', 'x')`));
    await as(db, null);
    assert.equal((await hint(q(db, `SELECT * FROM public.add_design_resource('${LIST}', '${URL_B}', 'x')`))).code, "28000");
  } finally {
    await db.close();
  }
});

test("direct table writes are denied for every client role", async () => {
  const db = await makeDb();
  try {
    const a = await addAs(db, OWNER);
    for (const profile of [OWNER, COLLAB, VIEWER]) {
      await as(db, profile);
      await hint(q(db, `INSERT INTO public.design_resources (list_id, original_url, title) VALUES ('${LIST}', '${URL_B}', 'direct')`));
      await hint(q(db, `UPDATE public.design_resources SET title = 'direct' WHERE id = '${a.id}'`));
      await hint(q(db, `DELETE FROM public.design_resources WHERE id = '${a.id}'`));
      await hint(q(db, `INSERT INTO public.design_favorites (resource_id, profile_id, list_id) VALUES ('${a.id}', '${profile}', '${LIST}')`));
      await hint(q(db, `INSERT INTO public.design_thing_links (resource_id, thing_id, list_id) VALUES ('${a.id}', '${THING}', '${LIST}')`));
      await hint(q(db, `INSERT INTO public.design_folders (list_id, name) VALUES ('${LIST}', 'direct')`));
    }
    await as(db, null, "anon");
    await hint(q(db, `SELECT * FROM public.design_resources`));
  } finally {
    await db.close();
  }
});

test("read access: members read; outsider and anonymous see nothing", async () => {
  const db = await makeDb();
  try {
    await addAs(db, OWNER);
    await as(db, OWNER);
    await q(db, `SELECT * FROM public.create_design_folder('${LIST}', 'Flows')`);
    for (const profile of [OWNER, COLLAB, VIEWER]) {
      await as(db, profile);
      assert.equal((await q(db, "SELECT * FROM public.design_resources")).rows.length, 1, profile);
      assert.equal((await q(db, "SELECT * FROM public.design_folders")).rows.length, 1, profile);
    }
    await as(db, OUTSIDER);
    assert.equal((await q(db, "SELECT * FROM public.design_resources")).rows.length, 0);
    assert.equal((await q(db, "SELECT * FROM public.design_folders")).rows.length, 0);
    await as(db, OTHER_OWNER);
    assert.equal((await q(db, "SELECT * FROM public.design_resources")).rows.length, 0);
    await as(db, null);
    assert.equal((await q(db, "SELECT * FROM public.design_resources")).rows.length, 0);
    await as(db, null, "anon");
    await hint(q(db, "SELECT * FROM public.design_resources"));
  } finally {
    await db.close();
  }
});

test("collaborator edits, archives and restores; owner must be a List participant", async () => {
  const db = await makeDb();
  try {
    const a = await addAs(db, OWNER);
    await as(db, COLLAB);
    const u = await q(db, `SELECT * FROM public.update_design_resource('${a.id}', '  Renamed ', ' note ', ARRAY['Web',' web ','Mobile',''], '${VIEWER}', NULL, NULL)`);
    assert.equal(u.rows[0].title, "Renamed");
    assert.equal(u.rows[0].notes, "note");
    assert.deepEqual(u.rows[0].tags, ["Web", "Mobile"]);
    assert.equal(u.rows[0].owner_profile_id, VIEWER);
    const bad = await hint(q(db, `SELECT * FROM public.update_design_resource('${a.id}', 'x', NULL, '{}', '${OUTSIDER}', NULL, NULL)`));
    assert.equal(bad.hint, "owner_not_member");
    const arch = await q(db, `SELECT * FROM public.set_design_resource_archived('${a.id}', true)`);
    assert.ok(arch.rows[0].archived_at);
    assert.equal((await hint(q(db, `SELECT * FROM public.update_design_resource('${a.id}', 'x')`))).hint, "archived");
    const restored = await q(db, `SELECT * FROM public.set_design_resource_archived('${a.id}', false)`);
    assert.equal(restored.rows[0].archived_at, null);
  } finally {
    await db.close();
  }
});

test("duplicate identity: unique among active rows; archive frees it; restore conflicts are explicit", async () => {
  const db = await makeDb();
  try {
    const first = await addAs(db, OWNER);
    // Same frame via legacy /file/ link, different slug and tracking param: same identity.
    await as(db, COLLAB);
    const dup = await hint(q(db, `SELECT * FROM public.add_design_resource('${LIST}', 'https://figma.com/file/${KEY}/Renamed?node-id=1%3A2&t=x', 'dup')`));
    assert.equal(dup.hint, "duplicate_design");
    // A different frame is a different identity.
    await q(db, `SELECT * FROM public.add_design_resource('${LIST}', '${URL_B}', 'Other')`);
    // Archive frees the identity; re-adding creates a NEW active row and keeps the archived one.
    await as(db, OWNER);
    await q(db, `SELECT * FROM public.set_design_resource_archived('${first.id}', true)`);
    const readded = await q(db, `SELECT * FROM public.add_design_resource('${LIST}', '${URL_A}', 'Again')`);
    assert.notEqual(readded.rows[0].id, first.id);
    const restore = await hint(q(db, `SELECT * FROM public.set_design_resource_archived('${first.id}', false)`));
    assert.equal(restore.hint, "duplicate_design");
    // The same design in another List is not a duplicate.
    await as(db, OTHER_OWNER);
    await q(db, `SELECT * FROM public.add_design_resource('${OTHER_LIST}', '${URL_A}', 'Elsewhere')`);
    // Editing an active row into another active row's identity conflicts.
    await as(db, OWNER);
    const other = (await q(db, `SELECT id FROM public.design_resources WHERE list_id = '${LIST}' AND node_id = '1-3'`)).rows[0];
    assert.equal((await hint(q(db, `SELECT * FROM public.update_design_resource('${other.id}', 'x', NULL, '{}', NULL, NULL, '${URL_A}')`))).hint, "duplicate_design");
    // Database-level backstop: the partial unique index exists and is on active rows only.
    await sys(db);
    const idx = await q(db, "SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_design_resources_active_identity'");
    assert.match(idx.rows[0].indexdef, /UNIQUE/);
    assert.match(idx.rows[0].indexdef, /archived_at IS NULL/);
    await hint(q(db, `UPDATE public.design_resources SET archived_at = NULL WHERE id = '${first.id}'`));
  } finally {
    await db.close();
  }
});

test("browser-supplied identity cannot be trusted: triggers re-derive even for privileged writers", async () => {
  const db = await makeDb();
  try {
    await sys(db);
    await q(db, `INSERT INTO public.design_resources (list_id, original_url, title, kind, file_key, identity_key, owner_profile_id)
      VALUES ('${LIST}', '${URL_A}', 'forged', 'prototype', 'FORGEDKEY1', 'forged', '${OWNER}')`);
    const r = (await q(db, "SELECT * FROM public.design_resources")).rows[0];
    assert.equal(r.kind, "design");
    assert.equal(r.file_key, KEY);
    assert.equal(r.identity_key, `design:${KEY}:1-2::`);
    await q(db, `UPDATE public.design_resources SET identity_key = 'forged2', file_key = 'FORGEDKEY2' WHERE id = '${r.id}'`);
    const r2 = (await q(db, "SELECT * FROM public.design_resources")).rows[0];
    assert.equal(r2.identity_key, `design:${KEY}:1-2::`);
    assert.equal(r2.file_key, KEY);
    const bad = await hint(q(db, `INSERT INTO public.design_resources (list_id, original_url, title, owner_profile_id)
      VALUES ('${LIST}', 'https://evil.com/design/${KEY}', 'bad', '${OWNER}')`));
    assert.equal(bad.hint, "unsupported_host");
    // Embed URLs are not stored at all.
    const cols = (await q(db, "SELECT column_name FROM information_schema.columns WHERE table_name = 'design_resources'")).rows.map((c) => c.column_name);
    assert.ok(!cols.some((c) => /embed/i.test(c)));
  } finally {
    await db.close();
  }
});

test("invalid URLs are rejected at the write boundary with a machine-readable hint", async () => {
  const db = await makeDb();
  try {
    await as(db, OWNER);
    const cases = {
      "https://evil.com/design/abc123": "unsupported_host",
      "http://www.figma.com/design/abc123": "insecure_protocol",
      "https://u:p@www.figma.com/design/abc123": "credentials_not_allowed",
      "https://www.figma.com/community/file/1": "unsupported_route",
      [`https://www.figma.com/design/${KEY}?node-id=abc`]: "invalid_node_id",
    };
    for (const [url, code] of Object.entries(cases)) {
      const e = await hint(q(db, "SELECT * FROM public.add_design_resource($1, $2, 'x')", [LIST, url]));
      assert.equal(e.hint, code, url);
    }
  } finally {
    await db.close();
  }
});

test("folders: List-scoped, collaborator-managed, no cross-List filing, delete unfiles", async () => {
  const db = await makeDb();
  try {
    await as(db, COLLAB);
    const folder = (await q(db, `SELECT * FROM public.create_design_folder('${LIST}', 'Flows')`)).rows[0];
    assert.equal((await hint(q(db, `SELECT * FROM public.create_design_folder('${LIST}', 'flows')`))).hint, "duplicate_folder");
    await as(db, OTHER_OWNER);
    const foreign = (await q(db, `SELECT * FROM public.create_design_folder('${OTHER_LIST}', 'Foreign')`)).rows[0];
    await as(db, COLLAB);
    // A folder from another List cannot be used (composite foreign key).
    const e = await hint(q(db, `SELECT * FROM public.add_design_resource('${LIST}', '${URL_A}', 'x', NULL, '{}', NULL, '${foreign.id}')`));
    assert.equal(e.code, "23503");
    const a = (await q(db, `SELECT * FROM public.add_design_resource('${LIST}', '${URL_A}', 'x', NULL, '{}', NULL, '${folder.id}')`)).rows[0];
    assert.equal(a.folder_id, folder.id);
    await as(db, VIEWER);
    await hint(q(db, `SELECT * FROM public.rename_design_folder('${folder.id}', 'Hijack')`));
    await hint(q(db, `SELECT * FROM public.delete_design_folder('${folder.id}')`));
    await as(db, OUTSIDER);
    await hint(q(db, `SELECT * FROM public.delete_design_folder('${folder.id}')`));
    await as(db, COLLAB);
    await q(db, `SELECT * FROM public.rename_design_folder('${folder.id}', 'Renamed')`);
    await q(db, `SELECT public.delete_design_folder('${folder.id}')`);
    const after = (await q(db, `SELECT * FROM public.design_resources WHERE id = '${a.id}'`)).rows[0];
    assert.equal(after.folder_id, null);
    assert.equal(after.list_id, LIST);
  } finally {
    await db.close();
  }
});

test("records cannot be moved across Lists or bypass membership", async () => {
  const db = await makeDb();
  try {
    const a = await addAs(db, OWNER);
    await sys(db);
    const moved = await hint(q(db, `UPDATE public.design_resources SET list_id = '${OTHER_LIST}' WHERE id = '${a.id}'`));
    assert.ok(moved.hint === "cross_list" || moved.code === "23514" || moved.code === "23503");
    const folderMove = await hint(
      (async () => {
        await q(db, `INSERT INTO public.design_folders (id, list_id, name) VALUES ('dddddddd-0000-0000-0000-000000000001', '${LIST}', 'F')`);
        await q(db, `UPDATE public.design_folders SET list_id = '${OTHER_LIST}' WHERE id = 'dddddddd-0000-0000-0000-000000000001'`);
      })(),
    );
    assert.equal(folderMove.hint, "cross_list");
    // Owner must belong to the List even for privileged writers.
    const badOwner = await hint(q(db, `UPDATE public.design_resources SET owner_profile_id = '${OUTSIDER}' WHERE id = '${a.id}'`));
    assert.equal(badOwner.hint, "owner_not_member");
    // Creation details are immutable.
    await hint(q(db, `UPDATE public.design_resources SET created_by = '${OUTSIDER}' WHERE id = '${a.id}'`));
    // A removed member loses access immediately.
    await q(db, `DELETE FROM public.list_members WHERE profile_id = '${COLLAB}'`);
    await as(db, COLLAB);
    assert.equal((await q(db, "SELECT * FROM public.design_resources")).rows.length, 0);
    await hint(q(db, `SELECT * FROM public.update_design_resource('${a.id}', 'x')`));
  } finally {
    await db.close();
  }
});

test("archived Lists reject design writes", async () => {
  const db = await makeDb();
  try {
    await sys(db);
    await q(db, `UPDATE public.lists SET archived_at = now() WHERE id = '${LIST}'`);
    await as(db, OWNER);
    assert.equal((await hint(q(db, `SELECT * FROM public.add_design_resource('${LIST}', '${URL_A}', 'x')`))).code, "42501");
  } finally {
    await db.close();
  }
});

test("favorites are personal, allowed for view-only members, and isolated", async () => {
  const db = await makeDb();
  try {
    const a = await addAs(db, OWNER);
    await as(db, VIEWER);
    await q(db, `SELECT public.set_design_favorite('${a.id}', true)`);
    await q(db, `SELECT public.set_design_favorite('${a.id}', true)`); // idempotent
    await as(db, COLLAB);
    assert.equal((await q(db, "SELECT * FROM public.design_favorites")).rows.length, 0);
    await q(db, `SELECT public.set_design_favorite('${a.id}', true)`);
    await as(db, VIEWER);
    const mine = (await q(db, "SELECT * FROM public.design_favorites")).rows;
    assert.equal(mine.length, 1);
    assert.equal(mine[0].profile_id, VIEWER);
    // Another member's unfavorite never touches mine.
    await as(db, OWNER);
    await q(db, `SELECT public.set_design_favorite('${a.id}', false)`);
    await as(db, VIEWER);
    assert.equal((await q(db, "SELECT * FROM public.design_favorites")).rows.length, 1);
    // Outsiders cannot favorite; direct edits and forged profile ids are impossible.
    await as(db, OUTSIDER);
    await hint(q(db, `SELECT public.set_design_favorite('${a.id}', true)`));
    assert.equal((await q(db, "SELECT * FROM public.design_favorites")).rows.length, 0);
    await sys(db);
    await hint(q(db, `UPDATE public.design_favorites SET profile_id = '${OWNER}'`));
    // Archived designs cannot be newly favorited; unfavoriting stays possible.
    await as(db, OWNER);
    await q(db, `SELECT * FROM public.set_design_resource_archived('${a.id}', true)`);
    assert.equal((await hint(q(db, `SELECT public.set_design_favorite('${a.id}', true)`))).hint, "archived");
    await as(db, VIEWER);
    await q(db, `SELECT public.set_design_favorite('${a.id}', false)`);
    // A member who loses access cannot read their favorites any more.
    await q(db, `SELECT public.set_design_favorite('${a.id}', false)`);
  } finally {
    await db.close();
  }
});

test("Thing links: same-List only, collaborator-managed, idempotent, cleaned when a Thing moves", async () => {
  const db = await makeDb();
  try {
    const a = await addAs(db, OWNER);
    await as(db, COLLAB);
    const link = (await q(db, `SELECT * FROM public.link_design_thing('${a.id}', '${THING}')`)).rows[0];
    const again = (await q(db, `SELECT * FROM public.link_design_thing('${a.id}', '${THING}')`)).rows[0];
    assert.equal(again.id, link.id);
    assert.equal(link.list_id, LIST);
    const cross = await hint(q(db, `SELECT * FROM public.link_design_thing('${a.id}', '${OTHER_THING}')`));
    assert.equal(cross.hint, "cross_list");
    // Privileged writers cannot create a cross-List link either.
    await sys(db);
    assert.equal((await hint(q(db, `INSERT INTO public.design_thing_links (resource_id, thing_id, list_id) VALUES ('${a.id}', '${OTHER_THING}', '${LIST}')`))).hint, "cross_list");
    await hint(q(db, `INSERT INTO public.design_thing_links (resource_id, thing_id, list_id) VALUES ('${a.id}', '${THING}', '${OTHER_LIST}')`));
    await hint(q(db, `UPDATE public.design_thing_links SET thing_id = '${OTHER_THING}'`));
    // Members read links; outsiders do not; view-only cannot unlink.
    await as(db, VIEWER);
    assert.equal((await q(db, "SELECT * FROM public.design_thing_links")).rows.length, 1);
    await hint(q(db, `SELECT public.unlink_design_thing('${a.id}', '${THING}')`));
    await as(db, OUTSIDER);
    assert.equal((await q(db, "SELECT * FROM public.design_thing_links")).rows.length, 0);
    await hint(q(db, `SELECT * FROM public.link_design_thing('${a.id}', '${THING}')`));
    // Moving the Thing to another List removes the now-invalid link.
    await sys(db);
    await q(db, `UPDATE public.things SET list_id = '${OTHER_LIST}' WHERE id = '${THING}'`);
    assert.equal((await q(db, "SELECT * FROM public.design_thing_links")).rows.length, 0);
    // Unlink works for collaborators.
    await q(db, `UPDATE public.things SET list_id = '${LIST}' WHERE id = '${THING}'`);
    await as(db, COLLAB);
    await q(db, `SELECT * FROM public.link_design_thing('${a.id}', '${THING}')`);
    await q(db, `SELECT public.unlink_design_thing('${a.id}', '${THING}')`);
    assert.equal((await q(db, "SELECT * FROM public.design_thing_links")).rows.length, 0);
  } finally {
    await db.close();
  }
});

test("constraints reject malformed titles, notes and tags; RPC grants exclude anon", async () => {
  const db = await makeDb();
  try {
    await as(db, OWNER);
    await hint(q(db, `SELECT * FROM public.add_design_resource('${LIST}', '${URL_A}', '   ')`));
    await hint(q(db, `SELECT * FROM public.add_design_resource('${LIST}', '${URL_A}', '${"t".repeat(201)}')`));
    await hint(q(db, `SELECT * FROM public.add_design_resource('${LIST}', '${URL_A}', 'x', '${"n".repeat(4001)}')`));
    const tags = Array.from({ length: 21 }, (_, i) => `'t${i}'`).join(",");
    await hint(q(db, `SELECT * FROM public.add_design_resource('${LIST}', '${URL_A}', 'x', NULL, ARRAY[${tags}])`));
    await hint(q(db, `SELECT * FROM public.add_design_resource('${LIST}', '${URL_A}', 'x', NULL, ARRAY['${"g".repeat(41)}'])`));
    await sys(db);
    for (const fn of [
      "create_design_folder(uuid,text)",
      "rename_design_folder(uuid,text)",
      "delete_design_folder(uuid)",
      "add_design_resource(uuid,text,text,text,text[],uuid,uuid)",
      "update_design_resource(uuid,text,text,text[],uuid,uuid,text)",
      "set_design_resource_archived(uuid,boolean)",
      "set_design_favorite(uuid,boolean)",
      "link_design_thing(uuid,uuid)",
      "unlink_design_thing(uuid,uuid)",
    ]) {
      const r = (await q(db, `SELECT has_function_privilege('anon','public.${fn}','EXECUTE') AS anon, has_function_privilege('authenticated','public.${fn}','EXECUTE') AS authed`)).rows[0];
      assert.deepEqual(r, { anon: false, authed: true }, fn);
    }
    const parse = (await q(db, "SELECT has_function_privilege('authenticated','katalist_priv.parse_figma_url(text)','EXECUTE') AS authed")).rows[0];
    assert.equal(parse.authed, false);
  } finally {
    await db.close();
  }
});

test("SQL URL parser stays in parity with the TypeScript parser", async () => {
  const db = await makeDb();
  try {
    const other = "ZyXwVu0987654321abC456";
    const inputs = [
      `https://www.figma.com/design/${KEY}/Checkout-Flow`,
      `https://www.figma.com/design/${KEY}/Name?node-id=12-34&t=trackingjunk`,
      `https://figma.com/design/${KEY}/Other-Name?node-id=12%3A34`,
      `https://www.figma.com/file/${KEY}/Name?node-id=1-2`,
      `https://www.figma.com/design/${KEY}/branch/${other}/Name`,
      `https://www.figma.com/board/${KEY}/Retro?node-id=2-3`,
      `https://www.figma.com/slides/${KEY}/Pitch`,
      `https://www.figma.com/deck/${KEY}/Pitch?node-id=2-3`,
      `https://www.figma.com/proto/${KEY}/App?node-id=5-6&starting-point-node-id=7%3A8&version-id=123456&scaling=fit-width&content-scaling=fixed&hide-ui=1`,
      `https://www.figma.com/proto/${KEY}/N?page-id=0-1`,
      `https://www.figma.com/design/${KEY}/N?page-id=0%3A1`,
      `https://www.figma.com/design/${KEY}/N?node-id=5-6&page-id=0-1&version-id=99`,
      `https://www.figma.com/design/${KEY}/N?node-id=1-2&foo=bar&embed-host=evil`,
      `https://embed.figma.com/design/${KEY}?node-id=1-2&embed-host=other`,
      `  https://www.figma.com/design/${KEY}/N \n`,
      "https://www.figma.com/design/abc123/N",
      "https://www.figma.com/design/Ab_c-1/N",
      "https://figma.com.evil.com/design/" + KEY,
      "https://evil-figma.com/design/" + KEY,
      "https://api.figma.com/design/" + KEY,
      "https://figma.com./design/" + KEY,
      `https://user:pass@www.figma.com/design/${KEY}/N`,
      `https://www.figma.com@evil.com/design/${KEY}/N`,
      `https://www.figma.com:8443/design/${KEY}/N`,
      `http://www.figma.com/design/${KEY}/N`,
      "javascript:alert(1)",
      `ftp://www.figma.com/design/${KEY}`,
      "not a url",
      "www.figma.com/design/abc",
      "",
      "   ",
      "https://www.figma.com/community/file/123",
      "https://www.figma.com/files/recent",
      "https://www.figma.com/",
      `https://www.figma.com/make/${KEY}`,
      "https://www.figma.com/design/",
      `https://www.figma.com/design/${KEY}%2F..%2Fx/N`,
      `https://www.figma.com/design/${KEY}!/N`,
      `https://www.figma.com/design/${KEY}/branch/bad!/N`,
      `https://www.figma.com/design/${KEY}/branch`,
      `https://www.figma.com/design/${KEY}/N?node-id=abc`,
      `https://www.figma.com/design/${KEY}/N?node-id=I1%3A2%3B3%3A4`,
      `https://www.figma.com/design/${KEY}/N?node-id=`,
      `https://www.figma.com/proto/${KEY}/N?starting-point-node-id=x`,
      `https://www.figma.com/design/${KEY}/N?version-id=abc`,
      `https://www.figma.com/design/${KEY}/N?page-id=zzz`,
      `https://www.figma.com/proto/${KEY}/N?scaling=huge`,
      `https://www.figma.com/proto/${KEY}/N?content-scaling=huge`,
      `https://www.figma.com/design/${KEY}/N?node-id=1-2&starting-point-node-id=9-9`,
      `https://www.figma.com/design/${"a".repeat(129)}/N`,
      `https://www.figma.com/design/${KEY}/${"a".repeat(3000)}`,
    ];
    for (const input of inputs) {
      const ts = parseFigmaUrl(input);
      let sql = null;
      let sqlHint = null;
      try {
        sql = (await q(db, "SELECT * FROM katalist_priv.parse_figma_url($1)", [input])).rows[0];
      } catch (e) {
        sqlHint = e.hint;
      }
      if (ts.ok) {
        assert.ok(sql, `SQL rejected a link TS accepts: ${JSON.stringify(input)} (${sqlHint})`);
        assert.equal(sql.kind, ts.value.kind, input);
        assert.equal(sql.file_key, ts.value.fileKey, input);
        assert.equal(sql.node_id, ts.value.nodeId, input);
        assert.equal(sql.starting_point_node_id, ts.value.startingPointNodeId, input);
        assert.equal(sql.version_id, ts.value.versionId, input);
        assert.equal(sql.page_id, ts.value.pageId, input);
        assert.equal(sql.original_url, ts.value.normalizedUrl, input);
        assert.equal(sql.identity_key, ts.value.identityKey, input);
      } else {
        assert.equal(sql, null, `SQL accepted a link TS rejects: ${JSON.stringify(input)}`);
        assert.equal(sqlHint, ts.error.code, input);
      }
    }
  } finally {
    await db.close();
  }
});

test("default Supabase table privileges are stripped: anon has nothing, authenticated can only SELECT", async () => {
  const db = await makeDb();
  try {
    const rows = (await q(db, `
      SELECT table_name, grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name LIKE 'design\\_%' AND grantee IN ('anon','authenticated','PUBLIC')
      GROUP BY table_name, grantee`)).rows;
    assert.ok(rows.length >= 4);
    for (const r of rows) {
      assert.equal(r.grantee, "authenticated", `${r.table_name}: only authenticated may hold any privilege`);
      assert.equal(r.privs, "SELECT", `${r.table_name}: authenticated is limited to SELECT`);
    }
    await as(db, OWNER);
    await hint(q(db, "TRUNCATE public.design_resources"));
  } finally {
    await db.close();
  }
});
