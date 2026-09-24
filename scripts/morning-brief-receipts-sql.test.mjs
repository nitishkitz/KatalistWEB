import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

/**
 * F-01/F-02 (audit): claim_morning_brief's RETURNS TABLE declares implicit
 * PL/pgSQL variables named `local_date` and `timezone` that collide with
 * this table's own `local_date`/`timezone` columns -- a bare `local_date`
 * reference, including inside the ON CONFLICT (...) target list, was
 * ambiguous and failed at EXECUTION time (F-01, fixed). Separately, the
 * server used to treat a profile's stored `timezone` being exactly 'UTC'
 * as a signal to prefer the client-supplied zone instead -- unable to
 * distinguish a deliberate UTC choice from an unset default, and
 * disagreeing with the client's own resolveEffectiveTimezone() rule,
 * which never does that (F-02, fixed: profile zone always wins when
 * valid, including 'UTC'; client zone is a fallback only when the
 * profile's own zone is absent/invalid). The server also never enforced
 * the 07:00 threshold itself (F-02, fixed: claim now rejects before the
 * threshold instead of silently burning the day's slot early), and
 * dismiss used to recompute "today" independently instead of targeting
 * the actual claimed receipt (F-02/F-03, fixed: dismiss now targets the
 * most recent undismissed row for the profile/context, not a
 * freshly-recomputed date).
 *
 * This runs the actual migration file content against a real
 * Postgres-compatible engine (PGlite, in-memory). It does not prove
 * deployed Supabase/RLS behavior (auth.uid()/roles are stubbed, not the
 * real Supabase auth integration), but it does prove the SQL itself
 * executes correctly.
 */

const PROFILE_A = "11111111-1111-1111-1111-111111111111";
const PROFILE_B = "22222222-2222-2222-2222-222222222222";

/**
 * A fixed-offset IANA zone name ("Etc/GMT+N"/"Etc/GMT-N") in which the
 * real current instant's wall-clock hour is `targetHour` -- computed from
 * the real UTC hour right now, so these tests are deterministic
 * regardless of what time it actually is when the suite runs (the same
 * class of wall-clock dependency fixed earlier in
 * use-morning-brief.test.mjs, but here at the SQL/timezone-name level
 * since Postgres's own now() can't be pinned the way JS Date can).
 * Note the inverted sign convention: Etc/GMT-N == UTC+N.
 */
function fixedOffsetZoneForLocalHour(targetHour) {
  const nowUtcHour = new Date().getUTCHours();
  let offset = ((targetHour - nowUtcHour) % 24 + 24) % 24; // 0..23
  if (offset > 12) offset -= 24; // -11..12
  if (offset === 0) return "Etc/GMT";
  return offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
}

const SAFE_ZONE = fixedOffsetZoneForLocalHour(12); // well inside the eligible window
const EARLY_ZONE = fixedOffsetZoneForLocalHour(3); // well before the 07:00 threshold

