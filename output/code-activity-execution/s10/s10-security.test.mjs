// DRAFT S10 tests: manual-only, source-linked Thing creation. Runs in-memory PGlite with the harness stand-ins.
//   CODE_ACTIVITY_SUBSET=workspace node --test output/code-activity-execution/s10/s10-security.test.mjs
// create_thing is a STAND-IN in the harness (same signature); the real one is existing code and is not re-tested here.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { readFileSync } from "node:fs";
import { L, U, createDb, reset, rpcClient, SUBSET } from "../g10/harness.mjs";

assert.equal(SUBSET, "workspace", "run with CODE_ACTIVITY_SUBSET=workspace");
const db = await createDb();
const usr = (uid) => rpcClient(db, "authenticated", uid);
const svc = () => rpcClient(db, "service_role");
const sql = (q, p) => db.query(q, p).then((r) => r.rows);
const KEY = "a0000000-0000-0000-0000-000000000001";
const SHA = (c) => c.repeat(40);
let conn;
let source;
const actorOf = async (uid) => (await sql("select id from public.actors where profile_id = $1", [uid]))[0].id;

beforeEach(async () => {
  await reset(db);
  conn = (await sql(`insert into public.code_activity_connections (list_id,status,installation_id,repository_id,repository_full_name,connected_by_profile_id) values ($1,'active',77,501,'acme/web',$2) returning id`, [L.L1, U.O]))[0].id;
  source = (await svc().rpc("code_activity_server_record_workspace_source", { p_list_id: L.L1, p_connection_id: conn, p_generation: 1, p_kind: "commit", p_provider_key: SHA("a"), p_revision_sha: SHA("a"), p_title: "fix: autofill", p_source_url: `https://github.com/acme/web/commit/${SHA("a")}` })).data;
});

async function confirm(uid, extra = {}) {
  const args = { p_list_id: L.L1, p_source_id: source, p_idempotency_key: KEY, p_title: "Verify autofill", p_notes: "Check the login form", p_assignee_actor_id: await actorOf(U.C), p_due_at: null, p_importance: "next", p_reviewed_sha: SHA("a"), p_acknowledge_source_change: false, ...extra };
  return usr(uid).rpc("confirm_code_activity_workspace_thing", args);
}
const things = async () => (await sql("select * from public.things")).length;

