import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes } from "node:crypto";
import {
  VaultDecryptError,
  VaultInputError,
  VaultUnavailableError,
  decryptSecret,
  encryptSecret,
  fromByteaHex,
  isVaultConfigured,
  loadVaultConfig,
  needsRotation,
  rewrapSecret,
  toByteaHex,
} from "../server/lib/qa/vault.ts";

const key = () => randomBytes(32).toString("base64");
const env = (keys, active) => ({ QA_VAULT_KEYS: JSON.stringify(keys), QA_VAULT_ACTIVE_KEY_VERSION: active });
const ctx = { listId: "list-1", accountId: "acc-1" };
// Synthetic, obviously fake value. Never a real credential.
const PASSWORD = "  Example#Pass 123  ";

test("round-trips a password exactly as typed (no trim or normalisation)", () => {
  const config = loadVaultConfig(env({ v1: key() }, "v1"));
  const sealed = encryptSecret({ plaintext: PASSWORD, ...ctx }, config);
  assert.equal(decryptSecret(sealed, ctx, config), PASSWORD);
  assert.equal(sealed.keyVersion, "v1");
  assert.equal(sealed.iv.length, 12);
  assert.equal(sealed.authTag.length, 16);
  assert.ok(!sealed.ciphertext.toString("utf8").includes("Example"));
});

test("a fresh IV is used per write so equal passwords do not produce equal ciphertext", () => {
  const config = loadVaultConfig(env({ v1: key() }, "v1"));
  const a = encryptSecret({ plaintext: PASSWORD, ...ctx }, config);
  const b = encryptSecret({ plaintext: PASSWORD, ...ctx }, config);
  assert.notDeepEqual(a.iv, b.iv);
  assert.notDeepEqual(a.ciphertext, b.ciphertext);
});

test("missing, malformed or mismatched configuration reports unavailable and never throws a key", () => {
  assert.throws(() => loadVaultConfig({}), VaultUnavailableError);
  assert.throws(() => loadVaultConfig({ QA_VAULT_KEYS: "{", QA_VAULT_ACTIVE_KEY_VERSION: "v1" }), VaultUnavailableError);
  assert.throws(() => loadVaultConfig(env({ v1: "c2hvcnQ=" }, "v1")), VaultUnavailableError);
  assert.throws(() => loadVaultConfig(env({ v1: key() }, "v9")), VaultUnavailableError);
  assert.equal(isVaultConfigured({}), false);
  const secretish = key();
  try {
    loadVaultConfig(env({ v1: secretish }, "v9"));
  } catch (e) {
    assert.ok(!String(e.message).includes(secretish));
  }
});

test("a wrong key, a tampered record, or a different account/list fails authentication", () => {
  const config = loadVaultConfig(env({ v1: key() }, "v1"));
  const other = loadVaultConfig(env({ v1: key() }, "v1"));
  const sealed = encryptSecret({ plaintext: PASSWORD, ...ctx }, config);
  assert.throws(() => decryptSecret(sealed, ctx, other), VaultDecryptError);
  assert.throws(() => decryptSecret(sealed, { ...ctx, accountId: "acc-2" }, config), VaultDecryptError);
  assert.throws(() => decryptSecret(sealed, { ...ctx, listId: "list-2" }, config), VaultDecryptError);
  const tampered = { ...sealed, ciphertext: Buffer.from(sealed.ciphertext.map((b, i) => (i === 0 ? b ^ 1 : b))) };
  assert.throws(() => decryptSecret(tampered, ctx, config), VaultDecryptError);
  assert.throws(() => decryptSecret({ ...sealed, keyVersion: "gone" }, ctx, config), VaultDecryptError);
});

test("rotation: old versions still decrypt, new writes use the active version, rewrap migrates", () => {
  const k1 = key();
  const k2 = key();
  const before = loadVaultConfig(env({ v1: k1 }, "v1"));
  const sealedOld = encryptSecret({ plaintext: PASSWORD, ...ctx }, before);
  const after = loadVaultConfig(env({ v1: k1, v2: k2 }, "v2"));
  assert.equal(decryptSecret(sealedOld, ctx, after), PASSWORD);
  assert.equal(needsRotation(sealedOld, after), true);
  const moved = rewrapSecret(sealedOld, ctx, after);
  assert.equal(moved.keyVersion, "v2");
  assert.equal(needsRotation(moved, after), false);
  assert.equal(decryptSecret(moved, ctx, loadVaultConfig(env({ v2: k2 }, "v2"))), PASSWORD);
});

test("empty and oversized passwords are rejected; bytea helpers round-trip", () => {
  const config = loadVaultConfig(env({ v1: key() }, "v1"));
  assert.throws(() => encryptSecret({ plaintext: "", ...ctx }, config), VaultInputError);
  assert.throws(() => encryptSecret({ plaintext: "x".repeat(1025), ...ctx }, config), VaultInputError);
  const buf = randomBytes(20);
  assert.deepEqual(fromByteaHex(toByteaHex(buf)), buf);
  assert.throws(() => fromByteaHex("not-hex"), VaultDecryptError);
});
