// DRAFT G03 security tests. Run manually (NOT part of `npm test`):
//   node --test output/code-activity-execution/g03/g03-security.test.mjs
// Runs the DRAFT schema in an in-memory PGlite database with stubbed Supabase roles and auth.uid().
// Proves the SQL executes and the privilege/predicate logic behaves. Does NOT prove hosted Supabase
// behavior, real JWT handling, PostgREST column-level semantics, or true concurrent-transaction races.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const DRAFT = readFileSync(new URL("./DRAFT_code_activity_connection_schema.sql", import.meta.url), "utf8");
const U = { O: "00000000-0000-0000-0000-00000000000a", O2: "00000000-0000-0000-0000-00000000000b", C: "00000000-0000-0000-0000-00000000000c", V: "00000000-0000-0000-0000-00000000000d", X: "00000000-0000-0000-0000-00000000000e" };
const L = { L1: "10000000-0000-0000-0000-000000000001", L2: "10000000-0000-0000-0000-000000000002", L3: "10000000-0000-0000-0000-000000000003", ARCH: "10000000-0000-0000-0000-000000000004" };
const hash = (s) => new Uint8Array(createHash("sha256").update(s).digest());
const NONCE = hash("nonce-1");
const OTHER_NONCE = hash("nonce-2");
const TABLES = ["code_activity_settings", "code_activity_list_allowlist", "code_activity_connections", "code_activity_auth_states", "code_activity_selection_proofs"];

const db = new PGlite();

async function setup() {
  await db.exec(`
    create role authenticated; create role anon; create role service_role;
    create schema auth; create schema katalist_priv;
    grant usage on schema public, auth, katalist_priv to authenticated, anon, service_role;
    -- Mimic Supabase default privileges so the draft's explicit REVOKEs are really exercised.
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    alter default privileges in schema katalist_priv grant execute on functions to anon, authenticated, service_role;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant execute on function auth.uid() to authenticated, anon, service_role;
    create type public.list_role as enum ('collaborator','view_only');
    create table public.profiles (id uuid primary key);
    create table public.lists (id uuid primary key, owner_profile_id uuid not null references public.profiles(id), archived_at timestamptz);
    create table public.list_members (list_id uuid not null references public.lists(id) on delete cascade, profile_id uuid not null references public.profiles(id), role public.list_role not null, primary key (list_id, profile_id));
    -- Helpers copied from 20260818144945_*.sql
    create function katalist_priv.is_list_owner(_list_id uuid) returns boolean language sql stable security definer set search_path = 'pg_catalog','public','katalist_priv' as $$ select exists (select 1 from public.lists l where l.id = _list_id and l.owner_profile_id = auth.uid()); $$;
    create function katalist_priv.is_list_member(_list_id uuid, _roles public.list_role[] default null) returns boolean language sql stable security definer set search_path = 'pg_catalog','public','katalist_priv' as $$ select exists (select 1 from public.list_members m where m.list_id = _list_id and m.profile_id = auth.uid() and (_roles is null or m.role = any(_roles))); $$;
    create function katalist_priv.can_view_list(_list_id uuid) returns boolean language sql stable security definer set search_path = 'pg_catalog','public','katalist_priv' as $$ select katalist_priv.is_list_owner(_list_id) or katalist_priv.is_list_member(_list_id); $$;
  `);
  await db.exec(DRAFT);
}

async function reset() {
  await db.exec(`
    reset role;
    truncate public.code_activity_selection_proofs, public.code_activity_auth_states, public.code_activity_connections, public.code_activity_list_allowlist, public.code_activity_settings, public.list_members, public.lists, public.profiles cascade;
    insert into public.profiles values ${Object.values(U).map((u) => `('${u}')`).join(",")};
    insert into public.lists values ('${L.L1}','${U.O}',null),('${L.L2}','${U.O2}',null),('${L.L3}','${U.O}',null),('${L.ARCH}','${U.O}', now());
    insert into public.list_members values ('${L.L1}','${U.C}','collaborator'),('${L.L1}','${U.V}','view_only');
    insert into public.code_activity_settings values ('master','true'::jsonb);
    insert into public.code_activity_list_allowlist (list_id) values ('${L.L1}'),('${L.L2}'),('${L.L3}'),('${L.ARCH}');
  `);
}

