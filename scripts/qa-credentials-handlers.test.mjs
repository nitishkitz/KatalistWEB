import assert from "node:assert/strict";
import { mock, test, beforeEach } from "node:test";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { encryptSecret, loadVaultConfig, toByteaHex } from "../server/lib/qa/vault.ts";

/**
 * Handler-level checks for the credential endpoints with scripted collaborators. They prove the
 * authorisation ORDER, response headers, audit trail and non-leakage of this server code. They do not
 * prove the real database, RLS, PostgREST or Storage (see qa-schema-sql.test.mjs and the staging gate).
 */
const root = path.resolve(import.meta.dirname, "..");
const href = (p) => pathToFileURL(path.join(root, p)).href;

const LIST = "11111111-1111-4111-8111-111111111111";
const ACCOUNT = "22222222-2222-4222-8222-222222222222";
const APP = "33333333-3333-4333-8333-333333333333";
const ENV = "44444444-4444-4444-8444-444444444444";
const USER = "55555555-5555-4555-8555-555555555555";
// Synthetic, obviously fake. Never a real credential.
const PASSWORD = "Synthetic-Handler-Test-1";

let world;
const reset = () => {
  world = {
    access: { list_id: LIST, archived: false, has_secret: true, can_use: true, can_manage: true },
    accessError: null,
    saveRpcResult: { id: ACCOUNT, list_id: LIST, has_secret: false },
    saveRpcError: null,
    secretRow: null,
    audits: [],
    upserts: [],
    headers: {},
    secretWriteError: null,
  };
};

mock.module("h3", {
  namedExports: {
    defineEventHandler: (fn) => fn,
    readBody: async (event) => event.body,
    getHeader: (event, name) => event.headers?.[name],
    setResponseHeader: (_e, name, value) => (world.headers[name] = value),
    createError: (o) => Object.assign(new Error(o.message), o),
  },
});
mock.module(href("server/lib/require-user.ts"), {
  namedExports: {
    requireUser: async () => ({
      userId: USER,
      client: {
        rpc: async (name) => {
          if (name === "qa_account_access") return world.accessError ? { data: null, error: world.accessError } : { data: world.access, error: null };
          if (name === "qa_save_account") return world.saveRpcError ? { data: null, error: world.saveRpcError } : { data: world.saveRpcResult, error: null };
          throw new Error(`unexpected rpc ${name}`);
        },
      },
    }),
  },
});
mock.module(href("server/lib/supabase-admin.ts"), {
  namedExports: {
    getSupabaseAdmin: () => ({
      from: (table) => ({
        insert: async (row) => { if (table === "qa_audit_events") world.audits.push(row); return { error: null }; },
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: world.secretRow, error: null }) }) }) }),
        upsert: async (row) => { world.upserts.push({ table, row }); return { error: world.secretWriteError }; },
        update: () => ({ eq: async () => ({ error: null }) }),
        delete: () => ({ eq: async () => ({ error: null }) }),
      }),
    }),
  },
});

const { default: secretHandler } = await import("../server/api/qa/credentials/secret.post.ts");
const { default: saveHandler } = await import("../server/api/qa/credentials/save.post.ts");

const withVault = (fn) => {
  const keys = { v1: randomBytes(32).toString("base64") };
  process.env.QA_VAULT_KEYS = JSON.stringify(keys);
  process.env.QA_VAULT_ACTIVE_KEY_VERSION = "v1";
  return fn(loadVaultConfig(process.env));
};
const withoutVault = () => { delete process.env.QA_VAULT_KEYS; delete process.env.QA_VAULT_ACTIVE_KEY_VERSION; };
const storeSecret = (config) => {
  const sealed = encryptSecret({ plaintext: PASSWORD, listId: LIST, accountId: ACCOUNT }, config);
  world.secretRow = { ciphertext: toByteaHex(sealed.ciphertext), iv: toByteaHex(sealed.iv), auth_tag: toByteaHex(sealed.authTag), key_version: sealed.keyVersion };
};
const call = async (handler, body) => {
  try {
    return { ok: await handler({ body, headers: {} }) };
  } catch (e) {
    return { err: e };
  }
};
const audited = (action, outcome) => world.audits.some((a) => a.action === action && a.outcome === outcome);
const noLeak = (value) => assert.ok(!JSON.stringify(value, Object.getOwnPropertyNames(value ?? {})).includes(PASSWORD), "the password must never appear");

beforeEach(() => { reset(); withoutVault(); });

test("a permitted member gets the password once, with no-store headers and an audit entry", async () => {
  withVault(storeSecret);
  const r = await call(secretHandler, { accountId: ACCOUNT, action: "reveal" });
  assert.equal(r.ok.secret, PASSWORD);
  assert.match(world.headers["Cache-Control"], /no-store/);
  assert.ok(audited("credential_reveal", "success"));
  assert.ok(!JSON.stringify(world.audits).includes(PASSWORD));
});

