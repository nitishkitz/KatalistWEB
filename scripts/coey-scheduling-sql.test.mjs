import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { replayMigrations, actAs, createUser } from "./lib/supabase-replay.mjs";

const SENDER = "10000000-0000-4000-8000-000000000001";
const RAVI = "10000000-0000-4000-8000-000000000002";
const PRIYA = "10000000-0000-4000-8000-000000000003";
const STRANGER = "10000000-0000-4000-8000-000000000004";

let db;
const anchor = (iso, precision = "date") => ({ at: iso, date: iso.slice(0, 10), precision, source: "typed", accepted: true, phrase: "x" });
const create = async (key, items) => (await db.query("SELECT coey_create_things($1, $2::jsonb) AS r", [key, JSON.stringify(items)])).rows[0].r;
const schedule = async (thingId) => {
  await db.exec("RESET ROLE");
  return (await db.query("SELECT * FROM thing_schedules WHERE thing_id = $1", [thingId])).rows[0];
};
const rules = async (thingId) => {
  await db.exec("RESET ROLE");
  return (await db.query("SELECT rule_id FROM thing_transitions WHERE thing_id = $1 ORDER BY id", [thingId])).rows.map((r) => r.rule_id);
};
async function connect(a, b) {
  await actAs(db, a);
  const id = (await db.query("SELECT (send_contact_request($1)).id", [b])).rows[0].id;
  await actAs(db, b);
  await db.query("SELECT respond_contact_request($1, true)", [id]);
}

before(async () => {
  ({ db } = await replayMigrations());
  for (const [id, name] of [[SENDER, "Deva Rao"], [RAVI, "Ravi Kumar"], [PRIYA, "Priya Shah"], [STRANGER, "Suresh Babu"]]) await createUser(db, { id, name });
  await connect(SENDER, RAVI);
  await connect(SENDER, PRIYA);
});
after(async () => db?.close());

test("new accounts start with an empty Court and a default calendar", async () => {
  await actAs(db, RAVI);
  assert.equal((await db.query("SELECT count(*)::int n FROM things")).rows[0].n, 0);
  const cal = (await db.query("SELECT * FROM get_calendars($1)", [[RAVI, SENDER, STRANGER]])).rows;
  assert.deepEqual(cal.map((c) => c.profile_id).sort(), [SENDER, RAVI].sort(), "calendars of strangers are not readable");
  assert.equal(cal[0].work_end, 1110);
});

test("C3: a delegated Thing reaches the connected holder; raw text and anchors persist; rule ids logged", async () => {
  await actAs(db, SENDER);
  const r = await create("key-c3-0001", [{
    title: "Dispatch 40 bags DAP to Suryapet dealer", text_raw: "Ravi dispatch 40 bags DAP to Suryapet dealer kal urgent",
    mode: "work", holder_profile_id: RAVI, pace: "urgent", action_time: anchor("2026-10-14T13:00:00.000Z"), lane: "now", rule_id: "C3+L1",
  }]);
  const thingId = r.things[0].thing_id;
  const s = await schedule(thingId);
  assert.equal(s.holder_profile_id, RAVI);
  assert.equal(s.text_raw, "Ravi dispatch 40 bags DAP to Suryapet dealer kal urgent", "never rewritten");
  assert.equal(s.pace, "urgent");
  assert.equal(s.action_time.precision, "date");
  assert.deepEqual(await rules(thingId), ["C3+L1"]);
  await actAs(db, RAVI);
  assert.equal((await db.query("SELECT count(*)::int n FROM thing_schedules WHERE thing_id = $1", [thingId])).rows[0].n, 1, "holder sees the schedule");
});

test("idempotency: the same key returns the first result and creates nothing new", async () => {
  await actAs(db, SENDER);
  const items = [{ title: "Call CA about GST", text_raw: "Call CA about GST", mode: "work", lane: "next", rule_id: "C1+L8" }];
  const first = await create("key-idem-0001", items);
  const second = await create("key-idem-0001", items);
  assert.equal(second.replayed, true);
  assert.equal(second.things[0].thing_id, first.things[0].thing_id);
  assert.equal((await db.query("SELECT count(*)::int n FROM things WHERE title = 'Call CA about GST'")).rows[0].n, 1);
});

test("unconnected holders, chains and private waits are refused by the server", async () => {
  await actAs(db, SENDER);
  await assert.rejects(create("key-deny-0001", [{ title: "x", text_raw: "x", mode: "work", holder_profile_id: STRANGER }]), /connect with this person/);
  await assert.rejects(create("key-deny-0002", [{ title: "x", text_raw: "x", mode: "work", chain: [RAVI, STRANGER] }]), /everyone in the chain/);
  await assert.rejects(create("key-deny-0003", [{ title: "x", text_raw: "x", mode: "work", private_wait: true, tracked_profile_id: STRANGER }]), /connected person/);
  await assert.rejects(create("key-deny-0004", [{ title: "x", text_raw: "x", mode: "work", action_time: { at: "tomorrow" } }]), /invalid time/);
  await assert.rejects(db.query("INSERT INTO thing_schedules(thing_id, text_raw, mode, sender_profile_id) VALUES (gen_random_uuid(), 'x', 'work', $1)", [SENDER]), /permission denied/);
});