/** Run one statement as a role with auth.uid() = uid. Returns { rows } or { error }. */
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
const denied = (r, label) => assert.ok(r.error, `${label}: expected an error, got ${JSON.stringify(r.rows)}`);
const sql = (q, params) => db.query(q, params).then((r) => r.rows);

const startAuth = (uid, list, flow = "oauth", state = hash(`state-${Math.random()}`), nonce = NONCE) =>
  as("authenticated", uid, "select public.code_activity_start_authorization($1,$2,$3,$4)", [list, flow, state, nonce]);
const writeProofs = (list, profile, nonce, items) =>
  as("service_role", null, "select public.code_activity_server_write_selection_proofs($1,$2,$3,$4::jsonb)", [list, profile, nonce, JSON.stringify(items)]);
const item = (id, name = `acme/repo-${id}`) => ({ installation_id: 77, repository_id: id, full_name: name, visibility: "private", updated_at: "2026-10-07T00:00:00Z" });
const proofIdFor = async (list, repoId) => (await sql("select id from public.code_activity_selection_proofs where list_id=$1 and repository_id=$2", [list, repoId]))[0]?.id;
const verify = (proof, list, profile, nonce = NONCE) =>
  as("service_role", null, "select public.code_activity_server_mark_proof_verified($1,$2,$3,$4)", [proof, list, profile, nonce]);
const connect = (uid, list, proof, nonce = NONCE, ack = true) =>
  as("authenticated", uid, "select public.code_activity_connect($1,$2,$3,$4)", [list, proof, nonce, ack]);
async function readyProof(list = L.L1, owner = U.O, repo = 501) {
  assert.ok(!(await writeProofs(list, owner, NONCE, [item(repo)])).error);
  const id = await proofIdFor(list, repo);
  assert.equal((await verify(id, list, owner)).rows[0].code_activity_server_mark_proof_verified, true);
  return id;
}

test.before(setup);
beforeEach(reset);

test("default deny: private tables are closed to anon, authenticated and service_role", async () => {
  for (const t of TABLES) {
    for (const role of ["anon", "authenticated", "service_role"]) {
      if (t === "code_activity_connections" && role === "authenticated") continue;
      denied(await as(role, U.O, `select 1 from public.${t} limit 1`), `${role} select ${t}`);
    }
    for (const role of ["anon", "authenticated", "service_role"]) {
      denied(await as(role, U.O, `delete from public.${t}`), `${role} delete ${t}`);
      denied(await as(role, U.O, `update public.${t} set ${t === "code_activity_settings" ? "updated_at" : t === "code_activity_list_allowlist" ? "added_at" : "created_at"} = now()`), `${role} update ${t}`);
    }
  }
  denied(await as("authenticated", U.O, `insert into public.code_activity_settings values ('master','true'::jsonb)`), "client cannot flip a flag");
  denied(await as("authenticated", U.O, `insert into public.code_activity_list_allowlist (list_id) values ('${L.L2}')`), "client cannot allowlist");
});

test("connections: only the listed columns are readable, never installation or lease fields", async () => {
  await sql(`insert into public.code_activity_connections (list_id,status,installation_id,repository_id,repository_full_name,connected_by_profile_id) values ($1,'active',77,501,'acme/web',$2)`, [L.L1, U.O]);
  denied(await as("authenticated", U.O, "select * from public.code_activity_connections"), "select *");
  for (const col of ["installation_id", "sync_lease_token", "sync_lease_until", "connected_by_profile_id", "updated_at"]) {
    denied(await as("authenticated", U.O, `select ${col} from public.code_activity_connections`), col);
  }
  const ok = await as("authenticated", U.O, "select id, list_id, status, repository_id, repository_full_name, sync_status from public.code_activity_connections");
  assert.equal(ok.rows.length, 1);
  denied(await as("authenticated", U.O, `update public.code_activity_connections set status='revoked'`), "no update");
  denied(await as("authenticated", U.O, `insert into public.code_activity_connections (list_id,status,installation_id,repository_id,connected_by_profile_id) values ('${L.L3}','active',1,2,'${U.O}')`), "no insert");
});

