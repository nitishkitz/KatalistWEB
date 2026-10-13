// Regressions for the re-review of 6437276e: call rings after a block, and calendar changes
// between planning and delivering a follow-up.
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { replayMigrations, actAs, createUser } from "./lib/supabase-replay.mjs";
import { defaultCalendar, localParts, addDays } from "../src/domain/coey/calendar.ts";
import { planFollowUps } from "../src/domain/coey/followup.ts";

const A = "91000000-0000-4000-8000-000000000001", B = "91000000-0000-4000-8000-000000000002", C = "91000000-0000-4000-8000-000000000003";
const ALL_DAY = { work_days: [0, 1, 2, 3, 4, 5, 6], work_start: 0, work_end: 1440, home_start: 0, home_end: 1440 };
let db;
async function connect(x, y) {
  await actAs(db, x);
  const id = (await db.query("SELECT (send_contact_request($1)).id", [y])).rows[0].id;
  await actAs(db, y);
  await db.query("SELECT respond_contact_request($1, true)", [id]);
}
const rpc = async (sql, args) => (await db.query(sql, args)).rows[0];

before(async () => {
  ({ db } = await replayMigrations());
  for (const [id, name] of [[A, "Calendar Sender"], [B, "Calendar Holder"], [C, "Third Person"]]) await createUser(db, { id, name });
  await connect(A, B);
  await connect(A, C);
  await connect(B, C);
  await actAs(db, B);
  await db.query("SELECT set_my_calendar($1::jsonb)", [JSON.stringify(ALL_DAY)]);
});
after(async () => db?.close());

test("calendar race: leave added after planning invalidates the old plan; the replanned one is empty", async () => {
  await actAs(db, A);
  const id = (await rpc("SELECT coey_create_things($1, $2::jsonb) r", ["calendar-review", JSON.stringify([{ title: "Calendar race", text_raw: "Calendar race", mode: "work", holder_profile_id: B, pace: "normal" }])])).r.things[0].thing_id;
  await db.exec("RESET ROLE");
  await db.query("UPDATE thing_schedules SET last_activity_at = now() - interval '30 days' WHERE thing_id = $1", [id]);
  const row = await rpc("SELECT s.*, c.revision AS cal_revision, now() AS clock FROM thing_schedules s, profile_calendars c WHERE s.thing_id = $1 AND c.profile_id = $2", [id, B]);
  const cal = { ...defaultCalendar("Asia/Kolkata"), workDays: ALL_DAY.work_days, workStart: 0, workEnd: 1440 };
  const now = Date.parse(row.clock), today = localParts(now, cal.timezone).date;
  const schedule = { thingId: id, senderProfileId: A, holderProfileId: B, state: row.state, inboxReason: null, privateWait: false, mode: "work", pace: "normal", promiseAt: null, snoozeUntil: null, lastActivityAt: Date.parse(row.last_activity_at), nudgeCountCycle: 0, revision: row.revision };
  const plan = planFollowUps([{ schedule, holderCal: cal }], now);
  assert.equal(plan.due.length, 1);
  const payload = plan.due.map((p) => ({ thing_id: p.thingId, step: p.step, kind: p.kind, revision: p.revision, calendar_revision: row.cal_revision }));

  await actAs(db, B);
  await db.query("SELECT set_my_calendar($1::jsonb)", [JSON.stringify({ ...ALL_DAY, leave: [{ start: today, end: addDays(today, 20) }] })]);
  await actAs(db, null, "service_role");
  const result = (await rpc("SELECT coey_apply_followups($1, $2::date, $3::jsonb, 3) r", [B, today, JSON.stringify(payload)])).r;
  assert.equal(result.delivered, 0, "the plan named the old calendar");
  const fresh = (await rpc("SELECT revision FROM profile_calendars WHERE profile_id = $1", [B])).revision;
  const recheck = (await rpc("SELECT coey_apply_followups($1, $2::date, $3::jsonb, 3) r", [B, today, JSON.stringify(payload.map((p) => ({ ...p, calendar_revision: fresh })))])).r;
  assert.equal(recheck.delivered, 0, "even with the new calendar revision, delivery re-checks the holder is on leave");
  assert.equal(planFollowUps([{ schedule, holderCal: { ...cal, leave: [{ start: today, end: addDays(today, 20) }] } }], now).due.length, 0);

  // Back from leave: the same plan with the current calendar revision delivers.
  await actAs(db, B);
  await db.query("SELECT set_my_calendar($1::jsonb)", [JSON.stringify(ALL_DAY)]);
  await actAs(db, null, "service_role");
  const back = (await rpc("SELECT revision FROM profile_calendars WHERE profile_id = $1", [B])).revision;
  assert.equal((await rpc("SELECT coey_apply_followups($1, $2::date, $3::jsonb, 3) r", [B, today, JSON.stringify(payload.map((p) => ({ ...p, calendar_revision: back })))])).r.delivered, 1);
});

