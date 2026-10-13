// Calls: the caller is the session; impersonation and blocked pairs are refused in the database.
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { replayMigrations, actAs, createUser } from "./lib/supabase-replay.mjs";

const A = "92000000-0000-4000-8000-00000000000a", B = "92000000-0000-4000-8000-00000000000b", C = "92000000-0000-4000-8000-00000000000c", X = "92000000-0000-4000-8000-0000000000ff";
let db, group, dm;
async function connect(x, y) {
  await actAs(db, x);
  const id = (await db.query("SELECT (send_contact_request($1)).id", [y])).rows[0].id;
  await actAs(db, y);
  await db.query("SELECT respond_contact_request($1, true)", [id]);
}
const one = async (sql, args) => (await db.query(sql, args)).rows[0];
const signal = (from, to, extra = {}) => db.query(
  "INSERT INTO call_signals (list_id, from_profile, from_session, to_profile, kind, payload) VALUES ($1, $2, 's1', $3, 'sdp', '{}')",
  [extra.list ?? group, from, to]);

before(async () => {
  ({ db } = await replayMigrations());
  for (const [id, name] of [[A, "Asha"], [B, "Bala"], [C, "Chitra"], [X, "Stranger"]]) await createUser(db, { id, name });
  await connect(A, B); await connect(A, C); await connect(B, C);
  await actAs(db, A);
  group = (await one("SELECT (create_group('Calls', $1, 'work')).id", [[B, C]])).id;
  dm = (await one("SELECT (get_or_create_dm($1, 'work')).id", [B])).id;
});
after(async () => db?.close());

test("a ring's caller is the session; recipients see only their own rings; outsiders cannot ring", async () => {
  await actAs(db, A);
  assert.deepEqual((await one("SELECT ring_call($1, $2, 'video') r", [group, [B, C, X]])).r.sort(), [B, C].sort());
  await actAs(db, B);
  const rows = (await db.query("SELECT caller_profile_id, recipient_profile_id, caller_name FROM call_rings")).rows;
  assert.deepEqual(rows, [{ caller_profile_id: A, recipient_profile_id: B, caller_name: "Asha" }], "B sees only the ring addressed to B, from the real caller");
  await assert.rejects(db.query("INSERT INTO call_rings (list_id, caller_profile_id, recipient_profile_id, caller_name, list_name, list_kind) VALUES ($1, $2, $3, 'Asha', 'x', 'group')", [group, A, C]), /permission denied/, "rings cannot be forged");
  await actAs(db, X);
  await assert.rejects(db.query("SELECT ring_call($1, $2)", [group, [A]]), /conversation not found/);
});

test("signals are stamped with the real sender; a member cannot speak as another member", async () => {
  await actAs(db, B);
  await signal(B, A);
  await assert.rejects(signal(C, A), /row-level security/, "B claiming to be C is refused");
  await actAs(db, A);
  assert.deepEqual((await db.query("SELECT from_profile FROM call_signals")).rows, [{ from_profile: B }]);
  await actAs(db, C);
  assert.equal((await db.query("SELECT count(*)::int n FROM call_signals")).rows[0].n, 0, "C cannot read signals addressed to A");
  await actAs(db, X);
  await assert.rejects(signal(X, A), /row-level security/, "outsiders cannot signal into the conversation");
});

test("after A blocks B: no ring or signal between them in either direction, the live call is hung up, C is still callable", async () => {
  await actAs(db, A);
  await db.query("SELECT block_contact($1)", [B]);
  assert.deepEqual((await one("SELECT ring_call($1, $2) r", [group, [B, C]])).r, [C]);
  await actAs(db, B);
  assert.deepEqual((await one("SELECT ring_call($1, $2) r", [group, [A, C]])).r, [C], "B can still ring C");
  assert.deepEqual((await one("SELECT ring_call($1, $2) r", [dm, [A]])).r, []);
  assert.equal((await db.query("SELECT count(*)::int n FROM call_rings WHERE caller_profile_id = $1", [A])).rows[0].n, 0, "A's earlier ring to B was withdrawn");
  await assert.rejects(signal(B, A), /row-level security/);
  await assert.rejects(signal(C, A), /row-level security/, "B still cannot speak as C to reach A");
  await signal(B, C);
  await actAs(db, A);
  await assert.rejects(signal(A, B), /row-level security/);
  const byes = (await db.query("SELECT from_profile, kind, list_id FROM call_signals WHERE kind = 'bye'")).rows;
  assert.deepEqual(byes, [{ from_profile: B, kind: "bye", list_id: null }], "A's client is told to drop any connection with B");
});

test("the sign-in limiter is server-only and stops after ten attempts per number", async () => {
  const key = (c) => c.repeat(64);
  await actAs(db, A);
  await assert.rejects(db.query("SELECT phone_login_attempt($1, $2)", [key("a"), key("b")]), /permission denied|server only/);
  await actAs(db, null, "service_role");
  for (let i = 0; i < 10; i++) assert.equal((await one("SELECT phone_login_attempt($1, $2) r", [key("a"), key(String(i % 9 + 1))])).r.allowed, true);
  const refused = (await one("SELECT phone_login_attempt($1, $2) r", [key("a"), key("c")])).r;
  assert.equal(refused.allowed, false);
  assert.ok(refused.retry_after_s >= 60);
  assert.equal((await one("SELECT phone_login_attempt($1, $2) r", [key("d"), key("c")])).r.allowed, true, "another number is unaffected");
});
