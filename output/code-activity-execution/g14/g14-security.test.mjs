// DRAFT G14 tests: AI consent, gating and rate limits.   node --test output/code-activity-execution/g14/g14-security.test.mjs
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { L, U, createDb, reset, rpcClient } from "../g10/harness.mjs";

const db = await createDb();
const usr = (uid) => rpcClient(db, "authenticated", uid);
const sql = (q, p) => db.query(q, p).then((r) => r.rows);
let change;
beforeEach(async () => {
  await reset(db);
  await db.exec(`insert into public.code_activity_settings values ('ai','true'::jsonb)`);
  const conn = (await sql(`insert into public.code_activity_connections (list_id,status,installation_id,repository_id,connected_by_profile_id) values ($1,'active',77,501,$2) returning id`, [L.L1, U.O]))[0].id;
  change = (await sql(`insert into public.code_activity_changes (connection_id, kind, provider_key, pr_number, pr_state, title, provider_updated_at, last_activity_at) values ($1,'pull_request','7',7,'open','t',now(),now()) returning id`, [conn]))[0].id;
});
const status = (uid) => usr(uid).rpc("code_activity_ai_status", { p_list_id: L.L1 }).then((r) => r.data);
const consent = (uid, on) => usr(uid).rpc("code_activity_set_consent", { p_list_id: L.L1, p_enabled: on });
const begin = (uid, kind = "draft", id = change) => usr(uid).rpc("code_activity_ai_begin", { p_list_id: L.L1, p_change_id: id, p_kind: kind });
const ok = (r) => !r.error && Array.isArray(r.data) && r.data.length === 1;

test("closed tables and the function grants", async () => {
  for (const t of ["code_activity_consents", "code_activity_ai_usage"]) for (const role of ["anon", "authenticated", "service_role"]) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query(`select 1 from public.${t}`), /permission denied/, `${role} ${t}`);
    await db.exec("reset role");
  }
  for (const name of ["code_activity_ai_status", "code_activity_set_consent", "code_activity_consent_details", "code_activity_ai_begin", "code_activity_ai_still_allowed"]) {
    const oid = (await sql("select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1", [name]))[0].oid;
    const can = async (role) => (await sql(`select has_function_privilege('${role}', ${oid}, 'EXECUTE') as ok`))[0].ok;
    assert.deepEqual([await can("anon"), await can("authenticated"), await can("service_role")], [false, true, false], name);
  }
});

test("default is off, and connecting never turns it on; members see only booleans", async () => {
  assert.deepEqual(await status(U.O), [{ o_available: true, o_consent: false }]);
  for (const uid of [U.C, U.V]) assert.deepEqual(await status(uid), [{ o_available: true, o_consent: false }], "members read the boolean");
  assert.deepEqual(await status(U.X), [], "an outsider learns nothing");
  assert.equal((await begin(U.O)).error?.code, "42501", "no consent, no AI call");
  assert.deepEqual(Object.keys((await status(U.V))[0]), ["o_available", "o_consent"], "no who or when for members");
  assert.equal((await sql("select count(*)::int c from public.code_activity_consents"))[0].c, 0);
});

test("only the owner changes consent, only while the operator flag is on; details are owner-only", async () => {
  for (const uid of [U.C, U.V, U.X, U.O2]) assert.equal((await consent(uid, true)).error?.code, "42501", uid);
  assert.equal((await consent(U.O, true)).data, true);
  assert.deepEqual(await status(U.V), [{ o_available: true, o_consent: true }]);
  const details = await usr(U.O).rpc("code_activity_consent_details", { p_list_id: L.L1 });
  assert.deepEqual([details.data[0].o_enabled, details.data[0].o_changed_by], [true, U.O]);
  for (const uid of [U.C, U.V, U.X]) assert.deepEqual((await usr(uid).rpc("code_activity_consent_details", { p_list_id: L.L1 })).data, [], `${uid} cannot read audit details`);
  await db.exec(`update public.code_activity_settings set value='false'::jsonb where key='ai'`);
  assert.equal((await consent(U.O, false)).error?.code, "42501", "the operator flag gates the setting");
  assert.deepEqual(await status(U.O), [{ o_available: false, o_consent: true }], "consent is kept but nothing runs");
  assert.equal((await begin(U.O)).error?.code, "42501", "flag off blocks calls even with consent");
});

