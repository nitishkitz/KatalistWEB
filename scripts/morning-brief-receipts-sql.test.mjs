import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

/**
 * F-01 (audit): claim_morning_brief's RETURNS TABLE declares implicit
 * PL/pgSQL variables named `local_date` and `timezone` that collide with
 * this table's own `local_date`/`timezone` columns. A bare `local_date`
 * reference -- including inside the ON CONFLICT (...) target list, not
 * only a WHERE/SELECT -- was ambiguous and failed at EXECUTION time with
 * "column reference \"local_date\" is ambiguous". The previous test for
 * this migration (morning-brief-receipts-live.test.mjs) only exercised
 * the client adapter against a mocked RPC -- it never ran this SQL.
 *
 * This runs the actual migration file content against a real
 * Postgres-compatible engine (PGlite, in-memory). It does not prove
 * deployed Supabase/RLS behavior (auth.uid()/roles are stubbed, not the
 * real Supabase auth integration), but it does prove the SQL itself
 * executes correctly -- which is the defect this audit item reproduced.
 */

const PROFILE_A = "11111111-1111-1111-1111-111111111111";
const PROFILE_B = "22222222-2222-2222-2222-222222222222";

async function makeDb() {
  const db = new PGlite();
  await db.exec(`
    create role authenticated;
    create role anon;
    create role service_role;
    create schema if not exists auth;
    create table public.profiles (id uuid primary key, timezone text not null default 'UTC');
  `);
  return db;
}

async function setAuthUid(db, profileId) {
  // auth.uid() is redefined per-"session" here since PGlite has no real
  // per-connection auth context -- each test picks which profile is
  // "currently authenticated" by replacing this stub function.
  await db.exec(`
    create or replace function auth.uid() returns uuid language sql stable as $$
      select '${profileId}'::uuid
    $$;
  `);
}

const MIGRATION_SQL = readFileSync(
  new URL("../supabase/migrations/20260923100000_morning_brief_receipts.sql", import.meta.url),
  "utf8",
);

async function applyMigration(db) {
  await db.exec(MIGRATION_SQL);
}

test("the migration's SQL executes without error against a real Postgres-compatible engine", async () => {
  const db = await makeDb();
  await setAuthUid(db, PROFILE_A);
  await db.query(`insert into public.profiles (id) values ('${PROFILE_A}')`);
  await applyMigration(db);
});

test("first claim succeeds (claimed:true) and returns today's local_date/timezone", async () => {
  const db = await makeDb();
  await setAuthUid(db, PROFILE_A);
  await db.query(`insert into public.profiles (id) values ('${PROFILE_A}')`);
  await applyMigration(db);

  const r = await db.query(`select * from public.claim_morning_brief('work', null)`);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].claimed, true);
  assert.equal(r.rows[0].timezone, "UTC");
});

test("a duplicate claim for the same profile/context/date reports claimed:false without a second row", async () => {
  const db = await makeDb();
  await setAuthUid(db, PROFILE_A);
  await db.query(`insert into public.profiles (id) values ('${PROFILE_A}')`);
  await applyMigration(db);

  await db.query(`select * from public.claim_morning_brief('work', null)`);
  const r = await db.query(`select * from public.claim_morning_brief('work', null)`);
  assert.equal(r.rows[0].claimed, false);

  const count = await db.query(
    `select count(*)::int as n from public.morning_brief_presentations where profile_id = '${PROFILE_A}'`,
  );
  assert.equal(count.rows[0].n, 1, "exactly one row, not a duplicate");
});

test("a different context for the same profile/date claims independently", async () => {
  const db = await makeDb();
  await setAuthUid(db, PROFILE_A);
  await db.query(`insert into public.profiles (id) values ('${PROFILE_A}')`);
  await applyMigration(db);

  await db.query(`select * from public.claim_morning_brief('work', null)`);
  const r = await db.query(`select * from public.claim_morning_brief('home', null)`);
  assert.equal(r.rows[0].claimed, true, "home is a separate slot from work on the same day");
});

