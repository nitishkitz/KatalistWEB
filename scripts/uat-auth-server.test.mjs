import assert from "node:assert/strict";
import test from "node:test";

import { requestUatOtp, verifyUatOtp } from "@/lib/auth/uat-auth.server";

const validUatEnv = {
  KATALIST_ENV: "uat",
  KATALIST_UAT_FIXED_OTP: "111111",
  KATALIST_UAT_AUTH_PEPPER: "pepper-for-tests-only",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "publishable",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
};

const validInput = { phone: "+919876543210", otp: "111111" };
const profile = { fullName: "Naga Reddy", age: "29", occupation: "Designer" };

function fakeDeps(overrides = {}) {
  const state = {
    profile: overrides.profile === undefined ? null : overrides.profile,
    consumeCalls: [],
    createUserCalls: [],
    signInCalls: [],
    findCalls: [],
    consumeImpl: overrides.consumeImpl,
    createUserImpl: overrides.createUserImpl,
  };
  return {
    consumeCalls: state.consumeCalls,
    createUserCalls: state.createUserCalls,
    signInCalls: state.signInCalls,
    findCalls: state.findCalls,
    async consumeRateLimit(scopeHash, limit, windowSeconds) {
      state.consumeCalls.push({ scopeHash, limit, windowSeconds });
      if (state.consumeImpl) return state.consumeImpl(scopeHash, limit, windowSeconds);
      return true;
    },
    async findProfileByPhone(phone) {
      state.findCalls.push(phone);
      return state.profile;
    },
    async createUser(input) {
      state.createUserCalls.push(input);
      if (state.createUserImpl) return state.createUserImpl(input);
    },
    async signIn(phone, password) {
      state.signInCalls.push({ phone, password });
      return { access_token: "access", refresh_token: "refresh" };
    },
  };
}

test("fresh valid OTP does not create before profile submission", async () => {
  const deps = fakeDeps({ profile: null });
  const result = await verifyUatOtp(
    { phone: "+919876543210", otp: "111111" },
    { ip: "203.0.113.8", env: validUatEnv },
    deps,
  );
  assert.deepEqual(result, { status: "needs_profile" });
  assert.equal(deps.createUserCalls.length, 0);
  assert.equal(deps.signInCalls.length, 0);
});

test("non-UAT returns a not-found error before dependencies run", async () => {
  const deps = fakeDeps();
  await assert.rejects(
    verifyUatOtp(validInput, { ip: "203.0.113.8", env: { KATALIST_ENV: "production" } }, deps),
    (error) => error.status === 404,
  );
  assert.equal(deps.consumeCalls.length, 0);
  assert.equal(deps.findCalls.length, 0);
});

test("invalid OTP does not create a user", async () => {
  const deps = fakeDeps();
  await assert.rejects(
    verifyUatOtp({ phone: "+919876543210", otp: "000000" }, { ip: "203.0.113.8", env: validUatEnv }, deps),
    (error) => error.status === 401 && error.code === "invalid_code",
  );
  assert.equal(deps.createUserCalls.length, 0);
  assert.equal(deps.signInCalls.length, 0);
});

test("complete profile creates then signs in", async () => {
  const deps = fakeDeps({ profile: null });
  const result = await verifyUatOtp(
    { ...validInput, profile },
    { ip: "203.0.113.8", env: validUatEnv },
    deps,
  );
  assert.equal(result.status, "authenticated");
  assert.equal(deps.createUserCalls.length, 1);
  assert.equal(deps.createUserCalls[0].profile.fullName, "Naga Reddy");
  assert.equal(deps.createUserCalls[0].profile.age, 29);
  assert.equal(deps.signInCalls.length, 1);
  assert.equal(deps.signInCalls[0].phone, "+919876543210");
  assert.notEqual(deps.signInCalls[0].password, "111111");
});

test("returning phone signs in without creating", async () => {
  const deps = fakeDeps({ profile: { id: "profile-1" } });
  const result = await verifyUatOtp(validInput, { ip: "203.0.113.8", env: validUatEnv }, deps);
  assert.equal(result.status, "authenticated");
  assert.equal(deps.createUserCalls.length, 0);
  assert.equal(deps.signInCalls.length, 1);
});

test("concurrent create conflict re-reads the profile and never overwrites", async () => {
  let created = false;
  const deps = fakeDeps({
    createUserImpl: async () => {
      created = true;
      throw Object.assign(new Error("User already registered"), { code: "phone_exists" });
    },
  });
  deps.findProfileByPhone = async () => (created ? { id: "profile-1" } : null);
  const result = await verifyUatOtp(
    { ...validInput, profile },
    { ip: "203.0.113.8", env: validUatEnv },
    deps,
  );
  assert.equal(result.status, "authenticated");
  assert.equal(deps.createUserCalls.length, 1);
  assert.equal(deps.signInCalls.length, 1);
});

test("rate limiting stops the broker before create or sign-in", async () => {
  const deps = fakeDeps({
    consumeImpl: async () => false,
  });
  await assert.rejects(
    verifyUatOtp({ ...validInput, profile }, { ip: "203.0.113.8", env: validUatEnv }, deps),
    (error) => error.status === 429,
  );
  assert.equal(deps.createUserCalls.length, 0);
  assert.equal(deps.signInCalls.length, 0);
});

test("request OTP validates the phone and does not create a user", async () => {
  const deps = fakeDeps();
  const result = await requestUatOtp({ phone: "+91 98765 43210" }, { ip: "203.0.113.8", env: validUatEnv }, deps);
  assert.deepEqual(result, { ok: true });
  assert.equal(deps.createUserCalls.length, 0);
});
