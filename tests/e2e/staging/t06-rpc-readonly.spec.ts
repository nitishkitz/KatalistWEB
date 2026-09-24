import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Read-only deployed-schema smoke. Requires an explicitly configured staging
 * backend and disposable email/password account. No service-role key, writes,
 * fixture creation, or production default is used here.
 *
 * This proves function availability and one account's invoker-visible rows.
 * It cannot prove unrelated-user RLS without a second isolated account.
 */
const url = process.env.KATALIST_STAGING_SUPABASE_URL;
const key = process.env.KATALIST_STAGING_SUPABASE_PUBLISHABLE_KEY;
const email = process.env.KATALIST_TEST_ACCOUNT_EMAIL;
const password = process.env.KATALIST_TEST_ACCOUNT_PASSWORD;
let client: SupabaseClient;

test.beforeAll(async () => {
  if (!url || !key || !email || !password) {
    throw new Error("T06 staging RPC check requires KATALIST_STAGING_SUPABASE_URL, KATALIST_STAGING_SUPABASE_PUBLISHABLE_KEY, and disposable KATALIST_TEST_ACCOUNT_EMAIL/PASSWORD.");
  }
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new Error(`Staging test account sign-in failed: ${error?.message ?? "no user"}`);
});

test("all six T06 read RPCs are deployed and executable by the staging user", async () => {
  const absent = "00000000-0000-0000-0000-000000000001";
  const checks: Array<[string, Record<string, unknown>]> = [
    ["get_thing_overview_stats", { p_thing_ids: [absent], p_last_reads: [null], p_context: "work" }],
    ["get_list_overview_counts", { p_list_ids: [absent] }],
    ["get_hub_conversation_page", { p_limit: 1, p_cursor_at: null, p_cursor_id: null }],
    ["get_hub_unread_counts", { p_list_ids: [absent], p_last_reads: [null] }],
    ["get_bucket_progress", { p_bucket_ids: [absent] }],
    ["get_trophy_activity_stats", { p_timezone: "UTC" }],
  ];
  for (const [name, args] of checks) {
    const { data, error } = await client.rpc(name, args);
    expect(error, `${name}: ${error?.message ?? "unknown RPC error"}`).toBeNull();
    expect(Array.isArray(data), `${name} should return a table-shaped result`).toBe(true);
  }
});

test("anonymous callers cannot execute T06 aggregates", async () => {
  const anon = createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } });
  for (const [name, args] of [
    ["get_list_overview_counts", { p_list_ids: ["00000000-0000-0000-0000-000000000001"] }],
    ["get_bucket_progress", { p_bucket_ids: ["00000000-0000-0000-0000-000000000001"] }],
    ["get_trophy_activity_stats", { p_timezone: "UTC" }],
  ] as const) {
    const { error } = await anon.rpc(name, args);
    expect(error, `${name} must not be callable as anon`).not.toBeNull();
  }
});

test("a visible Thing's deployed overview count matches this caller's authorized rows", async () => {
  const { data: things, error: thingError } = await client.from("things").select("id,context").limit(1);
  expect(thingError).toBeNull();
  expect(things?.length, "seed at least one disposable Thing for the staging test account").toBeGreaterThan(0);
  const thing = things![0]!;
  const { data: stats, error: statsError } = await client.rpc("get_thing_overview_stats", {
    p_thing_ids: [thing.id], p_last_reads: [null], p_context: thing.context,
  });
  expect(statsError).toBeNull();
  expect(stats).toHaveLength(1);
  const { count: comments, error: commentsError } = await client.from("thing_comments")
    .select("id", { count: "exact", head: true }).eq("thing_id", thing.id).is("deleted_at", null);
  expect(commentsError).toBeNull();
  const { count: files, error: filesError } = await client.from("thing_attachments")
    .select("id", { count: "exact", head: true }).eq("thing_id", thing.id)
    .eq("status", "ready").not("storage_key", "is", null);
  expect(filesError).toBeNull();
  expect(stats![0].thing_id).toBe(thing.id);
  expect(stats![0].comment_count).toBe(comments);
  expect(stats![0].attachment_count).toBe(files);
});
