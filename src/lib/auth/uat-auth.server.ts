import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { normalizePhone, validateRequiredProfile, type RequiredProfile } from "@/lib/auth/profile-validation";
import type { UatVerifyRequest, UatVerifyResponse } from "@/lib/auth/uat-contract";

const MAX_JSON_BYTES = 4096;
const REQUEST_PHONE_LIMIT = 8;
const VERIFY_PHONE_LIMIT = 10;
const IP_LIMIT = 30;
const WINDOW_SECONDS = 900;

export class UatAuthError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export type UatAuthEnv = {
  KATALIST_ENV?: string;
  KATALIST_UAT_FIXED_OTP?: string;
  KATALIST_UAT_AUTH_PEPPER?: string;
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
};

export type UatAuthConfig = {
  fixedOtp: string;
  pepper: string;
  supabaseUrl: string;
  publishableKey: string;
  serviceRoleKey: string;
};

export type UatAuthContext = {
  ip: string;
  env: UatAuthEnv;
  requestId?: string;
};

export type UatAuthDeps = {
  consumeRateLimit: (scopeHash: string, limit: number, windowSeconds: number) => Promise<boolean>;
  findProfileByPhone: (phone: string) => Promise<{ id: string } | null>;
  createUser: (input: { phone: string; password: string; profile: RequiredProfile }) => Promise<void>;
  signIn: (phone: string, password: string) => Promise<{ access_token: string; refresh_token: string }>;
  log?: (operation: string, code: string, requestId: string) => void;
};

export function readUatAuthConfig(env: UatAuthEnv): UatAuthConfig {
  if (env.KATALIST_ENV !== "uat") {
    throw new UatAuthError(404, "Not found.", "not_found");
  }
  const fixedOtp = env.KATALIST_UAT_FIXED_OTP?.trim() ?? "";
  const pepper = env.KATALIST_UAT_AUTH_PEPPER?.trim() ?? "";
  const supabaseUrl = env.SUPABASE_URL?.trim() ?? "";
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!/^\d{6}$/.test(fixedOtp) || !pepper || !supabaseUrl || !publishableKey || !serviceRoleKey) {
    throw new UatAuthError(503, "Sign-in is temporarily unavailable.", "unavailable");
  }
  return { fixedOtp, pepper, supabaseUrl, publishableKey, serviceRoleKey };
}

export function deriveUatPassword(pepper: string, phone: string): string {
  return createHmac("sha256", pepper).update(`katalist-uat-auth:${phone}`, "utf8").digest("hex");
}

export function hashRateLimitScope(pepper: string, kind: "phone" | "ip", value: string): string {
  return createHmac("sha256", pepper).update(`uat-auth-${kind}:${value}`, "utf8").digest("hex");
}

function otpMatches(submitted: string, expected: string): boolean {
  const left = Buffer.from(String(submitted ?? "").padEnd(6, "\0"));
  const right = Buffer.from(expected.padEnd(6, "\0"));
  return left.length === right.length && timingSafeEqual(left, right);
}

function isDuplicateUserError(error: unknown): boolean {
  const record = error && typeof error === "object" ? (error as { message?: string; code?: string; status?: number }) : {};
  const message = String(record.message ?? "").toLowerCase();
  const code = String(record.code ?? "").toLowerCase();
  return (
    code.includes("already") ||
    code === "phone_exists" ||
    code === "user_already_exists" ||
    message.includes("already been registered") ||
    message.includes("already registered") ||
    message.includes("already exists")
  );
}

async function enforceRateLimits(
  config: UatAuthConfig,
  phone: string,
  ip: string,
  deps: UatAuthDeps,
  phoneLimit: number,
): Promise<void> {
  const phoneAllowed = await deps.consumeRateLimit(hashRateLimitScope(config.pepper, "phone", phone), phoneLimit, WINDOW_SECONDS);
  const ipAllowed = await deps.consumeRateLimit(hashRateLimitScope(config.pepper, "ip", ip), IP_LIMIT, WINDOW_SECONDS);
  if (!phoneAllowed || !ipAllowed) {
    throw new UatAuthError(429, "Too many attempts. Try again shortly.", "rate_limited");
  }
}

async function signInExisting(
  config: UatAuthConfig,
  phone: string,
  deps: UatAuthDeps,
): Promise<UatVerifyResponse> {
  const password = deriveUatPassword(config.pepper, phone);
  const session = await deps.signIn(phone, password);
  if (!session?.access_token || !session?.refresh_token) {
    throw new UatAuthError(401, "Unable to sign in.", "invalid_code");
  }
  return { status: "authenticated", session };
}

export async function requestUatOtp(
  input: { phone: string },
  context: UatAuthContext,
  deps: UatAuthDeps,
): Promise<{ ok: true }> {
  const config = readUatAuthConfig(context.env);
  const phone = normalizePhone(input.phone ?? "");
  if (!phone) throw new UatAuthError(400, "Check the information and try again.", "invalid_request");
  await enforceRateLimits(config, phone, context.ip, deps, REQUEST_PHONE_LIMIT);
  return { ok: true };
}

