// Replays every supabase/migrations file, in filename order, into an in-memory
// PGlite database with a minimal Supabase shim (auth, storage, roles,
// realtime publication). Used for database behaviour tests and the empty
// database rehearsal; it is not a substitute for managed Supabase Auth/Storage.
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const dir = new URL("../../supabase/migrations/", import.meta.url);

export const SHIM = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN CREATE ROLE supabase_auth_admin NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_storage_admin') THEN CREATE ROLE supabase_storage_admin NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN CREATE ROLE authenticator NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN CREATE ROLE postgres; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS realtime;
CREATE SCHEMA IF NOT EXISTS vault;
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, phone text, raw_user_meta_data jsonb DEFAULT '{}',
  raw_app_meta_data jsonb DEFAULT '{}', created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  last_sign_in_at timestamptz, email_confirmed_at timestamptz, phone_confirmed_at timestamptz, is_anonymous boolean DEFAULT false,
  deleted_at timestamptz, banned_until timestamptz, aud text, role text
);
CREATE TABLE IF NOT EXISTS auth.sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), refreshed_at timestamp, user_agent text, ip inet, not_after timestamptz, aal text, factor_id uuid, tag text);
CREATE TABLE IF NOT EXISTS auth.refresh_tokens (id bigserial PRIMARY KEY, token text, user_id text, revoked boolean, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), parent text, session_id uuid);
CREATE TABLE IF NOT EXISTS auth.identities (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, provider text, identity_data jsonb, provider_id text, created_at timestamptz DEFAULT now());
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $f$ SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'authenticated') $f$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $f$ SELECT jsonb_build_object('sub', auth.uid(), 'role', auth.role(), 'session_id', nullif(current_setting('request.jwt.claim.session_id', true), '')) $f$;
CREATE OR REPLACE FUNCTION auth.email() RETURNS text LANGUAGE sql STABLE AS $f$ SELECT (SELECT email FROM auth.users WHERE id = auth.uid()) $f$;
CREATE TABLE IF NOT EXISTS storage.buckets (id text PRIMARY KEY, name text, public boolean DEFAULT false, file_size_limit bigint, allowed_mime_types text[], owner uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid, owner_id text, metadata jsonb, path_tokens text[], created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), last_accessed_at timestamptz, version text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $f$ SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $f$;
CREATE OR REPLACE FUNCTION storage.filename(name text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$ SELECT (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)] $f$;
CREATE OR REPLACE FUNCTION storage.extension(name text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$ SELECT reverse(split_part(reverse(name), '.', 1)) $f$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN CREATE PUBLICATION supabase_realtime; END IF; END $$;
GRANT USAGE ON SCHEMA public, auth, storage, extensions TO anon, authenticated, service_role;
CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions;
-- Stand-ins for hosted extensions PGlite cannot install (pg_cron, pg_net) and Vault views.
CREATE SCHEMA IF NOT EXISTS cron;
CREATE TABLE IF NOT EXISTS cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text);
CREATE OR REPLACE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS $f$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_schedule, p_command)
  ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command RETURNING jobid $f$;
CREATE OR REPLACE FUNCTION cron.unschedule(p_name text) RETURNS boolean LANGUAGE sql AS $f$ DELETE FROM cron.job WHERE jobname = p_name RETURNING true $f$;
CREATE SCHEMA IF NOT EXISTS net;
CREATE TABLE IF NOT EXISTS net.requests (id bigserial PRIMARY KEY, url text, headers jsonb, body jsonb);
CREATE OR REPLACE FUNCTION net.http_post(url text, headers jsonb DEFAULT '{}', body jsonb DEFAULT '{}', timeout_milliseconds int DEFAULT 5000) RETURNS bigint
  LANGUAGE sql AS $f$ INSERT INTO net.requests (url, headers, body) VALUES (url, headers, body) RETURNING id $f$;
CREATE TABLE IF NOT EXISTS vault.secrets (name text PRIMARY KEY, secret text);
CREATE OR REPLACE VIEW vault.decrypted_secrets AS SELECT name, secret AS decrypted_secret FROM vault.secrets;
-- Supabase platform event-trigger helper referenced by early migrations.
CREATE OR REPLACE FUNCTION public.rls_auto_enable() RETURNS event_trigger LANGUAGE plpgsql AS $f$ BEGIN END $f$;
`;

export function migrationFiles() {
  return readdirSync(dir).filter((f) => f.endsWith(".sql")).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Returns the database plus a per-file report. `stopOnError` throws on the first failure. */
export async function replayMigrations({ stopOnError = true, only } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SHIM);
  const report = [];
  for (const file of migrationFiles()) {
    if (only && !only(file)) continue;
    // Hosted-only extensions are stood in for by the shim above.
    const sql = readFileSync(new URL(file, dir), "utf8").replace(/^CREATE EXTENSION IF NOT EXISTS (pg_net|pg_cron)\b.*$/gm, "");
    try {
      await db.exec(sql);
      report.push({ file, ok: true });
    } catch (error) {
      report.push({ file, ok: false, error: error.message });
      if (stopOnError) {
        await db.close();
        throw new Error(`${file}: ${error.message}`);
      }
    }
  }
  return { db, report };
}

/** Switch the session to an authenticated user (or another role). */
export async function actAs(db, profileId, role = "authenticated") {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${profileId ?? ""}', false); SELECT set_config('request.jwt.claim.role', '${role}', false);`);
  if (role !== "postgres") await db.exec(`SET ROLE ${role}`);
}

/** Creates an auth user (the signup trigger creates the profile and actor). */
export async function createUser(db, { id, name, phone = null, email = null }) {
  await db.exec("RESET ROLE");
  await db.query(
    "INSERT INTO auth.users (id, email, phone, raw_user_meta_data) VALUES ($1, $2, $3, $4)",
    [id, email ?? `${name.toLowerCase().replace(/\s+/g, ".")}@example.test`, phone, JSON.stringify({ display_name: name, full_name: name })],
  );
  const actor = (await db.query("SELECT id FROM public.actors WHERE profile_id = $1", [id])).rows[0]?.id;
  return { id, actorId: actor };
}