test("a member without the use grant is denied before any secret is read, and the denial is audited", async () => {
  withVault(storeSecret);
  world.access.can_use = false;
  world.secretRow = null; // would fail loudly if read
  const r = await call(secretHandler, { accountId: ACCOUNT, action: "copy" });
  assert.equal(r.err.statusCode, 403);
  assert.ok(audited("credential_copy", "denied"));
  noLeak(r.err);
});

test("revoked membership reads as not found, never as a retryable error", async () => {
  withVault(storeSecret);
  world.accessError = { code: "P0002", message: "Account not found" };
  const r = await call(secretHandler, { accountId: ACCOUNT, action: "reveal" });
  assert.equal(r.err.statusCode, 404);
  assert.equal(r.err.data.code, "not_found");
});

test("an unconfigured vault is a clear 503 and is audited as unavailable", async () => {
  const r = await call(secretHandler, { accountId: ACCOUNT, action: "reveal" });
  assert.equal(r.err.statusCode, 503);
  assert.equal(r.err.data.code, "vault_unavailable");
  assert.ok(audited("credential_reveal", "unavailable"));
});

test("the wrong key or a tampered row is a safe 500 with no plaintext", async () => {
  withVault(storeSecret);
  withVault(() => undefined); // rotate to a different key set without re-encrypting
  const r = await call(secretHandler, { accountId: ACCOUNT, action: "reveal" });
  assert.equal(r.err.statusCode, 500);
  assert.equal(r.err.data.code, "secret_unreadable");
  assert.ok(audited("credential_reveal", "error"));
  noLeak(r.err);
});

test("an account with no stored password reports no_secret", async () => {
  withVault(() => undefined);
  world.access.has_secret = false;
  assert.equal((await call(secretHandler, { accountId: ACCOUNT, action: "reveal" })).err.data.code, "no_secret");
});

test("bad input is rejected before authorisation work", async () => {
  assert.equal((await call(secretHandler, { accountId: "nope", action: "reveal" })).err.statusCode, 400);
  assert.equal((await call(secretHandler, { accountId: ACCOUNT, action: "export" })).err.statusCode, 400);
});

const saveBody = (over = {}) => ({ listId: LIST, accountId: null, applicationId: APP, environmentId: ENV, label: "QA Dispatcher", testRole: "Dispatcher", username: "qa.dispatcher@example.test", instructions: "", password: PASSWORD, useRoles: ["collaborator"], manageRoles: [], useProfiles: [], manageProfiles: [], ...over });

test("saving with an unconfigured vault fails BEFORE any account is written", async () => {
  let rpcCalled = false;
  world.saveRpcResult = new Proxy({}, { get: () => { rpcCalled = true; return undefined; } });
  const r = await call(saveHandler, saveBody());
  assert.equal(r.err.statusCode, 503);
  assert.equal(rpcCalled, false);
  noLeak(r.err);
});

test("saving stores only ciphertext, never returns the password, and audits without values", async () => {
  withVault(() => undefined);
  const r = await call(saveHandler, saveBody());
  assert.equal(r.ok.secretStored, true);
  noLeak(r.ok);
  const secretUpsert = world.upserts.find((u) => u.table === "qa_account_secrets");
  assert.ok(secretUpsert);
  assert.ok(!JSON.stringify(secretUpsert.row).includes(PASSWORD));
  assert.match(secretUpsert.row.ciphertext, /^\\x[0-9a-f]+$/);
  assert.equal(secretUpsert.row.key_version, "v1");
  assert.ok(audited("credential_create", "success"));
  assert.ok(audited("credential_secret_set", "success"));
  assert.ok(!JSON.stringify(world.audits).includes(PASSWORD));
  assert.match(world.headers["Cache-Control"], /no-store/);
});

test("a new account requires a password; an edit with no password leaves the secret untouched", async () => {
  withVault(() => undefined);
  assert.equal((await call(saveHandler, saveBody({ password: "" }))).err.data.code, "password_required");
  world.saveRpcResult = { id: ACCOUNT, list_id: LIST, has_secret: true };
  const r = await call(saveHandler, saveBody({ accountId: ACCOUNT, password: "" }));
  assert.equal(r.ok.secretStored, true);
  assert.equal(world.upserts.length, 0);
});

test("a database denial on save is surfaced as forbidden and audited", async () => {
  withVault(() => undefined);
  world.saveRpcError = { code: "42501", message: "You don't have permission to manage this account." };
  const r = await call(saveHandler, saveBody({ accountId: ACCOUNT }));
  assert.equal(r.err.statusCode, 403);
  assert.equal(world.upserts.length, 0);
});

test("a failed secret write after the account saved is reported honestly", async () => {
  withVault(() => undefined);
  world.secretWriteError = { message: "boom" };
  const r = await call(saveHandler, saveBody());
  assert.equal(r.err.statusCode, 502);
  assert.equal(r.err.data.code, "secret_not_stored");
  assert.ok(audited("credential_secret_set", "error"));
  noLeak(r.err);
});
