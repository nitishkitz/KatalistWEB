import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const NONCE_COOKIE = "ca_connect_nonce";
export const COOKIE_PATH = "/api/code-activity";
/** Start sets 10 minutes (the state's life). The callback re-issues for 15 minutes (the proof's life). */
export const START_COOKIE_SECONDS = 600;
export const PROOF_COOKIE_SECONDS = 900;

export const base64url = (data: Uint8Array | Buffer) => Buffer.from(data).toString("base64url");

/** 256 random bits as base64url (43 characters). Used for the state and the browser nonce. */
export const randomToken = () => base64url(randomBytes(32));

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * SHA-256 of the token text as a PostgreSQL bytea hex literal (`\x` + 64 hex characters). PostgREST needs
 * this text form: a Uint8Array would be serialized by JSON.stringify as {"0":..,"1":..} and rejected or
 * misread. Use this for every bytea argument at the RPC boundary.
 */
export const sha256Bytea = (text: string): string => `\\x${createHash("sha256").update(text, "utf8").digest("hex")}`;

/**
 * PKCE verifier derived, not stored: HMAC(server secret, state + "." + nonce). The callback recomputes
 * it from the state in the URL and the nonce in the cookie. Result is 43 base64url characters.
 */
export function deriveVerifier(stateSecret: string, state: string, nonce: string): string {
  return base64url(createHmac("sha256", stateSecret).update(`${state}.${nonce}`).digest());
}

/** S256 code challenge: base64url(SHA-256(verifier)). */
export const challengeFor = (verifier: string) => base64url(createHash("sha256").update(verifier, "ascii").digest());

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Always Secure: Chromium accepts Secure cookies on http://localhost (probe, 7 Oct 2026). */
export function nonceCookie(value: string, maxAgeSeconds: number): string {
  return `${NONCE_COOKIE}=${value}; Path=${COOKIE_PATH}; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}
export const clearNonceCookie = () => nonceCookie("", 0);

/** Returns the nonce only when the header carries exactly one well-formed cookie of this name. */
export function readNonceCookie(header: string | null | undefined): string | null {
  if (!header) return null;
  const found = header
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${NONCE_COOKIE}=`))
    .map((part) => part.slice(NONCE_COOKIE.length + 1));
  if (found.length !== 1) return null;
  return TOKEN_PATTERN.test(found[0]) ? found[0] : null;
}
