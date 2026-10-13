import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { replayMigrations, actAs, createUser } from "./lib/supabase-replay.mjs";

const SENDER = "20000000-0000-4000-8000-000000000001";
const RAVI = "20000000-0000-4000-8000-000000000002";
const PRIYA = "20000000-0000-4000-8000-000000000003";
let db;

async function connect(a, b) {
  await actAs(db, a);
  const id = (await db.query("SELECT (send_contact_request($1)).id", [b])).rows[0].id;
  await actAs(db, b);
  await db.query("SELECT respond_contact_request($1, true)", [id]);
}
async function send(from, key, holder, title) {
  await actAs(db, from);
  const r = await db.query("SELECT coey_create_things($1, $2::jsonb) r", [key, JSON.stringify([{ title, text_raw: title, mode: "work", holder_profile_id: holder, pace: "normal" }])]);
  return r.rows[0].r.things[0].thing_id;
}
// A fresh plan names the schedule revision it was made against, as the job does.
const apply = async (holder, items, date = "2026-10-13", budget = 3) => {
  await db.exec("RESET ROLE");
  for (const item of items) {
    if (item.revision === undefined) item.revision = (await db.query("SELECT revision FROM thing_schedules WHERE thing_id = $1", [item.thing_id])).rows[0]?.revision ?? 0;
    if (item.calendar_revision === undefined) item.calendar_revision = (await db.query("SELECT revision FROM profile_calendars WHERE profile_id = $1", [holder])).rows[0]?.revision ?? 0;
  }
  await actAs(db, null, "service_role");
  return (await db.query("SELECT coey_apply_followups($1, $2::date, $3::jsonb, $4) r", [holder, date, JSON.stringify(items), budget])).rows[0].r;
};
const notifications = async (profile) => {
  await db.exec("RESET ROLE");
  return (await db.query("SELECT kind, title, body, payload FROM notifications WHERE profile_id = $1 AND kind = 'coey_nudge' ORDER BY created_at", [profile])).rows;
};

before(async () => {
  ({ db } = await replayMigrations());
  for (const [id, name] of [[SENDER, "Deva Rao"], [RAVI, "Ravi Kumar"], [PRIYA, "Priya Shah"]]) await createUser(db, { id, name });
  await connect(SENDER, RAVI);
  await connect(PRIYA, RAVI);
  // Ravi works every hour of every day, so these tests do not depend on the wall clock.
  await actAs(db, RAVI);
  await db.query("SELECT set_my_calendar($1::jsonb)", [JSON.stringify({ work_days: [0, 1, 2, 3, 4, 5, 6], work_start: 0, work_end: 1440, home_start: 0, home_end: 1440 })]);
});
after(async () => db?.close());

test("step 1 is in-app only: the Thing records the nudge, no notification row (so no push)", async () => {
  const t = await send(SENDER, "fu-key-0001", RAVI, "Dispatch DAP");
  const r = await apply(RAVI, [{ thing_id: t, step: 1, kind: "cadence" }]);
  assert.equal(r.delivered, 1);
  assert.equal(r.pushed, 0);
  assert.equal((await notifications(RAVI)).length, 0);
  await db.exec("RESET ROLE");
  assert.equal((await db.query("SELECT nudge_count_cycle FROM thing_schedules WHERE thing_id = $1", [t])).rows[0].nudge_count_cycle, 1);
  const again = await apply(RAVI, [{ thing_id: t, step: 1, kind: "cadence" }]);
  assert.equal(again.delivered, 0, "repeating the same step changes nothing");
});

test("step 2 batches one message per holder with neutral copy, never blame", async () => {
  const a = await send(SENDER, "fu-key-0002", RAVI, "Price list");
  const b = await send(PRIYA, "fu-key-0003", RAVI, "GST file");
  await apply(RAVI, [{ thing_id: a, step: 1 }, { thing_id: b, step: 1 }], "2026-10-14");
  const r = await apply(RAVI, [{ thing_id: a, step: 2 }, { thing_id: b, step: 2 }], "2026-10-14");
  assert.equal(r.pushed, 2);
  const [n] = await notifications(RAVI);
  assert.equal(n.title, "2 Things from 2 people");
  assert.match(n.body, /in your court/);
  assert.doesNotMatch(`${n.title} ${n.body}`, /overdue|still no|hasn't|cold|escalat/i);
  assert.deepEqual(n.payload.thing_ids.sort(), [a, b].sort());
});

test("the daily budget defers rather than drops; sorted, blocked and disconnected Things are skipped at delivery", async () => {
  const t = await send(SENDER, "fu-key-0004", RAVI, "Budget test");
  const full = await apply(RAVI, [{ thing_id: t, step: 1 }], "2026-10-15", 0);
  assert.equal(full.deferred, true);
  await db.exec("RESET ROLE");
  assert.equal((await db.query("SELECT nudge_count_cycle FROM thing_schedules WHERE thing_id = $1", [t])).rows[0].nudge_count_cycle, 0, "nothing consumed while deferred");

  const sorted = await send(SENDER, "fu-key-0005", RAVI, "Sorted one");
  await actAs(db, RAVI);
  await db.query("SELECT catch_thing($1, 'next')", [sorted]);
  await db.query("SELECT sort_thing($1)", [sorted]);
  const blocked = await send(SENDER, "fu-key-0006", RAVI, "Blocked one");
  await actAs(db, RAVI);
  await db.query("SELECT coey_flag_blocker($1, 'third_party', 'transporter')", [blocked]);
  const r = await apply(RAVI, [{ thing_id: sorted, step: 1 }, { thing_id: blocked, step: 1 }], "2026-10-16");
  assert.equal(r.delivered, 0);
  assert.equal(r.skipped.length, 2);

  const cut = await send(PRIYA, "fu-key-0007", RAVI, "After disconnect");
  await actAs(db, PRIYA);
  await db.query("SELECT disconnect_contact($1)", [RAVI]);
  assert.equal((await apply(RAVI, [{ thing_id: cut, step: 1 }], "2026-10-17")).delivered, 0, "no nudges after disconnect");
});

test("only the server can deliver follow-ups, and the old elapsed-hours escalation is retired", async () => {
  await actAs(db, SENDER);
  await assert.rejects(db.query("SELECT coey_apply_followups($1, '2026-10-13', '[]'::jsonb, 3)", [RAVI]), /permission denied/);
  await actAs(db, null, "service_role");
  assert.equal((await db.query("SELECT run_nudge_escalation() n")).rows[0].n, 0);
});