test("read predicate: owner, collaborator and view_only read; outsiders, removed members and disabled states do not", async () => {
  await sql(`insert into public.code_activity_connections (list_id,status,installation_id,repository_id,repository_full_name,connected_by_profile_id) values ($1,'active',77,501,'acme/web',$2)`, [L.L1, U.O]);
  const read = (uid) => as("authenticated", uid, "select id from public.code_activity_connections");
  for (const uid of [U.O, U.C, U.V]) assert.equal((await read(uid)).rows.length, 1, uid);
  assert.equal((await read(U.X)).rows.length, 0, "outsider");
  assert.equal((await read(U.O2)).rows.length, 0, "owner of another List");
  await sql(`delete from public.list_members where profile_id=$1`, [U.C]);
  assert.equal((await read(U.C)).rows.length, 0, "removed member");
  for (const status of ["disconnected", "revoked", "pending_repository"]) {
    await sql(`update public.code_activity_connections set status=$1`, [status]);
    assert.equal((await read(U.O)).rows.length, 0, status);
  }
  await sql(`update public.code_activity_connections set status='suspended'`);
  assert.equal((await read(U.V)).rows.length, 1, "suspended still readable");
  await sql(`update public.code_activity_settings set value='false'::jsonb where key='master'`);
  assert.equal((await read(U.O)).rows.length, 0, "master off");
  await sql(`delete from public.code_activity_settings`);
  assert.equal((await read(U.O)).rows.length, 0, "no settings row = off");
  await reset();
  await sql(`insert into public.code_activity_connections (list_id,status,installation_id,repository_id,connected_by_profile_id) values ($1,'active',77,501,$2)`, [L.L1, U.O]);
  await sql(`delete from public.code_activity_list_allowlist where list_id=$1`, [L.L1]);
  assert.equal((await read(U.O)).rows.length, 0, "not allowlisted");
  await sql(`insert into public.code_activity_list_allowlist (list_id) values ($1)`, [L.L1]);
  await sql(`update public.lists set archived_at = now() where id=$1`, [L.L1]);
  assert.equal((await read(U.O)).rows.length, 0, "archived");
});

test("function privileges: each function is callable by exactly the intended role", async () => {
  const user = ["code_activity_start_authorization", "code_activity_list_selection_proofs", "code_activity_connect", "code_activity_disconnect", "code_activity_connection_status", "code_activity_is_enabled"];
  const server = ["code_activity_server_consume_auth_state", "code_activity_server_write_selection_proofs", "code_activity_server_get_proof", "code_activity_server_mark_proof_verified", "code_activity_server_connection_for_provider"];
  const rows = await sql(`select p.proname, p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'code\\_activity\\_%'`);
  assert.equal(rows.length, user.length + server.length, "no unlisted function exists");
  for (const { proname, oid } of rows) {
    const can = async (role) => (await sql(`select has_function_privilege('${role}', ${oid}, 'EXECUTE') as ok`))[0].ok;
    assert.equal(await can("anon"), false, `${proname} anon`);
    assert.equal(await can("authenticated"), user.includes(proname), `${proname} authenticated`);
    assert.equal(await can("service_role"), server.includes(proname), `${proname} service_role`);
  }
  for (const f of ["code_activity_flag(text)", "code_activity_flags_ok_for(uuid)"]) {
    for (const role of ["anon", "authenticated", "service_role"]) {
      assert.equal((await sql(`select has_function_privilege('${role}', 'katalist_priv.${f}', 'EXECUTE') as ok`))[0].ok, false, `${f} ${role}`);
    }
  }
  assert.equal((await sql(`select has_function_privilege('authenticated','katalist_priv.code_activity_enabled_for(uuid)','EXECUTE') as ok`))[0].ok, true);
  assert.equal((await sql(`select has_function_privilege('anon','katalist_priv.code_activity_enabled_for(uuid)','EXECUTE') as ok`))[0].ok, false);
  const sig = (await sql(`select pg_get_function_arguments('public.code_activity_connect(uuid,uuid,bytea,boolean)'::regprocedure) as a`))[0].a;
  assert.match(sig, /p_nonce_hash bytea/, "connect signature carries the nonce hash");
  assert.doesNotMatch(sig, /installation|repository/, "connect never accepts repository or installation ids");
  denied(await as("authenticated", U.O, "select * from public.code_activity_server_connection_for_provider($1)", [L.L1]), "user cannot call server fn");
  denied(await as("service_role", null, "select public.code_activity_connect($1,$2,$3,true)", [L.L1, L.L1, NONCE]), "server cannot call user fn");
});

