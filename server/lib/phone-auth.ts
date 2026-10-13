/**
 * Mobile sign-in, server side. One module for every runtime (Vite dev and the
 * deployed server routes), so the code that is displayed and the code that is
 * accepted always come from the same place.
 *
 * Modes (KATALIST_PHONE_AUTH_MODE):
 *   static — TEMPORARY. A shared code, KATALIST_STATIC_LOGIN_CODE, is shown on
 *            the sign-in screen. It does NOT prove the person owns the number:
 *            anyone who knows a registered number can sign in as that account.
 *            Accounts are never marked phone-verified by it.
 *   sms    — Supabase Auth sends and verifies a real SMS code (phone provider
 *            must be configured on the project). No code is ever exposed.
 *   off    — Phone sign-in unavailable.
 * KATALIST_STATIC_LOGIN_DISABLED=true is the single off switch for static mode.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { findAuthUserByPhone } from "./find-phone-user.ts";
import { isTransientAuthFailure, withAuthNetworkRetry } from "./supabase-admin.ts";

export type PhoneAuthMode = "static" | "sms" | "off";

type Env = Record<string, string | undefined>;

export function phoneAuthConfig(env: Env = process.env): { mode: PhoneAuthMode; staticCode: string | null } {
  const requested = (env.KATALIST_PHONE_AUTH_MODE ?? "").trim().toLowerCase();
  if (requested === "sms") return { mode: "sms", staticCode: null };
  const disabled = env.KATALIST_STATIC_LOGIN_DISABLED === "true";
  const code = env.KATALIST_STATIC_LOGIN_CODE?.trim() ?? "";
  if (requested === "static") {
    return !disabled && /^\d{6}$/.test(code) ? { mode: "static", staticCode: code } : { mode: "off", staticCode: null };
  }
  // Local development keeps working with the older test variable, never in production.
  const environment = env.KATALIST_ENV || env.VITE_KATALIST_ENV;
  const devCode = env.VITE_KATALIST_FIXED_OTP?.trim() ?? "";
  if (!requested && !disabled && environment !== "production" && env.NODE_ENV !== "production" && /^\d{6}$/.test(devCode)) {
    return { mode: "static", staticCode: devCode };
  }
  return { mode: "off", staticCode: null };
}

/** What the browser may know. Never credentials; the code only in static mode. */
export function publicLoginConfig(env: Env = process.env) {
  const { mode, staticCode } = phoneAuthConfig(env);
  return { mode, staticCode: mode === "static" ? staticCode : null };
}

/** E.164 for the numbers Katalist accepts. Ten-digit Indian mobiles must carry +91. */
export function normalizePhone(value: unknown): string | null {
  // The country code is always explicit (the sign-in screen sends it), so "9876543210" is never guessed.
  if (typeof value !== "string" || !/^\+[\d\s()-]+$/.test(value.trim())) return null;
  const digits = value.replace(/\D/g, "");
  if (!/^[1-9]\d{6,14}$/.test(digits)) return null;
  if (digits.startsWith("91") && digits.length !== 12) return null;
  if (digits.startsWith("91") && !/^91[6-9]/.test(digits)) return null;
  return `+${digits}`;
}

function codesMatch(submitted: unknown, expected: string): boolean {
  if (typeof submitted !== "string" || !/^\d{6}$/.test(submitted)) return false;
  return timingSafeEqual(Buffer.from(submitted), Buffer.from(expected));
}

/** Keys for the persistent limiter; raw numbers and addresses are never stored. */
export function limiterKey(kind: "phone" | "ip", value: string, env: Env = process.env): string {
  const pepper = env.KATALIST_AUTH_LIMIT_SECRET || env.SUPABASE_SERVICE_ROLE_KEY || "katalist";
  return createHash("sha256").update(`${kind}:${pepper}:${value}`).digest("hex");
}

export type PhoneLoginFailure = {
  ok: false;
  status: number;
  code: "disabled" | "maintenance" | "invalid_phone" | "wrong_code" | "rate_limited" | "unavailable";
  message: string;
  retryAfterSec?: number;
};
export type PhoneLoginResult = { ok: true; token_hash: string; email: string } | PhoneLoginFailure;

const fail = (status: number, code: PhoneLoginFailure["code"], message: string, retryAfterSec?: number): PhoneLoginFailure =>
  ({ ok: false, status, code, message, ...(retryAfterSec ? { retryAfterSec } : {}) });

function placeholderEmail(phone: string): string {
  return `user-${phone.replace(/\D/g, "")}@users.katalist.invalid`;
}

/**
 * One account per normalised number. The number is stored on the Auth user's
 * phone field (unconfirmed), so a later switch to real SMS finds the same user.
 * Concurrent first logins race on Auth's unique phone/email; the loser re-reads.
 */
async function findOrCreateUser(admin: SupabaseClient, phone: string): Promise<User> {
  const existing = await findAuthUserByPhone(admin, phone);
  if (existing) return existing;
  const { data, error } = await admin.auth.admin.createUser({
    email: placeholderEmail(phone),
    email_confirm: true,
    phone,
    phone_confirm: false,
    user_metadata: { phone, display_name: "Katalist User", full_name: "Katalist User", login_method: "static_code" },
  });
  if (!error && data.user) return data.user;
  const raced = await findAuthUserByPhone(admin, phone);
  if (raced) return raced;
  throw error ?? new Error("Could not create the account.");
}

export async function staticPhoneLogin(input: {
  admin: SupabaseClient;
  phone: unknown;
  code: unknown;
  ip: string;
  maintenance: boolean;
  env?: Env;
}): Promise<PhoneLoginResult> {
  const env = input.env ?? process.env;
  const { mode, staticCode } = phoneAuthConfig(env);
  if (mode !== "static" || !staticCode) return fail(404, "disabled", "Sign-in with a code is not available right now.");
  if (input.maintenance) return fail(503, "maintenance", "Katalist is being updated. Please try again shortly.");
  const phone = normalizePhone(input.phone);
  if (!phone) return fail(400, "invalid_phone", "Enter a valid mobile number.");

  // Persistent limiter shared by every server instance (10 per number, 30 per address, per 15 minutes).
  const { data: limit, error: limitError } = await input.admin.rpc("phone_login_attempt", {
    p_phone_key: limiterKey("phone", phone, env),
    p_ip_key: limiterKey("ip", input.ip || "unknown", env),
  });
  if (limitError) return fail(503, "unavailable", "Sign-in is temporarily unavailable. Try again.");
  const verdict = limit as { allowed: boolean; retry_after_s: number } | null;
  if (!verdict?.allowed) return fail(429, "rate_limited", "Too many attempts. Wait a few minutes and try again.", verdict?.retry_after_s ?? 900);

  if (!codesMatch(input.code, staticCode)) return fail(401, "wrong_code", "That code did not match. Check it and try again.");

  try {
    const user = await findOrCreateUser(input.admin, phone);
    const email = user.email || placeholderEmail(phone);
    const link = await withAuthNetworkRetry(async () => {
      const { data, error } = await input.admin.auth.admin.generateLink({ type: "magiclink", email });
      if (error) throw error;
      return data;
    }, "generate-link");
    const tokenHash = link.properties?.hashed_token;
    if (!tokenHash) return fail(503, "unavailable", "Sign-in is temporarily unavailable. Try again.");
    return { ok: true, token_hash: tokenHash, email };
  } catch (error) {
    // No number, code or token is logged.
    console.error(JSON.stringify({ evt: "phone_login_failed", transient: isTransientAuthFailure(error) }));
    return fail(503, "unavailable", "Sign-in is temporarily unavailable. Try again.");
  }
}
