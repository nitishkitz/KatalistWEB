import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(new URL("../supabase/migrations/20261009190000_google_contact_matches.sql", import.meta.url), "utf8");
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222", C = "33333333-3333-4333-8333-333333333333";
const ACTOR_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
test("private Google matches: RLS, service-only import, exact matching, re-sync and forged contact requests", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      GRANT USAGE ON SCHEMA auth,public TO authenticated,service_role,anon;
      CREATE TABLE public.profiles(id uuid PRIMARY KEY,email text,phone_e164 text);
      CREATE TABLE public.actors(id uuid PRIMARY KEY,profile_id uuid);
      CREATE TABLE public.contact_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),requester_profile_id uuid,addressee_profile_id uuid,status text,responded_at timestamptz,UNIQUE(requester_profile_id,addressee_profile_id));
      INSERT INTO profiles VALUES ('${A}','owner@example.test',NULL),('${B}','B@EXAMPLE.TEST','+919000000101'),('${C}','unrelated@example.test','+14155550123');
      INSERT INTO actors VALUES ('${ACTOR_B}','${B}');
      GRANT ALL ON profiles,actors,contact_requests TO service_role;`);
    await db.exec(migration);
    const as = async (id, role="authenticated") => db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${id}',false); SET ROLE ${role};`);
    const snapshot = [{ resource: "people/b", name: "Not used to match", emails: ["b@example.test"], phones: [] }, { resource: "people/no-match", emails: ["not-registered@example.test"], phones: [] }];
    await as(A,"service_role");
    const first = await db.query("SELECT sync_google_contact_matches($1,$2::jsonb) AS count",[A,JSON.stringify(snapshot)]);
    assert.equal(first.rows[0].count,1);
    await as(A);
    assert.deepEqual((await db.query("SELECT profile_id FROM google_contact_matches")).rows,[{profile_id:B}]);
    await assert.rejects(db.query("SELECT sync_google_contact_matches($1,'[]')",[A]), /permission denied/);
    await assert.rejects(db.query("INSERT INTO google_contact_matches VALUES ($1,$2)",[A,C]), /permission denied/);
    await assert.rejects(db.query("SELECT send_contact_request($1)",[C]), /Sync this person/);
    const request = (await db.query("SELECT (send_contact_request($1)).status AS status",[ACTOR_B])).rows[0];
    assert.equal(request.status,"pending");
    await as(C);
    assert.equal((await db.query("SELECT * FROM google_contact_matches")).rows.length,0);
    await as(B);
    assert.equal((await db.query("SELECT (send_contact_request($1)).status AS status",[A])).rows[0].status,"accepted");
    await as(A,"service_role");
    // A resource that maps to two accounts is deliberately excluded.
    const ambiguous = [{resource:"people/ambiguous",emails:["b@example.test","unrelated@example.test"],phones:[]}];
    assert.equal((await db.query("SELECT sync_google_contact_matches($1,$2::jsonb) AS count",[A,JSON.stringify(ambiguous)])).rows[0].count,0);
    await db.query("SELECT sync_google_contact_matches($1,$2::jsonb)",[A,JSON.stringify(snapshot)]);
    await assert.rejects(db.query("SELECT sync_google_contact_matches($1,$2::jsonb)",[A,JSON.stringify([{resource:"bad",emails:"not-array",phones:[]}])]), /scalar/);
    assert.equal((await db.query("SELECT * FROM google_contact_matches")).rows.length,1,"failed snapshot rolls back deletion");
    await db.query("SELECT sync_google_contact_matches($1,'[]')",[A]);
    assert.equal((await db.query("SELECT * FROM google_contact_matches")).rows.length,0);
    await as(A);
    assert.equal((await db.query("SELECT (send_contact_request($1)).status AS status",[B])).rows[0].status,"accepted","re-sync does not remove accepted contacts");
    await db.exec("RESET ROLE; SET ROLE anon;");
    await assert.rejects(db.query("SELECT * FROM google_contact_matches"),/permission denied/);
  } finally { await db.close(); }
});