async function makeDb() {
  const db = new PGlite();
  await db.exec(`
    create role authenticated;
    create role anon;
    create role service_role;
    create schema if not exists auth;
    create schema if not exists katalist_priv;
    -- CREATE POLICY's USING clause and this migration's own functions
    -- need auth.uid() to resolve even before any test calls setAuthUid()
    -- (e.g. the resolve_morning_brief_timezone-focused tests never
    -- authenticate as anyone) -- a NULL default is harmless since those
    -- tests never call anything that requires a real identity.
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
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

async function insertProfile(db, id, timezone = SAFE_ZONE) {
  await db.query(`insert into public.profiles (id, timezone) values ('${id}', '${timezone}')`);
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
  await insertProfile(db, PROFILE_A);
  await applyMigration(db);
});

test("first claim succeeds (claimed:true) and returns today's local_date/timezone", async () => {
  const db = await makeDb();
  await setAuthUid(db, PROFILE_A);
  await insertProfile(db, PROFILE_A);
  await applyMigration(db);

  const r = await db.query(`select * from public.claim_morning_brief('work', null)`);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].claimed, true);
  assert.equal(r.rows[0].timezone, SAFE_ZONE);
});

test("a duplicate claim for the same profile/context/date reports claimed:false without a second row", async () => {
  const db = await makeDb();
  await setAuthUid(db, PROFILE_A);
  await insertProfile(db, PROFILE_A);
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
  await insertProfile(db, PROFILE_A);
  await applyMigration(db);

  await db.query(`select * from public.claim_morning_brief('work', null)`);
  const r = await db.query(`select * from public.claim_morning_brief('home', null)`);
  assert.equal(r.rows[0].claimed, true, "home is a separate slot from work on the same day");
});

test("two different profiles claiming the same context/date do not collide with each other", async () => {
  const db = await makeDb();
  await insertProfile(db, PROFILE_A);
  await insertProfile(db, PROFILE_B);
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
  await insertProfile(db, PROFILE_A);
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
  await insertProfile(db, PROFILE_A);
  await applyMigration(db);

  await assert.rejects(db.query(`select * from public.claim_morning_brief('nope', null)`), /invalid context/);
  await assert.rejects(db.query(`select public.dismiss_morning_brief('nope', null)`), /invalid context/);
});

test("EXECUTE is granted to authenticated/service_role only, never anon -- matches the plan's authenticated-owner-only contract", async () => {
  const db = await makeDb();
  await setAuthUid(db, PROFILE_A);
  await insertProfile(db, PROFILE_A);
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
  await insertProfile(db, PROFILE_A);
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

// ── F-02: effective-timezone resolution ────────────────────────────────────

// These test katalist_priv.resolve_morning_brief_timezone() directly --
// extracted specifically so the effective-timezone RULE is verifiable
// independent of claim_morning_brief's separate 07:00 threshold gate
// (which depends on real "now" and would otherwise make these tests
// non-deterministic depending on what time they happen to run).

test("F-02: an explicit profile timezone of exactly 'UTC' wins over a client-supplied zone -- it is never treated as unset", async () => {
  const db = await makeDb();
  await insertProfile(db, PROFILE_A, "UTC");
  await applyMigration(db);

  const r = await db.query(
    `select katalist_priv.resolve_morning_brief_timezone('${PROFILE_A}'::uuid, '${SAFE_ZONE}') as tz`,
  );
  assert.equal(r.rows[0].tz, "UTC", "the profile's explicit UTC must win over the client-supplied zone");
});

test("F-02: a non-UTC profile timezone always wins over a client-supplied zone", async () => {
  const db = await makeDb();
  await insertProfile(db, PROFILE_A, SAFE_ZONE);
  await applyMigration(db);

  const r = await db.query(
    `select katalist_priv.resolve_morning_brief_timezone('${PROFILE_A}'::uuid, 'Pacific/Kiritimati') as tz`,
  );
  assert.equal(r.rows[0].tz, SAFE_ZONE, "the client-supplied zone must never override a valid stored profile zone");
});

test("F-02: an invalid stored profile timezone falls back to a valid client-supplied zone, not a hard failure", async () => {
  const db = await makeDb();
  await insertProfile(db, PROFILE_A, "Not/A_Real_Zone");
  await applyMigration(db);

  const r = await db.query(
    `select katalist_priv.resolve_morning_brief_timezone('${PROFILE_A}'::uuid, '${SAFE_ZONE}') as tz`,
  );
  assert.equal(r.rows[0].tz, SAFE_ZONE);
});

test("F-02: no usable timezone at all (invalid profile zone, no client zone supplied) falls back to UTC rather than erroring", async () => {
  const db = await makeDb();
  await insertProfile(db, PROFILE_A, "Not/A_Real_Zone");
  await applyMigration(db);

  const r = await db.query(`select katalist_priv.resolve_morning_brief_timezone('${PROFILE_A}'::uuid, null) as tz`);
  assert.equal(r.rows[0].tz, "UTC");
});

// ── F-02: server-side 07:00 threshold enforcement ───────────────────────────

test("F-02: claiming before the local 07:00 threshold is rejected and does not consume the day's slot", async () => {
  const db = await makeDb();
  await setAuthUid(db, PROFILE_A);
  await insertProfile(db, PROFILE_A, EARLY_ZONE);
  await applyMigration(db);

  await assert.rejects(
    db.query(`select * from public.claim_morning_brief('work', null)`),
    /before morning threshold/,
  );
  const count = await db.query(`select count(*)::int as n from public.morning_brief_presentations`);
  assert.equal(count.rows[0].n, 0, "a rejected early claim must not insert a row -- the slot stays open for later");
});

test("F-02: claiming at/after the local 07:00 threshold succeeds", async () => {
  const db = await makeDb();
  await setAuthUid(db, PROFILE_A);
  await insertProfile(db, PROFILE_A, SAFE_ZONE);
  await applyMigration(db);

  const r = await db.query(`select * from public.claim_morning_brief('work', null)`);
  assert.equal(r.rows[0].claimed, true);
});

// ── F-02/F-03: dismiss targets the actual receipt, not a recomputed date ──

test("F-02/F-03: dismiss finds the claimed receipt even if 'today' would recompute differently right now", async () => {
  const db = await makeDb();
  await setAuthUid(db, PROFILE_A);
  await insertProfile(db, PROFILE_A, SAFE_ZONE);
  await applyMigration(db);

  await db.query(`select * from public.claim_morning_brief('work', null)`);

  // Simulate "today" having moved on since the claim (e.g. the profile's
  // timezone was edited afterward, or dismiss happens after local
  // midnight) by directly changing the profile's stored timezone to
  // something that would resolve a DIFFERENT local_date right now, then
  // dismissing. Since dismiss no longer recomputes local_date at all, this
  // must not matter.
  await db.query(`update public.profiles set timezone = 'Pacific/Kiritimati' where id = '${PROFILE_A}'`);

  await db.query(`select public.dismiss_morning_brief('work', null)`);
  const row = await db.query(
    `select dismissed_at from public.morning_brief_presentations where profile_id = '${PROFILE_A}' and context = 'work'`,
  );
  assert.ok(row.rows[0].dismissed_at, "the originally claimed row must be dismissed regardless of the timezone change");
});

test("F-02/F-03: dismiss only ever targets the caller's own most recent undismissed row for that context", async () => {
  const db = await makeDb();
  await insertProfile(db, PROFILE_A, SAFE_ZONE);
  await insertProfile(db, PROFILE_B, SAFE_ZONE);
  await setAuthUid(db, PROFILE_A);
  await applyMigration(db);

  await db.query(`select * from public.claim_morning_brief('work', null)`);
  await setAuthUid(db, PROFILE_B);
  await db.query(`select * from public.claim_morning_brief('work', null)`);

  await db.query(`select public.dismiss_morning_brief('work', null)`); // dismissing as B
  const rows = await db.query(
    `select profile_id, dismissed_at from public.morning_brief_presentations order by profile_id`,
  );
  const byProfile = Object.fromEntries(rows.rows.map((r) => [r.profile_id, r.dismissed_at]));
  assert.equal(byProfile[PROFILE_A], null, "A's own receipt must be untouched by B's dismiss");
  assert.ok(byProfile[PROFILE_B], "B's own receipt must be dismissed");
});