test("two different profiles claiming the same context/date do not collide with each other", async () => {
  const db = await makeDb();
  await db.query(`insert into public.profiles (id) values ('${PROFILE_A}'), ('${PROFILE_B}')`);
  await setAuthUid(db, PROFILE_A);
  await applyMigration(db);

  const rA = await db.query(`select * from public.claim_morning_brief('work', null)`);
  assert.equal(rA.rows[0].claimed, true);

  await setAuthUid(db, PROFILE_B);
  const rB = await db.query(`select * from public.claim_morning_brief('work', null)`);
  assert.equal(rB.rows[0].claimed, true, "a different profile's claim is independent, not blocked by A's row");
});

test("dismiss records dismissed_at on the already-claimed row and is a no-op without a prior claim", async () => {
  const db = await makeDb();
  await setAuthUid(db, PROFILE_A);
  await db.query(`insert into public.profiles (id) values ('${PROFILE_A}')`);
  await applyMigration(db);

  // dismiss without ever claiming: must not create a row or throw.
  await db.query(`select public.dismiss_morning_brief('work', null)`);
  const before = await db.query(`select count(*)::int as n from public.morning_brief_presentations`);
  assert.equal(before.rows[0].n, 0);

  await db.query(`select * from public.claim_morning_brief('work', null)`);
  await db.query(`select public.dismiss_morning_brief('work', null)`);
  const after = await db.query(`select dismissed_at from public.morning_brief_presentations where profile_id = '${PROFILE_A}'`);
  assert.ok(after.rows[0].dismissed_at, "dismissed_at must be set on the claimed row");
});

test("an invalid context is rejected by both RPCs", async () => {
  const db = await makeDb();
  await setAuthUid(db, PROFILE_A);
  await db.query(`insert into public.profiles (id) values ('${PROFILE_A}')`);
  await applyMigration(db);

  await assert.rejects(db.query(`select * from public.claim_morning_brief('nope', null)`), /invalid context/);
  await assert.rejects(db.query(`select public.dismiss_morning_brief('nope', null)`), /invalid context/);
});

test("EXECUTE is granted to authenticated/service_role only, never anon -- matches the plan's authenticated-owner-only contract", async () => {
  const db = await makeDb();
  await setAuthUid(db, PROFILE_A);
  await db.query(`insert into public.profiles (id) values ('${PROFILE_A}')`);
  await applyMigration(db);

  const grants = await db.query(`
    select routine_name, grantee
    from information_schema.routine_privileges
    where routine_schema = 'public'
      and routine_name in ('claim_morning_brief', 'dismiss_morning_brief')
      and privilege_type = 'EXECUTE'
    order by routine_name, grantee
  `);
  const grantees = grants.rows.map((r) => `${r.routine_name}:${r.grantee}`);
  assert.ok(grantees.includes("claim_morning_brief:authenticated"));
  assert.ok(grantees.includes("dismiss_morning_brief:authenticated"));
  assert.ok(!grantees.some((g) => g.endsWith(":anon")), "anon must never be able to call either RPC");
});

test("the SELECT policy on morning_brief_presentations exists and scopes to profile_id = auth.uid()", async () => {
  const db = await makeDb();
  await setAuthUid(db, PROFILE_A);
  await db.query(`insert into public.profiles (id) values ('${PROFILE_A}')`);
  await applyMigration(db);

  const policies = await db.query(`
    select policyname, cmd, qual
    from pg_policies
    where schemaname = 'public' and tablename = 'morning_brief_presentations'
  `);
  assert.equal(policies.rows.length, 1, "exactly one policy -- no direct write policy for authenticated");
  assert.equal(policies.rows[0].cmd, "SELECT");
  assert.match(policies.rows[0].qual, /profile_id\s*=\s*auth\.uid\(\)/);
});