test("an AI call needs owner or collaborator, consent, the flag, and a change of this List's live connection", async () => {
  await consent(U.O, true);
  assert.ok(ok(await begin(U.O)));
  assert.ok(ok(await begin(U.C, "summary")));
  for (const uid of [U.V, U.X, U.O2]) assert.equal((await begin(uid)).error?.code, "42501", uid);
  assert.equal((await begin(U.O, "weird")).error?.code, "42501");
  assert.equal((await begin(U.O, "draft", "99999999-9999-9999-9999-999999999999")).error?.code, "42501");
  await sql("update public.code_activity_connections set status = 'suspended'");
  assert.equal((await begin(U.O)).error?.code, "42501", "no AI on a suspended connection");
  await sql("update public.code_activity_connections set status = 'active'");
  await db.exec(`update public.code_activity_settings set value='false'::jsonb where key='master'`);
  assert.equal((await begin(U.O)).error?.code, "42501", "master off");
});

test("revoking consent blocks new calls and makes an in-flight result unusable", async () => {
  await consent(U.O, true);
  const started = await begin(U.O);
  assert.ok(ok(started));
  const generation = started.data[0].o_generation;
  const connectionId = started.data[0].o_connection_id;
  assert.equal(generation, 1);
  const still = (uid = U.O, gen = generation) => usr(uid).rpc("code_activity_ai_still_allowed", { p_list_id: L.L1, p_connection_id: connectionId, p_generation: gen }).then((r) => r.data);
  assert.equal(await still(), true);
  await consent(U.O, false);
  assert.equal(await still(), false, "checked again before disclosure and after the reply");
  assert.equal((await begin(U.O)).error?.code, "42501");
  await consent(U.O, true);
  assert.equal(await still(U.V), false, "View Only can never use it");
  assert.equal(await still(U.C), true);
});

test("rate limits: 3 per person per 10 minutes and 20 per List per hour; failures count", async () => {
  await consent(U.O, true);
  for (let i = 0; i < 3; i += 1) assert.ok(ok(await begin(U.O)));
  assert.equal((await begin(U.O)).error?.code, "54000", "fourth in 10 minutes");
  assert.ok(ok(await begin(U.C)), "another person has their own allowance");
  await sql("update public.code_activity_ai_usage set at = now() - interval '11 minutes' where profile_id = $1", [U.O]);
  assert.ok(ok(await begin(U.O)), "the window moves");
  await sql("delete from public.code_activity_ai_usage");
  await sql("insert into public.code_activity_ai_usage (list_id, profile_id, kind, at) select $1, $2, 'draft', now() - interval '30 minutes' from generate_series(1, 20)", [L.L1, U.C]);
  assert.equal((await begin(U.O)).error?.code, "54000", "twenty in the hour for the List");
  await sql("update public.code_activity_ai_usage set at = now() - interval '3 hours'");
  assert.ok(ok(await begin(U.O)));
  assert.equal((await sql("select count(*)::int c from public.code_activity_ai_usage"))[0].c, 1, "old usage rows are pruned");
});