test("flags fail closed: absent, false, not allowlisted and archived all deny start", async () => {
  await sql(`delete from public.code_activity_settings`);
  assert.equal((await startAuth(U.O, L.L1)).error?.code, "42501", "no settings rows");
  await reset();
  await sql(`update public.code_activity_settings set value='"true"'::jsonb`);
  assert.equal((await startAuth(U.O, L.L1)).error?.code, "42501", "string true is not true");
  await reset();
  await sql(`delete from public.code_activity_list_allowlist where list_id=$1`, [L.L1]);
  assert.equal((await startAuth(U.O, L.L1)).error?.code, "42501", "not allowlisted");
  await reset();
  assert.equal((await startAuth(U.O, L.ARCH)).error?.code, "42501", "archived");
});

test("start: owner only, bounded, one live connection, rate limited", async () => {
  assert.ok(!(await startAuth(U.O, L.L1)).error);
  for (const uid of [U.C, U.V, U.X, U.O2]) assert.equal((await startAuth(uid, L.L1)).error?.code, "42501", uid);
  assert.equal((await startAuth(U.O, L.L1, "bogus")).error?.code, "42501", "bad flow");
  assert.equal((await startAuth(U.O, L.L1, "oauth", new Uint8Array(5))).error?.code, "42501", "short state hash");
  assert.equal((await startAuth(U.O, L.L1, "oauth", hash("x"), new Uint8Array(5))).error?.code, "42501", "short nonce hash");
  for (let i = 0; i < 4; i += 1) assert.ok(!(await startAuth(U.O, L.L1)).error);
  assert.equal((await startAuth(U.O, L.L1)).error?.code, "54000", "sixth start in 10 minutes");
  await reset();
  await sql(`insert into public.code_activity_connections (list_id,status,installation_id,repository_id,connected_by_profile_id) values ($1,'active',1,2,$2)`, [L.L1, U.O]);
  assert.equal((await startAuth(U.O, L.L1)).error?.code, "23505", "already connected");
  assert.equal((await as("anon", null, "select public.code_activity_start_authorization($1,'oauth',$2,$3)", [L.L1, hash("a"), NONCE])).error?.code, "42501", "anon denied (permission)");
});

