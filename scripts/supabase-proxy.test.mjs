import assert from "node:assert/strict";
import { test } from "node:test";
import { toProxiedUrl } from "@/integrations/supabase/proxy";

const SUPABASE = "https://abc.supabase.co";
const BASE = "https://app.example.com/supabase";

test("API and storage URLs on the project are rewritten to the proxy", () => {
  assert.equal(toProxiedUrl(`${SUPABASE}/auth/v1/token?grant_type=otp`, SUPABASE, BASE), `${BASE}/auth/v1/token?grant_type=otp`);
  assert.equal(toProxiedUrl(`${SUPABASE}/rest/v1/rpc/list_my_sessions`, SUPABASE, BASE), `${BASE}/rest/v1/rpc/list_my_sessions`);
  assert.equal(
    toProxiedUrl(`${SUPABASE}/storage/v1/object/public/avatars/u/avatar.png?v=1`, SUPABASE, BASE),
    `${BASE}/storage/v1/object/public/avatars/u/avatar.png?v=1`,
  );
});

test("realtime, other hosts and relative URLs are left alone", () => {
  assert.equal(toProxiedUrl(`${SUPABASE}/realtime/v1/websocket`, SUPABASE, BASE), `${SUPABASE}/realtime/v1/websocket`);
  assert.equal(toProxiedUrl("https://other.supabase.co/auth/v1/token", SUPABASE, BASE), "https://other.supabase.co/auth/v1/token");
  assert.equal(toProxiedUrl("/avatars/priya.jpg", SUPABASE, BASE), "/avatars/priya.jpg");
  assert.equal(toProxiedUrl(`${SUPABASE}/auth/v1/token`, SUPABASE, null), `${SUPABASE}/auth/v1/token`);
});