test("regression (consent): the post-reply check is bound to the connection generation, so a disconnect cannot pass it", async () => {
  await consent(U.O, true);
  const started = (await begin(U.O)).data[0];
  const generation = started.o_generation;
  const still = (gen, conn = started.o_connection_id) => usr(U.O).rpc("code_activity_ai_still_allowed", { p_list_id: L.L1, p_connection_id: conn, p_generation: gen }).then((r) => r.data);
  assert.equal(await still(generation), true);
  assert.equal(await still(generation + 1), false, "a different generation");
  await sql("update public.code_activity_connections set status = 'disconnected', generation = generation + 1");
  assert.equal(await still(generation), false, "disconnected: the old generation no longer matches");
  assert.equal(await still(generation + 1), false, "and a disconnected connection is never allowed, even at its new generation");
  assert.equal(await still(generation + 1, "99999999-9999-9999-9999-999999999999"), false, "an unknown connection id");
  await sql("update public.code_activity_connections set status = 'suspended'");
  assert.equal(await still(generation + 1), false, "suspended");
  await sql("update public.code_activity_connections set status = 'active'");
  await sql("update public.code_activity_settings set value = 'false'::jsonb where key = 'ai'");
  assert.equal(await still(generation + 1), false, "flag off");
});

test("regression (limits): AI admission is serialized with advisory locks, person first and then List", async () => {
  // A count followed by an insert is only safe if concurrent callers cannot interleave. PGlite has one connection,
  // so the race itself cannot be run here; this pins the mechanism that prevents it, and the runbook says so.
  const def = (await sql("select pg_get_functiondef('public.code_activity_ai_begin(uuid, uuid, text)'::regprocedure) as d"))[0].d;
  const person = def.indexOf("pg_advisory_xact_lock(hashtext('code_activity_ai:person:'");
  const list = def.indexOf("pg_advisory_xact_lock(hashtext('code_activity_ai:list:'");
  const count = def.indexOf("SELECT count(*)");
  const insert = def.indexOf("INSERT INTO public.code_activity_ai_usage");
  assert.ok(person > 0 && list > person && count > list && insert > count, "locks come before the count and the insert, person before List");
  const start = (await sql("select pg_get_functiondef('public.code_activity_start_authorization(uuid, text, bytea, bytea)'::regprocedure) as d"))[0].d;
  assert.ok(start.indexOf("pg_advisory_xact_lock") > 0 && start.indexOf("pg_advisory_xact_lock") < start.indexOf("count(*)"), "the authorization limiter is serialized too");
});

test("regression (reconnect): a request that began on the OLD connection cannot pass its checks against the REPLACEMENT", async () => {
  await consent(U.O, true);
  const old = (await begin(U.O)).data[0];
  const still = (conn, gen) => usr(U.O).rpc("code_activity_ai_still_allowed", { p_list_id: L.L1, p_connection_id: conn, p_generation: gen }).then((r) => r.data);
  assert.equal(await still(old.o_connection_id, old.o_generation), true);

  // The owner disconnects and connects another repository: a NEW row, whose generation starts at 1 again.
  await sql("update public.code_activity_connections set status = 'disconnected', generation = generation + 1");
  const replacement = (await sql(`insert into public.code_activity_connections (list_id,status,installation_id,repository_id,repository_full_name,connected_by_profile_id) values ($1,'active',77,777,'acme/other',$2) returning id, generation`, [L.L1, U.O]))[0];
  assert.equal(replacement.generation, old.o_generation, "the replacement has the SAME generation number: the generation alone cannot tell them apart");
  assert.equal(await still(old.o_connection_id, old.o_generation), false, "the old request's checks fail against the replacement");
  assert.equal(await still(replacement.id, replacement.generation), true, "while the replacement's own checks pass");
  assert.equal(await still(replacement.id, old.o_generation + 5), false);
  // A change that belongs to the replacement starts its own call on the replacement.
  const next = (await sql(`insert into public.code_activity_changes (connection_id, kind, provider_key, pr_number, pr_state, title, provider_updated_at, last_activity_at) values ($1,'pull_request','1',1,'open','t',now(),now()) returning id`, [replacement.id]))[0].id;
  const begun = (await begin(U.O, "draft", next)).data[0];
  assert.deepEqual([begun.o_connection_id, begun.o_generation], [replacement.id, 1]);
  assert.equal((await begin(U.O, "draft", change)).error?.code, "42501", "a change of the old connection can no longer start a call");
});
