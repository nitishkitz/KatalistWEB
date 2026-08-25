import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = new URL("../supabase/migrations/20260825125932_collaboration_notifications_bucket_pins.sql", import.meta.url);
const sql = readFileSync(migration, "utf8");

test("collaboration migration persists bucket pins with an owner-scoped RPC", () => {
  assert.match(sql, /alter table public\.buckets\s+add column if not exists pinned_at timestamptz/i);
  assert.match(sql, /function public\.set_bucket_pinned\(p_bucket_id uuid, p_pinned boolean\)/i);
  assert.match(sql, /owner_profile_id\s*=\s*auth\.uid\(\)/i);
  assert.match(sql, /revoke execute on function public\.set_bucket_pinned[^;]+from public, anon/i);
});

test("collaboration events create recipient-owned notifications with trusted paths", () => {
  for (const fn of [
    "katalist_priv.notify_profile", "katalist_priv.notify_list_participants",
    "public.request_team_connection", "public.accept_team_request",
    "public.accept_team_invitation_server", "public.create_list_invitation_server",
    "public.accept_list_invitation_server", "public.add_connected_list_member",
    "public.change_list_role", "public.remove_list_member", "public.notify_on_list_message",
  ]) assert.match(sql, new RegExp(`function ${fn.replaceAll(".", "\\.")}`, "i"));
  assert.match(sql, /'\/team'/i);
  assert.match(sql, /'\/lists\/'\s*\|\|\s*p_list_id::text/i);
  assert.match(sql, /new\.author_profile_id/i);
  assert.match(sql, /left\(new\.body,\s*160\)/i);
  assert.doesNotMatch(sql, /grant\s+[^;]*notifications[^;]*\s+to\s+anon/i);
});

test("push claims include a trusted explicit path and nudge delivery stays intact", () => {
  assert.match(sql, /function public\.claim_notification_deliveries/i);
  assert.match(sql, /path text/i);
  assert.match(sql, /n\.payload\s*->>\s*'path'/i);
  assert.match(sql, /'nudged'/i);
  assert.match(sql, /set search_path (?:=|to) 'pg_catalog',\s*'public',\s*'katalist_priv'/i);
});
