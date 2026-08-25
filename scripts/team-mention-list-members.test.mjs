import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const migration = readdirSync(join(root, "supabase/migrations"))
  .find((name) => name.endsWith("_team_mentions_and_list_invitation_management.sql"));

test("accepted Team connections are included in private assignable people", () => {
  assert.ok(migration, "generated migration is missing");
  const sql = read(`supabase/migrations/${migration}`);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.list_assignable_people\(\)/i);
  assert.match(sql, /katalist_priv\.team_connections/i);
  assert.match(sql, /auth\.uid\(\)\s+IN\s*\(c\.profile_a_id,\s*c\.profile_b_id\)/i);
  assert.match(sql, /SET search_path = 'pg_catalog','public','katalist_priv'/i);
  assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.list_assignable_people\(\) FROM PUBLIC, anon/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.list_assignable_people\(\) TO authenticated/i);
});

test("List Owners can inspect and revoke only masked pending invitations", () => {
  assert.ok(migration, "generated migration is missing");
  const sql = read(`supabase/migrations/${migration}`);
  assert.match(sql, /phone_last4 text/i);
  assert.match(sql, /phone_last4 ~ '\^\\d\{4\}\$'/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.list_pending_list_invitations/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.revoke_list_invitation/i);
  assert.match(sql, /katalist_priv\.is_list_owner\(p_list_id\)/i);
  assert.doesNotMatch(sql, /RETURNS TABLE\s*\([^)]*(?:phone_hash|token_hash)/is);
  assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.list_pending_list_invitations/i);
  assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.revoke_list_invitation/i);
});

test("a repeated invite for the same List and phone replaces its active link", () => {
  assert.ok(migration, "generated migration is missing");
  const sql = read(`supabase/migrations/${migration}`);
  assert.match(sql, /UPDATE katalist_priv\.list_invitations/i);
  assert.match(sql, /phone_hash\s*=\s*p_phone_hash/i);
  assert.match(sql, /token_hash\s*=\s*p_token_hash/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.replace_list_invitation_server/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.replace_list_invitation_server[^;]+TO service_role/is);
  assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.replace_list_invitation_server[^;]+FROM PUBLIC, anon, authenticated/is);
});

test("server List invitations store only the phone suffix alongside hashes", () => {
  const server = read("src/features/lists/server/list-invitations.ts");
  assert.match(server, /p_phone_last4:\s*phone\.slice\(-4\)/);
  assert.doesNotMatch(server, /phone_e164:\s*phone/);
});

test("Team mutations invalidate mention and identity caches", () => {
  const team = read("src/routes/team.tsx");
  for (const key of ["team-directory", "team-requests", "assignable-people", "profile-directory"]) {
    assert.match(team, new RegExp(`queryKey:\\s*\\[\"${key}\\"\\]`));
  }
});

test("accepting either invitation invalidates Team and mention caches", () => {
  for (const path of ["src/routes/team-invitations.accept.tsx", "src/routes/list-invitations.accept.tsx"]) {
    const route = read(path);
    for (const key of ["team-directory", "team-requests", "assignable-people", "profile-directory"]) {
      assert.match(route, new RegExp(key));
    }
    assert.match(route, /showMagicBox=\{false\}/);
  }
});
