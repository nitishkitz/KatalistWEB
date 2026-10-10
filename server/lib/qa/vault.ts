import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Server-only protected storage for QA test-account passwords.
 *
 * Design:
 *  - AES-256-GCM (authenticated encryption), fresh random 96-bit IV per write.
 *  - The ciphertext is bound to its account and List through AAD, so a row copied to another
 *    account or List fails authentication instead of decrypting.
 *  - Keys come from the server environment only (never VITE_*, never source or migrations):
 *      QA_VAULT_KEYS               JSON object  {"v1":"<base64 of 32 random bytes>", "v2":"..."}
 *      QA_VAULT_ACTIVE_KEY_VERSION the version used for NEW writes (must exist in QA_VAULT_KEYS)
 *  - Rotation: add a new version, switch ACTIVE to it, keep old versions listed until
 *    `needsRotation` reports no rows are left on them (re-save or run the rewrap helper).
 *  - Missing or malformed configuration throws VaultUnavailableError; nothing falls back to a
 *    weaker scheme. Base64 or hashing is never used as "encryption".
 */

export const MAX_SECRET_LENGTH = 1024;
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class VaultUnavailableError extends Error {
  readonly code = "vault_unavailable";
  constructor(message = "Protected credential storage is not configured on this server.") {
    super(message);
    this.name = "VaultUnavailableError";
  }
}

export class VaultDecryptError extends Error {
  readonly code = "secret_unreadable";
  constructor(message = "The stored credential could not be decrypted.") {
    super(message);
    this.name = "VaultDecryptError";
  }
}

export class VaultInputError extends Error {
  readonly code = "invalid_secret";
  constructor(message: string) {
    super(message);
    this.name = "VaultInputError";
  }
}

export type VaultConfig = { keys: ReadonlyMap<string, Buffer>; activeVersion: string };

export type EncryptedSecret = { ciphertext: Buffer; iv: Buffer; authTag: Buffer; keyVersion: string };

type Env = Record<string, string | undefined>;

/** Parses the environment; throws VaultUnavailableError (never echoing key material) when unusable. */
export function loadVaultConfig(env: Env = process.env): VaultConfig {
  const rawKeys = env.QA_VAULT_KEYS?.trim();
  const active = env.QA_VAULT_ACTIVE_KEY_VERSION?.trim();
  if (!rawKeys || !active) throw new VaultUnavailableError();
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawKeys);
  } catch {
    throw new VaultUnavailableError("QA_VAULT_KEYS is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new VaultUnavailableError("QA_VAULT_KEYS must be a JSON object of key versions.");
  }
  const keys = new Map<string, Buffer>();
  for (const [version, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!/^[A-Za-z0-9_.-]{1,32}$/.test(version) || typeof value !== "string") {
      throw new VaultUnavailableError("QA_VAULT_KEYS contains an invalid entry.");
    }
    const key = Buffer.from(value, "base64");
    if (key.length !== KEY_BYTES) throw new VaultUnavailableError(`QA vault key "${version}" must be 32 bytes.`);
    keys.set(version, key);
  }
  if (!keys.has(active)) throw new VaultUnavailableError("QA_VAULT_ACTIVE_KEY_VERSION does not match a configured key.");
  return { keys, activeVersion: active };
}

/** True when the server could encrypt and decrypt right now. Does not expose why not. */
export function isVaultConfigured(env: Env = process.env): boolean {
  try {
    loadVaultConfig(env);
    return true;
  } catch {
    return false;
  }
}

const aad = (listId: string, accountId: string) => Buffer.from(`katalist.qa.secret.v1:${listId}:${accountId}`, "utf8");

/** The secret is stored exactly as typed: no trimming, no normalisation. */
export function validateSecret(plaintext: unknown): string {
  if (typeof plaintext !== "string" || plaintext.length === 0) throw new VaultInputError("Enter a password.");
  if (plaintext.length > MAX_SECRET_LENGTH) throw new VaultInputError(`Passwords can be at most ${MAX_SECRET_LENGTH} characters.`);
  return plaintext;
}

export function encryptSecret(
  input: { plaintext: string; listId: string; accountId: string },
  config: VaultConfig,
): EncryptedSecret {
  const plaintext = validateSecret(input.plaintext);
  const key = config.keys.get(config.activeVersion);
  if (!key) throw new VaultUnavailableError();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad(input.listId, input.accountId));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag(), keyVersion: config.activeVersion };
}

export function decryptSecret(
  record: EncryptedSecret,
  context: { listId: string; accountId: string },
  config: VaultConfig,
): string {
  const key = config.keys.get(record.keyVersion);
  if (!key) throw new VaultDecryptError("The key that protected this credential is no longer configured.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, record.iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad(context.listId, context.accountId));
    decipher.setAuthTag(record.authTag);
    return Buffer.concat([decipher.update(record.ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new VaultDecryptError();
  }
}

/** True when a stored secret is not on the active key version and should be re-encrypted. */
export function needsRotation(record: Pick<EncryptedSecret, "keyVersion">, config: VaultConfig): boolean {
  return record.keyVersion !== config.activeVersion;
}

/** Decrypts with the recorded version and re-encrypts with the active one. */
export function rewrapSecret(record: EncryptedSecret, context: { listId: string; accountId: string }, config: VaultConfig): EncryptedSecret {
  return encryptSecret({ plaintext: decryptSecret(record, context, config), ...context }, config);
}

/** Postgres bytea <-> Buffer using the `\x` hex form PostgREST returns and accepts. */
export const toByteaHex = (value: Buffer) => `\\x${value.toString("hex")}`;
export function fromByteaHex(value: unknown): Buffer {
  if (typeof value !== "string" || !value.startsWith("\\x")) throw new VaultDecryptError();
  return Buffer.from(value.slice(2), "hex");
}