test("consume state: single use, nonce bound, expiry, ownership and flags rechecked", async () => {
  const state = hash("state-A");
  assert.ok(!(await startAuth(U.O, L.L1, "oauth", state)).error);
  const consume = (s, n) => as("service_role", null, "select * from public.code_activity_server_consume_auth_state($1,$2)", [s, n]);
  assert.equal((await consume(state, OTHER_NONCE)).rows.length, 0, "wrong nonce");
  const ok = await consume(state, NONCE);
  assert.equal(ok.rows.length, 1, "wrong nonce must not have burned the state");
  assert.deepEqual([ok.rows[0].o_list_id, ok.rows[0].o_profile_id, ok.rows[0].o_flow], [L.L1, U.O, "oauth"]);
  assert.equal((await consume(state, NONCE)).rows.length, 0, "replay");
  const s2 = hash("state-B");
  await startAuth(U.O, L.L1, "oauth", s2);
  await sql(`update public.code_activity_auth_states set expires_at = now() - interval '1 second' where state_hash=$1`, [s2]);
  assert.equal((await consume(s2, NONCE)).rows.length, 0, "expired");
  const s3 = hash("state-C");
  await startAuth(U.O, L.L1, "oauth", s3);
  await sql(`update public.lists set owner_profile_id=$1 where id=$2`, [U.O2, L.L1]);
  assert.equal((await consume(s3, NONCE)).rows.length, 0, "owner lost the List");
  await sql(`update public.lists set owner_profile_id=$1 where id=$2`, [U.O, L.L1]);
  const s4 = hash("state-D");
  await startAuth(U.O, L.L1, "oauth", s4);
  await sql(`update public.code_activity_settings set value='false'::jsonb`);
  assert.equal((await consume(s4, NONCE)).rows.length, 0, "flag off");
});

test("proofs: written only for the verified owner, listed only to the bound caller, minimal columns", async () => {
  assert.ok(!(await writeProofs(L.L1, U.O, NONCE, [item(501), item(502)])).error);
  denied(await writeProofs(L.L1, U.C, NONCE, [item(503)]), "collaborator cannot be the proof owner");
  denied(await writeProofs(L.L2, U.O, NONCE, [item(503)]), "owner of another List");
  denied(await writeProofs(L.L1, U.O, NONCE, Array.from({ length: 301 }, (_, i) => item(1000 + i))), "more than 300");
  denied(await writeProofs(L.L1, U.O, new Uint8Array(3), [item(1)]), "short nonce");
  const list = (uid, list = L.L1, nonce = NONCE) => as("authenticated", uid, "select * from public.code_activity_list_selection_proofs($1,$2)", [list, nonce]);
  const mine = await list(U.O);
  assert.deepEqual(mine.rows.map((r) => r.repository_full_name), ["acme/repo-501", "acme/repo-502"]);
  assert.deepEqual(Object.keys(mine.rows[0]).sort(), ["proof_id", "repository_full_name", "repository_updated_at", "visibility"]);
  assert.equal((await list(U.O, L.L1, OTHER_NONCE)).rows.length, 0, "different browser nonce");
  for (const uid of [U.C, U.V, U.X, U.O2]) assert.equal((await list(uid)).rows.length, 0, uid);
  assert.equal((await list(U.O, L.L2)).rows.length, 0, "another List");
  await sql(`update public.code_activity_selection_proofs set expires_at = now() - interval '1 second'`);
  assert.equal((await list(U.O)).rows.length, 0, "expired");
  await reset();
  await writeProofs(L.L1, U.O, NONCE, [item(501)]);
  await writeProofs(L.L1, U.O, NONCE, [item(502)]);
  assert.deepEqual((await list(U.O)).rows.map((r) => r.repository_full_name), ["acme/repo-502"], "a new callback replaces unconsumed proofs");
  denied(await as("authenticated", U.O, "select * from public.code_activity_selection_proofs"), "no direct proof read");
  const page = await as("authenticated", U.O, "select * from public.code_activity_list_selection_proofs($1,$2,null,1000)", [L.L1, NONCE]);
  assert.ok(page.rows.length <= 50, "limit capped at 50");
});

