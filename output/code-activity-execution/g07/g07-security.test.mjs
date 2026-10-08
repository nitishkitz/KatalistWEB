// DRAFT G07 security tests (feed storage and manual refresh). Run manually:
//   node --test output/code-activity-execution/g07/g07-security.test.mjs
// In-memory PGlite with stubbed Supabase roles; loads the G03 draft first, then the G07 draft.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const G03 = readFileSync(new URL("../g03/DRAFT_code_activity_connection_schema.sql", import.meta.url), "utf8");
const G07 = readFileSync(new URL("./DRAFT_code_activity_changes_schema.sql", import.meta.url), "utf8");
const U = { O: "00000000-0000-0000-0000-00000000000a", O2: "00000000-0000-0000-0000-00000000000b", C: "00000000-0000-0000-0000-00000000000c", V: "00000000-0000-0000-0000-00000000000d", X: "00000000-0000-0000-0000-00000000000e" };
const L = { L1: "10000000-0000-0000-0000-000000000001", L2: "10000000-0000-0000-0000-000000000002" };
const hash = (s) => new Uint8Array(createHash("sha256").update(s).digest());
const db = new PGlite();

async function setup() {
  await db.exec(`
    create role authenticated; create role anon; create role service_role;
    create schema auth; create schema katalist_priv;
    grant usage on schema public, auth, katalist_priv to authenticated, anon, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    alter default privileges in schema katalist_priv grant execute on functions to anon, authenticated, service_role;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant execute on function auth.uid() to authenticated, anon, service_role;
    create type public.list_role as enum ('collaborator','view_only');
    create table public.profiles (id uuid primary key);
    create table public.lists (id uuid primary key, owner_profile_id uuid not null references public.profiles(id), archived_at timestamptz);
    create table public.list_members (list_id uuid not null references public.lists(id) on delete cascade, profile_id uuid not null references public.profiles(id), role public.list_role not null, primary key (list_id, profile_id));
    create function katalist_priv.is_list_owner(_list_id uuid) returns boolean language sql stable security definer set search_path = 'pg_catalog','public','katalist_priv' as $$ select exists (select 1 from public.lists l where l.id = _list_id and l.owner_profile_id = auth.uid()); $$;
    create function katalist_priv.is_list_member(_list_id uuid, _roles public.list_role[] default null) returns boolean language sql stable security definer set search_path = 'pg_catalog','public','katalist_priv' as $$ select exists (select 1 from public.list_members m where m.list_id = _list_id and m.profile_id = auth.uid() and (_roles is null or m.role = any(_roles))); $$;
    create function katalist_priv.can_view_list(_list_id uuid) returns boolean language sql stable security definer set search_path = 'pg_catalog','public','katalist_priv' as $$ select katalist_priv.is_list_owner(_list_id) or katalist_priv.is_list_member(_list_id); $$;
    -- Copied from 20260818144945_*.sql
    create function katalist_priv.can_create_thing_in_list(_list_id uuid) returns boolean language sql stable security definer set search_path = 'pg_catalog','public','katalist_priv' as $$
      select _list_id is null or (exists (select 1 from public.lists l where l.id = _list_id and l.archived_at is null)
        and (katalist_priv.is_list_owner(_list_id) or katalist_priv.is_list_member(_list_id, array['collaborator']::public.list_role[]))); $$;
  `);
  await db.exec(G03);
  await db.exec(G07);
}

let conn;
async function reset() {
  await db.exec(`
    reset role;
    truncate public.code_activity_changes, public.code_activity_selection_proofs, public.code_activity_auth_states, public.code_activity_connections, public.code_activity_list_allowlist, public.code_activity_settings, public.list_members, public.lists, public.profiles cascade;
    insert into public.profiles values ${Object.values(U).map((u) => `('${u}')`).join(",")};
    insert into public.lists values ('${L.L1}','${U.O}',null),('${L.L2}','${U.O2}',null);
    insert into public.list_members values ('${L.L1}','${U.C}','collaborator'),('${L.L1}','${U.V}','view_only');
    insert into public.code_activity_settings values ('master','true'::jsonb);
    insert into public.code_activity_list_allowlist (list_id) values ('${L.L1}'),('${L.L2}');
  `);
  conn = (await db.query(`insert into public.code_activity_connections (list_id,status,installation_id,repository_id,repository_full_name,connected_by_profile_id) values ($1,'active',77,501,'acme/web',$2) returning id`, [L.L1, U.O])).rows[0].id;
}

