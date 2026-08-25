import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const sql = await readFile(new URL("../supabase/migrations/20260825102422_list_collaboration_desktop.sql", import.meta.url), "utf8");

test("List metadata and private collaboration records are constrained", () => {
  assert.match(sql, /ADD COLUMN IF NOT EXISTS description text/i);
  assert.match(sql, /length\(description\) <= 500/i);
  assert.match(sql, /CREATE TABLE katalist_priv\.team_connections/i);
  assert.match(sql, /CREATE TABLE katalist_priv\.list_invitations/i);
  assert.match(sql, /token_hash bytea/i);
  assert.match(sql, /expires_at timestamptz/i);
});

test("public List RPCs authenticate internally and keep Owner out of members", () => {
  for (const name of ["create_list_v2", "update_list_metadata", "list_list_roster", "add_connected_list_member", "change_list_role", "remove_list_member", "list_team_directory"]) {
    assert.match(sql, new RegExp(`FUNCTION public\\.${name}`, "i"));
  }
  assert.match(sql, /auth\.uid\(\) IS NULL/i);
  assert.match(sql, /Owner is not a member row/i);
  assert.match(sql, /SET search_path = 'pg_catalog','public','katalist_priv'/i);
});

test("invite acceptance atomically creates mutual Team and List membership", () => {
  assert.match(sql, /FUNCTION public\.accept_list_invitation_server/i);
  assert.match(sql, /INSERT INTO katalist_priv\.team_connections/i);
  assert.match(sql, /INSERT INTO public\.list_members/i);
  assert.match(sql, /accepted_at = clock_timestamp\(\)/i);
  assert.match(sql, /auth\.role\(\) <> 'service_role'/i);
});

test("private collaboration tables and storage metadata are not exposed", () => {
  assert.doesNotMatch(sql, /GRANT\s+(?:ALL|SELECT|INSERT|UPDATE|DELETE)[\s\S]*ON\s+katalist_priv\.(?:team_connections|list_invitations)\s+TO\s+(?:anon|authenticated)/i);
  assert.doesNotMatch(sql, /(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?storage\.(?:buckets|objects)/i);
  assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.create_list_invitation_server/i);
});