test("C6: a private wait is invisible to the tracked person and never makes them a holder", async () => {
  await actAs(db, SENDER);
  const r = await create("key-c6-0001", [{ title: "Ravi's stock numbers", text_raw: "Waiting for Ravi's stock numbers", mode: "work", private_wait: true, tracked_profile_id: RAVI, holder_profile_id: RAVI, rule_id: "C6+L7" }]);
  const thingId = r.things[0].thing_id;
  assert.equal((await schedule(thingId)).holder_profile_id, SENDER);
  await actAs(db, RAVI);
  assert.equal((await db.query("SELECT count(*)::int n FROM things WHERE id = $1", [thingId])).rows[0].n, 0);
  assert.equal((await db.query("SELECT count(*)::int n FROM thing_schedules WHERE thing_id = $1", [thingId])).rows[0].n, 0);
  assert.equal((await db.query("SELECT count(*)::int n FROM notifications WHERE thing_id = $1", [thingId])).rows[0].n, 0, "no notification");
});

test("C10: an unresolved person stays in the sender's Inbox; resolving it delegates normally", async () => {
  await actAs(db, SENDER);
  const r = await create("key-c10-0001", [{ title: "Send the price list", text_raw: "Ravi send the price list", mode: "work", inbox_reason: "unresolved_person", holder_profile_id: RAVI, lane: "none", rule_id: "C10+L0" }]);
  const thingId = r.things[0].thing_id;
  let s = await schedule(thingId);
  assert.equal(s.holder_profile_id, SENDER, "never guessed onto Ravi");
  assert.equal(s.inbox_reason, "unresolved_person");
  await actAs(db, SENDER);
  await db.query("SELECT coey_resolve_holder($1, $2)", [thingId, PRIYA]);
  s = await schedule(thingId);
  assert.equal(s.holder_profile_id, PRIYA);
  assert.equal(s.inbox_reason, null);
  assert.ok((await rules(thingId)).includes("C16"));
});

test("C8: a group shares one group id; each person gets their own Thing", async () => {
  await actAs(db, SENDER);
  const r = await create("key-c8-0001", [
    { title: "Submit expense claims", text_raw: "Ravi and Priya submit expense claims by Friday", mode: "work", holder_profile_id: RAVI, group: "g", rule_id: "C8+L4" },
    { title: "Submit expense claims", text_raw: "Ravi and Priya submit expense claims by Friday", mode: "work", holder_profile_id: PRIYA, group: "g", rule_id: "C8+L4" },
  ]);
  assert.equal(r.things[0].group_id, r.things[1].group_id);
  assert.ok(r.things[0].group_id);
});

test("lifecycle: catch (M2), promise (M3), third-party blocker (C15) and unblock (M11), sort (M15)", async () => {
  await actAs(db, SENDER);
  const thingId = (await create("key-life-0001", [{ title: "Dispatch", text_raw: "Ravi dispatch", mode: "work", holder_profile_id: RAVI, pace: "normal" }])).things[0].thing_id;
  await actAs(db, SENDER);
  await assert.rejects(db.query("SELECT coey_promise($1, now() + interval '2 days')", [thingId]), /only the person holding/, "the sender cannot set the holder's promise");
  await actAs(db, RAVI);
  await db.query("SELECT catch_thing($1, 'next')", [thingId]);
  assert.equal((await schedule(thingId)).state, "caught");
  await actAs(db, RAVI);
  await db.query("SELECT coey_promise($1, now() + interval '2 days')", [thingId]);
  assert.equal((await schedule(thingId)).state, "promised");
  await actAs(db, RAVI);
  await db.query("SELECT coey_flag_blocker($1, 'third_party', 'waiting on transporter')", [thingId]);
  let s = await schedule(thingId);
  assert.equal(s.state, "blocked");
  assert.equal(s.holder_profile_id, RAVI);
  await actAs(db, RAVI);
  await db.query("SELECT coey_unblock($1)", [thingId]);
  assert.equal((await schedule(thingId)).state, "promised");
  await actAs(db, RAVI);
  await db.query("SELECT sort_thing($1)", [thingId]);
  assert.equal((await schedule(thingId)).state, "sorted");
  assert.deepEqual(await rules(thingId), ["C1", "M2", "M3", "C15", "M11", "M15"]);
});