async function as(role, uid, sql, params = []) {
  await db.exec(`set role ${role}`);
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid ?? ""]);
    return { rows: (await db.query(sql, params)).rows };
  } catch (error) {
    return { error };
  } finally {
    await db.exec("reset role");
  }
}
const sql = (q, params) => db.query(q, params).then((r) => r.rows);
const denied = (r, label) => assert.ok(r.error, `${label}: expected an error, got ${JSON.stringify(r.rows)}`);

const iso = (minutesAgo) => new Date(Date.UTC(2026, 9, 7, 12, 0, 0) - minutesAgo * 60_000).toISOString();
const pr = (n, minutesAgo, extra = {}) => ({ kind: "pull_request", provider_key: String(n), pr_number: n, pr_state: "open", title: `PR ${n}`, head_sha: "a".repeat(40), head_ref: `b${n}`, base_ref: "main", author_login: "ana", author_kind: "user", source_url: `https://github.com/acme/web/pull/${n}`, provider_updated_at: iso(minutesAgo), last_activity_at: iso(minutesAgo), ...extra });
const push = (key, minutesAgo) => ({ kind: "push", provider_key: key, title: `Push to ${key.split("@")[0]}`, head_sha: "c".repeat(40), before_sha: "d".repeat(40), head_ref: key.split("@")[0], author_login: "bo", author_kind: "user", provider_updated_at: iso(minutesAgo), last_activity_at: iso(minutesAgo) });

async function begin(uid = U.O, list = L.L1) {
  return as("authenticated", uid, "select * from public.code_activity_begin_refresh($1)", [list]);
}
async function finish({ lease, status = "ok", items = [], name = null, gen = 1, id = conn }) {
  return as("service_role", null, "select public.code_activity_server_finish_refresh($1,$2,$3,$4,$5,$6::jsonb) as ok", [id, gen, lease, status, name, items === null ? null : JSON.stringify(items)]);
}
async function refreshWith(items, extra = {}) {
  await sql("update public.code_activity_connections set last_refresh_started_at = null, sync_lease_until = null");
  const b = await begin();
  assert.ok(!b.error, b.error?.message);
  const r = await finish({ lease: b.rows[0].o_lease_token, items, ...extra });
  assert.equal(r.rows[0].ok, true);
}
const feed = (uid, list = L.L1, params = []) => as("authenticated", uid, "select * from public.code_activity_feed($1, $2, $3, $4)", [list, params[0] ?? null, params[1] ?? null, params[2] ?? 25]);

test.before(setup);
beforeEach(reset);

test("the changes table is closed to every client and server role", async () => {
  await sql(`insert into public.code_activity_changes (connection_id, kind, provider_key, pr_number, pr_state, title, provider_updated_at, last_activity_at) values ($1,'pull_request','1',1,'open','t',now(),now())`, [conn]);
  for (const role of ["anon", "authenticated", "service_role"]) {
    denied(await as(role, U.O, "select 1 from public.code_activity_changes"), `${role} select`);
    denied(await as(role, U.O, "delete from public.code_activity_changes"), `${role} delete`);
    denied(await as(role, U.O, "update public.code_activity_changes set title='x'"), `${role} update`);
    denied(await as(role, U.O, `insert into public.code_activity_changes (connection_id, kind, provider_key, pr_number, pr_state, title, provider_updated_at, last_activity_at) values ('${conn}','pull_request','2',2,'open','t',now(),now())`), `${role} insert`);
  }
});

