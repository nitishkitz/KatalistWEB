import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadConfig } from "../src/features/code-activity/server/config.server.ts";
import { CALLBACK_PATH, DEV_ORIGIN, bootstrapAppName, buildManifest, checkRedirect, envFor, mergeEnv, namesPresent, parseConversion, registrationPage } from "./code-activity-bootstrap-lib.mjs";

const PEM = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const conversion = (extra = {}) => ({ id: 12345, slug: "katalist-code-activity-local-ab1", client_id: "Iv23liTESTCLIENT", client_secret: "client-secret-value-xyz", pem: PEM, webhook_secret: "whsec_0123456789abcdef0123", ...extra });
const parsed = () => parseConversion(conversion()).value;
test("bootstrap uses a GitHub-valid App name including its random suffix", () => {
  for (let i = 0; i < 20; i++) {
    const name = bootstrapAppName();
    assert.ok(name.length <= 34);
    assert.match(name, /^Katalist Activity local [A-Za-z0-9_-]{5}$/);
  }
});
const parse = (text) => {
  const env = {};
  for (const line of text.split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && m[2].trim() !== "" && !m[2].trim().startsWith("#")) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
};

test("manifest: private, read-only, exact callback, no localhost webhook", () => {
  const m = buildManifest({ name: "Katalist Code Activity (local x)", redirectUrl: "http://127.0.0.1:8787/created" });
  assert.deepEqual(m.default_permissions, { metadata: "read", pull_requests: "read", checks: "read", statuses: "read", contents: "read" });
  assert.ok(Object.values(m.default_permissions).every((v) => v === "read"), "no write permission, ever");
  assert.deepEqual(m.callback_urls, [`${DEV_ORIGIN}${CALLBACK_PATH}`]);
  assert.equal(m.public, false);
  assert.equal(Object.hasOwn(m, "hook_attributes"), false);
  assert.deepEqual(m.default_events, []);
  assert.equal(m.request_oauth_on_install, true);
  assert.equal(m.redirect_url, "http://127.0.0.1:8787/created");
  assert.equal(m.url, DEV_ORIGIN);
});

test("redirect from GitHub: only this run's state and a well-formed code are accepted", () => {
  const q = (s) => new URLSearchParams(s);
  assert.deepEqual(checkRedirect(q("code=abcdef1234567890&state=S1"), "S1"), { ok: true, code: "abcdef1234567890" });
  for (const [query, label] of [["code=abcdef1234567890&state=OTHER", "wrong state"], ["code=abcdef1234567890", "no state"], ["state=S1", "no code"], ["code=../../etc&state=S1", "path in code"], ["code=short&state=S1", "short code"]]) {
    assert.equal(checkRedirect(q(query), "S1").ok, false, label);
  }
});

test("conversion reply: every needed piece is required and named when missing", () => {
  assert.equal(parseConversion(conversion()).ok, true);
  const bad = parseConversion(conversion({ pem: "nope", client_secret: undefined }));
  assert.deepEqual([bad.ok, bad.missing.sort()], [false, ["client_secret", "pem"]]);
  assert.deepEqual(parseConversion(null).missing.length, 5);
  assert.equal(parseConversion(conversion({ webhook_secret: undefined })).value.webhookSecret, null, "the webhook secret is optional");
  assert.equal(JSON.stringify(parseConversion(conversion({ client_secret: undefined }))).includes("client-secret"), false, "a failure reply carries names, not values");
});

