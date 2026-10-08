// DRAFT G15 tests: atomic, idempotent Thing creation from a change.
//   node --test output/code-activity-execution/g15/g15-security.test.mjs
// create_thing is a STAND-IN in the harness (same signature); the real one is existing code and is not re-tested here.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { L, U, createDb, reset, rpcClient } from "../g10/harness.mjs";

const db = await createDb();
const usr = (uid) => rpcClient(db, "authenticated", uid);
const sql = (q, p) => db.query(q, p).then((r) => r.rows);
const KEY = "a0000000-0000-0000-0000-000000000001";
const SHA = (c) => c.repeat(40);
let conn;
let change;
const actorOf = async (uid) => (await sql("select id from public.actors where profile_id = $1", [uid]))[0].id;

beforeEach(async () => {
  await reset(db);
  conn = (await sql(`insert into public.code_activity_connections (list_id,status,installation_id,repository_id,repository_full_name,connected_by_profile_id) values ($1,'active',77,501,'acme/web',$2) returning id`, [L.L1, U.O]))[0].id;
  change = (await sql(`insert into public.code_activity_changes (connection_id, kind, provider_key, pr_number, pr_state, title, head_sha, provider_updated_at, last_activity_at, source_url) values ($1,'pull_request','7',7,'open','Responsive nav',$2,now(),now(),'https://github.com/acme/web/pull/7') returning id`, [conn, SHA("a")]))[0].id;
});

async function confirm(uid, extra = {}) {
  const args = { p_list_id: L.L1, p_change_id: change, p_idempotency_key: KEY, p_title: "Verify nav", p_notes: "Check the menu", p_assignee_actor_id: await actorOf(U.C), p_due_at: null, p_importance: "next", p_head_sha: SHA("a"), p_acknowledge_source_change: false, p_ai_generated: false, ...extra };
  return usr(uid).rpc("confirm_code_activity_draft", args);
}
const things = async () => (await sql("select * from public.things order by title")).length;

test("closed table; both functions are for authenticated callers only", async () => {
  for (const role of ["anon", "authenticated", "service_role"]) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query("select 1 from public.code_activity_confirmations"), /permission denied/, role);
    await db.exec("reset role");
  }
  for (const name of ["code_activity_assignee_candidates", "confirm_code_activity_draft"]) {
    const oid = (await sql("select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1", [name]))[0].oid;
    const can = async (role) => (await sql(`select has_function_privilege('${role}', ${oid}, 'EXECUTE') as ok`))[0].ok;
    assert.deepEqual([await can("anon"), await can("authenticated"), await can("service_role")], [false, true, false], name);
  }
});