test("connect: complete signature, mandatory nonce match, verified proof, single use, identical failures", async () => {
  const proof = await readyProof();
  const failures = [];
  const fail = async (label, r) => { denied(r, label); failures.push(`${r.error.code}:${r.error.message}`); };
  await fail("wrong nonce hash", await connect(U.O, L.L1, proof, OTHER_NONCE));
  await fail("short nonce hash", await connect(U.O, L.L1, proof, new Uint8Array(4)));
  await fail("acknowledgement false", await connect(U.O, L.L1, proof, NONCE, false));
  await fail("acknowledgement null", await as("authenticated", U.O, "select public.code_activity_connect($1,$2,$3,null)", [L.L1, proof, NONCE]));
  await fail("collaborator", await connect(U.C, L.L1, proof));
  await fail("view only", await connect(U.V, L.L1, proof));
  await fail("outsider", await connect(U.X, L.L1, proof));
  await fail("other owner using this proof id", await connect(U.O2, L.L2, proof));
  await fail("same owner, different List", await connect(U.O, L.L3, proof));
  await fail("unknown proof id", await connect(U.O, L.L1, L.L2));
  assert.equal(new Set(failures).size, 1, `failure reasons must not differ: ${[...new Set(failures)].join(" | ")}`);
  assert.equal((await sql("select count(*)::int c from public.code_activity_connections"))[0].c, 0, "nothing connected by any failure");
  const ok = await connect(U.O, L.L1, proof);
  assert.ok(!ok.error, ok.error?.message);
  const row = (await sql("select status, installation_id, repository_id, generation, sharing_acknowledged_at is not null as acked from public.code_activity_connections"))[0];
  assert.deepEqual([row.status, Number(row.installation_id), Number(row.repository_id), row.generation, row.acked], ["active", 77, 501, 1, true]);
  await fail("replay of a consumed proof", await connect(U.O, L.L1, proof));
});

test("a proof bound to another profile is never listed or connectable, even with the right List and nonce", async () => {
  // Defense in depth: the owner is immutable today, but the proof must still be bound to the caller itself.
  await sql(`insert into public.code_activity_selection_proofs (list_id, profile_id, nonce_hash, installation_id, repository_id, repository_full_name, visibility, installation_verified_at, expires_at)
             values ($1, $2, $3, 77, 900, 'acme/foreign', 'private', now(), now() + interval '10 minutes')`, [L.L1, U.C, NONCE]);
  const listed = await as("authenticated", U.O, "select * from public.code_activity_list_selection_proofs($1,$2)", [L.L1, NONCE]);
  assert.equal(listed.rows.length, 0, "owner must not see another profile's proof");
  denied(await connect(U.O, L.L1, await proofIdFor(L.L1, 900)), "owner cannot consume another profile's proof");
  const got = await as("service_role", null, "select * from public.code_activity_server_get_proof($1,$2,$3,$4)", [await proofIdFor(L.L1, 900), L.L1, U.O, NONCE]);
  assert.equal(got.rows.length, 0, "server read is also profile-bound");
});

test("connect refuses a proof the server has not verified, expired, or consumed; unverified proofs cannot be self-verified", async () => {
  await writeProofs(L.L1, U.O, NONCE, [item(501)]);
  const proof = await proofIdFor(L.L1, 501);
  denied(await connect(U.O, L.L1, proof), "unverified proof");
  denied(await as("authenticated", U.O, "update public.code_activity_selection_proofs set installation_verified_at = now()"), "client cannot verify");
  denied(await as("authenticated", U.O, "select public.code_activity_server_mark_proof_verified($1,$2,$3,$4)", [proof, L.L1, U.O, NONCE]), "client cannot call the verifier");
  assert.equal((await verify(proof, L.L1, U.C)).rows[0].code_activity_server_mark_proof_verified, false, "wrong profile");
  assert.equal((await verify(proof, L.L1, U.O, OTHER_NONCE)).rows[0].code_activity_server_mark_proof_verified, false, "wrong nonce");
  assert.equal((await verify(proof, L.L1, U.O)).rows[0].code_activity_server_mark_proof_verified, true);
  await sql(`update public.code_activity_selection_proofs set expires_at = now() - interval '1 second'`);
  denied(await connect(U.O, L.L1, proof), "expired");
  const got = await as("service_role", null, "select * from public.code_activity_server_get_proof($1,$2,$3,$4)", [proof, L.L1, U.O, NONCE]);
  assert.equal(got.rows.length, 0, "server read of an expired proof returns nothing");
});