test("what the tool writes is exactly what the server reads: the round trip yields a ready configuration", () => {
  const vars = envFor(parsed(), { stateSecret: "s".repeat(48) });
  assert.deepEqual(Object.keys(vars).sort(), ["CODE_ACTIVITY_ALLOWED_ORIGINS", "CODE_ACTIVITY_GITHUB_APP_ID", "CODE_ACTIVITY_GITHUB_APP_SLUG", "CODE_ACTIVITY_GITHUB_CALLBACK_URL", "CODE_ACTIVITY_GITHUB_CLIENT_ID", "CODE_ACTIVITY_GITHUB_CLIENT_SECRET", "CODE_ACTIVITY_GITHUB_PRIVATE_KEY", "CODE_ACTIVITY_GITHUB_WEBHOOK_SECRET", "CODE_ACTIVITY_STATE_SECRET"]);
  assert.ok(!vars.CODE_ACTIVITY_GITHUB_PRIVATE_KEY.includes("\n"), "the key is one line");
  const text = mergeEnv("SUPABASE_URL=https://x.example\n", vars);
  const result = loadConfig(parse(text), { production: false });
  assert.equal(result.configured, true, JSON.stringify(result));
  assert.match(result.config.privateKeyPem, /-----BEGIN PRIVATE KEY-----\n/, "the escaped newlines are restored when read");
  assert.equal(result.config.callbackUrl, `${DEV_ORIGIN}${CALLBACK_PATH}`);
  assert.equal(loadConfig(parse(mergeEnv("", envFor({ ...parsed(), webhookSecret: null }))), { production: false }).configured, true, "no webhook secret is fine");
});

test("merging an env file keeps every other line, replaces in place, and is idempotent", () => {
  const original = '# my settings\nSUPABASE_URL=https://x.example\nSUPABASE_SERVICE_ROLE_KEY="keep-this-exactly"\nCODE_ACTIVITY_GITHUB_APP_ID=999\n\nVITE_KATALIST_DEMO_MODE=false\n';
  const vars = envFor(parsed(), { stateSecret: "s".repeat(48) });
  const once = mergeEnv(original, vars);
  for (const line of ["# my settings", "SUPABASE_URL=https://x.example", 'SUPABASE_SERVICE_ROLE_KEY="keep-this-exactly"', "VITE_KATALIST_DEMO_MODE=false"]) assert.ok(once.split("\n").includes(line), line);
  assert.equal(once.match(/^CODE_ACTIVITY_GITHUB_APP_ID=/gm).length, 1, "the old line was replaced, not duplicated");
  assert.equal(parse(once).CODE_ACTIVITY_GITHUB_APP_ID, "12345");
  assert.ok(once.indexOf("CODE_ACTIVITY_GITHUB_APP_ID") < once.indexOf("VITE_KATALIST_DEMO_MODE"), "replaced in place");
  assert.equal(mergeEnv(once, vars), once, "running it again changes nothing");
  assert.ok(mergeEnv("", vars).startsWith("# Code Activity"), "an empty file gets a labelled block");
});

test("names present: names only, blanks and comments do not count", () => {
  const names = ["A_ONE", "B_TWO", "C_THREE"];
  assert.deepEqual(namesPresent("A_ONE=x\n# B_TWO=y\nC_THREE=\n", names), ["A_ONE"]);
  assert.deepEqual(namesPresent("export B_TWO=1\n", names), ["B_TWO"]);
});

test("the registration page posts the manifest to GitHub with the state, and cannot be broken out of", () => {
  const manifest = buildManifest({ name: 'x"><script>alert(1)</script>', redirectUrl: "http://127.0.0.1:8787/created" });
  const page = registrationPage({ manifest, state: "S1&x=y" });
  assert.match(page, /action="https:\/\/github\.com\/settings\/apps\/new\?state=S1%26x%3Dy"/);
  assert.doesNotMatch(page, /<script>alert/, "the manifest is escaped inside the attribute");
  assert.match(registrationPage({ manifest, state: "S", organization: "acme corp" }), /organizations\/acme%20corp\/settings\/apps\/new/);
});

test("the command never prints a secret", () => {
  const code = ["code-activity-bootstrap.mjs", "code-activity-config-check.mjs"].map((f) => readFileSync(new URL(`./${f}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")).join("\n");
  const logging = code.split("\n").filter((l) => /console\.(log|error|warn)|res\.end\(/.test(l)).join("\n");
  for (const secretish of ["clientSecret", "client_secret", ".pem", "webhookSecret", "stateSecret", "vars[", "env[name]"]) {
    assert.ok(!logging.includes(secretish), `output must not include ${secretish}`);
  }
  assert.match(code, /mode: 0o600/, "the env file is written readable by its owner only");
});
