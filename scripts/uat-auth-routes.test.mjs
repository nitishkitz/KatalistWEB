import assert from "node:assert/strict";
import test from "node:test";

import { createUatRequestHandler, createUatVerifyHandler } from "@/lib/auth/uat-auth.server";

const validUatEnv = {
  KATALIST_ENV: "uat",
  KATALIST_UAT_FIXED_OTP: "111111",
  KATALIST_UAT_AUTH_PEPPER: "pepper-for-tests-only",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "publishable",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
};

const url = "https://uat.example.test/api/uat-auth/verify";

function jsonRequest(body, headers = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.8", ...headers },
    body: JSON.stringify(body),
  });
}

function fakeDeps(result) {
  return {
    consumeRateLimit: async () => true,
    findProfileByPhone: async () => null,
    createUser: async () => {},
    signInExisting: async () => ({ access_token: "access", refresh_token: "refresh" }),
    signIn: async () => ({ access_token: "access", refresh_token: "refresh" }),
    ...result,
  };
}

test("malformed JSON is rejected", async () => {
  const requestHandler = createUatRequestHandler({
    env: validUatEnv,
    deps: fakeDeps(),
  });
  assert.equal((await requestHandler(new Request(url, { method: "POST", body: "{" }))).status, 400);
});

test("non-UAT handlers return 404", async () => {
  const nonUatHandler = createUatVerifyHandler({
    env: { KATALIST_ENV: "production" },
    deps: fakeDeps(),
  });
  const validRequest = jsonRequest({ phone: "+919876543210", otp: "111111" });
  assert.equal((await nonUatHandler(validRequest)).status, 404);
});

test("fresh verify returns needs_profile", async () => {
  const needsProfileHandler = createUatVerifyHandler({
    env: validUatEnv,
    deps: fakeDeps(),
  });
  const validRequest = jsonRequest({ phone: "+919876543210", otp: "111111" });
  assert.deepEqual(await (await needsProfileHandler(validRequest)).json(), { status: "needs_profile" });
});

test("successful verify returns a session payload", async () => {
  const successHandler = createUatVerifyHandler({
    env: validUatEnv,
    deps: fakeDeps({
      findProfileByPhone: async () => ({ id: "profile-1" }),
    }),
  });
  const validRequest = jsonRequest({ phone: "+919876543210", otp: "111111" });
  assert.deepEqual(await (await successHandler(validRequest)).json(), {
    status: "authenticated",
    session: { access_token: "access", refresh_token: "refresh" },
  });
});

test("responses are not cached", async () => {
  const handler = createUatRequestHandler({ env: validUatEnv, deps: fakeDeps() });
  const response = await handler(jsonRequest({ phone: "+919876543210" }));
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.status, 200);
});
