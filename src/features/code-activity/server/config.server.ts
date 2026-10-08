/**
 * Code Activity server configuration (G04). Names only live here; values come from the environment and
 * are never logged or returned. Nothing is validated at application startup: `loadConfig` runs per
 * request, and a missing or invalid value yields `configured: false` that disables only this feature.
 */
export const ENV_NAMES = {
  appId: "CODE_ACTIVITY_GITHUB_APP_ID",
  appSlug: "CODE_ACTIVITY_GITHUB_APP_SLUG",
  clientId: "CODE_ACTIVITY_GITHUB_CLIENT_ID",
  clientSecret: "CODE_ACTIVITY_GITHUB_CLIENT_SECRET",
  privateKey: "CODE_ACTIVITY_GITHUB_PRIVATE_KEY",
  stateSecret: "CODE_ACTIVITY_STATE_SECRET",
  callbackUrl: "CODE_ACTIVITY_GITHUB_CALLBACK_URL",
  allowedOrigins: "CODE_ACTIVITY_ALLOWED_ORIGINS",
  // Needed from G11; not required for the connection flow.
  webhookSecret: "CODE_ACTIVITY_GITHUB_WEBHOOK_SECRET",
} as const;

export const CALLBACK_PATH = "/api/code-activity/github/authorize/callback";

export interface CodeActivityConfig {
  appId: string;
  appSlug: string;
  clientId: string;
  clientSecret: string;
  privateKeyPem: string;
  stateSecret: string;
  callbackUrl: string;
  allowedOrigins: readonly string[];
}

export type ConfigResult =
  | { configured: true; config: CodeActivityConfig }
  /** `missing` and `invalid` hold variable NAMES only, never values. */
  | { configured: false; missing: string[]; invalid: string[] };

type Env = Record<string, string | undefined>;

function normalizePem(raw: string): string | null {
  const text = raw.trim();
  const direct = text.includes("\\n") ? text.replace(/\\n/g, "\n") : text;
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(direct)) return direct;
  try {
    const decoded = Buffer.from(text, "base64").toString("utf8");
    return /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function parseOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

const isLoopback = (hostname: string) => hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";

export function loadConfig(env: Env = process.env, options: { production?: boolean } = {}): ConfigResult {
  const production = options.production ?? env.NODE_ENV === "production";
  const missing: string[] = [];
  const invalid: string[] = [];
  const get = (name: string) => {
    const value = env[name]?.trim();
    if (!value) missing.push(name);
    return value ?? "";
  };

  const appId = get(ENV_NAMES.appId);
  const appSlug = get(ENV_NAMES.appSlug);
  const clientId = get(ENV_NAMES.clientId);
  const clientSecret = get(ENV_NAMES.clientSecret);
  const privateKeyRaw = get(ENV_NAMES.privateKey);
  const stateSecret = get(ENV_NAMES.stateSecret);
  const callbackRaw = get(ENV_NAMES.callbackUrl);
  const originsRaw = get(ENV_NAMES.allowedOrigins);
  if (missing.length > 0) return { configured: false, missing, invalid };

  if (!/^\d+$/.test(appId)) invalid.push(ENV_NAMES.appId);
  if (!/^[A-Za-z0-9-]+$/.test(appSlug)) invalid.push(ENV_NAMES.appSlug);
  if (stateSecret.length < 32) invalid.push(ENV_NAMES.stateSecret);
  const privateKeyPem = normalizePem(privateKeyRaw);
  if (!privateKeyPem) invalid.push(ENV_NAMES.privateKey);

  const allowedOrigins = originsRaw
    .split(",")
    .map((o) => parseOrigin(o))
    .filter((o): o is string => o !== null);
  if (allowedOrigins.length === 0 || allowedOrigins.length !== originsRaw.split(",").length) invalid.push(ENV_NAMES.allowedOrigins);

  let callbackUrl = "";
  try {
    const url = new URL(callbackRaw);
    const secure = url.protocol === "https:";
    const loopbackDev = !production && url.protocol === "http:" && isLoopback(url.hostname);
    if ((!secure && !loopbackDev) || url.pathname !== CALLBACK_PATH || url.search || url.hash || url.username || url.password) {
      invalid.push(ENV_NAMES.callbackUrl);
    } else if (!allowedOrigins.includes(url.origin)) {
      invalid.push(ENV_NAMES.callbackUrl);
    } else {
      callbackUrl = url.toString();
    }
  } catch {
    invalid.push(ENV_NAMES.callbackUrl);
  }
  if (!production) {
    // Development only: an allowed http origin must be loopback. Production origins must be https.
  }
  if (production && allowedOrigins.some((o) => !o.startsWith("https://"))) invalid.push(ENV_NAMES.allowedOrigins);
  if (invalid.length > 0) return { configured: false, missing, invalid: [...new Set(invalid)] };

  return {
    configured: true,
    config: { appId, appSlug, clientId, clientSecret, privateKeyPem: privateKeyPem!, stateSecret, callbackUrl, allowedOrigins },
  };
}

/** The webhook secret, read separately because only intake needs it. Null when absent or too short to be safe. */
export function loadWebhookSecret(env: Env = process.env): string | null {
  const value = env[ENV_NAMES.webhookSecret]?.trim();
  return value && value.length >= 20 ? value : null;
}