test("only one live connection per List, including under the unique index", async () => {
  const p1 = await readyProof(L.L1, U.O, 501);
  assert.ok(!(await connect(U.O, L.L1, p1)).error);
  assert.ok(!(await writeProofs(L.L1, U.O, NONCE, [item(502)])).error);
  const p2 = await proofIdFor(L.L1, 502);
  await verify(p2, L.L1, U.O);
  const second = await connect(U.O, L.L1, p2);
  assert.equal(second.error?.code, "23505");
  assert.equal((await sql("select count(*)::int c from public.code_activity_connections where status='active'"))[0].c, 1);
  const a = await readyProof(L.L3, U.O, 601);
  const results = await Promise.all([connect(U.O, L.L3, a), connect(U.O, L.L3, a)]);
  assert.equal(results.filter((r) => !r.error).length, 1, "single-connection PGlite serializes these; real concurrency needs a multi-connection test");
});

test("disconnect: owner only, terminal, generation fenced, reconnect makes a new row", async () => {
  const proof = await readyProof();
  await connect(U.O, L.L1, proof);
  const dis = (uid, confirm = true) => as("authenticated", uid, "select public.code_activity_disconnect($1,$2)", [L.L1, confirm]);
  for (const uid of [U.C, U.V, U.X]) denied(await dis(uid), uid);
  denied(await dis(U.O, false), "confirmation required");
  const first = await dis(U.O);
  assert.ok(first.rows[0].code_activity_disconnect);
  const row = (await sql("select status, generation, disconnected_at is not null as t from public.code_activity_connections"))[0];
  assert.deepEqual([row.status, row.generation, row.t], ["disconnected", 2, true]);
  assert.equal((await dis(U.O)).rows[0].code_activity_disconnect, null, "second disconnect is a no-op");
  const p2 = await readyProof(L.L1, U.O, 502);
  assert.ok(!(await connect(U.O, L.L1, p2)).error, "reconnect allowed after terminal");
  const rows = await sql("select status from public.code_activity_connections order by created_at");
  assert.deepEqual(rows.map((r) => r.status), ["disconnected", "active"]);
});

test("status function: members see terminal states, others and disabled features see nothing", async () => {
  const proof = await readyProof();
  await connect(U.O, L.L1, proof);
  const status = (uid, list = L.L1) => as("authenticated", uid, "select * from public.code_activity_connection_status($1)", [list]);
  assert.equal((await status(U.V)).rows[0].status, "active");
  await as("authenticated", U.O, "select public.code_activity_disconnect($1,true)", [L.L1]);
  assert.equal((await status(U.V)).rows[0].status, "disconnected");
  assert.deepEqual(Object.keys((await status(U.V)).rows[0]).sort(), ["last_synced_at", "needs_reverification", "repository_full_name", "status", "sync_status"]);
  assert.equal((await status(U.X)).rows.length, 0, "outsider");
  assert.equal((await status(U.O2)).rows.length, 0, "owner of another List");
  await sql(`update public.code_activity_settings set value='false'::jsonb`);
  assert.equal((await status(U.V)).rows.length, 0, "disabled");
});

test("provider read: only an active, generation-matched connection, only for the server", async () => {
  const proof = await readyProof();
  await connect(U.O, L.L1, proof);
  const read = (gen = null) => as("service_role", null, "select * from public.code_activity_server_connection_for_provider($1,$2)", [L.L1, gen]);
  const ok = await read();
  assert.equal(ok.rows.length, 1);
  assert.deepEqual([Number(ok.rows[0].o_installation_id), Number(ok.rows[0].o_repository_id), ok.rows[0].o_generation], [77, 501, 1]);
  assert.equal((await read(1)).rows.length, 1);
  assert.equal((await read(2)).rows.length, 0, "stale generation");
  await sql(`update public.code_activity_settings set value='false'::jsonb`);
  assert.equal((await read()).rows.length, 0, "flag off");
  await sql(`update public.code_activity_settings set value='true'::jsonb`);
  await as("authenticated", U.O, "select public.code_activity_disconnect($1,true)", [L.L1]);
  assert.equal((await read()).rows.length, 0, "disconnected");
});