test("the package never mentions the G14 consent table and has no AI input", async () => {
  const text = readFileSync(new URL("./DRAFT_code_activity_workspace_creation.sql", import.meta.url), "utf8");
  const code = text.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.equal(/code_activity_consents/.test(code), false);
  assert.equal(/p_ai_generated|katalist_priv\.code_activity_flag\('ai'\)/.test(code), false);
  const tables = [...code.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?public\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(tables.sort(), ["code_activity_confirmations", "code_activity_workspace_sources"]);
  assert.equal((await sql("select to_regclass('public.code_activity_consents') as t"))[0].t, null, "G14 is not loaded in this subset");
});

test("grants: closed tables; user functions for authenticated only; the recorder for service_role only", async () => {
  for (const table of ["code_activity_confirmations", "code_activity_workspace_sources"]) {
    for (const role of ["anon", "authenticated", "service_role"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query(`select 1 from public.${table}`), /permission denied/, `${table} ${role}`);
      await db.exec("reset role");
    }
  }
  const expect = { code_activity_assignee_candidates: [false, true, false], confirm_code_activity_workspace_thing: [false, true, false], code_activity_server_record_workspace_source: [false, false, true] };
  for (const [name, want] of Object.entries(expect)) {
    const oid = (await sql("select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1", [name]))[0].oid;
    const can = async (role) => (await sql(`select has_function_privilege('${role}', ${oid}, 'EXECUTE') as ok`))[0].ok;
    assert.deepEqual([await can("anon"), await can("authenticated"), await can("service_role")], want, name);
  }
});

test("the recorder only accepts the live connection of that List at its generation", async () => {
  const rec = (extra) => svc().rpc("code_activity_server_record_workspace_source", { p_list_id: L.L1, p_connection_id: conn, p_generation: 1, p_kind: "pull_request", p_provider_key: "7", p_revision_sha: SHA("b"), p_title: "PR 7", p_source_url: "https://github.com/acme/web/pull/7", ...extra });
  assert.equal((await rec()).error, null);
  assert.equal((await rec({ p_generation: 2 })).error?.code, "42501", "a stale generation");
  assert.equal((await rec({ p_list_id: L.L2 })).error?.code, "42501", "another List's id");
  assert.equal((await rec({ p_kind: "bogus" })).error?.code, "23514", "an unknown kind");
  assert.equal((await rec({ p_source_url: "https://evil.example/x" })).error?.code, "23514", "only github.com links");
  assert.equal((await rec({ p_revision_sha: "nothex" })).error?.code, "23514");
  await sql("update public.code_activity_connections set needs_reverification = true");
  assert.equal((await rec()).error?.code, "42501", "uncertain access");
  await sql("update public.code_activity_connections set needs_reverification = false, status = 'disconnected'");
  assert.equal((await rec()).error?.code, "42501", "disconnected");
  for (const role of ["authenticated", "anon"]) {
    const r = await rpcClient(db, role, U.O).rpc("code_activity_server_record_workspace_source", { p_list_id: L.L1, p_connection_id: conn, p_generation: 1, p_kind: "commit", p_provider_key: SHA("c"), p_revision_sha: null, p_title: "x", p_source_url: null });
    assert.equal(r.error?.code, "42501", `${role} cannot register a source`);
  }
});

test("recording the same source again refreshes it instead of duplicating", async () => {
  const again = await svc().rpc("code_activity_server_record_workspace_source", { p_list_id: L.L1, p_connection_id: conn, p_generation: 1, p_kind: "commit", p_provider_key: SHA("a"), p_revision_sha: SHA("a"), p_title: "fix: autofill (amended title)", p_source_url: null });
  assert.equal(again.data, source);
  assert.equal((await sql("select count(*)::int c from public.code_activity_workspace_sources"))[0].c, 1);
  assert.equal((await sql("select title from public.code_activity_workspace_sources"))[0].title, "fix: autofill (amended title)");
});

test("candidates: owner and current collaborators only, and only for people who may create", async () => {
  const cand = (uid) => usr(uid).rpc("code_activity_assignee_candidates", { p_list_id: L.L1 });
  assert.deepEqual((await cand(U.O)).data.map((c) => c.role).sort(), ["collaborator", "owner"]);
  assert.ok(!(await cand(U.O)).data.some((c) => c.name === "V Person"), "View Only members are never offered");
  for (const uid of [U.V, U.X, U.O2]) assert.deepEqual((await cand(uid)).data, []);
});

test("confirm creates one Thing and one receipt together, with no invented date, in the person's own words", async () => {
  const r = await confirm(U.O);
  assert.equal(r.error, null, r.error?.message);
  assert.equal(r.data[0].o_replayed, false);
  const thing = (await sql("select * from public.things"))[0];
  assert.deepEqual([thing.title, thing.notes, thing.due_at, thing.list_id, thing.acknowledgement], ["Verify autofill", "Check the login form", null, L.L1, "waiting_for_catch"]);
  const receipt = (await sql("select * from public.code_activity_confirmations"))[0];
  assert.equal(receipt.thing_id, thing.id);
  assert.deepEqual([receipt.evidence.kind, receipt.evidence.head_sha, receipt.evidence.ai_generated], ["commit", SHA("a"), false]);
  assert.ok(!thing.notes.includes("github.com"), "provenance lives in the receipt, not in the notes");
});

test("a retry returns the original; the same key with different content conflicts; a late replay after deletion cannot duplicate", async () => {
  const first = await confirm(U.O);
  const again = await confirm(U.O);
  assert.deepEqual([again.data[0].o_thing_id, again.data[0].o_replayed], [first.data[0].o_thing_id, true]);
  assert.equal(await things(), 1);
  assert.equal((await confirm(U.O, { p_title: "Different" })).error?.code, "23505");
  assert.equal(await things(), 1);
  await sql("delete from public.things");
  const late = await confirm(U.O);
  assert.deepEqual([late.data[0].o_replayed, late.data[0].o_thing_id], [true, null]);
  assert.equal(await things(), 0);
});

test("one shared receipt namespace: a key used for one source cannot create a second Thing for another", async () => {
  await confirm(U.O);
  const other = (await svc().rpc("code_activity_server_record_workspace_source", { p_list_id: L.L1, p_connection_id: conn, p_generation: 1, p_kind: "pull_request", p_provider_key: "7", p_revision_sha: SHA("b"), p_title: "PR", p_source_url: null })).data;
  const clash = await confirm(U.O, { p_source_id: other, p_reviewed_sha: SHA("b") });
  assert.equal(clash.error?.code, "23505", "same key, different source");
  assert.equal(await things(), 1);
});

test("creation and receipt are atomic", async () => {
  await db.exec(`create or replace function public.create_thing(p_title text, p_assignee_actor_id uuid default null, p_notes text default null, p_context text default null, p_owner_importance public.importance default null, p_personal_pace text default null, p_due_at timestamptz default null, p_due_has_time boolean default false, p_list_id uuid default null) returns public.things language plpgsql as $$ begin raise exception 'simulated failure'; end; $$;`);
  assert.ok((await confirm(U.O)).error);
  assert.equal((await sql("select count(*)::int c from public.code_activity_confirmations"))[0].c, 0);
  await db.exec(`create or replace function public.create_thing(p_title text, p_assignee_actor_id uuid default null, p_notes text default null, p_context text default null, p_owner_importance public.importance default null, p_personal_pace text default null, p_due_at timestamptz default null, p_due_has_time boolean default false, p_list_id uuid default null) returns public.things language plpgsql security definer set search_path = pg_catalog, public, katalist_priv as $$ declare v_me uuid := katalist_priv.current_actor_id(); t public.things; begin insert into public.things (title, notes, creator_actor_id, owner_actor_id, current_assignee_actor_id, list_id, owner_importance, due_at) values (btrim(p_title), p_notes, v_me, v_me, coalesce(p_assignee_actor_id, v_me), p_list_id, coalesce(p_owner_importance, 'next'), p_due_at) returning * into t; return t; end; $$;`);
  assert.equal((await confirm(U.O)).error, null, "the same key works once the failure is gone");
  assert.equal(await things(), 1);
});

test("authorization: owners and collaborators only, own List's source only, eligible assignees only", async () => {
  for (const uid of [U.V, U.X, U.O2]) assert.equal((await confirm(uid)).error?.code, "42501", uid);
  assert.equal((await confirm(U.O, { p_assignee_actor_id: await actorOf(U.V) })).error?.code, "42501");
  assert.equal((await confirm(U.O, { p_assignee_actor_id: await actorOf(U.X) })).error?.code, "42501");
  assert.equal((await confirm(U.O, { p_assignee_actor_id: null })).error?.code, "22023");
  assert.equal((await confirm(U.O, { p_source_id: "99999999-9999-9999-9999-999999999999" })).error?.code, "42501");
  assert.equal((await confirm(U.O, { p_reviewed_sha: "nothex" })).error?.code, "22023");
  assert.equal((await confirm(U.O, { p_title: "   " })).error?.code, "22023");
  assert.equal((await confirm(U.O, { p_importance: "urgent" })).error?.code, "22023");
  await sql("update public.code_activity_connections set needs_reverification = true");
  assert.equal((await confirm(U.O)).error?.code, "42501", "uncertain access blocks new confirmations");
  await sql("update public.code_activity_connections set needs_reverification = false");
  await db.exec(`update public.code_activity_settings set value='false'::jsonb`);
  assert.equal((await confirm(U.O)).error?.code, "42501", "feature off");
  await db.exec(`update public.code_activity_settings set value='true'::jsonb; update public.lists set archived_at = now() where id = '${L.L1}'`);
  assert.equal((await confirm(U.O)).error?.code, "42501", "archived");
  assert.equal(await things(), 0, "no refusal created anything");
  assert.equal((await sql("select count(*)::int c from public.code_activity_confirmations"))[0].c, 0);
});

test("a source from another List cannot be used through this one", async () => {
  const conn2 = (await sql(`insert into public.code_activity_connections (list_id,status,installation_id,repository_id,connected_by_profile_id) values ($1,'active',88,601,$2) returning id`, [L.L2, U.O2]))[0].id;
  const foreign = (await svc().rpc("code_activity_server_record_workspace_source", { p_list_id: L.L2, p_connection_id: conn2, p_generation: 1, p_kind: "commit", p_provider_key: SHA("d"), p_revision_sha: SHA("d"), p_title: "Other", p_source_url: null })).data;
  assert.equal((await confirm(U.O, { p_source_id: foreign })).error?.code, "42501");
});

test("source changes: the reviewed revision must still be current unless confirmed again knowingly", async () => {
  await svc().rpc("code_activity_server_record_workspace_source", { p_list_id: L.L1, p_connection_id: conn, p_generation: 1, p_kind: "commit", p_provider_key: SHA("a"), p_revision_sha: SHA("b"), p_title: "moved", p_source_url: null });
  assert.equal((await confirm(U.O)).error?.code, "55000");
  assert.equal(await things(), 0);
  assert.equal((await confirm(U.O, { p_acknowledge_source_change: true })).error, null);
  const ev = (await sql("select evidence from public.code_activity_confirmations"))[0].evidence;
  assert.deepEqual([ev.reviewed_sha, ev.head_sha, ev.source_change_acknowledged], [SHA("a"), SHA("b"), true]);
});

test("a replay still answers after the feature is switched off, but never to someone who cannot see the List", async () => {
  await confirm(U.O);
  await db.exec(`update public.code_activity_settings set value='false'::jsonb`);
  assert.equal((await confirm(U.O)).data[0].o_replayed, true);
  assert.equal((await confirm(U.X)).error?.code, "42501");
});