test("candidates: only the owner and current collaborators, only for people who may create", async () => {
  const cand = (uid, list = L.L1) => usr(uid).rpc("code_activity_assignee_candidates", { p_list_id: list });
  const owner = await cand(U.O);
  assert.deepEqual(owner.data.map((c) => [c.role, c.name, c.is_self]), [["collaborator", "C Person", false], ["owner", "O Person", true]].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
  assert.equal((await cand(U.C)).data.find((c) => c.is_self).role, "collaborator");
  for (const uid of [U.V, U.X, U.O2]) assert.deepEqual((await cand(uid)).data, [], `${uid} sees no candidates`);
  assert.ok(!(await cand(U.O)).data.some((c) => c.name === "V Person"), "View Only members are never offered");
  await db.exec(`update public.lists set archived_at = now() where id = '${L.L1}'`);
  assert.deepEqual((await cand(U.O)).data, [], "archived");
  await db.exec(`update public.lists set archived_at = null; update public.code_activity_settings set value='false'::jsonb`);
  assert.deepEqual((await cand(U.O)).data, [], "feature off");
});

test("confirm creates one Thing and one receipt together, with no invented date and the person's own words", async () => {
  const r = await confirm(U.O);
  assert.equal(r.error, null, r.error?.message);
  assert.equal(r.data[0].o_replayed, false);
  const thing = (await sql("select * from public.things"))[0];
  assert.deepEqual([thing.title, thing.notes, thing.due_at, thing.list_id, thing.owner_importance, thing.acknowledgement], ["Verify nav", "Check the menu", null, L.L1, "next", "waiting_for_catch"]);
  assert.equal(thing.current_assignee_actor_id, await actorOf(U.C));
  const receipt = (await sql("select * from public.code_activity_confirmations"))[0];
  assert.equal(receipt.thing_id, thing.id);
  assert.deepEqual([receipt.evidence.pr_number, receipt.evidence.head_sha, receipt.evidence.ai_generated, receipt.evidence.source_change_acknowledged], [7, SHA("a"), false, false]);
  assert.ok(!thing.notes.includes("github.com"), "provenance lives in the receipt, not in the Thing's notes");
  const dated = await confirm(U.O, { p_idempotency_key: "a0000000-0000-0000-0000-000000000002", p_title: "With date", p_due_at: "2026-10-20T00:00:00Z" });
  assert.equal(dated.error, null);
  assert.ok((await sql("select due_at from public.things where title='With date'"))[0].due_at);
});

test("a retry of the same request returns the original; a different request under the same key is a conflict", async () => {
  const first = await confirm(U.O);
  const again = await confirm(U.O);
  assert.deepEqual([again.data[0].o_thing_id, again.data[0].o_replayed], [first.data[0].o_thing_id, true]);
  assert.equal(await things(), 1, "a replay never creates a second Thing");
  assert.equal((await confirm(U.O, { p_title: "Something else" })).error?.code, "23505");
  assert.equal((await confirm(U.O, { p_importance: "now" })).error?.code, "23505");
  assert.equal(await things(), 1);
  const other = await confirm(U.C, { p_assignee_actor_id: await actorOf(U.O) });
  assert.equal(other.error, null, "another person's key space is independent");
  assert.equal(await things(), 2);
  await sql("update public.things set title = title"); // the receipt outlives edits
  assert.equal((await confirm(U.O)).data[0].o_replayed, true);
});

test("a deleted Thing still replays as the same request, so a late retry cannot create a duplicate", async () => {
  await confirm(U.O);
  await sql("delete from public.things");
  const late = await confirm(U.O);
  assert.deepEqual([late.data[0].o_replayed, late.data[0].o_thing_id], [true, null], "the receipt is permanent and records that it was handled");
  assert.equal(await things(), 0);
});

test("creation and receipt are atomic: if the Thing cannot be created, no receipt remains", async () => {
  await db.exec(`create or replace function public.create_thing(p_title text, p_assignee_actor_id uuid default null, p_notes text default null, p_context text default null, p_owner_importance public.importance default null, p_personal_pace text default null, p_due_at timestamptz default null, p_due_has_time boolean default false, p_list_id uuid default null) returns public.things language plpgsql as $$ begin raise exception 'simulated failure'; end; $$;`);
  const failed = await confirm(U.O);
  assert.ok(failed.error);
  assert.equal((await sql("select count(*)::int c from public.code_activity_confirmations"))[0].c, 0);
  await db.exec(`create or replace function public.create_thing(p_title text, p_assignee_actor_id uuid default null, p_notes text default null, p_context text default null, p_owner_importance public.importance default null, p_personal_pace text default null, p_due_at timestamptz default null, p_due_has_time boolean default false, p_list_id uuid default null) returns public.things language plpgsql security definer set search_path = pg_catalog, public, katalist_priv as $$ declare v_me uuid := katalist_priv.current_actor_id(); t public.things; begin insert into public.things (title, notes, creator_actor_id, owner_actor_id, current_assignee_actor_id, list_id, owner_importance, due_at) values (btrim(p_title), p_notes, v_me, v_me, coalesce(p_assignee_actor_id, v_me), p_list_id, coalesce(p_owner_importance, 'next'), p_due_at) returning * into t; return t; end; $$;`);
  assert.equal((await confirm(U.O)).error, null, "the same key works once the failure is gone");
  assert.equal(await things(), 1);
});

test("authorization: only owners and collaborators, only for their List's connection, only eligible assignees", async () => {
  for (const uid of [U.V, U.X, U.O2]) assert.equal((await confirm(uid)).error?.code, "42501", uid);
  assert.equal((await confirm(U.O, { p_assignee_actor_id: await actorOf(U.V) })).error?.code, "42501", "a View Only member cannot be assigned");
  assert.equal((await confirm(U.O, { p_assignee_actor_id: await actorOf(U.X) })).error?.code, "42501", "nor a non-member");
  assert.equal((await confirm(U.O, { p_assignee_actor_id: await actorOf(U.O2) })).error?.code, "42501", "nor the owner of another List");
  assert.equal((await confirm(U.O, { p_assignee_actor_id: null })).error?.code, "22023", "an assignee is required and never chosen for the person");
  await sql("delete from public.list_members where profile_id = $1", [U.C]);
  assert.equal((await confirm(U.O)).error?.code, "42501", "a collaborator who was removed is no longer eligible");
  await sql("insert into public.list_members values ($1,$2,'collaborator')", [L.L1, U.C]);
  assert.equal((await confirm(U.O, { p_change_id: "99999999-9999-9999-9999-999999999999" })).error?.code, "42501", "unknown change");
  await sql("update public.code_activity_connections set status = 'disconnected'");
  assert.equal((await confirm(U.O)).error?.code, "42501", "a disconnected connection");
  await sql("update public.code_activity_connections set status = 'active'");
  await db.exec(`update public.code_activity_settings set value='false'::jsonb`);
  assert.equal((await confirm(U.O)).error?.code, "42501", "feature off");
  await db.exec(`update public.code_activity_settings set value='true'::jsonb; update public.lists set archived_at = now() where id = '${L.L1}'`);
  assert.equal((await confirm(U.O)).error?.code, "42501", "archived");
  assert.equal(await things(), 0, "no refusal created anything");
  assert.equal((await sql("select count(*)::int c from public.code_activity_confirmations"))[0].c, 0);
});

test("a change from another List cannot be used through this one", async () => {
  await sql("insert into public.code_activity_connections (list_id,status,installation_id,repository_id,connected_by_profile_id) values ($1,'active',88,601,$2)", [L.L2, U.O2]);
  const other = (await sql(`insert into public.code_activity_changes (connection_id, kind, provider_key, pr_number, pr_state, title, head_sha, provider_updated_at, last_activity_at) select id,'pull_request','1',1,'open','Other',$1,now(),now() from public.code_activity_connections where list_id=$2 returning id`, [SHA("a"), L.L2]))[0].id;
  assert.equal((await confirm(U.O, { p_change_id: other })).error?.code, "42501");
});

test("source changes: the reviewed revision must still be current unless the person confirms again knowingly", async () => {
  await sql("update public.code_activity_changes set head_sha = $1", [SHA("b")]);
  assert.equal((await confirm(U.O)).error?.code, "55000", "the pull request moved on after review");
  assert.equal(await things(), 0);
  const ok = await confirm(U.O, { p_acknowledge_source_change: true });
  assert.equal(ok.error, null);
  const evidence = (await sql("select evidence from public.code_activity_confirmations"))[0].evidence;
  assert.deepEqual([evidence.reviewed_sha, evidence.head_sha, evidence.source_change_acknowledged], [SHA("a"), SHA("b"), true], "both revisions are on record");
});

test("input bounds are enforced in the database", async () => {
  for (const [extra, label] of [[{ p_title: "" }, "empty title"], [{ p_title: "   " }, "blank title"], [{ p_title: "x".repeat(301) }, "title over 300"], [{ p_notes: "x".repeat(8001) }, "notes over 8000"], [{ p_importance: "urgent" }, "unknown importance"], [{ p_importance: null }, "no importance"]]) {
    assert.equal((await confirm(U.O, extra)).error?.code, "22023", label);
  }
  assert.equal((await confirm(U.O, { p_title: "x".repeat(300), p_notes: "y".repeat(8000) })).error, null, "the maxima are allowed");
  const evidence = (await sql("select octet_length(evidence::text) n from public.code_activity_confirmations"))[0].n;
  assert.ok(evidence <= 2048);
});

test("many identical retries create exactly one Thing", async () => {
  const results = await Promise.all(Array.from({ length: 6 }, () => confirm(U.O)));
  assert.ok(results.every((r) => !r.error));
  assert.equal(results.filter((r) => r.data[0].o_replayed === false).length, 1);
  assert.equal(new Set(results.map((r) => r.data[0].o_thing_id)).size, 1);
  assert.equal(await things(), 1);
});

// =====================================================================================================
// Regressions from the consolidated review
// =====================================================================================================

test("regression (hash): fields cannot be shifted across a separator to look identical", async () => {
  const first = await confirm(U.O, { p_title: "a|b", p_notes: "c" });
  assert.equal(first.error, null);
  const shifted = await confirm(U.O, { p_title: "a", p_notes: "b|c" });
  assert.equal(shifted.error?.code, "23505", "different content under the same key is a conflict, not a replay");
  assert.equal(await things(), 1);
  for (const extra of [{ p_title: "a|b", p_notes: "c|" }, { p_title: "a|b|", p_notes: "c" }, { p_title: "a|b", p_notes: "c", p_head_sha: SHA("b") }, { p_title: "a|b", p_notes: "c", p_ai_generated: true }]) {
    assert.equal((await confirm(U.O, extra)).error?.code, "23505", JSON.stringify(extra));
  }
  const same = await confirm(U.O, { p_title: "  a|b  ", p_notes: "c" });
  assert.deepEqual([same.data[0].o_replayed, same.data[0].o_thing_id], [true, first.data[0].o_thing_id], "surrounding whitespace in the title is not content");
});

test("regression (hash): the source-change acknowledgement is part of what was confirmed", async () => {
  const plain = await confirm(U.O);
  assert.equal(plain.error, null);
  assert.equal((await confirm(U.O, { p_acknowledge_source_change: true })).error?.code, "23505", "the same key with a different acknowledgement is a different request");
  assert.equal(await things(), 1);
  assert.equal((await confirm(U.O)).data[0].o_replayed, true);
});

test("regression (replay): a completed request still answers after the feature is switched off or the connection ends", async () => {
  const first = await confirm(U.O);
  await db.exec(`update public.code_activity_settings set value='false'::jsonb`);
  await sql("update public.code_activity_connections set status = 'disconnected'");
  const replay = await confirm(U.O);
  assert.equal(replay.error, null, "shutdown does not turn a finished request into an error");
  assert.deepEqual([replay.data[0].o_replayed, replay.data[0].o_thing_id], [true, first.data[0].o_thing_id]);
  assert.equal((await confirm(U.O, { p_title: "Changed" })).error?.code, "23505", "different content is still a conflict");
  assert.equal((await confirm(U.O, { p_idempotency_key: "a0000000-0000-0000-0000-0000000000ff" })).error?.code, "42501", "but a NEW request is refused while it is off");
  assert.equal(await things(), 1);
});

test("regression (replay): replay still needs access to the List, and returns the Thing only to someone who can see it", async () => {
  const first = await confirm(U.O);
  await sql("delete from public.list_members where profile_id = $1", [U.C]);
  assert.equal((await confirm(U.C, { p_idempotency_key: "a0000000-0000-0000-0000-0000000000c1" })).error?.code, "42501", "a removed collaborator cannot create");
  await confirm(U.O); // still fine for the owner
  await sql("insert into public.list_members values ($1,$2,'collaborator')", [L.L1, U.C]);
  const byC = await confirm(U.C, { p_assignee_actor_id: await actorOf(U.O) });
  assert.equal(byC.error, null);
  await sql("delete from public.list_members where profile_id = $1", [U.C]);
  assert.equal((await confirm(U.C, { p_assignee_actor_id: await actorOf(U.O) })).error?.code, "42501", "after losing access the same request cannot be replayed");

  // A Thing the person can no longer see is not handed back (the receipt says it was handled, nothing more).
  await sql("update public.things set list_id = null, owner_actor_id = $1, current_assignee_actor_id = $1 where id = $2", [await actorOf(U.X), first.data[0].o_thing_id]);
  const hidden = await confirm(U.O);
  assert.deepEqual([hidden.error, hidden.data[0].o_replayed, hidden.data[0].o_thing_id], [null, true, null], "replayed, but without a Thing id the caller cannot see");
});

test("regression (consent): AI-written text needs the operator flag AND the owner's consent, enforced in SQL", async () => {
  const aiKey = (n) => `a0000000-0000-0000-0000-0000000000a${n}`;
  const attempt = (n, extra = {}) => confirm(U.O, { p_idempotency_key: aiKey(n), p_ai_generated: true, ...extra });
  assert.equal((await attempt(1)).error?.code, "CA001", "flag off and no consent: refused even though the caller marked it AI-written");
  await db.exec(`insert into public.code_activity_settings values ('ai','true'::jsonb)`);
  assert.equal((await attempt(2)).error?.code, "CA001", "the flag alone is not enough");
  await db.exec(`insert into public.code_activity_consents (list_id, enabled) values ('${L.L1}', true)`);
  await db.exec(`update public.code_activity_settings set value='false'::jsonb where key='ai'`);
  assert.equal((await attempt(3)).error?.code, "CA001", "consent alone is not enough");
  assert.equal(await things(), 0, "nothing was created by any refusal");
  assert.equal((await sql("select count(*)::int c from public.code_activity_confirmations"))[0].c, 0);
  assert.equal((await confirm(U.O, { p_idempotency_key: aiKey(4), p_ai_generated: false })).error, null, "text the person wrote themselves never needs it");
  await db.exec(`update public.code_activity_settings set value='true'::jsonb where key='ai'`);
  const ok = await attempt(5);
  assert.equal(ok.error, null);
  assert.equal((await sql("select evidence->>'ai_generated' as a from public.code_activity_confirmations where idempotency_key = $1", [aiKey(5)]))[0].a, "true");
  await db.exec(`update public.code_activity_consents set enabled = false`);
  assert.equal((await attempt(5)).data[0].o_replayed, true, "withdrawing consent does not undo a Thing that was already created");
  assert.equal((await attempt(6)).error?.code, "CA001", "a new AI-written request is refused once consent is withdrawn");
});
