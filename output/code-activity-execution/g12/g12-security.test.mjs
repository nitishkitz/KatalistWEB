// DRAFT G11/G12 security and behavior tests (webhook storage, leased processing, budget, lifecycle, reconcile).
//   node --test output/code-activity-execution/g12/g12-security.test.mjs
// In-memory PGlite; uses the shared PostgREST-like harness. Real concurrency across connections is NOT proven.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { L, U, createDb, reset, rpcClient } from "../g10/harness.mjs";

const db = await createDb();
const srv = () => rpcClient(db, "service_role");
const usr = (uid) => rpcClient(db, "authenticated", uid);
const D = (n) => `70000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const sql = (q, p) => db.query(q, p).then((r) => r.rows);
const call = async (client, name, args) => client.rpc(name, args);
let conn;

beforeEach(async () => {
  current = undefined;
  await reset(db);
  await db.exec(`insert into public.code_activity_settings values ('sync','true'::jsonb)`);
  conn = (await sql(`insert into public.code_activity_connections (list_id,status,installation_id,repository_id,repository_full_name,connected_by_profile_id) values ($1,'active',77,501,'acme/web',$2) returning id`, [L.L1, U.O]))[0].id;
});

const record = (n, extra = {}) => call(srv(), "code_activity_server_record_delivery", { p_delivery_id: D(n), p_event: "push", p_action: null, p_installation_id: 77, p_repository_id: 501, p_refetch: { ref: "refs/heads/main" }, ...extra });
const claim = (limit = 4) => call(srv(), "code_activity_server_claim_deliveries", { p_limit: limit });
const finish = (id, lease, outcome, code = null) => call(srv(), "code_activity_server_finish_delivery", { p_delivery_id: id, p_lease_token: lease, p_outcome: outcome, p_error_code: code });

test("closed to every role; every function is server-only", async () => {
  for (const t of ["code_activity_deliveries", "code_activity_budget"]) {
    for (const role of ["anon", "authenticated", "service_role"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query(`select 1 from public.${t}`), /permission denied/, `${role} ${t}`);
      await db.exec("reset role");
    }
  }
  const rows = await sql(`select p.proname, p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'code\\_activity\\_server\\_%')`);
  const g12 = rows.filter((r) => /record_delivery|record_removal|take_budget|block_installation|claim_deliveries|finish_delivery|prune_deliveries|queue_health|connections_for_event|apply_items|set_check_state|apply_installation_event|begin_reconcile/.test(r.proname));
  assert.equal(g12.length, 13);
  for (const { proname, oid } of g12) {
    for (const role of ["anon", "authenticated"]) assert.equal((await sql(`select has_function_privilege('${role}', ${oid}, 'EXECUTE') as ok`))[0].ok, false, `${proname} ${role}`);
    assert.equal((await sql(`select has_function_privilege('service_role', ${oid}, 'EXECUTE') as ok`))[0].ok, true, `${proname} service_role`);
  }
  assert.equal((await call(usr(U.O), "code_activity_server_claim_deliveries", { p_limit: 1 })).error?.code, "42501");
});

test("record: stores identifiers once, answers duplicate for a redelivery, refuses while sync or master is off", async () => {
  assert.equal((await record(1)).data, "recorded");
  assert.equal((await record(1)).data, "duplicate");
  assert.equal((await sql("select count(*)::int c from public.code_activity_deliveries"))[0].c, 1);
  const row = (await sql("select event, installation_id, repository_id, refetch, status from public.code_activity_deliveries"))[0];
  assert.deepEqual([row.event, Number(row.installation_id), Number(row.repository_id), row.refetch, row.status], ["push", 77, 501, { ref: "refs/heads/main" }, "received"]);
  await db.exec(`update public.code_activity_settings set value='false'::jsonb where key='sync'`);
  assert.equal((await record(2)).data, "disabled");
  await db.exec(`update public.code_activity_settings set value='true'::jsonb where key='sync'; delete from public.code_activity_settings where key='master'`);
  assert.equal((await record(3)).data, "disabled");
  assert.equal((await sql("select count(*)::int c from public.code_activity_deliveries"))[0].c, 1, "nothing stored while disabled");
});

test("record: bounded and validated", async () => {
  assert.equal((await record(4, { p_event: "workflow_run" })).error?.code, "23514", "only subscribed events are stored");
  assert.equal((await record(5, { p_installation_id: 0 })).error?.code, "42501");
  assert.equal((await record(6, { p_refetch: { big: "x".repeat(5000) } })).error?.code, "23514", "refetch is at most 4 KiB");
  assert.equal((await record(7, { p_refetch: [1] })).error?.code, "42501", "refetch must be an object");
});

test("claim: leased, ordered, capped at four across callers, and a crashed lease is reclaimed", async () => {
  for (let i = 1; i <= 7; i += 1) await record(i);
  const first = (await claim(10)).data;
  assert.equal(first.length, 4, "at most four leases exist at once");
  assert.equal((await claim(10)).data.length, 0, "no room while four are live");
  assert.deepEqual(first.map((r) => r.o_attempts), [1, 1, 1, 1]);
  assert.equal(new Set(first.map((r) => r.o_lease_token)).size, 4);
  await sql("update public.code_activity_deliveries set lease_until = now() - interval '1 second' where delivery_id = $1", [D(1)]);
  const again = (await claim(1)).data;
  assert.deepEqual([again[0].o_delivery_id, again[0].o_attempts], [D(1), 2], "an expired lease is claimed again");
  assert.notEqual(again[0].o_lease_token, first[0].o_lease_token);
  assert.equal((await finish(D(1), first[0].o_lease_token, "processed")).data, false, "the old worker cannot finish after losing its lease");
  assert.equal((await finish(D(1), again[0].o_lease_token, "processed")).data, true);
  const rest = (await claim(10)).data.map((r) => r.o_delivery_id);
  assert.ok(!rest.includes(D(1)));
  await db.exec(`update public.code_activity_settings set value='false'::jsonb where key='sync'`);
  assert.equal((await claim(4)).data.length, 0, "claiming stops with the sync kill switch");
});

test("finish: processed, ignored, retry with backoff, and dead after five attempts; every call is fenced by the lease", async () => {
  await record(1);
  for (const [attempt, minWait, maxWait] of [[1, 30, 36], [2, 120, 144], [3, 600, 720], [4, 3600, 4320]]) {
    const c = (await claim(1)).data[0];
    assert.equal(c.o_attempts, attempt);
    assert.equal((await finish(D(1), c.o_lease_token, "retry", "provider_503")).data, true);
    const wait = Number((await sql(`select extract(epoch from next_attempt_at - now()) w from public.code_activity_deliveries`))[0].w);
    assert.ok(wait >= minWait - 2 && wait <= maxWait + 2, `attempt ${attempt}: waited ${wait}`);
    assert.equal((await claim(1)).data.length, 0, "not due yet");
    await sql("update public.code_activity_deliveries set next_attempt_at = now()");
  }
  const last = (await claim(1)).data[0];
  assert.equal(last.o_attempts, 5);
  await finish(D(1), last.o_lease_token, "retry", "provider_503");
  assert.deepEqual((await sql("select status, last_error_code from public.code_activity_deliveries"))[0], { status: "dead", last_error_code: "provider_503" });
  await sql("update public.code_activity_deliveries set next_attempt_at = now()");
  assert.equal((await claim(1)).data.length, 0, "dead is never claimed again");
  assert.equal((await finish(D(1), "99999999-9999-9999-9999-999999999999", "processed")).data, false);
  assert.equal((await finish(D(1), last.o_lease_token, "bogus")).error?.code, "42501");
  await record(2);
  const c2 = (await claim(1)).data[0];
  await finish(D(2), c2.o_lease_token, "ignored");
  assert.equal((await sql("select status, processed_at is not null p from public.code_activity_deliveries where delivery_id = $1", [D(2)]))[0].status, "ignored");
});

test("budget: 700 background and 300 interactive per hour, a window that resets, and a rate-limit block", async () => {
  const take = (cost, interactive) => call(srv(), "code_activity_server_take_budget", { p_installation_id: 77, p_cost: cost, p_interactive: interactive }).then((r) => r.data);
  assert.equal(await take(100, false), true);
  for (let i = 0; i < 6; i += 1) assert.equal(await take(100, false), true);
  assert.equal(await take(1, false), false, "background is exhausted at 700");
  assert.equal(await take(100, true), true, "interactive has its own reserve");
  assert.equal(await take(100, true), true);
  assert.equal(await take(100, true), true);
  assert.equal(await take(1, true), false, "interactive is exhausted at 300");
  await sql("update public.code_activity_budget set window_start = now() - interval '2 hours'");
  assert.equal(await take(5, false), true, "a new hour starts a new window");
  await call(srv(), "code_activity_server_block_installation", { p_installation_id: 77, p_seconds: 5 });
  assert.equal(await take(1, true), false, "blocked after a rate limit, for at least a minute");
  const until = Number((await sql(`select extract(epoch from blocked_until - now()) s from public.code_activity_budget`))[0].s);
  assert.ok(until >= 58 && until <= 3600);
  assert.equal((await call(srv(), "code_activity_server_take_budget", { p_installation_id: 77, p_cost: 0, p_interactive: false })).error?.code, "42501");
  assert.equal((await call(srv(), "code_activity_server_take_budget", { p_installation_id: 78, p_cost: 1, p_interactive: false })).data, true, "installations are independent");
});

const item = (n, minutesAgo, extra = {}) => ({ kind: "pull_request", provider_key: String(n), pr_number: n, pr_state: "open", title: `PR ${n}`, head_sha: "a".repeat(40), head_ref: "b", base_ref: "main", author_login: "ana", author_kind: "user", source_url: null, provider_updated_at: new Date(Date.UTC(2026, 9, 7, 12) - minutesAgo * 60_000).toISOString(), last_activity_at: new Date(Date.UTC(2026, 9, 7, 12) - minutesAgo * 60_000).toISOString(), ...extra });
let leaseSeq = 100;
/** A delivery claimed by a worker: the lease every data write must carry. */
async function lease() {
  leaseSeq += 1;
  assert.equal((await record(leaseSeq)).data, "recorded");
  const claimed = (await claim(1)).data;
  assert.equal(claimed.length, 1);
  return { p_delivery_id: claimed[0].o_delivery_id, p_lease_token: claimed[0].o_lease_token };
}
let current;
const apply = async (items, gen = 1, id = conn, l = null) => {
  current = l ?? current ?? (await lease());
  return call(srv(), "code_activity_server_apply_items", { p_connection_id: id, p_generation: gen, p_items: items, ...current });
};

test("apply_items: fenced by generation, status and flags; an older event never overwrites a newer row", async () => {
  assert.equal((await apply([item(1, 10)])).data, 1);
  assert.equal((await apply([item(1, 30, { title: "STALE" })])).data, 0, "older data is ignored");
  assert.equal((await sql("select title from public.code_activity_changes"))[0].title, "PR 1");
  assert.equal((await apply([item(1, 5, { title: "NEWER" })])).data, 1);
  assert.equal((await sql("select title from public.code_activity_changes"))[0].title, "NEWER");
  assert.equal((await apply([item(2, 1)], 2)).data, 0, "wrong generation");
  assert.equal((await apply([item(2, 1)], 1, "99999999-9999-9999-9999-999999999999")).data, 0, "unknown connection");
  assert.equal((await apply(Array.from({ length: 51 }, (_, i) => item(i + 10, i)))).error?.code, "42501", "bounded at 50");
  await db.exec(`update public.code_activity_settings set value='false'::jsonb where key='sync'`);
  assert.equal((await apply([item(3, 1)])).data, 0, "sync off");
  await db.exec(`update public.code_activity_settings set value='true'::jsonb where key='sync'; update public.code_activity_connections set status='disconnected', generation = generation + 1`);
  assert.equal((await apply([item(4, 1)], 2)).data, 0, "disconnected cannot be resurrected");
  assert.equal((await sql("select count(*)::int c from public.code_activity_changes where pr_number > 1"))[0].c, 0);
});

test("set_check_state: updates rows at that commit only, validates input", async () => {
  const l = await lease();
  await apply([item(1, 10), item(2, 9, { head_sha: "b".repeat(40) })], 1, conn, l);
  const set = (sha, state, gen = 1) => call(srv(), "code_activity_server_set_check_state", { p_connection_id: conn, p_generation: gen, p_sha: sha, p_state: state, ...l });
  assert.equal((await set("a".repeat(40), "failing")).data, 1);
  const rows = await sql("select pr_number, check_state, checks_revision from public.code_activity_changes order by pr_number");
  assert.deepEqual(rows.map((r) => [r.pr_number, r.check_state]), [[1, "failing"], [2, "unavailable"]]);
  assert.equal((await set("a".repeat(40), "weird")).error?.code, "42501");
  assert.equal((await set("not-a-sha", "passed")).error?.code, "42501");
  assert.equal((await set("a".repeat(40), "passed", 5)).data, 0, "stale generation");
});

test("installation lifecycle: suspend, unsuspend, delete and repository removal; terminal rows stay terminal", async () => {
  const l = await lease();
  const ev = (action, removed = null, inst = 77) => call(srv(), "code_activity_server_apply_installation_event", { p_installation_id: inst, p_action: action, p_removed_repository_ids: removed, ...l });
  const status = async () => (await sql("select status, generation, sync_status from public.code_activity_connections"))[0];
  assert.equal((await ev("suspend")).data, 1);
  assert.equal((await status()).status, "suspended");
  assert.equal((await apply([item(1, 1)])).data, 0, "no event work while suspended");
  assert.equal((await ev("unsuspend")).data, 1);
  assert.deepEqual(await status(), { status: "active", generation: 2, sync_status: "stale" });
  assert.equal((await ev("removed", [999])).data, 0, "another repository is untouched");
  assert.equal((await ev("removed", [501])).data, 1);
  assert.deepEqual([(await status()).status, (await status()).generation], ["revoked", 3]);
  assert.equal((await ev("unsuspend")).data, 0, "a revoked row is never reactivated");
  assert.equal((await ev("suspend")).data, 0);
  await sql("update public.code_activity_connections set status='disconnected'");
  assert.equal((await ev("deleted")).data, 0, "a disconnected row is untouched");
  assert.equal((await ev("unsuspend")).data, 0, "an intentional disconnect cannot be undone");
  await sql("update public.code_activity_connections set status='active'");
  assert.equal((await ev("deleted")).data, 1);
  assert.equal((await status()).status, "revoked");
  assert.equal((await ev("deleted", null, 12345)).data, 0, "another installation is untouched");
  assert.equal((await ev("bogus")).data, 0);
});

test("connections_for_event: active only, several Lists may share a repository, flags respected", async () => {
  const find = () => call(srv(), "code_activity_server_connections_for_event", { p_installation_id: 77, p_repository_id: 501 }).then((r) => r.data);
  assert.equal((await find()).length, 1);
  await sql("insert into public.code_activity_connections (list_id,status,installation_id,repository_id,connected_by_profile_id) values ($1,'active',77,501,$2)", [L.L2, U.O2]);
  assert.equal((await find()).length, 2);
  await sql("update public.code_activity_connections set status='suspended' where list_id=$1", [L.L2]);
  assert.equal((await find()).length, 1);
  await db.exec(`delete from public.code_activity_list_allowlist where list_id='${L.L1}'`);
  assert.equal((await find()).length, 0);
});

test("reconcile: leases only due, idle, active connections, one at a time, never while sync is off", async () => {
  const rec = (limit = 2) => call(srv(), "code_activity_server_begin_reconcile", { p_limit: limit, p_stale_after_minutes: 360 }).then((r) => r.data);
  const first = await rec();
  assert.equal(first.length, 1, "never synced is due");
  assert.equal((await rec()).length, 0, "now leased");
  await sql("update public.code_activity_connections set sync_lease_until = null, sync_status = 'ok', last_synced_at = now() - interval '1 hour', last_refresh_started_at = now() - interval '1 hour'");
  assert.equal((await rec()).length, 0, "recently synced is not due");
  await sql("update public.code_activity_connections set last_synced_at = now() - interval '7 hours'");
  const due = await rec();
  assert.equal(due.length, 1);
  assert.deepEqual([due[0].o_list_id, due[0].o_generation], [L.L1, 1]);
  assert.equal((await sql("select sync_status from public.code_activity_connections"))[0].sync_status, "syncing");
  await sql("update public.code_activity_connections set sync_lease_until = null, last_refresh_started_at = now() - interval '1 hour'");
  await db.exec(`update public.code_activity_settings set value='false'::jsonb where key='sync'`);
  assert.equal((await rec()).length, 0, "kill switch");
});

test("prune and queue health", async () => {
  for (let i = 1; i <= 4; i += 1) await record(i);
  await sql("update public.code_activity_deliveries set status='processed', received_at = now() - interval '15 days' where delivery_id = $1", [D(1)]);
  await sql("update public.code_activity_deliveries set status='dead', received_at = now() - interval '15 days' where delivery_id = $1", [D(2)]);
  await sql("update public.code_activity_deliveries set status='dead', received_at = now() - interval '31 days' where delivery_id = $1", [D(3)]);
  assert.equal((await call(srv(), "code_activity_server_prune_deliveries", {})).data, 2, "processed after 14 days, dead after 30");
  const health = (await call(srv(), "code_activity_server_queue_health", {})).data;
  assert.deepEqual(health.map((h) => [h.o_status, Number(h.o_count)]).sort(), [["dead", 1], ["received", 1]]);
});

// =====================================================================================================
// Regressions from the consolidated review
// =====================================================================================================

test("regression (worker safety): a worker that lost its lease cannot write data, though completion is already refused", async () => {
  const a = await lease(); // worker A claims a delivery...
  await apply([item(1, 10)], 1, conn, a);
  await sql("update public.code_activity_deliveries set lease_until = now() - interval '1 second' where delivery_id = $1", [a.p_delivery_id]);
  // ...and is slow. Every kind of write is refused, so it cannot overwrite what someone else has since written.
  const stale = item(1, 1, { title: "OVERWRITTEN BY A SLOW WORKER" });
  assert.equal((await apply([stale], 1, conn, a)).error?.code, "40001", "items");
  assert.equal((await call(srv(), "code_activity_server_set_check_state", { p_connection_id: conn, p_generation: 1, p_sha: "a".repeat(40), p_state: "passed", ...a })).error?.code, "40001", "check state");
  assert.equal((await call(srv(), "code_activity_server_apply_installation_event", { p_installation_id: 77, p_action: "deleted", p_removed_repository_ids: null, ...a })).error?.code, "40001", "lifecycle");
  assert.equal((await finish(a.p_delivery_id, a.p_lease_token, "processed")).data, false, "and finishing is refused too");
  assert.equal((await sql("select title, check_state from public.code_activity_changes"))[0].title, "PR 1");
  assert.equal((await sql("select status from public.code_activity_connections"))[0].status, "active", "an expired worker cannot revoke a connection either");

  // Worker B reclaims the same delivery with a new lease. Only B may write now.
  const claimedAgain = (await claim(1)).data[0];
  const b = { p_delivery_id: claimedAgain.o_delivery_id, p_lease_token: claimedAgain.o_lease_token };
  assert.equal(b.p_delivery_id, a.p_delivery_id);
  assert.equal((await apply([stale], 1, conn, a)).error?.code, "40001", "A's old token stays dead after B holds the delivery");
  assert.equal((await apply([item(1, 1, { title: "B WROTE THIS" })], 1, conn, b)).data, 1);
  assert.equal((await sql("select title from public.code_activity_changes"))[0].title, "B WROTE THIS");
});

test("regression (worker safety): the lease must belong to THIS delivery, be unfinished, and exist", async () => {
  const a = await lease();
  const other = await lease();
  assert.equal((await apply([item(1, 5)], 1, conn, { p_delivery_id: a.p_delivery_id, p_lease_token: other.p_lease_token })).error?.code, "40001", "another delivery's token");
  assert.equal((await apply([item(1, 5)], 1, conn, { p_delivery_id: "99999999-9999-9999-9999-999999999999", p_lease_token: a.p_lease_token })).error?.code, "40001", "unknown delivery");
  assert.equal((await apply([item(1, 5)], 1, conn, { p_delivery_id: a.p_delivery_id, p_lease_token: "99999999-9999-9999-9999-999999999999" })).error?.code, "40001", "wrong token");
  assert.equal((await finish(a.p_delivery_id, a.p_lease_token, "processed")).data, true);
  assert.equal((await apply([item(1, 5)], 1, conn, a)).error?.code, "40001", "a finished delivery cannot write");
  assert.equal((await apply([item(1, 5)], 1, conn, other)).data, 1, "the lease holder can");
  assert.equal((await db.query("select has_function_privilege('service_role', 'katalist_priv.code_activity_require_delivery_lease(uuid, uuid)', 'EXECUTE') as ok")).rows[0].ok, false, "the lease check is internal");
});

test("regression (revocation completeness): a removal of 450 repositories revokes all 450, in chunks of 200", async () => {
  await sql("insert into public.lists (id, owner_profile_id) select ('11000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, $1 from generate_series(1, 450) g", [U.O]);
  await sql(`insert into public.code_activity_list_allowlist select ('11000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid from generate_series(1, 450) g`);
  await sql(`insert into public.code_activity_connections (list_id, status, installation_id, repository_id, connected_by_profile_id)
             select ('11000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'active', 77, 1000 + g, $1 from generate_series(1, 450) g`, [U.O]);
  await sql("update public.code_activity_connections set status = 'disconnected' where list_id = $1", [L.L1]); // the setup connection is not part of this
  const ids = Array.from({ length: 450 }, (_, i) => 1001 + i);
  const removal = (id) => call(srv(), "code_activity_server_record_removal", { p_delivery_id: id, p_installation_id: 77, p_repository_ids: ids, p_overflow: false });
  assert.equal((await removal(D(500))).data, "recorded");
  const rows = await sql("select delivery_id, refetch from public.code_activity_deliveries order by received_at, delivery_id");
  assert.equal(rows.length, 3, "450 ids become three rows of at most 200");
  assert.deepEqual(rows.map((r) => r.refetch.removed.length).sort((x, y) => y - x), [200, 200, 50]);
  assert.ok(rows.some((r) => r.delivery_id === D(500)), "the first row keeps GitHub's delivery id");
  assert.equal(new Set(rows.flatMap((r) => r.refetch.removed)).size, 450, "no id is lost or repeated");
  assert.equal((await removal(D(500))).data, "duplicate", "a redelivery is recognised and adds nothing");
  assert.equal((await sql("select count(*)::int c from public.code_activity_deliveries"))[0].c, 3);

  // Process every chunk the way the worker does: claim one, write with its lease, finish.
  for (let i = 0; i < 3; i += 1) {
    const claimed = (await claim(1)).data[0];
    const done = await call(srv(), "code_activity_server_apply_installation_event", { p_installation_id: 77, p_action: "removed", p_removed_repository_ids: claimed.o_refetch.removed, p_delivery_id: claimed.o_delivery_id, p_lease_token: claimed.o_lease_token });
    assert.equal(done.error, null);
    await finish(claimed.o_delivery_id, claimed.o_lease_token, "processed");
  }
  const left = (await sql("select count(*)::int c from public.code_activity_connections where installation_id = 77 and status = 'active'"))[0].c;
  assert.equal(left, 0, "none of the 450 connections is left reading a repository that lost access");
  assert.equal((await sql("select count(*)::int c from public.code_activity_connections where status = 'revoked'"))[0].c, 450);
});