test("a timezone change is a calendar change", async () => {
  await db.exec("RESET ROLE");
  const before = (await rpc("SELECT revision FROM profile_calendars WHERE profile_id = $1", [B])).revision;
  await db.query("UPDATE profiles SET timezone = 'Europe/London' WHERE id = $1", [B]);
  assert.equal((await rpc("SELECT revision FROM profile_calendars WHERE profile_id = $1", [B])).revision, before + 1);
  await db.query("UPDATE profiles SET timezone = 'Asia/Kolkata' WHERE id = $1", [B]);
});

test("delivery re-checks working time at the moment of delivery (no calendar edit needed)", async () => {
  await db.exec("RESET ROLE");
  assert.equal((await rpc("SELECT katalist_priv.in_holder_window($1, 'work', now()) ok", [B])).ok, true);
  // A holder with a 09:00–18:30 window is outside it at 03:00 local time.
  assert.equal((await rpc("SELECT katalist_priv.in_holder_window($1, 'work', '2026-10-14T03:00:00+05:30'::timestamptz) ok", [C])).ok, false);
  assert.equal((await rpc("SELECT katalist_priv.in_holder_window($1, 'work', '2026-10-14T10:00:00+05:30'::timestamptz) ok", [C])).ok, true);
  assert.equal((await rpc("SELECT katalist_priv.in_holder_window($1, 'work', '2026-10-11T10:00:00+05:30'::timestamptz) ok", [C])).ok, false, "Sunday");
});

test("calls: a blocked person is never rung (push recipients or the in-app receiver); DMs need a connection", async () => {
  await actAs(db, A);
  const dm = (await rpc("SELECT (get_or_create_dm($1, 'work')).id", [B])).id;
  const group = (await rpc("SELECT (create_group('Review group', $1, 'work')).id", [[B, C]])).id;
  await actAs(db, null, "service_role");
  assert.deepEqual((await rpc("SELECT call_ring_recipients($1, $2, $3) r", [group, A, [B, C]])).r.sort(), [B, C].sort());
  await actAs(db, B);
  assert.equal((await rpc("SELECT can_receive_call($1, $2) ok", [dm, A])).ok, true);

  await actAs(db, A);
  await db.query("SELECT block_contact($1)", [B]);
  await actAs(db, null, "service_role");
  assert.deepEqual((await rpc("SELECT call_ring_recipients($1, $2, $3) r", [dm, A, [B]])).r, []);
  assert.deepEqual((await rpc("SELECT call_ring_recipients($1, $2, $3) r", [dm, B, [A]])).r, [], "either direction");
  assert.deepEqual((await rpc("SELECT call_ring_recipients($1, $2, $3) r", [group, A, [B, C]])).r, [C], "the group still rings everyone else");
  await actAs(db, B);
  assert.equal((await rpc("SELECT can_receive_call($1, $2) ok", [dm, A])).ok, false);
  assert.equal((await rpc("SELECT can_receive_call($1, $2) ok", [group, A])).ok, false);
  await actAs(db, C);
  assert.equal((await rpc("SELECT can_receive_call($1, $2) ok", [group, A])).ok, true);
  assert.equal((await rpc("SELECT can_receive_call($1, $2) ok", [dm, A])).ok, false, "not a member of that DM");
  await actAs(db, B);
  await assert.rejects(db.query("SELECT call_ring_recipients($1, $2, $3)", [dm, B, [A]]), /permission denied/);
});
