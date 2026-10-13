import assert from "node:assert/strict";
import { test } from "node:test";
import { limiterKey, normalizePhone, phoneAuthConfig, publicLoginConfig, staticPhoneLogin } from "../server/lib/phone-auth.ts";

const PROD = { KATALIST_ENV: "production", NODE_ENV: "production" };
const STATIC = { ...PROD, KATALIST_PHONE_AUTH_MODE: "static", KATALIST_STATIC_LOGIN_CODE: "482913", SUPABASE_SERVICE_ROLE_KEY: "x" };

test("modes: static needs an explicit server code; the off switch wins; production never uses the old VITE test code; sms exposes nothing", () => {
  assert.deepEqual(phoneAuthConfig(STATIC), { mode: "static", staticCode: "482913" });
  assert.equal(phoneAuthConfig({ ...STATIC, KATALIST_STATIC_LOGIN_DISABLED: "true" }).mode, "off");
  assert.equal(phoneAuthConfig({ ...STATIC, KATALIST_STATIC_LOGIN_CODE: "12ab" }).mode, "off");
  assert.equal(phoneAuthConfig({ ...PROD, VITE_KATALIST_FIXED_OTP: "111111" }).mode, "off");
  assert.equal(phoneAuthConfig({ NODE_ENV: "development", VITE_KATALIST_FIXED_OTP: "111111" }).mode, "static");
  assert.deepEqual(publicLoginConfig({ ...STATIC, KATALIST_PHONE_AUTH_MODE: "sms" }), { mode: "sms", staticCode: null });
  assert.deepEqual(Object.keys(publicLoginConfig(STATIC)).sort(), ["mode", "staticCode"]);
});

test("numbers normalise to one canonical E.164 form", () => {
  for (const v of ["+91 98765 43210", "+919876543210", "+91 (98765) 43210"]) assert.equal(normalizePhone(v), "+919876543210");
  for (const v of ["9876543210", "+91 12345 67890", "+9198765", "abc", "", null, "+0 123"]) assert.equal(normalizePhone(v), null, String(v));
  assert.notEqual(limiterKey("phone", "+919876543210", STATIC), limiterKey("ip", "+919876543210", STATIC));
  assert.match(limiterKey("phone", "+919876543210", STATIC), /^[0-9a-f]{64}$/);
});

function fakeAdmin({ allowed = true, existing = null, createFails = false } = {}) {
  const calls = { rpc: [], create: 0, link: 0 };
  let created = existing;
  return {
    calls,
    admin: {
      rpc: async (fn, args) => { calls.rpc.push({ fn, args }); return { data: { allowed, retry_after_s: allowed ? 0 : 600 }, error: null }; },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: created ? { id: created.id } : null, error: null }) }) }) }),
      auth: { admin: {
        getUserById: async () => ({ data: { user: created }, error: null }),
        listUsers: async () => ({ data: { users: created ? [created] : [] }, error: null }),
        createUser: async (attrs) => {
          calls.create++;
          if (createFails) { created = { id: "u-raced", email: attrs.email, phone: attrs.phone }; return { data: { user: null }, error: new Error("duplicate") }; }
          created = { id: "u-new", email: attrs.email, phone: attrs.phone, phone_confirm: attrs.phone_confirm };
          calls.createAttrs = attrs;
          return { data: { user: created }, error: null };
        },
        generateLink: async () => { calls.link++; return { data: { properties: { hashed_token: "hash" } }, error: null }; },
      } },
    },
  };
}
const login = (admin, over = {}) => staticPhoneLogin({ admin, phone: "+91 98765 43210", code: "482913", ip: "203.0.113.5", maintenance: false, env: STATIC, ...over });

test("the server decides: wrong, missing and malformed codes are rejected before any account work", async () => {
  for (const code of ["000000", "", undefined, "48291", 482913]) {
    const { admin, calls } = fakeAdmin();
    const r = await login(admin, { code });
    assert.equal(r.ok, false);
    assert.equal(r.code, "wrong_code");
    assert.equal(r.status, 401);
    assert.equal(calls.create + calls.link, 0);
  }
  const { admin } = fakeAdmin();
  assert.equal((await login(admin, { phone: "12345" })).code, "invalid_phone");
  assert.equal((await login(admin, { maintenance: true })).code, "maintenance");
  assert.equal((await staticPhoneLogin({ admin, phone: "+919876543210", code: "482913", ip: "", maintenance: false, env: PROD })).code, "disabled");
});

test("the persistent limiter is consulted with hashed keys and can refuse", async () => {
  const { admin, calls } = fakeAdmin({ allowed: false });
  const r = await login(admin);
  assert.equal(r.code, "rate_limited");
  assert.equal(r.status, 429);
  assert.equal(calls.rpc[0].fn, "phone_login_attempt");
  assert.doesNotMatch(JSON.stringify(calls.rpc[0].args), /9876543210|203\.0\.113/);
});

test("a correct code creates one account with the canonical number, unconfirmed; existing and raced accounts are reused", async () => {
  const fresh = fakeAdmin();
  const r = await login(fresh.admin);
  assert.equal(r.ok, true);
  assert.equal(fresh.calls.createAttrs.phone, "+919876543210");
  assert.equal(fresh.calls.createAttrs.phone_confirm, false, "a shown code never verifies phone ownership");
  assert.equal(fresh.calls.createAttrs.email, "user-919876543210@users.katalist.invalid");
  const existing = fakeAdmin({ existing: { id: "u-old", email: "user-919876543210@users.katalist.invalid" } });
  assert.equal((await login(existing.admin)).ok, true);
  assert.equal(existing.calls.create, 0);
  const raced = fakeAdmin({ createFails: true });
  assert.equal((await login(raced.admin)).email, "user-919876543210@users.katalist.invalid");
});
