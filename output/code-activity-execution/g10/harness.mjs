// Shared harness for G10 and later integration tests: the REAL TypeScript services run against the REAL draft SQL
// in an in-memory PGlite database, through an RPC adapter that behaves like PostgREST (named arguments, JSON values
// cast to the declared parameter types, scalar vs set results). Stubs: Supabase roles and auth.uid().
// It proves the TS and SQL agree on names, types and shapes. It does NOT prove hosted Supabase or PostgREST behavior.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const here = new URL("../", import.meta.url);
/**
 * Which SQL to load. Default: every draft (g03 through g15). With CODE_ACTIVITY_SUBSET=readonly: only the four
 * candidate migrations of the read-only connector (g03, g07, g11, g12), exactly as they would be applied first, so
 * the absence of the optional AI and Thing-creation functions can be tested for real.
 */
const readonly = process.env.CODE_ACTIVITY_SUBSET === "readonly";
// "workspace": the four applied candidates plus the S10 package (which replaces G15's manual part), with no G14 consent table.
const workspace = process.env.CODE_ACTIVITY_SUBSET === "workspace";
const candidateFiles = () => readdirSync(new URL("migration-candidates/", here)).filter((f) => f.endsWith(".sql")).sort().map((f) => `migration-candidates/${f}`);
const files = workspace
  ? [...candidateFiles(), "s10/DRAFT_code_activity_workspace_creation.sql"]
  : readonly
  ? readdirSync(new URL("migration-candidates/", here)).filter((f) => f.endsWith(".sql")).sort().map((f) => `migration-candidates/${f}`)
  : ["g03/DRAFT_code_activity_connection_schema.sql", "g07/DRAFT_code_activity_changes_schema.sql", "g11/DRAFT_code_activity_webhooks_schema.sql", "g12/DRAFT_code_activity_processing_schema.sql", "g14/DRAFT_code_activity_consent_schema.sql", "g15/DRAFT_code_activity_confirmations_schema.sql"];
export const drafts = files.filter((f) => existsSync(new URL(f, here))).map((f) => readFileSync(new URL(f, here), "utf8"));
export const SUBSET = workspace ? "workspace" : readonly ? "readonly" : "all";

export const U = { O: "00000000-0000-0000-0000-00000000000a", O2: "00000000-0000-0000-0000-00000000000b", C: "00000000-0000-0000-0000-00000000000c", V: "00000000-0000-0000-0000-00000000000d", X: "00000000-0000-0000-0000-00000000000e" };
export const L = { L1: "10000000-0000-0000-0000-000000000001", L2: "10000000-0000-0000-0000-000000000002" };