test("C12/C13 serve back and C14 wrong person return the ball to the sender", async () => {
  await actAs(db, SENDER);
  const [a, b] = (await create("key-back-0001", [
    { title: "Price list", text_raw: "Ravi price list", mode: "work", holder_profile_id: RAVI },
    { title: "GST file", text_raw: "Ravi GST file", mode: "work", holder_profile_id: RAVI },
  ])).things.map((t) => t.thing_id);
  await actAs(db, RAVI);
  await db.query("SELECT coey_serve_back($1, 'Which dealer?')", [a]);
  let s = await schedule(a);
  assert.equal(s.state, "with_sender");
  assert.equal(s.holder_profile_id, SENDER);
  await actAs(db, SENDER);
  await db.query("SELECT coey_unblock($1)", [a]);
  assert.equal((await schedule(a)).holder_profile_id, RAVI, "answered: back to Ravi");
  await actAs(db, RAVI);
  await db.query("SELECT coey_wrong_person($1)", [b]);
  s = await schedule(b);
  assert.equal(s.inbox_reason, "wrong_person");
  assert.equal(s.holder_profile_id, SENDER);
});

test("M9: only the sender changes pace; holder comments reset the clock, sender comments do not (D17)", async () => {
  await actAs(db, SENDER);
  const thingId = (await create("key-m9-0001", [{ title: "Deck", text_raw: "Ravi deck", mode: "work", holder_profile_id: RAVI, pace: "normal" }])).things[0].thing_id;
  await actAs(db, RAVI);
  await assert.rejects(db.query("SELECT coey_set_pace($1, 'chill')", [thingId]), /only the sender/);
  await actAs(db, SENDER);
  await db.query("SELECT coey_set_pace($1, 'urgent')", [thingId]);
  assert.equal((await schedule(thingId)).pace, "urgent");
  await db.exec("RESET ROLE");
  await db.query("UPDATE thing_schedules SET last_activity_at = now() - interval '3 days' WHERE thing_id = $1", [thingId]);
  const actor = async (p) => (await db.query("SELECT id FROM actors WHERE profile_id = $1", [p])).rows[0].id;
  await db.query("INSERT INTO thing_comments(thing_id, author_actor_id, body) VALUES ($1, $2, 'any update?')", [thingId, await actor(SENDER)]);
  assert.ok(new Date((await schedule(thingId)).last_activity_at) < new Date(Date.now() - 2 * 86400000), "sender comment is not holder activity");
  await db.query("INSERT INTO thing_comments(thing_id, author_actor_id, body) VALUES ($1, $2, 'on it')", [thingId, await actor(RAVI)]);
  assert.ok(new Date((await schedule(thingId)).last_activity_at) > new Date(Date.now() - 60000));
});

test("disconnecting stops new delegation but keeps existing Things and history", async () => {
  await actAs(db, SENDER);
  const thingId = (await create("key-disc-0001", [{ title: "Keep me", text_raw: "Priya keep me", mode: "work", holder_profile_id: PRIYA }])).things[0].thing_id;
  await actAs(db, SENDER);
  await db.query("SELECT disconnect_contact($1)", [PRIYA]);
  await assert.rejects(create("key-disc-0002", [{ title: "New", text_raw: "Priya new", mode: "work", holder_profile_id: PRIYA }]), /connect with this person/);
  await actAs(db, PRIYA);
  assert.equal((await db.query("SELECT count(*)::int n FROM things WHERE id = $1", [thingId])).rows[0].n, 1, "history is not deleted");
});

test("C9 relay: when the first person sorts their step, the next step goes to the next person, once", async () => {
  await connect(SENDER, PRIYA); // an earlier test disconnected them; a chain needs everyone connected
  await actAs(db, SENDER);
  const r = await create("key-chain-0001", [{ title: "Approve scheme", text_raw: "Ask Ravi to get Priya to approve", mode: "work", chain: [RAVI, PRIYA], rule_id: "C9+L7" }]);
  const first = r.things[0].thing_id;
  assert.equal((await schedule(first)).holder_profile_id, RAVI);
  await actAs(db, RAVI);
  await db.query("SELECT catch_thing($1, 'next')", [first]);
  await db.query("SELECT sort_thing($1)", [first]);
  await db.exec("RESET ROLE");
  const next = (await db.query("SELECT * FROM thing_schedules WHERE chain_step_of = $1", [first])).rows;
  assert.equal(next.length, 1);
  assert.equal(next[0].holder_profile_id, PRIYA);
  assert.equal(next[0].sender_profile_id, SENDER);
  assert.equal(next[0].chain_index, 1);
  await actAs(db, PRIYA);
  assert.equal((await db.query("SELECT count(*)::int n FROM things WHERE id = $1", [next[0].thing_id])).rows[0].n, 1, "Priya now sees her step");
  await actAs(db, PRIYA);
  await db.query("SELECT catch_thing($1, 'next')", [next[0].thing_id]);
  await db.query("SELECT sort_thing($1)", [next[0].thing_id]);
  await db.exec("RESET ROLE");
  assert.equal((await db.query("SELECT count(*)::int n FROM thing_schedules WHERE chain_step_of = $1", [next[0].thing_id])).rows[0].n, 0, "the last step ends the relay");
});