test("regression (revocation completeness): a chunk is never silently shortened, and an unlistable removal fails closed", async () => {
  const l = await lease();
  const tooMany = await call(srv(), "code_activity_server_apply_installation_event", { p_installation_id: 77, p_action: "removed", p_removed_repository_ids: Array.from({ length: 201 }, (_, i) => i + 1), ...l });
  assert.equal(tooMany.error?.code, "22023", "more than 200 ids is an error, not a quiet no-op");
  assert.equal((await sql("select status from public.code_activity_connections"))[0].status, "active");

  await sql("update public.code_activity_connections set status = 'active'");
  await sql("insert into public.code_activity_connections (list_id,status,installation_id,repository_id,connected_by_profile_id) values ($1,'active',77,777,$2)", [L.L2, U.O2]);
  assert.equal((await call(srv(), "code_activity_server_record_removal", { p_delivery_id: D(600), p_installation_id: 77, p_repository_ids: [], p_overflow: true })).data, "recorded");
  assert.equal((await call(srv(), "code_activity_server_record_removal", { p_delivery_id: D(600), p_installation_id: 77, p_repository_ids: [], p_overflow: true })).data, "duplicate");
  const claimed = (await claim(1)).data[0];
  assert.deepEqual([claimed.o_action, claimed.o_refetch], ["removed_overflow", { overflow: true }]);
  const done = await call(srv(), "code_activity_server_apply_installation_event", { p_installation_id: 77, p_action: "removed_overflow", p_removed_repository_ids: null, p_delivery_id: claimed.o_delivery_id, p_lease_token: claimed.o_lease_token });
  assert.equal(done.data, 2, "every live connection of the installation is stopped");
  const states = await sql("select status, sync_status, generation from public.code_activity_connections where installation_id = 77 order by repository_id");
  assert.ok(states.every((r) => r.status === "suspended" && r.sync_status === "stale" && r.generation === 2), JSON.stringify(states));
  assert.equal((await apply([item(1, 1)], 1, conn, { p_delivery_id: claimed.o_delivery_id, p_lease_token: claimed.o_lease_token })).data, 0, "nothing more is applied to a stopped connection");
  const direct = await call(srv(), "code_activity_server_record_removal", { p_delivery_id: D(601), p_installation_id: 77, p_repository_ids: Array.from({ length: 5001 }, (_, i) => i + 1), p_overflow: false });
  assert.equal(direct.data, "recorded");
  assert.deepEqual((await sql("select action, refetch from public.code_activity_deliveries where delivery_id = $1", [D(601)]))[0], { action: "removed_overflow", refetch: { overflow: true } }, "more than 5,000 ids is recorded as an overflow, not truncated");
  await db.exec(`update public.code_activity_settings set value='false'::jsonb where key='sync'`);
  assert.equal((await call(srv(), "code_activity_server_record_removal", { p_delivery_id: D(602), p_installation_id: 77, p_repository_ids: [1], p_overflow: false })).data, "disabled");
  assert.equal((await usr(U.O).rpc("code_activity_server_record_removal", { p_delivery_id: D(603), p_installation_id: 77, p_repository_ids: [1], p_overflow: false })).error?.code, "42501", "clients cannot call it");
});

