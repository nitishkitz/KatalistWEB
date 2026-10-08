#!/usr/bin/env node
/**
 * Reports whether Code Activity's server settings are present and valid, BY NAME ONLY. Never prints a value.
 *   node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs scripts/code-activity-config-check.mjs [--env .env.local] [--production]
 * It reads the file, not the running server: after any change restart `npm run dev`, then probe
 * GET /api/code-activity/github/authorize/callback (no state): 503 means the server still lacks the settings; 400 means it has them.
 */
import { existsSync, readFileSync } from "node:fs";
import { ENV_NAMES, loadConfig, loadWebhookSecret } from "../src/features/code-activity/server/config.server.ts";
import { loadAiConfig } from "../src/features/code-activity/server/ai.server.ts";

const args = process.argv.slice(2);
const file = args.includes("--env") ? args[args.indexOf("--env") + 1] : ".env.local";
const env = {};
if (existsSync(file)) {
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && m[2].trim() !== "" && !m[2].trim().startsWith("#")) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
console.log(`${file}: ${existsSync(file) ? "present" : "ABSENT"}`);
const result = loadConfig(env, { production: args.includes("--production") });
for (const name of [ENV_NAMES.appId, ENV_NAMES.appSlug, ENV_NAMES.clientId, ENV_NAMES.clientSecret, ENV_NAMES.privateKey, ENV_NAMES.stateSecret, ENV_NAMES.callbackUrl, ENV_NAMES.allowedOrigins]) {
  const state = result.configured ? "ok" : result.missing.includes(name) ? "MISSING" : result.invalid.includes(name) ? "INVALID" : env[name] ? "present" : "MISSING";
  console.log(`  ${name}: ${state}`);
}
console.log(`connection: ${result.configured ? "READY (restart the server if it was running)" : "NOT READY"}`);
console.log(`optional: webhook secret ${loadWebhookSecret(env) ? "usable" : "absent"}; model key ${loadAiConfig(env) ? "usable" : "absent"}; service role key ${env.SUPABASE_SERVICE_ROLE_KEY ? "present" : "absent"}`);
process.exit(result.configured ? 0 : 1);