test("function privileges: feed, detail and begin are user functions; finish is server-only", async () => {
  const rows = await sql(`select p.proname, p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('code_activity_feed','code_activity_change_for_read','code_activity_begin_refresh','code_activity_server_finish_refresh')`);
  assert.equal(rows.length, 4);
  for (const { proname, oid } of rows) {
    const can = async (role) => (await sql(`select has_function_privilege('${role}', ${oid}, 'EXECUTE') as ok`))[0].ok;
    const server = proname === "code_activity_server_finish_refresh";
    assert.equal(await can("anon"), false, `${proname} anon`);
    assert.equal(await can("authenticated"), !server, `${proname} authenticated`);
    assert.equal(await can("service_role"), server, `${proname} service_role`);
  }
});

test("begin refresh: owner and collaborator may; View Only, outsiders, other Lists and disabled features may not", async () => {
  for (const uid of [U.V, U.X, U.O2]) assert.equal((await begin(uid)).error?.code, "42501", uid);
  assert.equal((await begin(U.C)).rows.length, 1, "collaborator");
  await reset();
  assert.equal((await begin(U.O)).rows.length, 1, "owner");
  await reset();
  await sql(`update public.code_activity_settings set value='false'::jsonb`);
  assert.equal((await begin(U.O)).error?.code, "42501", "master off");
  await reset();
  await sql(`update public.code_activity_connections set status='disconnected'`);
  assert.equal((await begin(U.O)).error?.code, "42501", "no live connection");
  await reset();
  await sql(`update public.code_activity_connections set status='suspended'`);
  assert.equal((await begin(U.O)).error?.code, "42501", "suspended is not refreshed");
  denied(await as("anon", null, "select * from public.code_activity_begin_refresh($1)", [L.L1]), "anon");
});

test("begin refresh: one at a time, rate limited, and the lease is a fresh token", async () => {
  const first = await begin();
  assert.ok(first.rows[0].o_lease_token);
  assert.equal((await begin()).error?.code, "55006", "second start while leased");
  assert.equal((await sql("select sync_status from public.code_activity_connections"))[0].sync_status, "syncing");
  await sql("update public.code_activity_connections set sync_lease_until = now() - interval '1 second'");
  assert.equal((await begin()).error?.code, "54000", "within 10 seconds of the last start");
  await sql("update public.code_activity_connections set last_refresh_started_at = now() - interval '11 seconds'");
  const next = await begin();
  assert.ok(!next.error);
  assert.notEqual(next.rows[0].o_lease_token, first.rows[0].o_lease_token);
});

test("finish: writes rows only for the lease holder, the matching generation and an active connection", async () => {
  const b = await begin();
  const lease = b.rows[0].o_lease_token;
  const items = [pr(1, 10), push("main@" + "c".repeat(40), 5)];
  assert.equal((await finish({ lease: "99999999-9999-9999-9999-999999999999", items })).rows[0].ok, false, "wrong lease");
  assert.equal((await finish({ lease, items, gen: 2 })).rows[0].ok, false, "wrong generation");
  assert.equal((await finish({ lease, items, id: "99999999-9999-9999-9999-999999999999" })).rows[0].ok, false, "wrong connection");
  assert.equal((await sql("select count(*)::int c from public.code_activity_changes"))[0].c, 0, "nothing written by rejected calls");
  denied(await as("authenticated", U.O, "select public.code_activity_server_finish_refresh($1,1,$2,'ok',null,'[]'::jsonb)", [conn, lease]), "clients cannot finish");
  assert.equal((await finish({ lease, items, name: "acme/web-renamed" })).rows[0].ok, true);
  assert.equal((await sql("select count(*)::int c from public.code_activity_changes"))[0].c, 2);
  const c = (await sql("select sync_status, last_synced_at is not null as synced, sync_lease_token, repository_full_name from public.code_activity_connections"))[0];
  assert.deepEqual([c.sync_status, c.synced, c.sync_lease_token, c.repository_full_name], ["ok", true, null, "acme/web-renamed"]);
  assert.equal((await finish({ lease, items })).rows[0].ok, false, "the lease is spent");
});