test("capabilities function: true only for members of an enabled List; identical false otherwise", async () => {
  const enabled = (uid, list = L.L1) => as("authenticated", uid, "select public.code_activity_is_enabled($1) as e", [list]);
  for (const uid of [U.O, U.C, U.V]) assert.equal((await enabled(uid)).rows[0].e, true, uid);
  for (const uid of [U.X, U.O2]) assert.equal((await enabled(uid)).rows[0].e, false, uid);
  assert.equal((await enabled(U.O, "99999999-9999-9999-9999-999999999999")).rows[0].e, false, "unknown List");
  assert.equal((await enabled(U.O, L.ARCH)).rows[0].e, false, "archived");
  await sql(`update public.code_activity_settings set value='false'::jsonb`);
  assert.equal((await enabled(U.O)).rows[0].e, false, "master off");
  denied(await as("anon", null, "select public.code_activity_is_enabled($1)", [L.L1]), "anon");
});

test("bytea arguments arrive as PostgreSQL hex text from PostgREST and work end to end", async () => {
  const hex = (u8) => `\\x${Buffer.from(u8).toString("hex")}`;
  assert.ok(!(await as("authenticated", U.O, "select public.code_activity_start_authorization($1, 'oauth', $2::text::bytea, $3::text::bytea)", [L.L1, hex(hash("state-hex")), hex(NONCE)])).error);
  assert.equal((await as("service_role", null, "select * from public.code_activity_server_consume_auth_state($1::text::bytea, $2::text::bytea)", [hex(hash("state-hex")), hex(NONCE)])).rows.length, 1);
  assert.ok(!(await as("service_role", null, "select public.code_activity_server_write_selection_proofs($1,$2,$3::text::bytea,$4::jsonb)", [L.L1, U.O, hex(NONCE), JSON.stringify([item(777)])])).error);
  const proof = await proofIdFor(L.L1, 777);
  assert.equal((await as("service_role", null, "select public.code_activity_server_mark_proof_verified($1,$2,$3,$4::text::bytea)", [proof, L.L1, U.O, hex(NONCE)])).rows[0].code_activity_server_mark_proof_verified, true);
  const connected = await as("authenticated", U.O, "select public.code_activity_connect($1,$2,$3::text::bytea,true)", [L.L1, proof, hex(NONCE)]);
  assert.ok(!connected.error, connected.error?.message);
});

test("regression (reconnect): provider reads are bound to the connection id as well as the generation", async () => {
  const provider = (gen, conn) => as("service_role", null, "select * from public.code_activity_server_connection_for_provider($1,$2,$3)", [L.L1, gen, conn]);
  const first = await readyProof(L.L1, U.O, 501);
  assert.ok(!(await connect(U.O, L.L1, first)).error);
  const a = (await sql("select id, generation from public.code_activity_connections"))[0];
  assert.equal((await provider(a.generation, a.id)).rows.length, 1);
  await as("authenticated", U.O, "select public.code_activity_disconnect($1,true)", [L.L1]);
  const second = await readyProof(L.L1, U.O, 502);
  assert.ok(!(await connect(U.O, L.L1, second)).error);
  const b = (await sql("select id, generation, repository_id from public.code_activity_connections where status = 'active'"))[0];
  assert.equal(b.generation, 1, "the replacement starts at generation 1 again");
  assert.notEqual(b.id, a.id);
  const byGenerationOnly = await provider(1, null);
  assert.equal(Number(byGenerationOnly.rows[0].o_repository_id), 502, "by generation alone an old request would be answered with the NEW repository");
  assert.equal((await provider(1, a.id)).rows.length, 0, "bound to the old connection id it gets nothing");
  const bound = await provider(1, b.id);
  assert.equal(Number(bound.rows[0].o_repository_id), 502);
  assert.equal((await provider(2, b.id)).rows.length, 0);
});
