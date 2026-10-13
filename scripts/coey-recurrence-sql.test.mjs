import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { replayMigrations, actAs, createUser } from "./lib/supabase-replay.mjs";

const SENDER = "30000000-0000-4000-8000-000000000001";
const RAVI = "30000000-0000-4000-8000-000000000002";
let db;

before(async () => {
  ({ db } = await replayMigrations());
  await createUser(db, { id: SENDER, name: "Deva Rao" });
  await createUser(db, { id: RAVI, name: "Ravi Kumar" });
  await actAs(db, SENDER);
  const id = (await db.query("SELECT (send_contact_request($1)).id", [RAVI])).rows[0].id;
  await actAs(db, RAVI);
  await db.query("SELECT respond_contact_request($1, true)", [id]);
});
after(async () => db?.close());

const nextDate = async (rec, after) => {
  await db.exec("RESET ROLE");
  return (await db.query("SELECT katalist_priv.next_occurrence_date($1::jsonb, $2::date)::text d", [JSON.stringify(rec), after])).rows[0].d;
};

test("next occurrence dates: weekly weekdays, daily, monthly with short-month clamp", async () => {
  assert.equal(await nextDate({ freq: "weekly", weekdays: ["mon"] }, "2026-10-12"), "2026-10-19");
  assert.equal(await nextDate({ freq: "weekly", weekdays: ["mon", "thu"] }, "2026-10-12"), "2026-10-15");
  assert.equal(await nextDate({ freq: "daily", weekdays: [] }, "2026-10-12"), "2026-10-13");
  assert.equal(await nextDate({ freq: "monthly", weekdays: [], monthDay: 31 }, "2026-01-31"), "2026-02-28");
});

test("sorting an occurrence creates the next one once, for the same holder, with the raw text kept", async () => {
  await actAs(db, SENDER);
  const items = [{ title: "Send invoice", text_raw: "Ravi every Monday send invoice", mode: "work", holder_profile_id: RAVI,
    recurrence: { freq: "weekly", weekdays: ["mon"], monthDay: null, phrase: "every Monday" },
    action_time: { at: "2026-10-19T13:00:00.000Z", date: "2026-10-19", precision: "date", source: "typed", accepted: true, phrase: "every Monday" } }];
  const first = (await db.query("SELECT coey_create_things('rec-key-0001', $1::jsonb) r", [JSON.stringify(items)])).rows[0].r.things[0].thing_id;
  await actAs(db, RAVI);
  await db.query("SELECT catch_thing($1, 'next')", [first]);
  await db.query("SELECT sort_thing($1)", [first]);
  await db.exec("RESET ROLE");
  const next = (await db.query("SELECT s.*, t.owner_actor_id, t.current_assignee_actor_id, t.title FROM thing_schedules s JOIN things t ON t.id = s.thing_id WHERE s.occurrence_of = $1", [first])).rows;
  assert.equal(next.length, 1);
  assert.equal(next[0].holder_profile_id, RAVI);
  assert.equal(next[0].sender_profile_id, SENDER);
  assert.equal(next[0].text_raw, "Ravi every Monday send invoice");
  assert.equal(next[0].action_time.date, "2026-10-26");
  assert.equal(next[0].lane_rule, "L11");
  const owner = (await db.query("SELECT profile_id FROM actors WHERE id = $1", [next[0].owner_actor_id])).rows[0].profile_id;
  assert.equal(owner, SENDER, "the series stays the sender's");
  await actAs(db, SENDER);
  await db.query("SELECT reopen_thing($1)", [first]).catch(() => undefined);
  await db.exec("RESET ROLE");
  assert.equal((await db.query("SELECT count(*)::int n FROM thing_schedules WHERE occurrence_of = $1", [first])).rows[0].n, 1, "never duplicated");
});

test("after a disconnect, Sort still works and the series stops quietly", async () => {
  await actAs(db, SENDER);
  const items = [{ title: "Daily check", text_raw: "Ravi daily check stock", mode: "work", holder_profile_id: RAVI,
    recurrence: { freq: "daily", weekdays: [], monthDay: null, phrase: "daily" } }];
  const thing = (await db.query("SELECT coey_create_things('rec-key-0002', $1::jsonb) r", [JSON.stringify(items)])).rows[0].r.things[0].thing_id;
  await actAs(db, RAVI);
  await db.query("SELECT catch_thing($1, 'next')", [thing]);
  await actAs(db, SENDER);
  await db.query("SELECT disconnect_contact($1)", [RAVI]);
  await actAs(db, RAVI);
  await db.query("SELECT sort_thing($1)", [thing]);
  await db.exec("RESET ROLE");
  assert.equal((await db.query("SELECT state FROM thing_schedules WHERE thing_id = $1", [thing])).rows[0].state, "sorted");
  assert.equal((await db.query("SELECT count(*)::int n FROM thing_schedules WHERE occurrence_of = $1", [thing])).rows[0].n, 0);
});