// =====================================================================================================
// Post-overflow access: a connection whose access is uncertain stays blocked until the owner reconnects
// =====================================================================================================

test("regression (fail closed): after an overflow nothing is readable, nothing new can be confirmed, and no unsuspend revives it", async () => {
  const l = await lease();
  await apply([item(1, 5)], 1, conn, l);
  const feed = (uid) => usr(uid).rpc("code_activity_feed", { p_list_id: L.L1, p_before_at: null, p_before_id: null, p_limit: 25 }).then((r) => r.data);
  const status = (uid) => usr(uid).rpc("code_activity_connection_status", { p_list_id: L.L1 }).then((r) => r.data);
  const changeId = (await sql("select id from public.code_activity_changes"))[0].id;
  for (const uid of [U.O, U.C, U.V]) assert.equal((await feed(uid)).length, 1, `${uid} reads before the overflow`);

  const overflow = await lease();
  const hit = await call(srv(), "code_activity_server_apply_installation_event", { p_installation_id: 77, p_action: "removed_overflow", p_removed_repository_ids: null, ...overflow });
  assert.equal(hit.data, 1);
  const row = (await sql("select status, needs_reverification, sync_status, generation from public.code_activity_connections"))[0];
  assert.deepEqual(row, { status: "suspended", needs_reverification: true, sync_status: "stale", generation: 2 });

  // Reads: the saved private feed is gone for everyone, including View Only.
  for (const uid of [U.O, U.C, U.V]) {
    assert.deepEqual(await feed(uid), [], `${uid} cannot read the saved feed`);
    assert.deepEqual((await usr(uid).rpc("code_activity_change_for_read", { p_list_id: L.L1, p_change_id: changeId })).data, [], `${uid} cannot open a change`);
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid]);
    assert.equal((await db.query("select count(*)::int c from public.code_activity_connections")).rows[0].c, 0, `${uid}: the table policy hides it too`);
    await db.exec("reset role");
  }
  // The status function still tells members WHY, so the UI can explain instead of showing an empty screen.
  assert.deepEqual([(await status(U.V))[0].status, (await status(U.V))[0].needs_reverification], ["suspended", true]);

  // New work: no confirmation, no AI, no refresh, no provider read.
  assert.equal((await usr(U.O).rpc("code_activity_begin_refresh", { p_list_id: L.L1 })).error?.code, "42501");
  assert.equal((await call(srv(), "code_activity_server_connection_for_provider", { p_list_id: L.L1, p_expected_generation: null, p_expected_connection_id: null })).data.length, 0);
  assert.equal((await usr(U.O).rpc("confirm_code_activity_draft", { p_list_id: L.L1, p_change_id: changeId, p_idempotency_key: "a0000000-0000-0000-0000-000000000001", p_title: "t", p_notes: null, p_assignee_actor_id: (await sql("select id from public.actors where profile_id = $1", [U.O]))[0].id, p_due_at: null, p_importance: "next", p_head_sha: "a".repeat(40), p_acknowledge_source_change: false, p_ai_generated: false })).error?.code, "42501", "no new Thing from a connection whose access is uncertain");

  // An ordinary unsuspend event does NOT bring it back.
  const un = await lease();
  assert.equal((await call(srv(), "code_activity_server_apply_installation_event", { p_installation_id: 77, p_action: "unsuspend", p_removed_repository_ids: null, ...un })).data, 0);
  assert.deepEqual((await sql("select status, needs_reverification, generation from public.code_activity_connections"))[0], { status: "suspended", needs_reverification: true, generation: 2 });
  for (const uid of [U.O, U.V]) assert.deepEqual(await feed(uid), [], "still blocked after the unsuspend");

  // Only the owner can clear it: disconnect, then connect again (a new, verified connection).
  assert.equal((await usr(U.C).rpc("code_activity_disconnect", { p_list_id: L.L1, p_confirm: true })).error?.code, "42501");
  assert.ok((await usr(U.O).rpc("code_activity_disconnect", { p_list_id: L.L1, p_confirm: true })).data);
  const fresh = (await sql(`insert into public.code_activity_connections (list_id,status,installation_id,repository_id,connected_by_profile_id) values ($1,'active',77,501,$2) returning id, needs_reverification`, [L.L1, U.O]))[0];
  assert.equal(fresh.needs_reverification, false, "a new connection starts verified");
  await sql(`insert into public.code_activity_changes (connection_id, kind, provider_key, pr_number, pr_state, title, provider_updated_at, last_activity_at) values ($1,'pull_request','9',9,'open','Fresh',now(),now())`, [fresh.id]);
  assert.deepEqual((await feed(U.V)).map((r) => r.title), ["Fresh"], "after reconnecting, reads work again, and only the new connection's rows are shown");
});

test("regression (fail closed): a connection already suspended by GitHub is also blocked by an overflow", async () => {
  await call(srv(), "code_activity_server_apply_installation_event", { p_installation_id: 77, p_action: "suspend", p_removed_repository_ids: null, ...(await lease()) });
  assert.equal((await sql("select status from public.code_activity_connections"))[0].status, "suspended");
  assert.equal((await call(srv(), "code_activity_server_apply_installation_event", { p_installation_id: 77, p_action: "removed_overflow", p_removed_repository_ids: null, ...(await lease()) })).data, 1, "the already-suspended row is marked too");
  assert.equal((await call(srv(), "code_activity_server_apply_installation_event", { p_installation_id: 77, p_action: "unsuspend", p_removed_repository_ids: null, ...(await lease()) })).data, 0, "so the later unsuspend cannot revive it");
  assert.deepEqual((await sql("select status, needs_reverification from public.code_activity_connections"))[0], { status: "suspended", needs_reverification: true });
  assert.equal((await call(srv(), "code_activity_server_apply_installation_event", { p_installation_id: 77, p_action: "removed_overflow", p_removed_repository_ids: null, ...(await lease()) })).data, 0, "marking is idempotent");
});