export async function createDb({ extraSetup = "" } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon; create role service_role;
    create schema auth; create schema katalist_priv;
    grant usage on schema public, auth, katalist_priv to authenticated, anon, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    alter default privileges in schema katalist_priv grant execute on functions to anon, authenticated, service_role;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant execute on function auth.uid() to authenticated, anon, service_role;
    create type public.list_role as enum ('collaborator','view_only');
    create table public.profiles (id uuid primary key, display_name text);
    create table public.actors (id uuid primary key default gen_random_uuid(), profile_id uuid unique references public.profiles(id));
    create type public.importance as enum ('now','next','later');
    create table public.lists (id uuid primary key, owner_profile_id uuid not null references public.profiles(id), archived_at timestamptz, name text default 'List');
    create table public.list_members (list_id uuid not null references public.lists(id) on delete cascade, profile_id uuid not null references public.profiles(id), role public.list_role not null, primary key (list_id, profile_id));
    create function katalist_priv.is_list_owner(_list_id uuid) returns boolean language sql stable security definer set search_path = 'pg_catalog','public','katalist_priv' as $$ select exists (select 1 from public.lists l where l.id = _list_id and l.owner_profile_id = auth.uid()); $$;
    create function katalist_priv.is_list_member(_list_id uuid, _roles public.list_role[] default null) returns boolean language sql stable security definer set search_path = 'pg_catalog','public','katalist_priv' as $$ select exists (select 1 from public.list_members m where m.list_id = _list_id and m.profile_id = auth.uid() and (_roles is null or m.role = any(_roles))); $$;
    create function katalist_priv.can_view_list(_list_id uuid) returns boolean language sql stable security definer set search_path = 'pg_catalog','public','katalist_priv' as $$ select katalist_priv.is_list_owner(_list_id) or katalist_priv.is_list_member(_list_id); $$;
    create function katalist_priv.can_create_thing_in_list(_list_id uuid) returns boolean language sql stable security definer set search_path = 'pg_catalog','public','katalist_priv' as $$
      select _list_id is null or (exists (select 1 from public.lists l where l.id = _list_id and l.archived_at is null)
        and (katalist_priv.is_list_owner(_list_id) or katalist_priv.is_list_member(_list_id, array['collaborator']::public.list_role[]))); $$;
    create function katalist_priv.current_actor_id() returns uuid language sql stable security definer set search_path = 'pg_catalog','public' as $$ select id from public.actors where profile_id = auth.uid(); $$;
    -- STAND-IN for the existing create_thing (migration 20260820133000): same signature and effect on what these tests observe.
    create table public.things (id uuid primary key default gen_random_uuid(), title text not null, notes text, creator_actor_id uuid, owner_actor_id uuid, current_assignee_actor_id uuid, list_id uuid, owner_importance public.importance, due_at timestamptz, acknowledgement text not null default 'waiting_for_catch');
    create function public.create_thing(p_title text, p_assignee_actor_id uuid default null, p_notes text default null, p_context text default null, p_owner_importance public.importance default null, p_personal_pace text default null, p_due_at timestamptz default null, p_due_has_time boolean default false, p_list_id uuid default null)
      returns public.things language plpgsql security definer set search_path = pg_catalog, public, katalist_priv as $$
      declare v_me uuid := katalist_priv.current_actor_id(); t public.things;
      begin
        if v_me is null then raise exception 'not authenticated'; end if;
        if not katalist_priv.can_create_thing_in_list(p_list_id) then raise exception 'you cannot create a Thing in that List'; end if;
        insert into public.things (title, notes, creator_actor_id, owner_actor_id, current_assignee_actor_id, list_id, owner_importance, due_at)
        values (btrim(p_title), p_notes, v_me, v_me, coalesce(p_assignee_actor_id, v_me), p_list_id, coalesce(p_owner_importance, 'next'), p_due_at) returning * into t;
        return t;
      end; $$;
    -- STAND-IN for katalist_priv.can_view_thing: a Thing is visible to its owner, its assignee, and (when it belongs to a List) to anyone who can view the List.
    create function katalist_priv.can_view_thing(_thing_id uuid) returns boolean language sql stable security definer set search_path = 'pg_catalog','public','katalist_priv' as $$
      select exists (select 1 from public.things t where t.id = _thing_id and (
        exists (select 1 from public.actors a where a.id in (t.owner_actor_id, t.current_assignee_actor_id) and a.profile_id = auth.uid())
        or (t.list_id is not null and katalist_priv.can_view_list(t.list_id)))); $$;
    ${extraSetup}
  `);
  for (const sql of drafts) await db.exec(sql);
  return db;
}

export async function reset(db, { allowlist = [L.L1, L.L2] } = {}) {
  await db.exec(`reset role;`);
  const tables = (await db.query(`select tablename from pg_tables where schemaname='public' and tablename not in ('profiles','lists','list_members')`)).rows.map((r) => `public.${r.tablename}`);
  await db.exec(`truncate ${[...tables, "public.list_members", "public.lists", "public.profiles"].join(", ")} cascade;`);
  await db.exec(`
    insert into public.profiles values ${Object.values(U).map((u, i) => `('${u}','${Object.keys(U)[i]} Person')`).join(",")};
    insert into public.actors (profile_id) select id from public.profiles;
    insert into public.lists (id, owner_profile_id) values ('${L.L1}','${U.O}'),('${L.L2}','${U.O2}');
    insert into public.list_members values ('${L.L1}','${U.C}','collaborator'),('${L.L1}','${U.V}','view_only');
    insert into public.code_activity_settings values ('master','true'::jsonb);
    ${allowlist.map((l) => `insert into public.code_activity_list_allowlist (list_id) values ('${l}');`).join("\n")}
  `);
}

/** PostgREST returns JSON: timestamps as ISO strings and bigints as numbers. PGlite returns Date and BigInt. */
function jsonShape(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return Number(value);
  if (Array.isArray(value)) return value.map(jsonShape);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, jsonShape(v)]));
  return value;
}

const signatures = new Map();
async function signature(db, name) {
  if (signatures.has(name)) return signatures.get(name);
  const row = (await db.query(
    `select p.proargnames, p.proretset, p.prorettype::regtype::text as rettype,
            array(select format_type(t, null) from unnest(p.proargtypes::oid[]) t) as types
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`,
    [name],
  )).rows[0];
  if (!row) {
    const error = Object.assign(new Error(`function ${name} does not exist`), { code: "PGRST202" });
    throw error;
  }
  signatures.set(name, row);
  return row;
}

/** A PostgREST-like client. `role`: authenticated (with `uid`) or service_role. */
export function rpcClient(db, role, uid = null, log = []) {
  return {
    async rpc(name, args) {
      let sig;
      try {
        sig = await signature(db, name);
      } catch (error) {
        return { data: null, error: { code: error.code, message: error.message } };
      }
      const keys = Object.keys(args);
      for (const key of keys) {
        if (!sig.proargnames.includes(key)) return { data: null, error: { code: "PGRST202", message: `no named argument ${key}` } };
      }
      const params = [];
      const parts = keys.map((key) => {
        const type = sig.types[sig.proargnames.indexOf(key)];
        let value = args[key];
        if (Array.isArray(value) && type.endsWith("[]")) value = `{${value.join(",")}}`; // PostgREST accepts a JSON array for an array argument
        else if (value !== null && typeof value === "object") value = JSON.stringify(value);
        if (value instanceof Uint8Array) throw new Error(`${name}.${key}: a byte array reached the RPC boundary (PostgREST would reject it)`);
        params.push(value === null ? null : String(value));
        return `${key} => $${params.length}::text::${type}`;
      });
      log.push({ name, args });
      await db.exec(`set role ${role}`);
      try {
        await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid ?? ""]);
        const rows = (await db.query(`select * from public.${name}(${parts.join(", ")})`, params)).rows;
        if (sig.proretset) return { data: jsonShape(rows), error: null };
        return { data: rows.length ? jsonShape(Object.values(rows[0])[0]) : null, error: null };
      } catch (error) {
        return { data: null, error: { code: error.code, message: error.message } };
      } finally {
        await db.exec("reset role");
      }
    },
  };
}
