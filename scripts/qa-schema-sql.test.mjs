import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

/**
 * Manual QA authorization/integrity matrix for 20261009144940_manual_qa.sql on PGlite
 * (a real Postgres engine, one connection). List helpers are copied from the production
 * migration; auth.uid() is stubbed from request.jwt.claim.sub as in design-resources-sql.test.mjs.
 * This does NOT prove Supabase's JWT/PostgREST layer, Storage, or concurrent transactions.
 */

const migration = readFileSync(new URL("../supabase/migrations/20261009144940_manual_qa.sql", import.meta.url), "utf8");

const OWNER = "11111111-1111-1111-1111-111111111111";
const COLLAB = "22222222-2222-2222-2222-222222222222";
const VIEWER = "33333333-3333-3333-3333-333333333333";
const OUTSIDER = "44444444-4444-4444-4444-444444444444";
const OTHER_OWNER = "55555555-5555-5555-5555-555555555555";
const LIST = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTHER_LIST = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const THING = "cccccccc-0000-0000-0000-000000000001";
const OTHER_THING = "cccccccc-0000-0000-0000-000000000002";

async function makeDb() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA katalist_priv; CREATE SCHEMA storage;
    CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE TYPE public.list_role AS ENUM ('collaborator','view_only');
    CREATE TABLE public.profiles (id uuid PRIMARY KEY);
    CREATE TABLE public.lists (id uuid PRIMARY KEY, owner_profile_id uuid NOT NULL REFERENCES public.profiles(id), archived_at timestamptz);
    CREATE TABLE public.list_members (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      list_id uuid NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
      profile_id uuid NOT NULL REFERENCES public.profiles(id),
      role public.list_role NOT NULL DEFAULT 'collaborator',
      UNIQUE (list_id, profile_id)
    );
    CREATE TABLE public.things (id uuid PRIMARY KEY, list_id uuid REFERENCES public.lists(id) ON DELETE SET NULL,
      owner_actor_id uuid, current_assignee_actor_id uuid, work_status text DEFAULT 'not_started', acknowledgement text DEFAULT 'waiting_for_catch');
    CREATE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
    CREATE OR REPLACE FUNCTION katalist_priv.is_list_owner(_list_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path = 'pg_catalog','public','katalist_priv' AS $$
      SELECT EXISTS (SELECT 1 FROM public.lists l WHERE l.id = _list_id AND l.owner_profile_id = auth.uid()); $$;
    CREATE OR REPLACE FUNCTION katalist_priv.is_list_member(_list_id uuid, _roles public.list_role[] DEFAULT NULL) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path = 'pg_catalog','public','katalist_priv' AS $$
      SELECT EXISTS (SELECT 1 FROM public.list_members m WHERE m.list_id = _list_id AND m.profile_id = auth.uid() AND (_roles IS NULL OR m.role = ANY(_roles))); $$;
    CREATE OR REPLACE FUNCTION katalist_priv.can_view_list(_list_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path = 'pg_catalog','public','katalist_priv' AS $$
      SELECT katalist_priv.is_list_owner(_list_id) OR katalist_priv.is_list_member(_list_id); $$;
    GRANT SELECT ON public.things TO authenticated;
    GRANT ALL ON public.list_members, public.lists, public.profiles, public.things TO service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    GRANT USAGE ON SCHEMA public, auth, katalist_priv TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION katalist_priv.is_list_owner(uuid), katalist_priv.can_view_list(uuid) TO authenticated;
    GRANT EXECUTE ON FUNCTION katalist_priv.is_list_member(uuid, public.list_role[]) TO authenticated;
    INSERT INTO public.profiles VALUES ('${OWNER}'),('${COLLAB}'),('${VIEWER}'),('${OUTSIDER}'),('${OTHER_OWNER}');
    INSERT INTO public.lists VALUES ('${LIST}','${OWNER}',NULL),('${OTHER_LIST}','${OTHER_OWNER}',NULL);
    INSERT INTO public.list_members (list_id, profile_id, role) VALUES ('${LIST}','${COLLAB}','collaborator'), ('${LIST}','${VIEWER}','view_only');
    INSERT INTO public.things (id, list_id) VALUES ('${THING}','${LIST}'),('${OTHER_THING}','${OTHER_LIST}');
  `);
  await db.exec(migration);
  return db;
}

const as = async (db, profile, role = "authenticated") =>
  db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${profile ?? ""}', false); SET ROLE ${role};`);
const q = (db, sql) => db.query(sql);
const one = async (db, sql) => (await q(db, sql)).rows[0];

async function failure(promise) {
  try {
    await promise;
  } catch (e) {
    return { message: e.message, hint: e.hint, code: e.code };
  }
  assert.fail("expected the statement to fail");
}

/** Owner creates app, env, build, two cases. */
async function seed(db) {
  await as(db, OWNER);
  const app = await one(db, `SELECT * FROM qa_upsert_application('${LIST}', NULL, 'Web application', 'web', NULL)`);
  const env = await one(db, `SELECT * FROM qa_upsert_environment('${LIST}', NULL, 'QA')`);
  const b142 = await one(db, `SELECT * FROM qa_register_build('${LIST}', '${app.id}', '${env.id}', 'web.142')`);
  const b143 = await one(db, `SELECT * FROM qa_register_build('${LIST}', '${app.id}', '${env.id}', 'web.143')`);
  const steps = `'[{"action":"Open","expected":"Opens"}]'::jsonb`;
  const c1 = (await one(db, `SELECT qa_save_case('${LIST}', NULL, 'Login works', 'pre', ${steps}, 'high', 'Auth', ARRAY['web']) AS r`)).r;
  const c2 = (await one(db, `SELECT qa_save_case('${LIST}', NULL, 'Edit blocked', NULL, ${steps}, 'medium', 'Perm', ARRAY['web']) AS r`)).r;
  return { app, env, b142, b143, c1, c2 };
}

async function newRun(db, s, build = s.b142, key = "run-key-0001", cases = [s.c1.case_id, s.c2.case_id]) {
  return one(
    db,
    `SELECT * FROM qa_create_run('${LIST}', 'Release run', '${s.app.id}', '${s.env.id}', '${build.id}', '{"browser":"Chrome 129"}'::jsonb,
      ARRAY[${cases.map((c) => `'${c}'::uuid`).join(",")}], '{}'::jsonb, '${key}')`,
  );
}

test("members read QA data; outsiders and anon read nothing; direct writes are denied to everyone", async () => {
  const db = await makeDb();
  try {
    const s = await seed(db);
    for (const p of [OWNER, COLLAB, VIEWER]) {
      await as(db, p);
      assert.equal((await q(db, "SELECT 1 FROM qa_applications")).rows.length, 1);
      assert.equal((await q(db, "SELECT 1 FROM qa_case_current")).rows.length, 2);
    }
    await as(db, OUTSIDER);
    assert.equal((await q(db, "SELECT 1 FROM qa_applications")).rows.length, 0);
    assert.equal((await q(db, "SELECT 1 FROM qa_case_current")).rows.length, 0);
    await as(db, null, "anon");
    await failure(q(db, "SELECT 1 FROM qa_applications"));
    for (const p of [OWNER, COLLAB, VIEWER]) {
      await as(db, p);
      await failure(q(db, `INSERT INTO qa_applications (list_id, name) VALUES ('${LIST}', 'x')`));
      await failure(q(db, `UPDATE qa_cases SET archived_at = now()`));
      await failure(q(db, `DELETE FROM qa_environments`));
      await failure(q(db, `INSERT INTO qa_attempts (run_case_id, run_id, list_id, status, idempotency_key) VALUES (gen_random_uuid(), gen_random_uuid(), '${LIST}', 'pass', 'abcdefgh')`));
    }
    assert.ok(s.app.id);
  } finally {
    await db.close();
  }
});

test("view-only and outsiders cannot write; owner and collaborator can", async () => {
  const db = await makeDb();
  try {
    const s = await seed(db);
    for (const p of [VIEWER, OUTSIDER]) {
      await as(db, p);
      const e = await failure(q(db, `SELECT * FROM qa_upsert_environment('${LIST}', NULL, 'Hack')`));
      assert.ok(e.code === "42501" || e.code === "P0002", e.message);
      await failure(q(db, `SELECT qa_save_case('${LIST}', NULL, 'x', NULL, '[]'::jsonb, 'low', NULL, '{}')`));
    }
    await as(db, COLLAB);
    const env2 = await one(db, `SELECT * FROM qa_upsert_environment('${LIST}', NULL, 'UAT')`);
    assert.equal(env2.name, "UAT");
    assert.equal((await failure(q(db, `SELECT * FROM qa_upsert_environment('${LIST}', NULL, 'uat')`))).hint, "duplicate_name");
    assert.ok(s.env.id);
  } finally {
    await db.close();
  }
});

test("the same application can have many environments and resources are isolated by app AND environment", async () => {
  const db = await makeDb();
  try {
    const s = await seed(db);
    await as(db, OWNER);
    const uat = await one(db, `SELECT * FROM qa_upsert_environment('${LIST}', NULL, 'UAT')`);
    await q(db, `SELECT * FROM qa_upsert_resource('${LIST}', NULL, '${s.app.id}', '${s.env.id}', 'application', 'QA workspace', 'https://qa.example.test', NULL)`);
    await q(db, `SELECT * FROM qa_upsert_resource('${LIST}', NULL, '${s.app.id}', '${uat.id}', 'application', 'UAT workspace', 'https://uat.example.test', NULL)`);
    const qa = await q(db, `SELECT label FROM qa_resources WHERE application_id='${s.app.id}' AND environment_id='${s.env.id}'`);
    assert.deepEqual(qa.rows.map((r) => r.label), ["QA workspace"]);
    // cross-List application cannot be attached
    await as(db, OTHER_OWNER);
    const other = await one(db, `SELECT * FROM qa_upsert_application('${OTHER_LIST}', NULL, 'Other', 'web', NULL)`);
    await as(db, OWNER);
    const e = await failure(q(db, `SELECT * FROM qa_upsert_resource('${LIST}', NULL, '${other.id}', '${s.env.id}', 'api', 'x', NULL, NULL)`));
    assert.equal(e.code, "23503");
    const bad = await failure(q(db, `SELECT * FROM qa_upsert_resource('${LIST}', NULL, '${s.app.id}', '${s.env.id}', 'api', 'x', 'javascript:alert(1)', NULL)`));
    assert.equal(bad.code, "23514");
  } finally {
    await db.close();
  }
});

test("builds are immutable and re-registering returns the same build", async () => {
  const db = await makeDb();
  try {
    const s = await seed(db);
    await as(db, OWNER);
    const again = await one(db, `SELECT * FROM qa_register_build('${LIST}', '${s.app.id}', '${s.env.id}', 'web.142', 'changed')`);
    assert.equal(again.id, s.b142.id);
    assert.equal(again.display_version, null);
    await as(db, "11111111-1111-1111-1111-111111111111", "service_role");
    assert.equal((await failure(q(db, `UPDATE qa_builds SET identifier = 'web.999' WHERE id = '${s.b142.id}'`))).hint, "immutable");
    assert.equal((await failure(q(db, `DELETE FROM qa_builds WHERE id = '${s.b142.id}'`))).hint, "immutable");
  } finally {
    await db.close();
  }
});

test("editing a case creates an immutable version; a run keeps the version it snapshotted", async () => {
  const db = await makeDb();
  try {
    const s = await seed(db);
    const run = await newRun(db, s);
    await as(db, OWNER);
    const same = (await one(db, `SELECT qa_save_case('${LIST}', '${s.c1.case_id}', 'Login works', 'pre', '[{"action":"Open","expected":"Opens"}]'::jsonb, 'high', 'Auth', ARRAY['web']) AS r`)).r;
    assert.equal(same.outcome, "unchanged");
    const edited = (await one(db, `SELECT qa_save_case('${LIST}', '${s.c1.case_id}', 'Login works v2', 'pre', '[{"action":"Open","expected":"Opens"}]'::jsonb, 'high', 'Auth', ARRAY['web'], 'reworded') AS r`)).r;
    assert.equal(edited.version, 2);
    const rc = await one(db, `SELECT * FROM qa_run_case_status WHERE run_id = '${run.id}' AND case_id = '${s.c1.case_id}'`);
    assert.equal(rc.version, 1);
    assert.equal(rc.title, "Login works");
    const cur = await one(db, `SELECT * FROM qa_case_current WHERE id = '${s.c1.case_id}'`);
    assert.equal(cur.title, "Login works v2");
    assert.equal(cur.case_key, "TC-001");
    await as(db, OWNER, "service_role");
    assert.equal((await failure(q(db, `UPDATE qa_case_versions SET title = 'tamper' WHERE case_id = '${s.c1.case_id}' AND version = 1`))).hint, "immutable");
  } finally {
    await db.close();
  }
});

test("attempts are append-only, idempotent, require notes for fail/blocked, and keep history", async () => {
  const db = await makeDb();
  try {
    const s = await seed(db);
    const run = await newRun(db, s);
    await as(db, COLLAB);
    const rc = await one(db, `SELECT id FROM qa_run_case_status WHERE run_id='${run.id}' AND case_id='${s.c1.case_id}'`);
    assert.equal((await failure(q(db, `SELECT * FROM qa_record_attempt('${rc.id}', 'fail', '  ', 'idem-0001')`))).hint, "actual_required");
    const a1 = await one(db, `SELECT * FROM qa_record_attempt('${rc.id}', 'fail', 'Title editable', 'idem-0001')`);
    const a1b = await one(db, `SELECT * FROM qa_record_attempt('${rc.id}', 'fail', 'Title editable', 'idem-0001')`);
    assert.equal(a1.id, a1b.id);
    const a2 = await one(db, `SELECT * FROM qa_record_attempt('${rc.id}', 'pass', NULL, 'idem-0002')`);
    assert.equal(a2.previous_attempt_id, a1.id);
    const status = await one(db, `SELECT status, attempt_count FROM qa_run_case_status WHERE id='${rc.id}'`);
    assert.equal(status.status, "pass");
    assert.equal(status.attempt_count, 2);
    assert.equal((await q(db, `SELECT 1 FROM qa_history WHERE run_case_id='${rc.id}'`)).rows.length, 2);
    await as(db, VIEWER);
    assert.ok(["42501", "P0002"].includes((await failure(q(db, `SELECT * FROM qa_record_attempt('${rc.id}', 'pass', NULL, 'idem-0003')`))).code));
    await as(db, COLLAB, "service_role");
    assert.equal((await failure(q(db, `UPDATE qa_attempts SET status = 'pass' WHERE id = '${a1.id}'`))).hint, "immutable");
    assert.equal((await failure(q(db, `DELETE FROM qa_attempts WHERE id = '${a1.id}'`))).hint, "immutable");
  } finally {
    await db.close();
  }
});

test("run build/context cannot change; build must match the run's application and environment", async () => {
  const db = await makeDb();
  try {
    const s = await seed(db);
    const run = await newRun(db, s);
    await as(db, OWNER, "service_role");
    assert.equal((await failure(q(db, `UPDATE qa_runs SET build_id = '${s.b143.id}' WHERE id = '${run.id}'`))).hint, "run_context_frozen");
    await as(db, OWNER);
    const env2 = await one(db, `SELECT * FROM qa_upsert_environment('${LIST}', NULL, 'UAT')`);
    const e = await failure(
      q(db, `SELECT * FROM qa_create_run('${LIST}', 'bad', '${s.app.id}', '${env2.id}', '${s.b142.id}', '{}'::jsonb, ARRAY['${s.c1.case_id}'::uuid])`),
    );
    assert.equal(e.hint, "build_mismatch");
  } finally {
    await db.close();
  }
});

test("retest needs a different build, creates a new run, and carries the failure and defect link forward", async () => {
  const db = await makeDb();
  try {
    const s = await seed(db);
    const run = await newRun(db, s);
    await as(db, COLLAB);
    const rc1 = await one(db, `SELECT id FROM qa_run_case_status WHERE run_id='${run.id}' AND case_id='${s.c1.case_id}'`);
    const rc2 = await one(db, `SELECT id FROM qa_run_case_status WHERE run_id='${run.id}' AND case_id='${s.c2.case_id}'`);
    const fail = await one(db, `SELECT * FROM qa_record_attempt('${rc1.id}', 'fail', 'Broken', 'idem-0001')`);
    await q(db, `SELECT * FROM qa_record_attempt('${rc2.id}', 'pass', NULL, 'idem-0002')`);
    await q(db, `SELECT * FROM qa_link_thing('${rc1.id}', '${fail.id}', '${THING}')`);
    await q(db, `SELECT * FROM qa_link_thing('${rc1.id}', '${fail.id}', '${THING}')`); // idempotent
    assert.equal((await q(db, `SELECT 1 FROM qa_thing_links`)).rows.length, 1);
    assert.equal((await failure(q(db, `SELECT * FROM qa_create_retest_run('${run.id}', '${s.b142.id}', 'again')`))).hint, "same_build");
    const retest = await one(db, `SELECT * FROM qa_create_retest_run('${run.id}', '${s.b143.id}', 'Retest web.143', 'retest-key-1')`);
    const again = await one(db, `SELECT * FROM qa_create_retest_run('${run.id}', '${s.b143.id}', 'Retest web.143', 'retest-key-1')`);
    assert.equal(retest.id, again.id);
    assert.equal(retest.predecessor_run_id, run.id);
    const rows = (await q(db, `SELECT * FROM qa_run_case_status WHERE run_id='${retest.id}'`)).rows;
    assert.equal(rows.length, 1); // only the failure
    assert.equal(rows[0].retest_of_run_case_id, rc1.id);
    assert.equal(rows[0].status, null); // Not Run in the new run
    assert.equal(rows[0].link_count, 1); // defect link carried
    // original failure untouched
    const orig = await one(db, `SELECT status, attempt_count FROM qa_run_case_status WHERE id='${rc1.id}'`);
    assert.equal(orig.status, "fail");
    assert.equal((await one(db, `SELECT build_id FROM qa_runs WHERE id='${run.id}'`)).build_id, s.b142.id);
  } finally {
    await db.close();
  }
});

test("same case on two builds keeps independent results; totals use latest attempts", async () => {
  const db = await makeDb();
  try {
    const s = await seed(db);
    const r142 = await newRun(db, s, s.b142, "run-key-0001", [s.c1.case_id]);
    const r143 = await newRun(db, s, s.b143, "run-key-0002", [s.c1.case_id]);
    await as(db, OWNER);
    const a = await one(db, `SELECT id FROM qa_run_case_status WHERE run_id='${r142.id}'`);
    const b = await one(db, `SELECT id FROM qa_run_case_status WHERE run_id='${r143.id}'`);
    await q(db, `SELECT * FROM qa_record_attempt('${a.id}', 'fail', 'x', 'idem-0001')`);
    await q(db, `SELECT * FROM qa_record_attempt('${a.id}', 'pass', NULL, 'idem-0002')`);
    await q(db, `SELECT * FROM qa_record_attempt('${b.id}', 'blocked', 'env down', 'idem-0003')`);
    const t142 = await one(db, `SELECT * FROM qa_run_totals('${r142.id}')`);
    const t143 = await one(db, `SELECT * FROM qa_run_totals('${r143.id}')`);
    assert.deepEqual([t142.total, t142.pass, t142.fail, t142.blocked, t142.not_run], [1, 1, 0, 0, 0]);
    assert.deepEqual([t143.total, t143.pass, t143.blocked], [1, 0, 1]);
  } finally {
    await db.close();
  }
});

test("completion requires explicit acceptance of Not Run and Blocked; NA counts as resolved; completed runs are closed", async () => {
  const db = await makeDb();
  try {
    const s = await seed(db);
    const run = await newRun(db, s);
    await as(db, OWNER);
    const rows = (await q(db, `SELECT id, case_id FROM qa_run_case_status WHERE run_id='${run.id}' ORDER BY position`)).rows;
    assert.equal((await failure(q(db, `SELECT qa_complete_run('${run.id}')`))).hint, "not_run_remaining");
    await q(db, `SELECT * FROM qa_record_attempt('${rows[0].id}', 'not_applicable', NULL, 'idem-0001')`);
    await q(db, `SELECT * FROM qa_record_attempt('${rows[1].id}', 'blocked', 'no device', 'idem-0002')`);
    assert.equal((await failure(q(db, `SELECT qa_complete_run('${run.id}')`))).hint, "blocked_remaining");
    const done = (await one(db, `SELECT qa_complete_run('${run.id}', true, false) AS r`)).r;
    assert.equal(done.not_applicable, 1);
    assert.equal(done.accepted_blocked, true);
    assert.equal((await failure(q(db, `SELECT qa_complete_run('${run.id}')`))).hint, "run_not_active");
    assert.equal((await failure(q(db, `SELECT * FROM qa_record_attempt('${rows[0].id}', 'pass', NULL, 'idem-0009')`))).hint, "run_not_active");
    assert.equal((await one(db, `SELECT status FROM qa_runs WHERE id='${run.id}'`)).status, "completed");
  } finally {
    await db.close();
  }
});

test("Thing links reject cross-List Things and never modify the Thing", async () => {
  const db = await makeDb();
  try {
    const s = await seed(db);
    const run = await newRun(db, s);
    await as(db, OWNER);
    const rc = await one(db, `SELECT id FROM qa_run_case_status WHERE run_id='${run.id}' AND case_id='${s.c1.case_id}'`);
    const before = await one(db, `SELECT * FROM things WHERE id='${THING}'`);
    assert.equal((await failure(q(db, `SELECT * FROM qa_link_thing('${rc.id}', NULL, '${OTHER_THING}')`))).hint, "cross_list");
    await q(db, `SELECT * FROM qa_link_thing('${rc.id}', NULL, '${THING}')`);
    assert.deepEqual(await one(db, `SELECT * FROM things WHERE id='${THING}'`), before);
    await as(db, VIEWER);
    assert.ok(["42501", "P0002"].includes((await failure(q(db, `SELECT * FROM qa_link_thing('${rc.id}', NULL, '${THING}')`))).code));
  } finally {
    await db.close();
  }
});

test("account secrets are unreachable by clients; grants intersect live membership; revoke is immediate", async () => {
  const db = await makeDb();
  try {
    const s = await seed(db);
    await as(db, OWNER);
    const acc = await one(
      db,
      `SELECT * FROM qa_save_account('${LIST}', NULL, '${s.app.id}', '${s.env.id}', 'QA Dispatcher', 'Dispatcher', 'qa.dispatcher@example.test', NULL,
        ARRAY['collaborator'], ARRAY[]::text[], ARRAY[]::uuid[], ARRAY[]::uuid[])`,
    );
    assert.equal(acc.has_secret, false);
    // server (service role) stores ciphertext
    await as(db, OWNER, "service_role");
    await q(db, `INSERT INTO qa_account_secrets (account_id, list_id, ciphertext, iv, auth_tag, key_version)
      VALUES ('${acc.id}', '${LIST}', '\\x0102'::bytea, '\\x000102030405060708090a0b'::bytea, '\\x000102030405060708090a0b0c0d0e0f'::bytea, 'v1')`);
    // clients: no read at all
    for (const p of [OWNER, COLLAB, VIEWER, OUTSIDER]) {
      await as(db, p);
      await failure(q(db, `SELECT * FROM qa_account_secrets`));
      await failure(q(db, `INSERT INTO qa_account_secrets (account_id, list_id, ciphertext, iv, auth_tag, key_version) VALUES ('${acc.id}', '${LIST}', '\\x01', '\\x000102030405060708090a0b', '\\x000102030405060708090a0b0c0d0e0f', 'v1')`));
    }
    await as(db, null, "anon");
    await failure(q(db, `SELECT * FROM qa_account_secrets`));
    // capabilities: creator manages; collaborator uses; viewer and owner-without-grant do not use via role
    await as(db, OWNER);
    assert.deepEqual(await one(db, `SELECT can_use, can_manage FROM qa_list_account_access('${LIST}')`), { can_use: true, can_manage: true });
    await as(db, COLLAB);
    assert.deepEqual(await one(db, `SELECT can_use, can_manage FROM qa_list_account_access('${LIST}')`), { can_use: true, can_manage: false });
    await as(db, VIEWER);
    assert.deepEqual(await one(db, `SELECT can_use, can_manage FROM qa_list_account_access('${LIST}')`), { can_use: false, can_manage: false });
    await as(db, OUTSIDER);
    assert.equal((await q(db, `SELECT * FROM qa_list_account_access('${LIST}')`)).rows.length, 0);
    assert.equal((await failure(q(db, `SELECT qa_account_access('${acc.id}')`))).code, "P0002");
    // a collaborator cannot manage; grants are hidden from non-managers
    await as(db, COLLAB);
    await failure(q(db, `SELECT * FROM qa_save_account('${LIST}', '${acc.id}', '${s.app.id}', '${s.env.id}', 'x', 'x', 'x', NULL)`));
    assert.equal((await q(db, `SELECT * FROM qa_account_grants`)).rows.length, 0);
    // revoking membership removes use immediately even though the grant row still names the role
    await as(db, OWNER, "service_role");
    await q(db, `DELETE FROM list_members WHERE profile_id = '${COLLAB}'`);
    await as(db, COLLAB);
    assert.equal((await failure(q(db, `SELECT qa_account_access('${acc.id}')`))).code, "P0002");
    assert.equal((await q(db, `SELECT * FROM qa_list_account_access('${LIST}')`)).rows.length, 0);
    // owner can strip use grants but keeps manage
    await as(db, OWNER);
    await q(db, `SELECT * FROM qa_save_account('${LIST}', '${acc.id}', '${s.app.id}', '${s.env.id}', 'QA Dispatcher', 'Dispatcher', 'qa.dispatcher@example.test', NULL, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::uuid[], ARRAY[]::uuid[])`);
    assert.deepEqual(await one(db, `SELECT can_use, can_manage FROM qa_list_account_access('${LIST}')`), { can_use: true, can_manage: true });
    // a non-member cannot be granted
    const bad = await failure(q(db, `SELECT * FROM qa_save_account('${LIST}', '${acc.id}', '${s.app.id}', '${s.env.id}', 'x', 'x', 'x', NULL, ARRAY[]::text[], ARRAY[]::text[], ARRAY['${OUTSIDER}'::uuid], ARRAY[]::uuid[])`));
    assert.equal(bad.hint, "owner_not_member");
  } finally {
    await db.close();
  }
});

test("audit events are readable only by QA managers and cannot be written by clients", async () => {
  const db = await makeDb();
  try {
    await seed(db);
    await as(db, OWNER, "service_role");
    await q(db, `INSERT INTO qa_audit_events (list_id, actor_profile_id, action, outcome) VALUES ('${LIST}', '${OWNER}', 'credential_reveal', 'success')`);
    await as(db, OWNER);
    assert.equal((await q(db, `SELECT 1 FROM qa_audit_events`)).rows.length, 1);
    await as(db, VIEWER);
    assert.equal((await q(db, `SELECT 1 FROM qa_audit_events`)).rows.length, 0);
    await as(db, OWNER);
    await failure(q(db, `INSERT INTO qa_audit_events (list_id, action, outcome) VALUES ('${LIST}', 'credential_reveal', 'success')`));
  } finally {
    await db.close();
  }
});

test("evidence: type/size/count validation, private lifecycle, and viewer denial", async () => {
  const db = await makeDb();
  try {
    const s = await seed(db);
    const run = await newRun(db, s);
    await as(db, COLLAB);
    const rc = await one(db, `SELECT id FROM qa_run_case_status WHERE run_id='${run.id}' AND case_id='${s.c1.case_id}'`);
    const att = await one(db, `SELECT * FROM qa_record_attempt('${rc.id}', 'fail', 'x', 'idem-0001')`);
    assert.equal((await failure(q(db, `SELECT * FROM qa_begin_evidence('${att.id}', 'a.exe', 'application/x-msdownload', 100)`))).hint, "mime_not_allowed");
    assert.equal((await failure(q(db, `SELECT * FROM qa_begin_evidence('${att.id}', 'big.png', 'image/png', 99999999999)`))).hint, "too_large");
    const ev = await one(db, `SELECT * FROM qa_begin_evidence('${att.id}', '../ev idence.png', 'image/png', 1234, '${"a".repeat(64)}')`);
    assert.equal(ev.status, "pending");
    assert.ok(ev.storage_key.startsWith(`qa/${LIST}/${att.id}/`));
    assert.ok(!ev.file_name.includes("/"));
    // pending is visible to its uploader only
    await as(db, OWNER);
    assert.equal((await q(db, `SELECT 1 FROM qa_attempt_evidence`)).rows.length, 0);
    await as(db, COLLAB);
    assert.equal((await q(db, `SELECT 1 FROM qa_attempt_evidence`)).rows.length, 1);
    await failure(q(db, `SELECT * FROM qa_finalize_evidence('${ev.id}', '${COLLAB}')`));
    await as(db, COLLAB, 'service_role');
    const ready = await one(db, `SELECT * FROM qa_finalize_evidence('${ev.id}', '${COLLAB}')`);
    assert.equal(ready.status, "ready");
    await as(db, VIEWER);
    assert.equal((await q(db, `SELECT 1 FROM qa_attempt_evidence`)).rows.length, 1); // ready is visible to viewers
    assert.ok(["42501", "P0002"].includes((await failure(q(db, `SELECT * FROM qa_begin_evidence('${att.id}', 'a.png', 'image/png', 10)`))).code));
    await as(db, OUTSIDER);
    assert.equal((await q(db, `SELECT 1 FROM qa_attempt_evidence`)).rows.length, 0);
    // abort removes only pending rows
    await as(db, COLLAB);
    const ev2 = await one(db, `SELECT * FROM qa_begin_evidence('${att.id}', 'b.png', 'image/png', 10)`);
    assert.equal((await one(db, `SELECT qa_abort_evidence('${ev2.id}') AS k`)).k, ev2.storage_key);
    await failure(q(db, `SELECT qa_abort_evidence('${ev.id}')`));
    // orphan sweep is service-role only
    await failure(q(db, `SELECT * FROM qa_stale_pending_evidence('0 seconds')`));
  } finally {
    await db.close();
  }
});

test("bulk edit and import: only authorised, atomic mode applies nothing on any invalid row, duplicates follow the strategy", async () => {
  const db = await makeDb();
  try {
    const s = await seed(db);
    await as(db, VIEWER);
    assert.equal((await one(db, `SELECT qa_bulk_update_cases(ARRAY['${s.c1.case_id}'::uuid], '{"priority":"low"}'::jsonb) AS r`)).r.skipped, 1);
    await as(db, COLLAB);
    assert.equal((await one(db, `SELECT qa_bulk_update_cases(ARRAY['${s.c1.case_id}'::uuid], '{"priority":"low"}'::jsonb) AS r`)).r.updated, 1);
    assert.equal((await one(db, `SELECT priority, current_version FROM qa_case_current WHERE id='${s.c1.case_id}'`)).priority, "low");

    const rows = `'[{"title":"Imported A","steps":[{"action":"a","expected":"b"}],"priority":"high"},{"title":"","priority":"low"}]'::jsonb`;
    const atomic = (await one(db, `SELECT qa_import_cases('${LIST}', ${rows}, 'skip', true) AS r`)).r;
    assert.equal(atomic.applied, false);
    assert.equal(atomic.errors.length, 1);
    assert.equal(atomic.errors[0].row, 2);
    assert.equal((await q(db, `SELECT 1 FROM qa_case_current`)).rows.length, 2);

    const partial = (await one(db, `SELECT qa_import_cases('${LIST}', ${rows}, 'skip', false) AS r`)).r;
    assert.deepEqual([partial.created, partial.skipped, partial.errors.length], [1, 0, 1]);
    const dup = `'[{"case_key":"TC-001","title":"Login works","priority":"critical"}]'::jsonb`;
    assert.equal((await one(db, `SELECT qa_import_cases('${LIST}', ${dup}, 'skip', true) AS r`)).r.skipped, 1);
    assert.equal((await one(db, `SELECT qa_import_cases('${LIST}', ${dup}, 'update', true) AS r`)).r.updated, 1);
    assert.equal((await one(db, `SELECT priority FROM qa_case_current WHERE id='${s.c1.case_id}'`)).priority, "critical");
    // an import never touches run outcomes
    assert.equal((await q(db, `SELECT 1 FROM qa_attempts`)).rows.length, 0);
  } finally {
    await db.close();
  }
});

test("saved views are private to their owner", async () => {
  const db = await makeDb();
  try {
    await seed(db);
    await as(db, COLLAB);
    await q(db, `SELECT * FROM qa_save_view('${LIST}', 'library', 'My view', '{"columns":["title"]}'::jsonb)`);
    await q(db, `SELECT * FROM qa_save_view('${LIST}', 'library', 'My view', '{"columns":["title","module"]}'::jsonb)`);
    assert.equal((await q(db, `SELECT 1 FROM qa_saved_views`)).rows.length, 1);
    await as(db, OWNER);
    assert.equal((await q(db, `SELECT 1 FROM qa_saved_views`)).rows.length, 0);
    await as(db, OUTSIDER);
    await failure(q(db, `SELECT * FROM qa_save_view('${LIST}', 'library', 'x', '{}'::jsonb)`));
  } finally {
    await db.close();
  }
});

test("no client-readable QA table or view exposes secret material; only flags exist", async () => {
  const db = await makeDb();
  try {
    const { rows } = await q(
      db,
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name LIKE 'qa\\_%' ESCAPE '\\'
         AND table_name <> 'qa_account_secrets'
         AND column_name ~* '(password|secret|cipher|auth_tag|^iv$|token|credential_value)'`,
    );
    assert.deepEqual(rows.filter((r) => !["has_secret", "secret_updated_at"].includes(r.column_name)), []);
    // and the one table that does hold ciphertext grants nothing to client roles
    for (const role of ["anon", "authenticated"]) {
      const g = await q(db, `SELECT has_table_privilege('${role}', 'public.qa_account_secrets', 'SELECT') AS s, has_table_privilege('${role}', 'public.qa_account_secrets', 'INSERT') AS i`);
      assert.deepEqual(g.rows[0], { s: false, i: false }, role);
    }
  } finally {
    await db.close();
  }
});

test("every public QA function is SECURITY DEFINER with a pinned search_path, and none is executable by anon", async () => {
  const db = await makeDb();
  try {
    const { rows } = await q(
      db,
      `SELECT p.proname, p.prosecdef, p.proconfig, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname LIKE 'qa\\_%' ESCAPE '\\'`,
    );
    assert.ok(rows.length >= 20, `expected the QA RPC set, found ${rows.length}`);
    for (const r of rows) {
      assert.equal(r.prosecdef, true, `${r.proname} must be SECURITY DEFINER`);
      assert.ok((r.proconfig ?? []).some((c) => c.startsWith("search_path=")), `${r.proname} must pin search_path`);
      assert.equal(r.anon_exec, false, `${r.proname} must not be executable by anon`);
    }
  } finally {
    await db.close();
  }
});


test("clients cannot bypass server upload verification by calling evidence finalization", async () => {
  const db = await makeDb();
  try {
    const { rows } = await q(db, `SELECT has_function_privilege('authenticated', p.oid, 'EXECUTE') AS client_exec
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'qa_finalize_evidence'`);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].client_exec, false);
  } finally { await db.close(); }
});

test("result recording locks the run row shared with completion", async () => {
  const db = await makeDb();
  try {
    const { body } = await one(db, `SELECT pg_get_functiondef('public.qa_record_attempt(uuid,text,text,text)'::regprocedure) AS body`);
    assert.match(body, /FROM public\.qa_runs WHERE id = v_rc\.run_id FOR UPDATE/i);
  } finally { await db.close(); }
});