test("a disconnect during a refresh cannot be undone by late results", async () => {
  const b = await begin();
  await as("authenticated", U.O, "select public.code_activity_disconnect($1,true)", [L.L1]);
  assert.equal((await finish({ lease: b.rows[0].o_lease_token, items: [pr(1, 1)] })).rows[0].ok, false);
  assert.equal((await sql("select count(*)::int c from public.code_activity_changes"))[0].c, 0);
  assert.equal((await sql("select status from public.code_activity_connections"))[0].status, "disconnected");
});

test("finish is idempotent: the same rows upsert in place and never duplicate", async () => {
  await refreshWith([pr(1, 10), pr(2, 8)]);
  await refreshWith([pr(1, 10, { title: "PR 1 renamed" }), pr(2, 8), pr(3, 1)]);
  const rows = await sql("select provider_key, title from public.code_activity_changes order by provider_key");
  assert.deepEqual(rows.map((r) => r.provider_key), ["1", "2", "3"]);
  assert.equal(rows[0].title, "PR 1 renamed");
});

test("check state: a fresh read wins, an unread one is kept only for the same revision", async () => {
  const sha1 = "a".repeat(40);
  const sha2 = "b".repeat(40);
  await refreshWith([pr(1, 5, { head_sha: sha1, check_state: "passed", checks_revision: sha1 })]);
  await refreshWith([pr(1, 4, { head_sha: sha1 })]);
  let row = (await sql("select check_state, checks_revision from public.code_activity_changes"))[0];
  assert.deepEqual([row.check_state, row.checks_revision], ["passed", sha1], "same revision keeps the earlier result");
  await refreshWith([pr(1, 3, { head_sha: sha2 })]);
  row = (await sql("select check_state, checks_revision from public.code_activity_changes"))[0];
  assert.deepEqual([row.check_state, row.checks_revision], ["unavailable", null], "a new revision never inherits old checks");
  await refreshWith([pr(1, 2, { head_sha: sha2, check_state: "failing", checks_revision: sha2 })]);
  assert.equal((await sql("select check_state from public.code_activity_changes"))[0].check_state, "failing");
});

test("a failed refresh keeps the last good rows and says so; partial still records the sync", async () => {
  await refreshWith([pr(1, 10)]);
  await sql("update public.code_activity_connections set last_refresh_started_at = null, sync_lease_until = null");
  const b = await begin();
  assert.equal((await finish({ lease: b.rows[0].o_lease_token, status: "unavailable", items: null })).rows[0].ok, true);
  const c = (await sql("select sync_status, last_synced_at is not null as synced from public.code_activity_connections"))[0];
  assert.deepEqual([c.sync_status, c.synced], ["unavailable", true], "last good sync time is kept");
  assert.equal((await feed(U.V)).rows.length, 1, "the saved row is still readable");
  await refreshWith([pr(1, 10)], { status: "partial" });
  assert.equal((await sql("select sync_status from public.code_activity_connections"))[0].sync_status, "partial");
});

test("finish rejects bad input and bounds retention at 300 rows", async () => {
  const b = await begin();
  denied(await finish({ lease: b.rows[0].o_lease_token, status: "weird", items: [] }), "unknown status");
  denied(await finish({ lease: b.rows[0].o_lease_token, items: Array.from({ length: 201 }, (_, i) => pr(i + 1, i)) }), "more than 200 items");
  for (let batch = 0; batch < 2; batch += 1) {
    await refreshWith(Array.from({ length: 200 }, (_, i) => pr(batch * 200 + i + 1, batch * 200 + i)));
  }
  assert.equal((await sql("select count(*)::int c from public.code_activity_changes"))[0].c, 300);
  const range = (await sql("select min(pr_number) lo, max(pr_number) hi from public.code_activity_changes"))[0];
  assert.deepEqual([range.lo, range.hi], [1, 300], "the 300 most recent by activity are kept; the 100 oldest were pruned");
});

