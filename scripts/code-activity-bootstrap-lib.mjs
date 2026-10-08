import { randomBytes } from "node:crypto";

/**
 * Pure helpers for the one-time operator bootstrap (scripts/code-activity-bootstrap.mjs). Nothing here touches the
 * network or the file system, and nothing here prints a secret. Provider facts: GitHub's "Registering a GitHub App from a
 * manifest" page (retrieved 7 Oct 2026): `url` is required; `hook_attributes` is optional (its `url` required if supplied),
 * `redirect_url`, `callback_urls`, `public`, `default_events`, `default_permissions`, `request_oauth_on_install`;
 * registration form target `https://github.com/settings/apps/new` with a `state` parameter; the temporary code is exchanged
 * with `POST /app-manifests/{code}/conversions`, whose reply is documented to include `id`, `pem` and `webhook_secret`.
 */

export const DEV_ORIGIN = "http://localhost:8080";
export const CALLBACK_PATH = "/api/code-activity/github/authorize/callback";

// GitHub App names must be at most 34 characters, including the random suffix.
export const bootstrapAppName = () => `Katalist Activity local ${randomState().slice(0, 5)}`;

/** Read-only permissions only. No write permission is ever requested. */
export const MANIFEST_PERMISSIONS = {
  metadata: "read",
  pull_requests: "read",
  checks: "read",
  statuses: "read",
  contents: "read",
};

export function buildManifest({ name, redirectUrl, origin = DEV_ORIGIN }) {
  return {
    name,
    url: origin,
    // Omit the optional webhook configuration for local, manual-refresh setup.
    // GitHub rejects localhost hook URLs even when active:false. A real public
    // HTTPS receiver must be configured separately before enabling webhooks.
    redirect_url: redirectUrl,
    callback_urls: [`${origin}${CALLBACK_PATH}`],
    description: "Read-only GitHub activity for Katalist Lists. Reads pull requests, pushes and checks. Never writes.",
    public: false,
    default_events: [],
    default_permissions: { ...MANIFEST_PERMISSIONS },
    request_oauth_on_install: true,
  };
}

export const randomState = () => randomBytes(24).toString("base64url");

/** Checks the redirect from GitHub: the `state` must be exactly the one this run created, and a code must be present. */
export function checkRedirect(query, expectedState) {
  const code = query.get("code");
  const state = query.get("state");
  if (!code || !state || state !== expectedState) return { ok: false, reason: "state_mismatch" };
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(code)) return { ok: false, reason: "bad_code" };
  return { ok: true, code };
}

/** The conversion reply, reduced to what Katalist needs. Missing pieces are named, never guessed. */
export function parseConversion(reply) {
  const o = typeof reply === "object" && reply !== null ? reply : {};
  const missing = [];
  const need = (key, ok) => {
    if (!ok(o[key])) missing.push(key);
  };
  need("id", (v) => Number.isSafeInteger(v) && v > 0);
  need("slug", (v) => typeof v === "string" && /^[A-Za-z0-9-]+$/.test(v));
  need("client_id", (v) => typeof v === "string" && v.length > 3);
  need("client_secret", (v) => typeof v === "string" && v.length > 8);
  need("pem", (v) => typeof v === "string" && /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(v));
  return missing.length > 0
    ? { ok: false, missing }
    : { ok: true, value: { id: String(o.id), slug: o.slug, clientId: o.client_id, clientSecret: o.client_secret, pem: o.pem, webhookSecret: typeof o.webhook_secret === "string" ? o.webhook_secret : null } };
}

/** The variables Katalist reads, in the form written to an uncommitted .env.local. Returns NAME to VALUE. */
export function envFor(value, { origin = DEV_ORIGIN, stateSecret = randomBytes(36).toString("base64") } = {}) {
  const out = {
    CODE_ACTIVITY_GITHUB_APP_ID: value.id,
    CODE_ACTIVITY_GITHUB_APP_SLUG: value.slug,
    CODE_ACTIVITY_GITHUB_CLIENT_ID: value.clientId,
    CODE_ACTIVITY_GITHUB_CLIENT_SECRET: value.clientSecret,
    // One line, newlines escaped: Katalist accepts the escaped form.
    CODE_ACTIVITY_GITHUB_PRIVATE_KEY: value.pem.trim().replace(/\r?\n/g, "\\n"),
    CODE_ACTIVITY_STATE_SECRET: stateSecret,
    CODE_ACTIVITY_GITHUB_CALLBACK_URL: `${origin}${CALLBACK_PATH}`,
    CODE_ACTIVITY_ALLOWED_ORIGINS: origin,
  };
  if (value.webhookSecret) out.CODE_ACTIVITY_GITHUB_WEBHOOK_SECRET = value.webhookSecret;
  return out;
}

const quote = (v) => `"${String(v).replace(/\\(?!n)/g, "\\\\").replace(/"/g, '\\"')}"`;

/**
 * Merges variables into the text of an env file: existing lines for OTHER names are kept byte for byte, an existing line
 * for one of these names is replaced in place, and new names are appended in a labelled block.
 */
export function mergeEnv(text, vars) {
  const lines = text.length > 0 ? text.split("\n") : [];
  const remaining = new Map(Object.entries(vars));
  const out = lines.map((line) => {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=/.exec(line);
    if (m && remaining.has(m[1])) {
      const value = remaining.get(m[1]);
      remaining.delete(m[1]);
      return `${m[1]}=${quote(value)}`;
    }
    return line;
  });
  if (remaining.size > 0) {
    if (out.length > 0 && out[out.length - 1] !== "") out.push("");
    out.push("# Code Activity (GitHub connector). Server-only. Never commit this file.");
    for (const [name, value] of remaining) out.push(`${name}=${quote(value)}`);
    out.push("");
  }
  return out.join("\n");
}

/** Which of Katalist's names are present in an env file's text. Names only. */
export function namesPresent(text, names) {
  const found = new Set();
  for (const line of text.split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.+)$/.exec(line);
    if (m && m[2].trim() !== "" && names.includes(m[1])) found.add(m[1]);
  }
  return names.filter((n) => found.has(n));
}

export function registrationPage({ manifest, state, organization }) {
  const target = organization
    ? `https://github.com/organizations/${encodeURIComponent(organization)}/settings/apps/new?state=${encodeURIComponent(state)}`
    : `https://github.com/settings/apps/new?state=${encodeURIComponent(state)}`;
  const escaped = JSON.stringify(manifest).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return `<!doctype html><meta charset="utf-8"><title>Create the Katalist GitHub App</title>
<body style="font:16px system-ui;max-width:34rem;margin:4rem auto;padding:0 1rem">
<h1 style="font-size:20px">Create the Katalist Code Activity GitHub App</h1>
<p>GitHub will show the app's name and read-only permissions for you to confirm. Nothing is created until you click <b>Create GitHub App</b> on GitHub.</p>
<form method="post" action="${target}"><input type="hidden" name="manifest" value="${escaped}"><button style="font:inherit;padding:.6rem 1rem">Continue to GitHub</button></form>
</body>`;
}