export async function verifyUatOtp(
  input: UatVerifyRequest,
  context: UatAuthContext,
  deps: UatAuthDeps,
): Promise<UatVerifyResponse> {
  const config = readUatAuthConfig(context.env);
  const phone = normalizePhone(input.phone ?? "");
  if (!phone) throw new UatAuthError(400, "Check the information and try again.", "invalid_request");
  await enforceRateLimits(config, phone, context.ip, deps, VERIFY_PHONE_LIMIT);

  if (!otpMatches(input.otp ?? "", config.fixedOtp)) {
    throw new UatAuthError(401, "The verification code is invalid.", "invalid_code");
  }

  const existing = await deps.findProfileByPhone(phone);
  if (existing) {
    return signInExisting(config, phone, deps);
  }

  if (!input.profile) {
    return { status: "needs_profile" };
  }

  const profile = validateRequiredProfile(input.profile);
  if (!profile.ok) {
    throw new UatAuthError(400, "Check the information and try again.", "invalid_request");
  }

  const password = deriveUatPassword(config.pepper, phone);
  try {
    await deps.createUser({ phone, password, profile: profile.value });
  } catch (error) {
    if (!isDuplicateUserError(error)) {
      deps.log?.("uat_verify_create", "create_failed", context.requestId ?? "unknown");
      throw new UatAuthError(503, "Sign-in is temporarily unavailable.", "unavailable");
    }
    const raced = await deps.findProfileByPhone(phone);
    if (!raced) {
      deps.log?.("uat_verify_create", "race_without_profile", context.requestId ?? "unknown");
      throw new UatAuthError(503, "Sign-in is temporarily unavailable.", "unavailable");
    }
    return signInExisting(config, phone, deps);
  }

  return signInExisting(config, phone, deps);
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "0.0.0.0";
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (raw.length > MAX_JSON_BYTES) {
    throw new UatAuthError(400, "Check the information and try again.", "invalid_request");
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new UatAuthError(400, "Check the information and try again.", "invalid_request");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof UatAuthError) throw error;
    throw new UatAuthError(400, "Check the information and try again.", "invalid_request");
  }
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export function mapUatError(error: unknown): Response {
  if (error instanceof UatAuthError) {
    if (error.status === 404) return jsonResponse({ error: "not_found" }, 404);
    return jsonResponse({ error: error.code, message: error.message }, error.status);
  }
  return jsonResponse({ error: "unavailable", message: "Sign-in is temporarily unavailable." }, 503);
}

export async function createDefaultUatDeps(): Promise<UatAuthDeps> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { createSupabasePasswordClient } = await import("@/integrations/supabase/auth-client.server");
  return {
    async consumeRateLimit(scopeHash, limit, windowSeconds) {
      const { data, error } = await supabaseAdmin.rpc("consume_uat_auth_rate_limit", {
        p_scope_hash: scopeHash,
        p_limit: limit,
        p_window_seconds: windowSeconds,
      });
      if (error) throw new UatAuthError(503, "Sign-in is temporarily unavailable.", "unavailable");
      return Boolean(data);
    },
    async findProfileByPhone(phone) {
      const { data, error } = await supabaseAdmin.from("profiles").select("id").eq("phone_e164", phone).maybeSingle();
      if (error) throw new UatAuthError(503, "Sign-in is temporarily unavailable.", "unavailable");
      return data;
    },
    async createUser({ phone, password, profile }) {
      const { error } = await supabaseAdmin.auth.admin.createUser({
        phone,
        password,
        phone_confirm: true,
        user_metadata: {
          full_name: profile.fullName,
          display_name: profile.fullName,
          age: profile.age,
          occupation: profile.occupation,
          role_label: profile.occupation,
          phone,
          uat_profile_complete: true,
        },
      });
      if (error) throw error;
    },
    async signIn(phone, password) {
      const client = createSupabasePasswordClient();
      const { data, error } = await client.auth.signInWithPassword({ phone, password });
      if (error || !data.session) throw new UatAuthError(401, "Unable to sign in.", "invalid_code");
      return {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      };
    },
    log(operation, code, requestId) {
      console.info(JSON.stringify({ op: operation, code, requestId }));
    },
  };
}

export function createUatRequestHandler(options?: { env?: UatAuthEnv; deps?: UatAuthDeps }) {
  return async (request: Request) => {
    const requestId = request.headers.get("x-request-id")?.trim() || randomUUID();
    try {
      const env = options?.env ?? process.env;
      if (env.KATALIST_ENV !== "uat") return jsonResponse({ error: "not_found" }, 404);
      const body = await readJsonObject(request);
      const deps = options?.deps ?? (await createDefaultUatDeps());
      const result = await requestUatOtp(
        { phone: typeof body.phone === "string" ? body.phone : "" },
        { ip: clientIp(request), env, requestId },
        deps,
      );
      return jsonResponse(result, 200);
    } catch (error) {
      return mapUatError(error);
    }
  };
}

export function createUatVerifyHandler(options?: { env?: UatAuthEnv; deps?: UatAuthDeps }) {
  return async (request: Request) => {
    const requestId = request.headers.get("x-request-id")?.trim() || randomUUID();
    try {
      const env = options?.env ?? process.env;
      if (env.KATALIST_ENV !== "uat") return jsonResponse({ error: "not_found" }, 404);
      const body = await readJsonObject(request);
      const profileRaw = body.profile;
      const profile =
        profileRaw && typeof profileRaw === "object" && !Array.isArray(profileRaw)
          ? {
              fullName: String((profileRaw as { fullName?: unknown }).fullName ?? ""),
              age: String((profileRaw as { age?: unknown }).age ?? ""),
              occupation: String((profileRaw as { occupation?: unknown }).occupation ?? ""),
            }
          : undefined;
      const deps = options?.deps ?? (await createDefaultUatDeps());
      const result = await verifyUatOtp(
        {
          phone: typeof body.phone === "string" ? body.phone : "",
          otp: typeof body.otp === "string" ? body.otp : "",
          profile,
        },
        { ip: clientIp(request), env, requestId },
        deps,
      );
      return jsonResponse(result, 200);
    } catch (error) {
      return mapUatError(error);
    }
  };
}