test("feed: members read; outsiders, other Lists, disabled features and terminal connections see nothing", async () => {
  await refreshWith([pr(1, 10)]);
  for (const uid of [U.O, U.C, U.V]) assert.equal((await feed(uid)).rows.length, 1, uid);
  for (const uid of [U.X, U.O2]) assert.equal((await feed(uid)).rows.length, 0, uid);
  assert.equal((await feed(U.O, L.L2)).rows.length, 0);
  await sql("update public.code_activity_connections set status='suspended'");
  assert.equal((await feed(U.V)).rows.length, 1, "suspended keeps saved rows readable");
  await sql("update public.code_activity_connections set status='revoked'");
  assert.equal((await feed(U.O)).rows.length, 0, "revoked");
  await sql("update public.code_activity_connections set status='active'");
  await sql(`update public.code_activity_settings set value='false'::jsonb`);
  assert.equal((await feed(U.O)).rows.length, 0, "master off");
  denied(await as("authenticated", U.O, "select * from public.code_activity_changes"), "no direct read");
  assert.deepEqual(Object.keys((await (async () => { await sql(`update public.code_activity_settings set value='true'::jsonb`); return feed(U.O); })()).rows[0]).sort(),
    ["author_kind", "author_login", "base_ref", "check_state", "checks_revision", "head_ref", "head_sha", "id", "kind", "last_activity_at", "pr_number", "pr_state", "source_url", "title"]);
});

test("feed: keyset pagination is stable, bounded and never repeats a row", async () => {
  await refreshWith(Array.from({ length: 60 }, (_, i) => pr(i + 1, i)));
  const seen = [];
  let cursor = [null, null];
  for (let page = 0; page < 5; page += 1) {
    const rows = (await feed(U.V, L.L1, [cursor[0], cursor[1], 25])).rows;
    if (rows.length === 0) break;
    assert.ok(rows.length <= 25);
    seen.push(...rows.map((r) => r.pr_number));
    const last = rows[rows.length - 1];
    cursor = [last.last_activity_at, last.id];
  }
  assert.equal(seen.length, 60);
  assert.equal(new Set(seen).size, 60, "no duplicates across pages");
  assert.deepEqual(seen.slice(0, 3), [1, 2, 3], "newest activity first");
  assert.equal((await as("authenticated", U.V, "select * from public.code_activity_feed($1,null,null,100000)", [L.L1])).rows.length, 50, "limit capped at 50");
});

test("change_for_read returns only a change of an enabled, live connection for a member, with the generation", async () => {
  await refreshWith([pr(7, 1)]);
  const id = (await sql("select id from public.code_activity_changes"))[0].id;
  const read = (uid, list = L.L1) => as("authenticated", uid, "select * from public.code_activity_change_for_read($1,$2)", [list, id]);
  const ok = await read(U.V);
  assert.equal(ok.rows.length, 1);
  assert.deepEqual([ok.rows[0].generation, ok.rows[0].pr_number, ok.rows[0].connection_id], [1, 7, conn]);
  assert.equal((await read(U.X)).rows.length, 0, "outsider");
  assert.equal((await read(U.O2, L.L2)).rows.length, 0, "a change id from another List is not readable through it");
  assert.equal((await read(U.O, L.L2)).rows.length, 0, "wrong List for this change");
  await as("authenticated", U.O, "select public.code_activity_disconnect($1,true)", [L.L1]);
  assert.equal((await read(U.O)).rows.length, 0, "disconnected");
});

test("two connections never see each other's changes", async () => {
  await sql("insert into public.code_activity_connections (list_id,status,installation_id,repository_id,connected_by_profile_id) values ($1,'active',88,601,$2)", [L.L2, U.O2]);
  const other = (await sql("select id from public.code_activity_connections where list_id=$1", [L.L2]))[0].id;
  await sql(`insert into public.code_activity_changes (connection_id, kind, provider_key, pr_number, pr_state, title, provider_updated_at, last_activity_at) values ($1,'pull_request','1',1,'open','other list',now(),now())`, [other]);
  await refreshWith([pr(1, 1)]);
  assert.deepEqual((await feed(U.O)).rows.map((r) => r.title), ["PR 1"]);
  assert.deepEqual((await feed(U.O2, L.L2)).rows.map((r) => r.title), ["other list"]);
});
