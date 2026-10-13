import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migration = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222", C = "33333333-3333-4333-8333-333333333333";
const AA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", AB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", AC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc", AX = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

async function setup() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA katalist_priv;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'authenticated') $$;
    GRANT USAGE ON SCHEMA auth, public, katalist_priv TO authenticated, service_role, anon;
    CREATE TYPE public.list_role AS ENUM ('collaborator','view_only');
    CREATE TABLE public.profiles(id uuid PRIMARY KEY, display_name text, email text, phone_e164 text, avatar_url text);
    CREATE TABLE public.actors(id uuid PRIMARY KEY, kind text NOT NULL DEFAULT 'user', profile_id uuid);
    CREATE TABLE public.lists(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, owner_profile_id uuid, kind text NOT NULL DEFAULT 'list');
    CREATE TABLE public.list_members(list_id uuid, profile_id uuid, role public.list_role, added_by_profile_id uuid, PRIMARY KEY(list_id, profile_id));
    CREATE TABLE public.thing_assignments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), thing_id uuid, assignee_actor_id uuid, assigned_by_actor_id uuid);
    CREATE TABLE public.things(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_actor_id uuid, current_assignee_actor_id uuid);
    CREATE TABLE public.notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), profile_id uuid, kind text, payload jsonb);
    CREATE TABLE katalist_priv.team_connections(profile_a_id uuid, profile_b_id uuid, created_at timestamptz DEFAULT now(), created_by_profile_id uuid, PRIMARY KEY(profile_a_id, profile_b_id), CHECK (profile_a_id < profile_b_id));
    CREATE TABLE katalist_priv.list_invitations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), list_id uuid, inviter_profile_id uuid, invitee_profile_id uuid, token_hash bytea UNIQUE, role public.list_role, expires_at timestamptz, accepted_at timestamptz, accepted_by_profile_id uuid, revoked_at timestamptz);
    CREATE TABLE katalist_priv.team_invitations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), inviter_profile_id uuid, token_hash bytea UNIQUE, expires_at timestamptz, accepted_at timestamptz, accepted_by_profile_id uuid, revoked_at timestamptz);
    CREATE FUNCTION katalist_priv.notify_profile(p uuid, k text, t text, b text DEFAULT NULL, a uuid DEFAULT NULL, th uuid DEFAULT NULL, l uuid DEFAULT NULL, path text DEFAULT '/', payload jsonb DEFAULT '{}') RETURNS uuid
      LANGUAGE sql SECURITY DEFINER AS $$ INSERT INTO public.notifications(profile_id, kind, payload) VALUES (p, k, payload) RETURNING id $$;
    CREATE FUNCTION katalist_priv.notify_list_participants(l uuid, ex uuid[], k text, t text, b text, a uuid, path text, payload jsonb) RETURNS void LANGUAGE sql AS $$ SELECT $$;
    CREATE FUNCTION public.request_team_connection(uuid) RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
    CREATE FUNCTION public.accept_team_request(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
    CREATE FUNCTION public.remove_team_connection(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
    CREATE FUNCTION public.assign_outside_katalist(uuid, text, text, text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
    INSERT INTO profiles(id, display_name, email, phone_e164) VALUES ('${A}','Asha','asha@example.test','+919000000101'),('${B}','Bala','bala@example.test','+919000000102'),('${C}','Chitra',null,null);
    INSERT INTO actors VALUES ('${AA}','user','${A}'),('${AB}','user','${B}'),('${AC}','user','${C}'),('${AX}','external',null);
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;`);
  for (const file of ["20260918220000_hub_contacts.sql", "20261009190000_google_contact_matches.sql", "20261013120000_explicit_connections.sql", "20261013121000_connect_discovery.sql"]) {
    await db.exec(migration(file));
  }
  const as = async (id, role = "authenticated") =>
    db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${id}',false); SELECT set_config('request.jwt.claim.role','${role}',false); SET ROLE ${role};`);
  const connected = async (x, y) => (await db.query("SELECT katalist_priv.are_connected($1,$2) AS c", [x, y])).rows[0].c;
  return { db, as, connected };
}

test("A requests B → pending; B accepts → both connected; duplicate accept and repeated sends are harmless", async () => {
  const { db, as, connected } = await setup();
  try {
    await as(A);
    const req = (await db.query("SELECT (send_contact_request($1)).* ", [B])).rows[0];
    assert.equal(req.status, "pending");
    const again = (await db.query("SELECT (send_contact_request($1)).* ", [AB])).rows[0];
    assert.equal(again.id, req.id, "sending twice (even by actor id) is idempotent");
    await assert.rejects(db.query("SELECT respond_contact_request($1, true)", [req.id]), /no longer pending/, "the requester cannot accept their own request");
    assert.equal(await connected(A, B), false);
    await as(B);
    assert.equal((await db.query("SELECT (respond_contact_request($1, true)).status", [req.id])).rows[0].status, "accepted");
    assert.equal(await connected(A, B), true);
    assert.equal((await db.query("SELECT (respond_contact_request($1, true)).status", [req.id])).rows[0].status, "accepted", "duplicate accept is harmless");
    await db.exec("RESET ROLE");
    assert.equal((await db.query("SELECT count(*)::int n FROM katalist_priv.team_connections")).rows[0].n, 1);
  } finally { await db.close(); }
});

test("opposite requests resolve to one pending pair; a reciprocal send never auto-accepts", async () => {
  const { db, as, connected } = await setup();
  try {
    await as(A);
    const first = (await db.query("SELECT (send_contact_request($1)).*", [B])).rows[0];
    await as(B);
    const second = (await db.query("SELECT (send_contact_request($1)).*", [A])).rows[0];
    assert.equal(second.id, first.id);
    assert.equal(second.status, "pending");
    assert.equal(await connected(A, B), false, "B must press Accept");
    assert.equal((await db.query("SELECT count(*)::int n FROM contact_requests")).rows[0].n, 1);
  } finally { await db.close(); }
});

test("decline, cancel, disconnect and block are enforced on the server", async () => {
  const { db, as, connected } = await setup();
  try {
    await as(A);
    let req = (await db.query("SELECT (send_contact_request($1)).*", [B])).rows[0];
    await as(B);
    assert.equal((await db.query("SELECT (respond_contact_request($1, false)).status", [req.id])).rows[0].status, "declined");
    await as(A);
    req = (await db.query("SELECT (send_contact_request($1)).*", [B])).rows[0];
    assert.equal(req.status, "pending", "a new request after decline is allowed");
    assert.equal((await db.query("SELECT cancel_contact_request($1) ok", [req.id])).rows[0].ok, true);
    await as(B);
    await assert.rejects(db.query("SELECT respond_contact_request($1, true)", [req.id]), /no longer pending/, "a cancelled request cannot be accepted");
    req = (await db.query("SELECT (send_contact_request($1)).*", [A])).rows[0];
    await as(A);
    await db.query("SELECT respond_contact_request($1, true)", [req.id]);
    assert.equal(await connected(A, B), true);
    await db.query("SELECT disconnect_contact($1)", [B]);
    assert.equal(await connected(A, B), false);
    await db.query("SELECT block_contact($1)", [B]);
    await as(B);
    await assert.rejects(db.query("SELECT send_contact_request($1)", [A]), /cannot be added/);
    await as(A);
    assert.deepEqual((await db.query("SELECT profile_id FROM list_my_blocks()")).rows, [{ profile_id: B }]);
    await db.query("SELECT unblock_contact($1)", [B]);
    assert.equal((await db.query("SELECT (send_contact_request($1)).status", [B])).rows[0].status, "pending");
  } finally { await db.close(); }
});

test("Google Contacts is gone and is no longer a condition for connecting", async () => {
  const { db, as } = await setup();
  try {
    assert.equal((await db.query("SELECT to_regclass('public.google_contact_matches') r")).rows[0].r, null);
    assert.equal((await db.query("SELECT count(*)::int n FROM pg_proc WHERE proname = 'sync_google_contact_matches'")).rows[0].n, 0);
    await as(C);
    assert.equal((await db.query("SELECT (send_contact_request($1)).status", [A])).rows[0].status, "pending");
  } finally { await db.close(); }
});

test("delegation, DMs and groups require an accepted connection, even through direct writes", async () => {
  const { db, as } = await setup();
  try {
    await as(A, "service_role");
    await assert.rejects(db.query("INSERT INTO thing_assignments(assignee_actor_id, assigned_by_actor_id) VALUES ($1,$2)", [AB, AA]), /connect with this person/);
    await assert.rejects(db.query("INSERT INTO thing_assignments(assignee_actor_id, assigned_by_actor_id) VALUES ($1,$2)", [AX, AA]), /connected Katalist people/);
    await db.query("INSERT INTO thing_assignments(assignee_actor_id, assigned_by_actor_id) VALUES ($1,$1)", [AA]);
    const dm = (await db.query("INSERT INTO lists(name, owner_profile_id, kind) VALUES ('dm', $1, 'dm') RETURNING id", [A])).rows[0].id;
    await assert.rejects(db.query("INSERT INTO list_members VALUES ($1,$2,'collaborator',$3)", [dm, B, A]), /before messaging/);
    const list = (await db.query("INSERT INTO lists(name, owner_profile_id, kind) VALUES ('Q3', $1, 'list') RETURNING id", [A])).rows[0].id;
    await db.query("INSERT INTO list_members VALUES ($1,$2,'collaborator',$3)", [list, B, A]);
    await db.exec("RESET ROLE");
    await db.query("INSERT INTO katalist_priv.team_connections(profile_a_id, profile_b_id, created_by_profile_id) VALUES (least($1::uuid,$2::uuid), greatest($1::uuid,$2::uuid), $1)", [A, B]);
    await as(A, "service_role");
    await db.query("INSERT INTO thing_assignments(assignee_actor_id, assigned_by_actor_id) VALUES ($1,$2)", [AB, AA]);
    await db.query("INSERT INTO list_members VALUES ($1,$2,'collaborator',$3)", [dm, B, A]);
  } finally { await db.close(); }
});

test("accepting a List invitation adds membership but never a connection; legacy bypass RPCs are closed", async () => {
  const { db, as, connected } = await setup();
  try {
    await db.exec("RESET ROLE");
    const list = (await db.query("INSERT INTO lists(name, owner_profile_id) VALUES ('Q3', $1) RETURNING id", [A])).rows[0].id;
    await db.query("INSERT INTO katalist_priv.list_invitations(list_id, inviter_profile_id, invitee_profile_id, token_hash, role, expires_at) VALUES ($1,$2,$3,'\\x01','collaborator', now() + interval '1 day')", [list, A, B]);
    await as(A, "service_role");
    await db.query("SELECT accept_list_invitation_server('\\x01', $1)", [B]);
    assert.equal((await db.query("SELECT count(*)::int n FROM list_members WHERE profile_id = $1", [B])).rows[0].n, 1);
    assert.equal(await connected(A, B), false);
    await as(A);
    for (const fn of ["request_team_connection($1)", "accept_team_request($1)", "remove_team_connection($1)"]) {
      await assert.rejects(db.query(`SELECT ${fn}`, [B]), /permission denied/);
    }
    await assert.rejects(db.query("SELECT assign_outside_katalist($1,'x',null,null)", [B]), /permission denied/);
  } finally { await db.close(); }
});

test("discovery: exact handle, email or phone finds one minimal identity; partial text, blocks and strangers' details never leak", async () => {
  const { db, as } = await setup();
  try {
    await as(B);
    const handle = (await db.query("SELECT my_connect_handle() h")).rows[0].h;
    assert.match(handle, /^[a-z2-9]{10}$/);
    await as(A);
    const byLink = (await db.query("SELECT * FROM find_person_for_connect($1)", [`https://katalist.app/connect/${handle}`])).rows;
    assert.deepEqual(byLink.map((r) => [r.profile_id, r.display_name, r.state]), [[B, "Bala", "none"]]);
    assert.equal(Object.hasOwn(byLink[0], "email"), false, "no contact details in the result");
    assert.equal((await db.query("SELECT * FROM find_person_for_connect('BALA@example.test')")).rows[0].profile_id, B);
    assert.equal((await db.query("SELECT * FROM find_person_for_connect('9000000102')")).rows[0].profile_id, B, "10-digit Indian number");
    assert.equal((await db.query("SELECT * FROM find_person_for_connect('bala')")).rows.length, 0, "no name search");
    assert.equal((await db.query("SELECT * FROM find_person_for_connect('example.test')")).rows.length, 0);
    await db.query("SELECT send_contact_request($1)", [B]);
    assert.equal((await db.query("SELECT state FROM find_person_for_connect('bala@example.test')")).rows[0].state, "pending_out");
    await as(B);
    assert.equal((await db.query("SELECT state FROM find_person_for_connect('asha@example.test')")).rows[0].state, "pending_in");
    await db.query("SELECT block_contact($1)", [A]);
    await as(A);
    assert.equal((await db.query("SELECT * FROM find_person_for_connect('bala@example.test')")).rows.length, 0, "blocked looks like not found");
  } finally { await db.close(); }
});

test("visible identities: self, connections and request counterparts only; email for self only", async () => {
  const { db, as } = await setup();
  try {
    await as(A);
    let rows = (await db.query("SELECT profile_id, email, connected FROM list_visible_identities() ORDER BY display_name")).rows;
    assert.deepEqual(rows, [{ profile_id: A, email: "asha@example.test", connected: false }], "a stranger is not in the directory");
    const req = (await db.query("SELECT (send_contact_request($1)).id", [B])).rows[0].id;
    await as(B);
    await db.query("SELECT respond_contact_request($1, true)", [req]);
    await as(A);
    rows = (await db.query("SELECT profile_id, email, connected FROM list_visible_identities() ORDER BY display_name")).rows;
    assert.deepEqual(rows, [{ profile_id: A, email: "asha@example.test", connected: false }, { profile_id: B, email: null, connected: true }]);
  } finally { await db.close(); }
});

test("first-login profile upsert works as the signed-in user (column defaults are evaluable)", async () => {
  const { replayMigrations, actAs, createUser } = await import("./lib/supabase-replay.mjs");
  const { db } = await replayMigrations();
  try {
    const id = "93000000-0000-4000-8000-000000000001";
    await createUser(db, { id, name: "Katalist User", phone: "+919000000101" });
    await actAs(db, id);
    await db.query("INSERT INTO public.profiles (id, display_name, phone_e164, email) VALUES ($1, 'Katalist Verify A', '+919000000101', NULL) ON CONFLICT (id) DO UPDATE SET display_name = excluded.display_name, email = excluded.email", [id]);
    assert.equal((await db.query("SELECT display_name FROM public.profiles WHERE id = $1", [id])).rows[0].display_name, "Katalist Verify A");
  } finally { await db.close(); }
});

test("profiles are private: others' phone and email are never readable; names only for people you share something with", async () => {
  const { replayMigrations, actAs, createUser } = await import("./lib/supabase-replay.mjs");
  const { db } = await replayMigrations();
  try {
    const A = "94000000-0000-4000-8000-00000000000a", B = "94000000-0000-4000-8000-00000000000b", C = "94000000-0000-4000-8000-00000000000c";
    await createUser(db, { id: A, name: "Avani", phone: "+919000000201" });
    await createUser(db, { id: B, name: "Bharat", phone: "+919000000202" });
    await createUser(db, { id: C, name: "Chitra", phone: "+919000000203" });
    await actAs(db, A);
    const id = (await db.query("SELECT (send_contact_request($1)).id", [B])).rows[0].id;
    await actAs(db, B);
    await db.query("SELECT respond_contact_request($1, true)", [id]);
    await actAs(db, C);
    assert.deepEqual((await db.query("SELECT id FROM public.profiles")).rows.map((r) => r.id), [C], "C reads only its own profile");
    assert.deepEqual((await db.query("SELECT display_name FROM public.public_identities")).rows.map((r) => r.display_name), ["Chitra"], "C shares nothing with A or B");
    await actAs(db, A);
    assert.deepEqual((await db.query("SELECT display_name FROM public.public_identities ORDER BY 1")).rows.map((r) => r.display_name), ["Avani", "Bharat"]);
    assert.equal((await db.query("SELECT count(*)::int n FROM public.profiles WHERE id = $1", [B])).rows[0].n, 0, "B's phone and email stay private even to a connection");
    await assert.rejects(db.query("SELECT phone_e164 FROM public.public_identities"), /column .*phone_e164.* does not exist/);
  } finally { await db.close(); }
});
