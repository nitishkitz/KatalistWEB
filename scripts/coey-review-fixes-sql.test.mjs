// Regressions for the independent review (output/coey-code-review/review.md), findings 1, 2, 3 and 5.
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { replayMigrations, actAs, createUser } from "./lib/supabase-replay.mjs";

const A = "90000000-0000-4000-8000-000000000001", B = "90000000-0000-4000-8000-000000000002";
let db, a;
const capture = async (key, extra = {}) =>
  (await db.query("SELECT coey_create_things($1, $2::jsonb) r", [key, JSON.stringify([{ title: key, text_raw: key, mode: "work", ...extra }])])).rows[0].r.things[0].thing_id;

before(async () => {
  ({ db } = await replayMigrations());
  a = await createUser(db, { id: A, name: "Review Sender" });
  await createUser(db, { id: B, name: "Review Holder" });
  await actAs(db, A);
  const req = (await db.query("SELECT (send_contact_request($1)).id", [B])).rows[0].id;
  await actAs(db, B);
  await db.query("SELECT respond_contact_request($1, true)", [req]);
});
after(async () => db?.close());

test("1: a private capture created inside a shared List is not readable by other List members, and cannot be moved back in", async () => {
  await actAs(db, A);
  const list = (await db.query("SELECT (create_list('Shared review list', 'work')).id")).rows[0].id;
  await db.exec("RESET ROLE");
  await db.query("INSERT INTO list_members(list_id, profile_id, role, added_by_profile_id) VALUES ($1, $2, 'collaborator', $3)", [list, B, A]);
  await actAs(db, A);
  const id = await capture("private-capture-review", { inbox_reason: "unresolved_capture", lane: "none", list_id: list });
  await actAs(db, B);
  assert.deepEqual((await db.query("SELECT title FROM things WHERE id = $1", [id])).rows, []);
  await actAs(db, A);
  assert.equal((await db.query("SELECT list_id FROM things WHERE id = $1", [id])).rows[0].list_id, null);
  await db.exec("RESET ROLE");
  await assert.rejects(db.query("UPDATE things SET list_id = $1 WHERE id = $2", [list, id]), /private Thing cannot be moved|moving a Thing between Lists is not supported/);
});

test("3: after 'wrong person', Keep it for me makes the sender the real assignee, who can Catch and Sort", async () => {
  await actAs(db, A);
  const id = await capture("wrong-person-review", { holder_profile_id: B });
  await actAs(db, B);
  await db.query("SELECT coey_wrong_person($1)", [id]);
  await actAs(db, B);
  assert.deepEqual((await db.query("SELECT id FROM things WHERE id = $1 AND current_assignee_actor_id = (SELECT id FROM actors WHERE profile_id = $2)", [id, B])).rows, [], "B no longer holds it");
  await actAs(db, A);
  await db.query("SELECT coey_resolve_holder($1, $2)", [id, A]);
  await db.query("SELECT catch_thing($1, 'next')", [id]);
  await db.query("SELECT sort_thing($1)", [id]);
  await db.exec("RESET ROLE");
  const row = (await db.query("SELECT t.current_assignee_actor_id, s.holder_profile_id, s.state FROM things t JOIN thing_schedules s ON s.thing_id = t.id WHERE t.id = $1", [id])).rows[0];
  assert.equal(row.current_assignee_actor_id, a.actorId);
  assert.equal(row.holder_profile_id, A);
  assert.equal(row.state, "sorted");
});

test("5: a plan made before a new promise is rejected; a replayed plan is rejected", async () => {
  await actAs(db, A);
  const id = await capture("promise-race-review", { holder_profile_id: B, pace: "normal" });
  await db.exec("RESET ROLE");
  const planned = (await db.query("SELECT revision FROM thing_schedules WHERE thing_id = $1", [id])).rows[0].revision;
  await actAs(db, B);
  await db.query("SELECT coey_promise($1, now() + interval '10 days')", [id]);
  await actAs(db, null, "service_role");
  const stale = (await db.query("SELECT coey_apply_followups($1, current_date, $2::jsonb, 3) r", [B, JSON.stringify([{ thing_id: id, step: 1, kind: "cadence", revision: planned }])])).rows[0].r;
  assert.equal(stale.delivered, 0);
  await db.exec("RESET ROLE");
  const current = (await db.query("SELECT revision FROM thing_schedules WHERE thing_id = $1", [id])).rows[0].revision;
  await actAs(db, null, "service_role");
  const wrongKind = (await db.query("SELECT coey_apply_followups($1, current_date, $2::jsonb, 3) r", [B, JSON.stringify([{ thing_id: id, step: 1, kind: "cadence", revision: current }])])).rows[0].r;
  assert.equal(wrongKind.delivered, 0, "a cadence nudge never goes out once a promise exists");
  const ok = (await db.query("SELECT coey_apply_followups($1, current_date, $2::jsonb, 3) r", [B, JSON.stringify([{ thing_id: id, step: 1, kind: "promise_soon", revision: current }])])).rows[0].r;
  assert.equal(ok.delivered, 1);
  const replay = (await db.query("SELECT coey_apply_followups($1, current_date, $2::jsonb, 3) r", [B, JSON.stringify([{ thing_id: id, step: 1, kind: "promise_soon", revision: current }])])).rows[0].r;
  assert.equal(replay.delivered, 0);
  const missing = (await db.query("SELECT coey_apply_followups($1, current_date, $2::jsonb, 3) r", [B, JSON.stringify([{ thing_id: id, step: 2, kind: "promise_due" }])])).rows[0].r;
  assert.equal(missing.delivered, 0, "a plan without a revision is never trusted");
});

test("2: after a block, neither person can post new DM messages; history stays readable", async () => {
  await actAs(db, A);
  const dm = (await db.query("SELECT (get_or_create_dm($1, 'work')).id", [B])).rows[0].id;
  await db.query("INSERT INTO list_messages(list_id, author_profile_id, body) VALUES ($1, $2, 'before block')", [dm, A]);
  await db.query("SELECT block_contact($1)", [B]);
  await actAs(db, B);
  await assert.rejects(db.query("INSERT INTO list_messages(list_id, author_profile_id, body) VALUES ($1, $2, 'after block')", [dm, B]), /once you are connected/);
  await actAs(db, A);
  await assert.rejects(db.query("INSERT INTO list_messages(list_id, author_profile_id, body) VALUES ($1, $2, 'after block')", [dm, A]), /once you are connected/);
  assert.equal((await db.query("SELECT count(*)::int n FROM list_messages WHERE list_id = $1", [dm])).rows[0].n, 1);
});
