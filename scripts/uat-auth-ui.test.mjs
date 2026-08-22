import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createUatAuthController } from "@/lib/auth/uat-client";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const authSource = readFileSync(join(root, "src/routes/auth.tsx"), "utf8");

test("auth page uses the UAT broker and a real Supabase session", () => {
  assert.match(authSource, /\/api\/uat-auth\/request/);
  assert.match(authSource, /\/api\/uat-auth\/verify/);
  assert.match(authSource, /supabase\.auth\.setSession/);
  assert.doesNotMatch(authSource, /signInAsDemo\(outcome\.persona\)/);
  assert.doesNotMatch(authSource, /localFixedOtp/);
  assert.doesNotMatch(authSource, />\s*Optional\s*</i);
  assert.match(authSource, /Full name/);
  assert.match(authSource, /Age/);
  assert.match(authSource, /Occupation/);
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("a fresh phone reaches needs_profile and invalid fields do not verify again", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(String(init.body ?? "{}"));
    calls.push({ url: String(url), body });
    if (String(url).includes("/api/uat-auth/request")) return jsonResponse({ ok: true });
    if (!body.profile) return jsonResponse({ status: "needs_profile" });
    return jsonResponse({
      status: "authenticated",
      session: { access_token: "access", refresh_token: "refresh" },
    });
  };

  const flow = createUatAuthController(fetchImpl);
  await flow.request("+919876543210");
  assert.deepEqual(await flow.verifyOtp("+919876543210", "111111"), { status: "needs_profile" });
  assert.equal(flow.verifyCount, 1);

  const invalid = await flow.submitProfile("+919876543210", "111111", {
    fullName: "",
    age: "0",
    occupation: "",
  });
  assert.equal(invalid.status, "invalid_profile");
  assert.equal(flow.verifyCount, 1);
  assert.equal(calls.filter((call) => String(call.url).includes("/verify")).length, 1);

  const valid = await flow.submitProfile("+919876543210", "111111", {
    fullName: "Naga Reddy",
    age: "29",
    occupation: "Designer",
  });
  assert.equal(valid.status, "authenticated");
  assert.equal(flow.verifyCount, 2);
  assert.equal(calls.filter((call) => String(call.url).includes("/verify")).length, 2);
});
