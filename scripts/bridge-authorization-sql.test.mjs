import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

/**
 * H08: runs the actual guest-side Bridge RPCs (`bridge_session_grant`,
 * `bridge_get_thing`, `bridge_act`, `bridge_comment`, `bridge_redeem_token`)
 * -- copied verbatim from their latest migration definitions, including
 * the real `katalist_priv.hash_token`/`new_token` (real pgcrypto
 * digest/gen_random_bytes, not a stand-in) -- against a real
 * Postgres-compatible engine (PGlite). This is the local, credential-free
 * authorization matrix the audit asks for (valid/expired/revoked/
 * malformed/wrong-recipient/wrong-session/terminal/unrelated-Thing), plus
 * the new bridge_comment idempotency migration applied on top of the
 * original 2-arg function, matching this repo's own "historical + new
 * migration" pattern (see morning-brief-receipts-sql.test.mjs).
 *
 * Owner-side functions (issue_bridge_grant, create_external_actor, RLS
 * policies, can_view_thing, current_actor_id) are NOT reproduced here --
 * this fixture inserts grants/sessions directly, which is equivalent for
 * testing the GUEST-side authorization checks these RPCs themselves make.
 * Does not prove real Supabase auth.uid()/RLS integration or concurrent-
 * transaction races -- same standing caveat as every other PGlite SQL test
 * in this repo.
 */

const IDEMPOTENCY_MIGRATION_SQL = readFileSync(
  new URL("../supabase/migrations/20260926120000_bridge_comment_idempotency.sql", import.meta.url),
  "utf8",
);

const ACTOR_ASSIGNEE = "11111111-1111-1111-1111-111111111111";
const ACTOR_OTHER = "22222222-2222-2222-2222-222222222222";
const ACTOR_OWNER = "33333333-3333-3333-3333-333333333333";

async function makeDb() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role authenticated;
    create role anon;
    create role service_role;
    create schema if not exists extensions;
    create extension if not exists pgcrypto with schema extensions;
    create schema if not exists katalist_priv;

    create type public.work_status as enum ('not_started','under_progress','sorted','cancelled');
    create type public.acknowledgement_state as enum ('waiting_for_catch','caught');
    create type public.importance as enum ('now','next','later');
    create type public.activity_event as enum ('caught','work_status_changed','sorted','bridge_opened','bridge_revoked');

    create table public.actors (id uuid primary key);

    create table public.things (
      id uuid primary key,
      title text not null default 'Untitled',
      notes text,
      due_at timestamptz,
      due_has_time boolean not null default false,
      acknowledgement public.acknowledgement_state not null default 'waiting_for_catch',
      work_status public.work_status not null default 'not_started',
      owner_actor_id uuid references public.actors(id),
      owner_importance public.importance not null default 'next',
      current_assignee_actor_id uuid references public.actors(id),
      current_assignment_id uuid,
      assignee_personal_pace text,
      caught_at timestamptz,
      sorted_at timestamptz
    );

    create table public.thing_assignments (
      id uuid primary key,
      thing_id uuid references public.things(id),
      acknowledgement public.acknowledgement_state,
      caught_at timestamptz,
      ended_at timestamptz,
      ended_reason text
    );

    create table public.thing_comments (
      id uuid primary key default gen_random_uuid(),
      thing_id uuid not null references public.things(id),
      author_actor_id uuid not null references public.actors(id),
      body text not null check (length(btrim(body)) > 0),
      deleted_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table public.thing_activity (
      id uuid primary key default gen_random_uuid(),
      thing_id uuid,
      actor_id uuid,
      event public.activity_event,
      detail jsonb,
      created_at timestamptz not null default now()
    );

    create table public.app_config (key text primary key, value text);

    create table public.bridge_grants (
      id uuid primary key default gen_random_uuid(),
      thing_id uuid not null references public.things(id) on delete cascade,
      assignment_id uuid not null references public.thing_assignments(id),
      actor_id uuid not null references public.actors(id),
      issued_by_actor_id uuid not null references public.actors(id),
      token_hash text not null unique,
      expires_at timestamptz not null,
      first_used_at timestamptz,
      revoked_at timestamptz,
      revoked_reason text,
      created_at timestamptz not null default now()
    );

    create table public.bridge_sessions (
      id uuid primary key default gen_random_uuid(),
      grant_id uuid not null references public.bridge_grants(id) on delete cascade,
      session_hash text not null unique,
      expires_at timestamptz not null,
      revoked_at timestamptz,
      last_seen_at timestamptz not null default now(),
      created_at timestamptz not null default now()
    );

    -- ---------- helpers, copied verbatim from their migrations ----------

    create or replace function katalist_priv.hash_token(_token text)
    returns text
    language sql
    immutable
    set search_path to 'pg_catalog', 'public', 'extensions'
    as $$
      select encode(extensions.digest(convert_to(_token, 'UTF8'), 'sha256'), 'hex');
    $$;

    create or replace function katalist_priv.new_token()
    returns text
    language sql
    volatile
    set search_path to 'pg_catalog', 'public', 'extensions'
    as $$
      select encode(extensions.gen_random_bytes(32), 'hex');
    $$;

    create or replace function katalist_priv.config_int(_key text, _fallback integer)
    returns integer
    language sql
    stable
    set search_path = pg_catalog, public, katalist_priv
    as $$
      select coalesce((select (c.value)::text::integer from public.app_config c where c.key = _key), _fallback);
    $$;

    create or replace function katalist_priv.log_activity(
      _thing_id uuid, _actor_id uuid, _event public.activity_event, _detail jsonb default '{}'::jsonb
    )
    returns void
    language plpgsql
    set search_path = pg_catalog, public, katalist_priv
    as $$
    begin
      insert into public.thing_activity (thing_id, actor_id, event, detail)
      values (_thing_id, _actor_id, _event, coalesce(_detail, '{}'::jsonb));
    end;
    $$;

    create or replace function katalist_priv.assert_forward_status(_from work_status, _to work_status)
    returns void
    language plpgsql
    immutable
    set search_path to 'pg_catalog', 'public', 'katalist_priv'
    as $$
    begin
      if _to = 'not_started' and _from <> 'not_started' then
        raise exception 'work can only move forward: % cannot go back to Not Started', _from;
      end if;
    end;
    $$;

    create or replace function katalist_priv.revoke_bridge_for_assignment(_assignment_id uuid, _reason text)
    returns void
    language plpgsql
    set search_path to 'pg_catalog', 'public', 'katalist_priv'
    as $$
    begin
      if _assignment_id is null then
        return;
      end if;
      update public.bridge_sessions s
         set revoked_at = now()
       where s.revoked_at is null
         and s.grant_id in (select g.id from public.bridge_grants g where g.assignment_id = _assignment_id);
      update public.bridge_grants g
         set revoked_at = now(), revoked_reason = coalesce(_reason, 'revoked')
       where g.assignment_id = _assignment_id and g.revoked_at is null;
    end;
    $$;

    -- ---------- guest-side Bridge RPCs, copied verbatim ----------

    create or replace function katalist_priv.bridge_session_grant(_session_token text)
    returns public.bridge_grants
    language plpgsql
    set search_path to 'pg_catalog', 'public', 'katalist_priv'
    as $$
    declare
      v_grant public.bridge_grants;
    begin
      select g.* into v_grant
        from public.bridge_sessions s
        join public.bridge_grants g on g.id = s.grant_id
       where s.session_hash = katalist_priv.hash_token(_session_token)
         and s.revoked_at is null
         and s.expires_at > now()
         and g.revoked_at is null
         and g.expires_at > now();

      if not found then
        raise exception 'this link is no longer active';
      end if;

      update public.bridge_sessions
         set last_seen_at = now()
       where session_hash = katalist_priv.hash_token(_session_token);

      return v_grant;
    end;
    $$;

    create or replace function public.bridge_get_thing(p_session_token text)
    returns table(
      id uuid, title text, notes text, due_at timestamptz, due_has_time boolean,
      acknowledgement public.acknowledgement_state, work_status public.work_status,
      owner_name text, owner_importance public.importance
    )
    language plpgsql
    set search_path to 'pg_catalog', 'public', 'katalist_priv'
    as $$
    declare
      v_grant public.bridge_grants := katalist_priv.bridge_session_grant(p_session_token);
    begin
      return query
        select t.id, t.title, t.notes, t.due_at, t.due_has_time,
               t.acknowledgement, t.work_status,
               'Katalist user'::text,
               t.owner_importance
          from public.things t
         where t.id = v_grant.thing_id;
    end;
    $$;

    create or replace function public.bridge_act(p_session_token text, p_action text)
    returns work_status
    language plpgsql
    set search_path to 'pg_catalog', 'public', 'katalist_priv'
    as $$
    declare
      v_grant public.bridge_grants := katalist_priv.bridge_session_grant(p_session_token);
      v_thing public.things;
    begin
      select * into v_thing from public.things where id = v_grant.thing_id for update;
      if v_thing.current_assignee_actor_id <> v_grant.actor_id
         or v_thing.current_assignment_id is distinct from v_grant.assignment_id then
        raise exception 'this link is no longer active';
      end if;
      if v_thing.work_status in ('sorted','cancelled') then
        raise exception 'this Thing is already %', v_thing.work_status;
      end if;

      if p_action = 'catch' then
        if v_thing.acknowledgement <> 'caught' then
          update public.things
             set acknowledgement = 'caught', caught_at = now(), assignee_personal_pace = null
           where id = v_thing.id returning * into v_thing;
          update public.thing_assignments
             set acknowledgement = 'caught', caught_at = now()
           where id = v_thing.current_assignment_id;
          perform katalist_priv.log_activity(v_thing.id, v_grant.actor_id, 'caught',
            jsonb_build_object('via', 'bridge'));
        end if;

      elsif p_action in ('not_started','under_progress') then
        if v_thing.acknowledgement <> 'caught' then
          raise exception 'Catch the Thing before changing its status';
        end if;
        perform katalist_priv.assert_forward_status(v_thing.work_status, p_action::public.work_status);
        if v_thing.work_status <> p_action::public.work_status then
          update public.things set work_status = p_action::public.work_status
           where id = v_thing.id returning * into v_thing;
          perform katalist_priv.log_activity(v_thing.id, v_grant.actor_id, 'work_status_changed',
            jsonb_build_object('work_status', p_action, 'via', 'bridge'));
        end if;

      elsif p_action = 'sorted' then
        if v_thing.acknowledgement <> 'caught' then
          raise exception 'Catch the Thing before marking it Sorted';
        end if;
        update public.things set work_status = 'sorted', sorted_at = now()
         where id = v_thing.id returning * into v_thing;
        update public.thing_assignments
           set ended_at = now(), ended_reason = 'sorted'
         where id = v_thing.current_assignment_id and ended_at is null;
        perform katalist_priv.log_activity(v_thing.id, v_grant.actor_id, 'sorted',
          jsonb_build_object('via', 'bridge'));
        perform katalist_priv.revoke_bridge_for_assignment(v_thing.current_assignment_id, 'sorted');

      else
        raise exception 'unsupported action';
      end if;

      return v_thing.work_status;
    end;
    $$;

    -- Original 2-arg form, before the H08 idempotency migration layers the
    -- 3-arg replacement on top (applied separately below).
    create or replace function public.bridge_comment(p_session_token text, p_body text)
    returns uuid
    language plpgsql
    set search_path to 'pg_catalog', 'public', 'katalist_priv'
    as $$
    declare
      v_grant public.bridge_grants := katalist_priv.bridge_session_grant(p_session_token);
      v_thing public.things;
      v_body  text := nullif(btrim(coalesce(p_body, '')), '');
      v_id    uuid;
    begin
      if v_body is null then
        raise exception 'a comment cannot be empty';
      end if;

      select * into v_thing from public.things where id = v_grant.thing_id;
      if v_thing.current_assignee_actor_id <> v_grant.actor_id
         or v_thing.current_assignment_id is distinct from v_grant.assignment_id then
        raise exception 'this link is no longer active';
      end if;
      if v_thing.work_status in ('sorted','cancelled') then
        raise exception 'this Thing is already %', v_thing.work_status;
      end if;

      insert into public.thing_comments (thing_id, author_actor_id, body)
      values (v_thing.id, v_grant.actor_id, v_body)
      returning id into v_id;

      return v_id;
    end;
    $$;

    create or replace function public.bridge_redeem_token(p_token text)
    returns table(session_token text, expires_at timestamptz, thing_id uuid)
    language plpgsql
    set search_path to 'pg_catalog', 'public', 'katalist_priv'
    as $$
    declare
      v_grant   public.bridge_grants;
      v_thing   public.things;
      v_session text;
      v_expires timestamptz;
    begin
      select g.* into v_grant
        from public.bridge_grants g
       where g.token_hash = katalist_priv.hash_token(p_token)
         and g.revoked_at is null
         and g.expires_at > now();
      if not found then
        raise exception 'this link is no longer active';
      end if;

      select t.* into v_thing from public.things t where t.id = v_grant.thing_id;
      if not found
         or v_thing.current_assignment_id is distinct from v_grant.assignment_id
         or v_thing.current_assignee_actor_id <> v_grant.actor_id
         or v_thing.work_status in ('sorted','cancelled') then
        raise exception 'this link is no longer active';
      end if;

      v_session := katalist_priv.new_token();
      v_expires := now() + make_interval(mins => katalist_priv.config_int('bridge_session_ttl_minutes', 120));

      insert into public.bridge_sessions (grant_id, session_hash, expires_at)
      values (v_grant.id, katalist_priv.hash_token(v_session), v_expires);

      update public.bridge_grants g
         set first_used_at = coalesce(g.first_used_at, now())
       where g.id = v_grant.id;

      return query select v_session, v_expires, v_grant.thing_id;
    end;
    $$;
  `);
  return db;
}

/** Inserts a Thing + assignment + actors, bypassing the owner-side
 *  issue_bridge_grant()/RLS entirely (equivalent for testing the guest-side
 *  checks these RPCs themselves make, per this file's own header note). */
async function seedThing(db, { thingId, assignmentId, assigneeActorId = ACTOR_ASSIGNEE, workStatus = "not_started", acknowledgement = "waiting_for_catch" }) {
  await db.query(`insert into public.actors (id) values ('${ACTOR_OWNER}'), ('${assigneeActorId}') on conflict do nothing`);
  await db.query(
    `insert into public.things (id, title, work_status, acknowledgement, owner_actor_id, current_assignee_actor_id, current_assignment_id)
     values ('${thingId}', 'Test Thing', '${workStatus}', '${acknowledgement}', '${ACTOR_OWNER}', '${assigneeActorId}', '${assignmentId}')`,
  );
  await db.query(
    `insert into public.thing_assignments (id, thing_id, acknowledgement) values ('${assignmentId}', '${thingId}', '${acknowledgement}')`,
  );
}

async function insertGrant(db, { thingId, assignmentId, actorId = ACTOR_ASSIGNEE, token, expiresInMinutes = 60, revoked = false }) {
  const hash = (await db.query(`select katalist_priv.hash_token('${token}') as h`)).rows[0].h;
  const grantId = crypto.randomUUID();
  await db.query(
    `insert into public.bridge_grants (id, thing_id, assignment_id, actor_id, issued_by_actor_id, token_hash, expires_at, revoked_at)
     values ('${grantId}', '${thingId}', '${assignmentId}', '${actorId}', '${ACTOR_OWNER}', '${hash}',
             now() + interval '${expiresInMinutes} minutes', ${revoked ? "now()" : "null"})`,
  );
  return grantId;
}

async function insertSession(db, { grantId, token, expiresInMinutes = 60, revoked = false }) {
  const hash = (await db.query(`select katalist_priv.hash_token('${token}') as h`)).rows[0].h;
  await db.query(
    `insert into public.bridge_sessions (grant_id, session_hash, expires_at, revoked_at)
     values ('${grantId}', '${hash}', now() + interval '${expiresInMinutes} minutes', ${revoked ? "now()" : "null"})`,
  );
}

async function callBridgeAct(db, sessionToken, action) {
  return db.query(`select public.bridge_act('${sessionToken}', '${action}') as result`);
}

test("valid session: bridge_get_thing returns the grant's own Thing, and bridge_act can catch/progress/sort it end to end", async () => {
  const db = await makeDb();
  const thingId = crypto.randomUUID();
  const assignmentId = crypto.randomUUID();
  await seedThing(db, { thingId, assignmentId });
  const grantId = await insertGrant(db, { thingId, assignmentId, token: "grant-1" });
  await insertSession(db, { grantId, token: "session-1" });

  const got = await db.query(`select * from public.bridge_get_thing('session-1')`);
  assert.equal(got.rows.length, 1);
  assert.equal(got.rows[0].id, thingId);

  await callBridgeAct(db, "session-1", "catch");
  await callBridgeAct(db, "session-1", "under_progress");
  const final = await callBridgeAct(db, "session-1", "sorted");
  assert.equal(final.rows[0].result, "sorted");

  const thing = (await db.query(`select work_status from public.things where id = '${thingId}'`)).rows[0];
  assert.equal(thing.work_status, "sorted");
});

test("expired session is rejected", async () => {
  const db = await makeDb();
  const thingId = crypto.randomUUID();
  const assignmentId = crypto.randomUUID();
  await seedThing(db, { thingId, assignmentId });
  const grantId = await insertGrant(db, { thingId, assignmentId, token: "grant-2" });
  await insertSession(db, { grantId, token: "session-2", expiresInMinutes: -5 });

  await assert.rejects(() => db.query(`select public.bridge_get_thing('session-2')`), /no longer active/);
});

test("expired grant is rejected even with a live session", async () => {
  const db = await makeDb();
  const thingId = crypto.randomUUID();
  const assignmentId = crypto.randomUUID();
  await seedThing(db, { thingId, assignmentId });
  const grantId = await insertGrant(db, { thingId, assignmentId, token: "grant-3", expiresInMinutes: -5 });
  await insertSession(db, { grantId, token: "session-3" });

  await assert.rejects(() => db.query(`select public.bridge_get_thing('session-3')`), /no longer active/);
});

test("revoked grant is rejected", async () => {
  const db = await makeDb();
  const thingId = crypto.randomUUID();
  const assignmentId = crypto.randomUUID();
  await seedThing(db, { thingId, assignmentId });
  const grantId = await insertGrant(db, { thingId, assignmentId, token: "grant-4", revoked: true });
  await insertSession(db, { grantId, token: "session-4" });

  await assert.rejects(() => db.query(`select public.bridge_get_thing('session-4')`), /no longer active/);
});

test("revoked session is rejected even with a live grant", async () => {
  const db = await makeDb();
  const thingId = crypto.randomUUID();
  const assignmentId = crypto.randomUUID();
  await seedThing(db, { thingId, assignmentId });
  const grantId = await insertGrant(db, { thingId, assignmentId, token: "grant-5" });
  await insertSession(db, { grantId, token: "session-5", revoked: true });

  await assert.rejects(() => db.query(`select public.bridge_get_thing('session-5')`), /no longer active/);
});

test("a malformed/garbage session token is rejected the same generic way as any other invalid one", async () => {
  const db = await makeDb();
  await assert.rejects(
    () => db.query(`select public.bridge_get_thing('${"x".repeat(64)}')`),
    /no longer active/,
  );
});

test("wrong-recipient: a session belonging to a grant for a DIFFERENT actor never authorizes the current assignee's own view", async () => {
  const db = await makeDb();
  const thingId = crypto.randomUUID();
  const assignmentId = crypto.randomUUID();
  // Seed the Thing assigned to ACTOR_ASSIGNEE, but issue the grant/session
  // for ACTOR_OTHER (simulating a stale/forwarded link after reassignment
  // that hasn't yet been revoked by the reassignment cascade).
  await seedThing(db, { thingId, assignmentId, assigneeActorId: ACTOR_ASSIGNEE });
  await db.query(`insert into public.actors (id) values ('${ACTOR_OTHER}') on conflict do nothing`);
  const grantId = await insertGrant(db, { thingId, assignmentId, actorId: ACTOR_OTHER, token: "grant-6" });
  await insertSession(db, { grantId, token: "session-6" });

  // bridge_get_thing itself only checks the grant/session, not the
  // assignee match (unlike bridge_act/bridge_comment) -- but it can only
  // ever return the Thing the GRANT's own thing_id names. It never grants
  // action capability with a mismatched actor.
  const got = await db.query(`select * from public.bridge_get_thing('session-6')`);
  assert.equal(got.rows[0].id, thingId, "bridge_get_thing never returns an unrelated Thing");
  await assert.rejects(
    () => callBridgeAct(db, "session-6", "catch"),
    /no longer active/,
    "bridge_act must reject when the grant's actor no longer matches the Thing's current assignee",
  );
});

test("wrong-session: a session_hash that doesn't match any real session is rejected, not silently matched to a different one", async () => {
  const db = await makeDb();
  const thingId = crypto.randomUUID();
  const assignmentId = crypto.randomUUID();
  await seedThing(db, { thingId, assignmentId });
  const grantId = await insertGrant(db, { thingId, assignmentId, token: "grant-7" });
  await insertSession(db, { grantId, token: "session-7-real" });

  await assert.rejects(
    () => db.query(`select public.bridge_get_thing('session-7-wrong')`),
    /no longer active/,
  );
});

test("terminal Thing: a sorted Thing rejects every further action, and its grant/session no longer authorize anything", async () => {
  const db = await makeDb();
  const thingId = crypto.randomUUID();
  const assignmentId = crypto.randomUUID();
  await seedThing(db, { thingId, assignmentId, workStatus: "sorted", acknowledgement: "caught" });
  const grantId = await insertGrant(db, { thingId, assignmentId, token: "grant-8" });
  await insertSession(db, { grantId, token: "session-8" });

  await assert.rejects(() => callBridgeAct(db, "session-8", "catch"), /already sorted/);
  await assert.rejects(() => callBridgeAct(db, "session-8", "under_progress"), /already sorted/);
});

test("unrelated-Thing: acting through one session can never affect a different Thing's row", async () => {
  const db = await makeDb();
  const thingA = crypto.randomUUID();
  const assignmentA = crypto.randomUUID();
  const thingB = crypto.randomUUID();
  const assignmentB = crypto.randomUUID();
  await seedThing(db, { thingId: thingA, assignmentId: assignmentA });
  await seedThing(db, { thingId: thingB, assignmentId: assignmentB, assigneeActorId: ACTOR_OTHER });
  const grantId = await insertGrant(db, { thingId: thingA, assignmentId: assignmentA, token: "grant-9" });
  await insertSession(db, { grantId, token: "session-9" });

  await callBridgeAct(db, "session-9", "catch");
  const thingBRow = (await db.query(`select acknowledgement from public.things where id = '${thingB}'`)).rows[0];
  assert.equal(thingBRow.acknowledgement, "waiting_for_catch", "Thing B must be completely untouched by a session scoped to Thing A");
});

test("bridge_act enforces forward-only status and requires Catch before a status change or Sorted", async () => {
  const db = await makeDb();
  const thingId = crypto.randomUUID();
  const assignmentId = crypto.randomUUID();
  await seedThing(db, { thingId, assignmentId });
  const grantId = await insertGrant(db, { thingId, assignmentId, token: "grant-10" });
  await insertSession(db, { grantId, token: "session-10" });

  await assert.rejects(() => callBridgeAct(db, "session-10", "under_progress"), /Catch the Thing/);
  await assert.rejects(() => callBridgeAct(db, "session-10", "sorted"), /Catch the Thing/);

  await callBridgeAct(db, "session-10", "catch");
  await callBridgeAct(db, "session-10", "under_progress");
  await assert.rejects(() => callBridgeAct(db, "session-10", "not_started"), /cannot go back/);
});

test("bridge_redeem_token issues one new session per redemption and records first_used_at once", async () => {
  const db = await makeDb();
  const thingId = crypto.randomUUID();
  const assignmentId = crypto.randomUUID();
  await seedThing(db, { thingId, assignmentId });
  const hash = (await db.query(`select katalist_priv.hash_token('magic-token') as h`)).rows[0].h;
  await db.query(
    `insert into public.bridge_grants (id, thing_id, assignment_id, actor_id, issued_by_actor_id, token_hash, expires_at)
     values ('${crypto.randomUUID()}', '${thingId}', '${assignmentId}', '${ACTOR_ASSIGNEE}', '${ACTOR_OWNER}', '${hash}', now() + interval '1 day')`,
  );

  const redeemed = await db.query(`select * from public.bridge_redeem_token('magic-token')`);
  assert.equal(redeemed.rows.length, 1);
  assert.equal(redeemed.rows[0].thing_id, thingId);
  const sessionToken = redeemed.rows[0].session_token;

  // The new session actually authorizes the Thing.
  const got = await db.query(`select * from public.bridge_get_thing('${sessionToken}')`);
  assert.equal(got.rows[0].id, thingId);

  const grant = (await db.query(`select first_used_at from public.bridge_grants where thing_id = '${thingId}'`)).rows[0];
  assert.ok(grant.first_used_at, "first_used_at must be recorded on redemption");
});

test("an already-redeemed magic link's raw token cannot be redeemed a second time once it's expired/consumed, but real re-redemption while still valid is not blocked by this RPC itself", async () => {
  // bridge_redeem_token's own contract only checks the GRANT's expiry/
  // revocation, not "already redeemed" -- re-redemption while the grant is
  // still valid legitimately issues another session (e.g. the guest opens
  // the link on a second device). This documents that as real, current
  // behavior rather than assuming redemption is single-use.
  const db = await makeDb();
  const thingId = crypto.randomUUID();
  const assignmentId = crypto.randomUUID();
  await seedThing(db, { thingId, assignmentId });
  const hash = (await db.query(`select katalist_priv.hash_token('magic-token-2') as h`)).rows[0].h;
  await db.query(
    `insert into public.bridge_grants (id, thing_id, assignment_id, actor_id, issued_by_actor_id, token_hash, expires_at)
     values ('${crypto.randomUUID()}', '${thingId}', '${assignmentId}', '${ACTOR_ASSIGNEE}', '${ACTOR_OWNER}', '${hash}', now() + interval '1 day')`,
  );

  const first = await db.query(`select * from public.bridge_redeem_token('magic-token-2')`);
  const second = await db.query(`select * from public.bridge_redeem_token('magic-token-2')`);
  assert.notEqual(first.rows[0].session_token, second.rows[0].session_token, "each redemption issues its own distinct session");
});

// ---------- H08 idempotency migration, applied on top of the original ----------

test("H08 rollout: the old two-argument Bridge caller remains valid while the three-argument API is deployed", async () => {
  const db = await makeDb();
  await db.exec(IDEMPOTENCY_MIGRATION_SQL);
  const thingId = crypto.randomUUID();
  const assignmentId = crypto.randomUUID();
  await seedThing(db, { thingId, assignmentId });
  const grantId = await insertGrant(db, { thingId, assignmentId, token: "grant-compat" });
  await insertSession(db, { grantId, token: "session-compat" });
  const result = await db.query("select public.bridge_comment('session-compat', 'old caller') as id");
  assert.ok(result.rows[0].id);
  assert.match(IDEMPOTENCY_MIGRATION_SQL, /ON CONFLICT \(thing_id, author_actor_id, client_token\)[\s\S]*?DO NOTHING/);
});

test("H08: after the idempotency migration, a repeated bridge_comment submit with the SAME client token inserts exactly one comment and returns the same id", async () => {
  const db = await makeDb();
  await db.exec(IDEMPOTENCY_MIGRATION_SQL);

  const thingId = crypto.randomUUID();
  const assignmentId = crypto.randomUUID();
  await seedThing(db, { thingId, assignmentId, workStatus: "not_started", acknowledgement: "waiting_for_catch" });
  const grantId = await insertGrant(db, { thingId, assignmentId, token: "grant-11" });
  await insertSession(db, { grantId, token: "session-11" });

  const clientToken = crypto.randomUUID();
  const first = await db.query(`select public.bridge_comment('session-11', 'hello', '${clientToken}') as id`);
  const second = await db.query(`select public.bridge_comment('session-11', 'hello', '${clientToken}') as id`);
  assert.equal(first.rows[0].id, second.rows[0].id, "a retry with the same client token must return the original comment's id");

  const count = (await db.query(`select count(*)::int as n from public.thing_comments where thing_id = '${thingId}'`)).rows[0].n;
  assert.equal(count, 1, "exactly one comment row must exist, not two");
});

test("H08: two DIFFERENT client tokens (or none) still insert two distinct comments -- idempotency never suppresses a genuinely new comment", async () => {
  const db = await makeDb();
  await db.exec(IDEMPOTENCY_MIGRATION_SQL);

  const thingId = crypto.randomUUID();
  const assignmentId = crypto.randomUUID();
  await seedThing(db, { thingId, assignmentId });
  const grantId = await insertGrant(db, { thingId, assignmentId, token: "grant-12" });
  await insertSession(db, { grantId, token: "session-12" });

  await db.query(`select public.bridge_comment('session-12', 'first message', '${crypto.randomUUID()}')`);
  await db.query(`select public.bridge_comment('session-12', 'second message', '${crypto.randomUUID()}')`);
  await db.query(`select public.bridge_comment('session-12', 'third message', null)`);

  const count = (await db.query(`select count(*)::int as n from public.thing_comments where thing_id = '${thingId}'`)).rows[0].n;
  assert.equal(count, 3, "three genuinely different comments must all be inserted");
});

test("H08: the idempotency key is scoped per-Thing/author -- the same client token from a DIFFERENT session/actor is not deduplicated against it", async () => {
  const db = await makeDb();
  await db.exec(IDEMPOTENCY_MIGRATION_SQL);

  const thingId = crypto.randomUUID();
  const assignmentA = crypto.randomUUID();
  await seedThing(db, { thingId, assignmentId: assignmentA, assigneeActorId: ACTOR_ASSIGNEE });
  const grantA = await insertGrant(db, { thingId, assignmentId: assignmentA, actorId: ACTOR_ASSIGNEE, token: "grant-13a" });
  await insertSession(db, { grantId: grantA, token: "session-13a" });

  const sharedToken = crypto.randomUUID();
  await db.query(`select public.bridge_comment('session-13a', 'from assignee', '${sharedToken}')`);

  // A second Thing, different author, reusing the SAME client token value
  // by coincidence -- must not be treated as the same logical send.
  const thingId2 = crypto.randomUUID();
  const assignmentB = crypto.randomUUID();
  await seedThing(db, { thingId: thingId2, assignmentId: assignmentB, assigneeActorId: ACTOR_OTHER });
  const grantB = await insertGrant(db, { thingId: thingId2, assignmentId: assignmentB, actorId: ACTOR_OTHER, token: "grant-13b" });
  await insertSession(db, { grantId: grantB, token: "session-13b" });
  await db.query(`select public.bridge_comment('session-13b', 'from other actor', '${sharedToken}')`);

  const total = (await db.query(`select count(*)::int as n from public.thing_comments`)).rows[0].n;
  assert.equal(total, 2, "a coincidentally-shared client token across different (thing, author) pairs must not collide");
});
