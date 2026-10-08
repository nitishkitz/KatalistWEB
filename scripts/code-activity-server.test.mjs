import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { CALLBACK_PATH, ENV_NAMES, loadConfig } from "../src/features/code-activity/server/config.server.ts";
import {
  PROOF_COOKIE_SECONDS,
  START_COOKIE_SECONDS,
  challengeFor,
  clearNonceCookie,
  deriveVerifier,
  nonceCookie,
  randomToken,
  readNonceCookie,
  sha256Bytea,
} from "../src/features/code-activity/server/crypto.server.ts";
import {
  GITHUB_LIMITS,
  GitHubError,
  READ_ONLY_PERMISSIONS,
  createGitHubClient,
  parseInstallationToken,
} from "../src/features/code-activity/server/github.server.ts";
import * as svc from "../src/features/code-activity/server/service.server.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const LIST = "10000000-0000-0000-0000-000000000001";
const USER = "00000000-0000-0000-0000-00000000000a";
const PROOF = "20000000-0000-0000-0000-000000000001";
const STATE_SECRET = "s".repeat(40);
const CLIENT_SECRET = "client-secret-value-xyz";
const baseEnv = () => ({
  [ENV_NAMES.appId]: "12345",
  [ENV_NAMES.appSlug]: "katalist-code-activity",
  [ENV_NAMES.clientId]: "Iv23liTESTCLIENT",
  [ENV_NAMES.clientSecret]: CLIENT_SECRET,
  [ENV_NAMES.privateKey]: PEM,
  [ENV_NAMES.stateSecret]: STATE_SECRET,
  [ENV_NAMES.callbackUrl]: `http://localhost:8080${CALLBACK_PATH}`,
  [ENV_NAMES.allowedOrigins]: "http://localhost:8080",
});
const config = () => {
  const result = loadConfig(baseEnv(), { production: false });
  assert.equal(result.configured, true);
  return result.config;
};

// ---- config ---------------------------------------------------------------------------------

test("config: complete environment is configured; no webhook secret is required yet", () => {
  assert.equal(loadConfig(baseEnv(), { production: false }).configured, true);
  assert.equal(baseEnv()[ENV_NAMES.webhookSecret], undefined);
});

test("config: missing and invalid values are reported by NAME only and never echo a value", () => {
  const env = baseEnv();
  delete env[ENV_NAMES.clientSecret];
  const missing = loadConfig(env, { production: false });
  assert.deepEqual(missing.missing, [ENV_NAMES.clientSecret]);
  assert.equal(loadConfig({}).configured, false);
  const bad = { ...baseEnv(), [ENV_NAMES.stateSecret]: "short", [ENV_NAMES.appId]: "abc", [ENV_NAMES.privateKey]: "not a key" };
  const result = loadConfig(bad, { production: false });
  assert.equal(result.configured, false);
  assert.deepEqual(result.invalid.sort(), [ENV_NAMES.appId, ENV_NAMES.privateKey, ENV_NAMES.stateSecret].sort());
  const text = JSON.stringify(result);
  for (const secret of ["short", "not a key", PEM.slice(30, 60), CLIENT_SECRET]) assert.ok(!text.includes(secret));
});

test("config: callback must be the fixed path on an allowed origin; http only on loopback and never in production", () => {
  const bad = (patch, opts = { production: false }) => loadConfig({ ...baseEnv(), ...patch }, opts);
  assert.equal(bad({ [ENV_NAMES.callbackUrl]: "http://localhost:8080/other" }).configured, false);
  assert.equal(bad({ [ENV_NAMES.callbackUrl]: `http://localhost:8080${CALLBACK_PATH}?x=1` }).configured, false);
  assert.equal(bad({ [ENV_NAMES.callbackUrl]: `http://example.com${CALLBACK_PATH}`, [ENV_NAMES.allowedOrigins]: "http://example.com" }).configured, false, "plain http on a public host");
  assert.equal(bad({ [ENV_NAMES.callbackUrl]: `https://app.example.com${CALLBACK_PATH}` }).configured, false, "origin not allowlisted");
  assert.equal(bad({}, { production: true }).configured, false, "loopback http is a development exception only");
  const prod = bad({ [ENV_NAMES.callbackUrl]: `https://app.example.com${CALLBACK_PATH}`, [ENV_NAMES.allowedOrigins]: "https://app.example.com" }, { production: true });
  assert.equal(prod.configured, true);
});

test("config: private key accepts PEM, escaped newlines, and base64", () => {
  const escaped = PEM.replace(/\n/g, "\\n");
  const b64 = Buffer.from(PEM).toString("base64");
  for (const value of [PEM, escaped, b64]) {
    const result = loadConfig({ ...baseEnv(), [ENV_NAMES.privateKey]: value }, { production: false });
    assert.equal(result.configured, true);
    assert.match(result.config.privateKeyPem, /BEGIN PRIVATE KEY/);
  }
});

// ---- crypto ---------------------------------------------------------------------------------

test("pkce: S256 challenge matches the RFC 7636 example; the derived verifier is stable and 43 characters", () => {
  assert.equal(challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  const state = randomToken();
  const nonce = randomToken();
  assert.equal(state.length, 43);
  const v = deriveVerifier(STATE_SECRET, state, nonce);
  assert.equal(v, deriveVerifier(STATE_SECRET, state, nonce));
  assert.match(v, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(v, deriveVerifier(STATE_SECRET, state, randomToken()), "nonce changes the verifier");
  assert.notEqual(v, deriveVerifier("t".repeat(40), state, nonce), "rotated secret changes it");
  assert.match(sha256Bytea(nonce), /^\\x[0-9a-f]{64}$/);
});

test("cookie: HttpOnly Secure Lax on /api/code-activity; reader accepts one well-formed cookie only", () => {
  const nonce = randomToken();
  const set = nonceCookie(nonce, START_COOKIE_SECONDS);
  for (const part of ["ca_connect_nonce=", "Path=/api/code-activity", "HttpOnly", "Secure", "SameSite=Lax", "Max-Age=600"]) assert.ok(set.includes(part), part);
  assert.ok(nonceCookie(nonce, PROOF_COOKIE_SECONDS).includes("Max-Age=900"));
  assert.ok(clearNonceCookie().includes("Max-Age=0"));
  assert.equal(readNonceCookie(`a=1; ca_connect_nonce=${nonce}; b=2`), nonce);
  assert.equal(readNonceCookie(null), null);
  assert.equal(readNonceCookie("ca_connect_nonce=short"), null);
  assert.equal(readNonceCookie(`ca_connect_nonce=${nonce}; ca_connect_nonce=${randomToken()}`), null, "duplicates are refused");
  assert.equal(readNonceCookie(`ca_connect_nonce=${nonce}x`), null);
});

// ---- GitHub client --------------------------------------------------------------------------

function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), init });
    const r = await handler(String(url), init, calls.length);
    return r instanceof Response ? r : new Response(JSON.stringify(r), { status: 200, headers: { "content-type": "application/json" } });
  };
  impl.calls = calls;
  return impl;
}
const repo = (id, extra = {}) => ({ id, full_name: `acme/r${id}`, private: true, pushed_at: "2026-10-01T00:00:00Z", ...extra });

test("github: authorize URL carries client id, exact redirect, state and S256 challenge; install URL carries state", () => {
  const gh = createGitHubClient({ config: config() });
  const url = new URL(gh.authorizeUrl({ state: "ST", challenge: "CH" }));
  assert.equal(url.origin + url.pathname, "https://github.com/login/oauth/authorize");
  assert.equal(url.searchParams.get("client_id"), "Iv23liTESTCLIENT");
  assert.equal(url.searchParams.get("redirect_uri"), `http://localhost:8080${CALLBACK_PATH}`);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("state"), "ST");
  const install = new URL(gh.installUrl("ST"));
  assert.equal(install.pathname, "/apps/katalist-code-activity/installations/new");
  assert.equal(install.searchParams.get("state"), "ST");
});

test("github: code exchange sends the verifier and never follows redirects; bad replies are rejected", async () => {
  const f = fakeFetch(() => ({ access_token: "ghu_abcdefghijklmnop" }));
  const gh = createGitHubClient({ config: config(), fetchImpl: f });
  assert.equal(await gh.exchangeCode({ code: "c", verifier: "v" }), "ghu_abcdefghijklmnop");
  const body = JSON.parse(f.calls[0].init.body);
  assert.deepEqual([body.code, body.code_verifier, body.client_id], ["c", "v", "Iv23liTESTCLIENT"]);
  assert.equal(f.calls[0].init.redirect, "error");
  for (const reply of [{ error: "bad_verification_code" }, {}, "text", { access_token: "x" }]) {
    const g = createGitHubClient({ config: config(), fetchImpl: fakeFetch(() => reply) });
    await assert.rejects(g.exchangeCode({ code: "c", verifier: "v" }), (e) => e instanceof GitHubError && e.kind === "bad_response");
  }
});

test("github: provider failures map to feature-local error kinds", async () => {
  const kinds = async (response) => {
    const gh = createGitHubClient({ config: config(), fetchImpl: fakeFetch(() => response) });
    return gh.exchangeCode({ code: "c", verifier: "v" }).catch((e) => e);
  };
  assert.equal((await kinds(new Response("{}", { status: 401 }))).kind, "unauthorized");
  assert.equal((await kinds(new Response("{}", { status: 404 }))).kind, "not_found");
  assert.equal((await kinds(new Response("{}", { status: 503 }))).kind, "unavailable");
  assert.equal((await kinds(new Response("{}", { status: 403 }))).kind, "forbidden");
  const limited = await kinds(new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0" } }));
  assert.equal(limited.kind, "rate_limited");
  const retry = await kinds(new Response("{}", { status: 429, headers: { "retry-after": "42" } }));
  assert.deepEqual([retry.kind, retry.retryAfterSeconds], ["rate_limited", 42]);
  assert.equal((await kinds(new Response("not json", { status: 200 }))).kind, "bad_response");
  const timeout = createGitHubClient({ config: config(), fetchImpl: async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); } });
  assert.equal((await timeout.exchangeCode({ code: "c", verifier: "v" }).catch((e) => e)).kind, "timeout");
  const net = createGitHubClient({ config: config(), fetchImpl: async () => { throw new Error("ECONNRESET secret-host"); } });
  const err = await net.exchangeCode({ code: "c", verifier: "v" }).catch((e) => e);
  assert.equal(err.kind, "unavailable");
  assert.ok(!String(err.message).includes("secret-host"), "provider text never leaks into the message");
});

test("github: user repositories are paged and bounded (10 installations, 300 repositories)", async () => {
  const f = fakeFetch((url) => {
    if (url.includes("/user/installations?")) return { installations: [{ id: 1 }, { id: 2 }] };
    const page = Number(new URL(url).searchParams.get("page"));
    const inst = url.includes("/installations/1/") ? 1 : 2;
    const n = page === 1 ? GITHUB_LIMITS.perPage : 3;
    return { repositories: Array.from({ length: n }, (_, i) => repo(inst * 1000 + page * 200 + i)) };
  });
  const gh = createGitHubClient({ config: config(), fetchImpl: f });
  const all = await gh.collectUserRepositories("ghu_user_token_value");
  assert.equal(all.length, 2 * (GITHUB_LIMITS.perPage + 3));
  assert.deepEqual([all[0].installationId, all[0].visibility], [1, "private"]);
  assert.ok(f.calls.every((c) => c.init.headers.get("authorization") === "Bearer ghu_user_token_value"));
  const many = createGitHubClient({ config: config(), fetchImpl: fakeFetch(() => ({ installations: Array.from({ length: 11 }, (_, i) => ({ id: i + 1 })) })) });
  await assert.rejects(many.collectUserRepositories("t"), (e) => e.kind === "too_many");
  let id = 0;
  const big = createGitHubClient({
    config: config(),
    fetchImpl: fakeFetch((url) => (url.includes("/user/installations?") ? { installations: [{ id: 1 }] } : { repositories: Array.from({ length: 100 }, () => repo((id += 1))) })),
  });
  await assert.rejects(big.collectUserRepositories("t"), (e) => e.kind === "too_many");
  const malformed = createGitHubClient({ config: config(), fetchImpl: fakeFetch((url) => (url.includes("/user/installations?") ? { installations: [{ id: 1 }] } : { repositories: [{ id: 1, full_name: "bad name" }] })) });
  await assert.rejects(malformed.collectUserRepositories("t"), (e) => e.kind === "bad_response");
});

test("github: installation token is requested read-only and narrowed to one repository; broader or writable replies are refused", async () => {
  const good = (extra = {}) => ({ token: "ghs_installation_token", expires_at: "2026-10-07T13:00:00Z", repository_selection: "selected", permissions: { metadata: "read", contents: "read" }, repositories: [{ id: 501 }], ...extra });
  const f = fakeFetch(() => good());
  const gh = createGitHubClient({ config: config(), fetchImpl: f, nowSeconds: () => 1_800_000_000 });
  const token = await gh.mintInstallationToken({ installationId: 77, repositoryId: 501 });
  assert.deepEqual(token.repositoryIds, [501]);
  const sent = JSON.parse(f.calls[0].init.body);
  assert.deepEqual(sent.repository_ids, [501]);
  assert.deepEqual(sent.permissions, READ_ONLY_PERMISSIONS);
  assert.ok(Object.values(sent.permissions).every((level) => level === "read"), "no write permission is ever requested");
  assert.match(f.calls[0].url, /\/app\/installations\/77\/access_tokens$/);
  for (const reply of [good({ permissions: { contents: "write" } }), good({ repositories: [{ id: 501 }, { id: 502 }] }), good({ repositories: [{ id: 999 }] }), good({ repository_selection: "all" }), good({ repositories: undefined }), { token: 1 }]) {
    assert.throws(() => parseInstallationToken(reply, 501), (e) => e.kind === "bad_response");
  }
});

test("github: the App JWT is RS256, backdated 60 s, short lived, issued by the client id and verifies with the public key", () => {
  const gh = createGitHubClient({ config: config(), nowSeconds: () => 1_800_000_000 });
  const [h, p, s] = gh.appJwt().split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url")), { alg: "RS256", typ: "JWT" });
  const payload = JSON.parse(Buffer.from(p, "base64url"));
  assert.equal(payload.iss, "Iv23liTESTCLIENT");
  assert.equal(payload.iat, 1_800_000_000 - 60);
  assert.ok(payload.exp - payload.iat <= 600 && payload.exp > 1_800_000_000);
  assert.equal(createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(s, "base64url")), true);
});

test("github: installation reachability checks the repository id", async () => {
  const gh = createGitHubClient({ config: config(), fetchImpl: fakeFetch(() => ({ repositories: [{ id: 501 }] })) });
  assert.equal(await gh.installationReachesRepository("t", 501), true);
  assert.equal(await gh.installationReachesRepository("t", 502), false);
});

// ---- service --------------------------------------------------------------------------------

function harness({ rpc = {}, github, cfg = loadConfig(baseEnv(), { production: false }) } = {}) {
  const calls = [];
  const client = (label) => ({
    rpc: async (name, args) => {
      calls.push({ label, name, args });
      const handler = rpc[name];
      const result = typeof handler === "function" ? await handler(args) : handler;
      return result ?? { data: null, error: null };
    },
  });
  const user = client("user");
  const admin = client("admin");
  const gh = github ?? (cfg.configured ? createGitHubClient({ config: cfg.config, fetchImpl: fakeFetch(() => ({})) }) : null);
  return { deps: { config: cfg, github: gh, admin: () => admin }, user, calls };
}
const HEX = (value) => value; // bytea arguments are `\\x`-prefixed hex strings, compared as text
const cookieFor = (nonce) => `ca_connect_nonce=${nonce}`;

test("start: hashes go to the database, the raw nonce only to the cookie, and the URL matches the derived verifier", async () => {
  const { deps, user, calls } = harness();
  const result = await svc.startAuthorization(deps, { user, listId: LIST, flow: "oauth" });
  assert.equal(result.status, 200);
  const rpc = calls[0];
  assert.equal(rpc.name, "code_activity_start_authorization");
  assert.match(rpc.args.p_state_hash, /^\\x[0-9a-f]{64}$/);
  assert.match(rpc.args.p_nonce_hash, /^\\x[0-9a-f]{64}$/);
  const url = new URL(result.body.url);
  const state = url.searchParams.get("state");
  const nonce = /ca_connect_nonce=([^;]+)/.exec(result.cookies[0])[1];
  assert.equal(HEX(rpc.args.p_state_hash), HEX(sha256Bytea(state)));
  assert.equal(HEX(rpc.args.p_nonce_hash), HEX(sha256Bytea(nonce)));
  assert.equal(url.searchParams.get("code_challenge"), challengeFor(deriveVerifier(STATE_SECRET, state, nonce)));
  assert.ok(!JSON.stringify(calls).includes(nonce) && !JSON.stringify(calls).includes(state), "raw state and nonce never reach the database");
  assert.ok(result.cookies[0].includes("Max-Age=600"));
  const install = await svc.startAuthorization(harness().deps, { user, listId: LIST, flow: "install" });
  assert.match(install.body.url, /\/apps\/katalist-code-activity\/installations\/new\?state=/);
});

test("start: neutral failures", async () => {
  assert.equal((await svc.startAuthorization(harness({ cfg: loadConfig({}) }).deps, { user: harness().user, listId: LIST, flow: "oauth" })).body.error, "not_configured");
  const bad = harness();
  assert.equal((await svc.startAuthorization(bad.deps, { user: bad.user, listId: "nope", flow: "oauth" })).status, 400);
  assert.equal((await svc.startAuthorization(bad.deps, { user: bad.user, listId: LIST, flow: "weird" })).status, 400);
  const codes = { "42501": 403, "23505": 409, "54000": 429, "PGRST202": 503, XX000: 502 };
  for (const [code, status] of Object.entries(codes)) {
    const h = harness({ rpc: { code_activity_start_authorization: { data: null, error: { code, message: "provider/db text must not leak" } } } });
    const r = await svc.startAuthorization(h.deps, { user: h.user, listId: LIST, flow: "oauth" });
    assert.equal(r.status, status, code);
    assert.ok(!JSON.stringify(r).includes("must not leak"));
  }
});

test("disabled and not_allowed share one body so a caller cannot tell them apart", () => {
  assert.deepEqual(svc.failure("disabled").body, svc.failure("not_allowed").body);
});

const consumeOk = (flow = "oauth") => ({ data: [{ o_flow: flow, o_list_id: LIST, o_profile_id: USER }], error: null });
function callbackHarness(extra = {}) {
  const nonce = randomToken();
  const state = randomToken();
  const f = fakeFetch((url) => {
    if (url.includes("login/oauth/access_token")) return { access_token: "ghu_SECRET_USER_TOKEN_123" };
    if (url.includes("/user/installations?")) return { installations: [{ id: 77 }] };
    return { repositories: [repo(501)] };
  });
  const cfg = loadConfig(baseEnv(), { production: false });
  const h = harness({ cfg, github: createGitHubClient({ config: cfg.config, fetchImpl: f }), rpc: { code_activity_server_consume_auth_state: consumeOk(), code_activity_server_write_selection_proofs: { data: 1, error: null }, ...extra } });
  return { ...h, f, nonce, state };
}

test("callback: valid state exchanges the code once, writes proofs from verified replies, re-issues the cookie, redirects to the List", async () => {
  const h = callbackHarness();
  const r = await svc.handleCallback(h.deps, { query: { code: "abc", state: h.state }, cookieHeader: cookieFor(h.nonce) });
  assert.deepEqual([r.status, r.redirect], [302, `/lists/${LIST}?codeActivity=select`]);
  assert.ok(r.cookies[0].includes("Max-Age=900") && r.cookies[0].includes(h.nonce));
  const consume = h.calls.find((c) => c.name === "code_activity_server_consume_auth_state");
  assert.equal(HEX(consume.args.p_state_hash), HEX(sha256Bytea(h.state)));
  assert.equal(HEX(consume.args.p_nonce_hash), HEX(sha256Bytea(h.nonce)));
  const write = h.calls.find((c) => c.name === "code_activity_server_write_selection_proofs");
  assert.deepEqual([write.args.p_list_id, write.args.p_profile_id], [LIST, USER]);
  assert.deepEqual(write.args.p_items, [{ installation_id: 77, repository_id: 501, full_name: "acme/r501", visibility: "private", updated_at: "2026-10-01T00:00:00Z" }]);
  const exchange = JSON.parse(h.f.calls[0].init.body);
  assert.equal(exchange.code_verifier, deriveVerifier(STATE_SECRET, h.state, h.nonce), "the verifier is recomputed, not stored");
  const everything = JSON.stringify([h.calls, r]);
  assert.ok(!everything.includes("ghu_SECRET_USER_TOKEN_123"), "the user token never reaches the database or the response");
});

test("callback: replay, mismatch, missing cookie or malformed state cause no provider request", async () => {
  const none = callbackHarness({ code_activity_server_consume_auth_state: { data: [], error: null } });
  const replay = await svc.handleCallback(none.deps, { query: { code: "abc", state: none.state }, cookieHeader: cookieFor(none.nonce) });
  assert.equal(replay.status, 400);
  assert.equal(none.f.calls.length, 0);
  const noCookie = callbackHarness();
  assert.equal((await svc.handleCallback(noCookie.deps, { query: { code: "abc", state: noCookie.state }, cookieHeader: null })).status, 400);
  assert.equal(noCookie.calls.length, 0, "no database call without a cookie");
  assert.equal((await svc.handleCallback(noCookie.deps, { query: { code: "abc", state: "short" }, cookieHeader: cookieFor(noCookie.nonce) })).status, 400);
  assert.equal(noCookie.f.calls.length, 0);
  const err = callbackHarness({ code_activity_server_consume_auth_state: { data: null, error: { code: "PGRST202", message: "x" } } });
  assert.equal((await svc.handleCallback(err.deps, { query: { code: "abc", state: err.state }, cookieHeader: cookieFor(err.nonce) })).status, 400);
  assert.equal(err.f.calls.length, 0);
});

test("callback: denial, install flow, limits and provider failure return to the List with a neutral outcome", async () => {
  const run = async (h, query, flow) => svc.handleCallback(h.deps, { query: { state: h.state, ...query }, cookieHeader: cookieFor(h.nonce) });
  const denied = callbackHarness();
  const d = await run(denied, { error: "access_denied" });
  assert.equal(d.redirect, `/lists/${LIST}?codeActivity=denied`);
  assert.equal(denied.f.calls.length, 0, "no exchange after denial");
  const install = callbackHarness({ code_activity_server_consume_auth_state: consumeOk("install") });
  const i = await run(install, { code: "abc" });
  assert.equal(i.redirect, `/lists/${LIST}?codeActivity=continue`);
  assert.equal(install.f.calls.length, 0, "install flow never exchanges the code and creates no proof");
  assert.ok(!install.calls.some((c) => c.name === "code_activity_server_write_selection_proofs"));
  const missingCode = await run(callbackHarness(), {});
  assert.equal(missingCode.redirect, `/lists/${LIST}?codeActivity=error`);
  const failing = callbackHarness();
  failing.deps.github = createGitHubClient({ config: failing.deps.config.config, fetchImpl: fakeFetch(() => new Response("{}", { status: 503 })) });
  const p = await run(failing, { code: "abc" });
  assert.equal(p.redirect, `/lists/${LIST}?codeActivity=error`);
  assert.ok(p.cookies[0].includes("Max-Age=0"));
  const tooMany = callbackHarness();
  tooMany.deps.github = createGitHubClient({ config: tooMany.deps.config.config, fetchImpl: fakeFetch((url) => (url.includes("access_token") ? { access_token: "ghu_abcdefghijklmnop" } : { installations: Array.from({ length: 11 }, (_, i) => ({ id: i + 1 })) })) });
  assert.equal((await run(tooMany, { code: "abc" })).redirect, `/lists/${LIST}?codeActivity=too_many`);
  const writeFail = callbackHarness({ code_activity_server_write_selection_proofs: { data: null, error: { code: "42501", message: "x" } } });
  assert.equal((await run(writeFail, { code: "abc" })).redirect, `/lists/${LIST}?codeActivity=error`);
});

function connectHarness({ reach = [501], rpc = {} } = {}) {
  const nonce = randomToken();
  const cfg = loadConfig(baseEnv(), { production: false });
  const f = fakeFetch((url) =>
    url.includes("/access_tokens")
      ? { token: "ghs_installation_token", expires_at: "2026-10-07T13:00:00Z", repository_selection: "selected", permissions: { metadata: "read" }, repositories: [{ id: 501 }] }
      : { repositories: reach.map((id) => ({ id })) },
  );
  const h = harness({
    cfg,
    github: createGitHubClient({ config: cfg.config, fetchImpl: f }),
    rpc: {
      code_activity_server_get_proof: { data: [{ o_installation_id: 77, o_repository_id: 501, o_repository_full_name: "acme/r501" }], error: null },
      code_activity_server_mark_proof_verified: { data: true, error: null },
      code_activity_connect: { data: "conn-1", error: null },
      code_activity_server_take_budget: { data: true, error: null },
      ...rpc,
    },
  });
  return { ...h, f, nonce, input: { userId: USER, user: h.user, listId: LIST, proofId: PROOF, acknowledged: true, cookieHeader: cookieFor(nonce) } };
}

test("connect: server reads the proof, proves the installation with a narrowed token, records verification, then connects as the user", async () => {
  const h = connectHarness();
  const r = await svc.connect(h.deps, h.input);
  assert.deepEqual([r.status, r.body], [200, { connected: true }]);
  assert.ok(r.cookies[0].includes("Max-Age=0"), "cookie cleared on success");
  assert.deepEqual(h.calls.map((c) => `${c.label}:${c.name}`).filter((n, i, a) => a.indexOf(n) === i), [
    "admin:code_activity_server_get_proof",
    "admin:code_activity_server_take_budget",
    "admin:code_activity_server_mark_proof_verified",
    "user:code_activity_connect",
  ]);
  assert.deepEqual(h.calls.find((c) => c.name === "code_activity_server_take_budget").args, { p_installation_id: 77, p_cost: 5, p_interactive: true }, "provider requests are metered, in the interactive class");
  const connect = h.calls.find((c) => c.name === "code_activity_connect").args;
  assert.deepEqual(Object.keys(connect).sort(), ["p_list_id", "p_nonce_hash", "p_proof_id", "p_sharing_acknowledged"], "no installation or repository id is passed");
  assert.equal(HEX(connect.p_nonce_hash), HEX(sha256Bytea(h.nonce)));
  assert.equal(h.calls[0].args.p_profile_id, USER, "the verified user id, not a client value");
  assert.deepEqual(JSON.parse(h.f.calls[0].init.body).repository_ids, [501]);
  assert.ok(!JSON.stringify(r).includes("501") && !JSON.stringify(r).includes("77"));
});

test("connect: refuses without acknowledgement, cookie, or a bound proof, and never touches GitHub in those cases", async () => {
  const noAck = connectHarness();
  assert.equal((await svc.connect(noAck.deps, { ...noAck.input, acknowledged: false })).status, 400);
  assert.equal((await svc.connect(noAck.deps, { ...noAck.input, acknowledged: "true" })).status, 400);
  assert.equal((await svc.connect(noAck.deps, { ...noAck.input, listId: "x" })).status, 400);
  assert.equal(noAck.calls.length + noAck.f.calls.length, 0);
  const noCookie = connectHarness();
  assert.equal((await svc.connect(noCookie.deps, { ...noCookie.input, cookieHeader: null })).status, 403);
  assert.equal(noCookie.calls.length + noCookie.f.calls.length, 0);
  const noProof = connectHarness({ rpc: { code_activity_server_get_proof: { data: [], error: null } } });
  assert.equal((await svc.connect(noProof.deps, noProof.input)).status, 403);
  assert.equal(noProof.f.calls.length, 0, "no provider call without a bound proof");
});

test("connect: an installation that cannot reach the repository is refused and never marked verified", async () => {
  const h = connectHarness({ reach: [999] });
  assert.equal((await svc.connect(h.deps, h.input)).status, 403);
  assert.ok(!h.calls.some((c) => c.name === "code_activity_server_mark_proof_verified" || c.name === "code_activity_connect"));
});

test("connect: provider and database failures map to neutral codes", async () => {
  const h = connectHarness();
  h.deps.github = createGitHubClient({ config: h.deps.config.config, fetchImpl: fakeFetch(() => new Response("{}", { status: 429, headers: { "retry-after": "5" } })) });
  assert.equal((await svc.connect(h.deps, h.input)).status, 429);
  const unmarked = connectHarness({ rpc: { code_activity_server_mark_proof_verified: { data: false, error: null } } });
  assert.equal((await svc.connect(unmarked.deps, unmarked.input)).status, 403);
  const forbidden = connectHarness({ rpc: { code_activity_connect: { data: null, error: { code: "42501", message: "not allowed" } } } });
  const r = await svc.connect(forbidden.deps, forbidden.input);
  assert.equal(r.status, 403);
  assert.ok(!r.cookies, "the cookie stays so the owner can retry within the proof's life");
  const already = connectHarness({ rpc: { code_activity_connect: { data: null, error: { code: "23505", message: "already connected" } } } });
  assert.equal((await svc.connect(already.deps, already.input)).status, 409);
});

test("repositories: no cookie means an empty list; the nonce is hashed; the limit is capped", async () => {
  const nonce = randomToken();
  const { user, calls } = harness({ rpc: { code_activity_list_selection_proofs: { data: Array.from({ length: 50 }, (_, i) => ({ proof_id: `p${i}`, repository_full_name: `acme/r${i}`, visibility: "private", repository_updated_at: null })), error: null } } });
  assert.deepEqual((await svc.listRepositories({ user, listId: LIST, cookieHeader: null })).body, { items: [], nextCursor: null });
  assert.equal(calls.length, 0);
  const page = await svc.listRepositories({ user, listId: LIST, cookieHeader: cookieFor(nonce), limit: 5000 });
  assert.equal(calls[0].args.p_limit, 50);
  assert.equal(HEX(calls[0].args.p_nonce_hash), HEX(sha256Bytea(nonce)));
  assert.equal(page.body.items.length, 50);
  assert.equal(page.body.nextCursor, "acme/r49");
  assert.deepEqual(Object.keys(page.body.items[0]).sort(), ["fullName", "proofId", "updatedAt", "visibility"], "no installation or repository id");
});

test("capabilities, status and disconnect behave neutrally", async () => {
  const on = harness({ rpc: { code_activity_is_enabled: { data: true, error: null } } });
  assert.deepEqual((await svc.capabilities({ user: on.user, listId: LIST, config: on.deps.config })).body, { enabled: true, configured: true, ai: { available: false, consent: false } });
  const withAi = harness({ rpc: { code_activity_is_enabled: { data: true, error: null }, code_activity_ai_status: { data: [{ o_available: true, o_consent: true }], error: null } } });
  assert.deepEqual((await svc.capabilities({ user: withAi.user, listId: LIST, config: withAi.deps.config, aiConfigured: true })).body.ai, { available: true, consent: true });
  assert.deepEqual((await svc.capabilities({ user: withAi.user, listId: LIST, config: withAi.deps.config, aiConfigured: false })).body.ai, { available: false, consent: true }, "no model key: nothing is available");
  const unconfigured = await svc.capabilities({ user: on.user, listId: LIST, config: loadConfig({}) });
  assert.deepEqual(unconfigured.body, { enabled: true, configured: false, ai: { available: false, consent: false } });
  for (const rpc of [{ data: false, error: null }, { data: null, error: { code: "PGRST202", message: "x" } }]) {
    const off = harness({ rpc: { code_activity_is_enabled: rpc } });
    assert.deepEqual((await svc.capabilities({ user: off.user, listId: LIST, config: off.deps.config })).body, { enabled: false });
  }
  assert.deepEqual((await svc.capabilities({ user: on.user, listId: "bad", config: on.deps.config })).body, { enabled: false });
  const none = harness({ rpc: { code_activity_connection_status: { data: [], error: null } } });
  assert.deepEqual((await svc.connectionStatus({ user: none.user, listId: LIST })).body, { status: "none" });
  const some = harness({ rpc: { code_activity_connection_status: { data: [{ status: "revoked", repository_full_name: "acme/r1", last_synced_at: null, sync_status: "stale" }], error: null } } });
  assert.deepEqual((await svc.connectionStatus({ user: some.user, listId: LIST })).body, { status: "revoked", repositoryFullName: "acme/r1", lastSyncedAt: null, syncStatus: "stale", needsReverification: false });
  const d = harness();
  assert.equal((await svc.disconnect({ user: d.user, listId: LIST, confirm: false })).status, 400);
  assert.equal(d.calls.length, 0);
  assert.equal((await svc.disconnect({ user: d.user, listId: LIST, confirm: true })).status, 200);
});

// ---- structure ------------------------------------------------------------------------------

test("structure: routes import server code only dynamically; client files never import the server folder; no logging in server code", () => {
  const dir = new URL("../src/routes/api/code-activity/", import.meta.url).pathname;
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}${e.name}/`) : [`${d}${e.name}`]));
  const routes = walk(dir);
  assert.equal(routes.length, 21, "13 connector routes, six workspace read routes and two workspace creation routes");
  const elsewhere = [new URL("../src/routes/api/public/code-activity/github/webhook.ts", import.meta.url).pathname, new URL("../src/routes/api/jobs/code-activity-drain.ts", import.meta.url).pathname];
  for (const file of elsewhere) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(text, /^import .*server/m, `${file} must not statically import server modules`);
    assert.match(text, /import\("@\/features\/code-activity\/server\//);
  }
  for (const file of routes) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(text, /^import .*server/m, `${file} must not statically import server modules`);
    assert.match(text, /await import\("@\/features\/code-activity\/server\//);
  }
  const feature = new URL("../src/features/code-activity/", import.meta.url).pathname;
  for (const file of readdirSync(feature).filter((f) => /\.(ts|tsx)$/.test(f))) {
    assert.doesNotMatch(readFileSync(feature + file, "utf8"), /from "\.\/server\//, `${file} must not import server code`);
  }
  const serverDir = `${feature}server/`;
  for (const file of readdirSync(serverDir)) {
    assert.match(file, /\.server\.ts$/, "server modules use the .server suffix so the bundler keeps them out of the client");
    assert.doesNotMatch(readFileSync(serverDir + file, "utf8"), /console\.(log|info|debug|warn|error)/, `${file} must not log`);
  }
});

// ---- regressions from the first integration review ------------------------------------------

test("regression: every bytea argument is a \\x hex STRING in the request the Supabase client actually sends", async () => {
  const sent = [];
  const client = createClient("https://example.supabase.co", "sb_publishable_test", {
    auth: { persistSession: false },
    global: {
      fetch: async (url, init) => {
        sent.push({ url: String(url), body: init?.body ? String(init.body) : "" });
        const name = String(url);
        const body = name.includes("consume_auth_state") ? [{ o_flow: "oauth", o_list_id: LIST, o_profile_id: USER }] : name.includes("get_proof") ? [{ o_installation_id: 77, o_repository_id: 501 }] : name.includes("mark_proof") ? true : name.includes("write_selection") ? 1 : null;
        return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      },
    },
  });
  const cfg = loadConfig(baseEnv(), { production: false });
  const f = fakeFetch((url) =>
    url.includes("access_token") ? { access_token: "ghu_abcdefghijklmnop" } : url.includes("/user/installations?") ? { installations: [{ id: 77 }] } : url.includes("/access_tokens") ? { token: "ghs_installation_token", expires_at: "x", repository_selection: "selected", permissions: { metadata: "read" }, repositories: [{ id: 501 }] } : { repositories: [repo(501)] },
  );
  const deps = { config: cfg, github: createGitHubClient({ config: cfg.config, fetchImpl: f }), admin: () => client };
  const nonce = randomToken();
  const state = randomToken();
  await svc.startAuthorization(deps, { user: client, listId: LIST, flow: "oauth" });
  await svc.handleCallback(deps, { query: { code: "abc", state }, cookieHeader: cookieFor(nonce) });
  await svc.listRepositories({ user: client, listId: LIST, cookieHeader: cookieFor(nonce) });
  await svc.connect(deps, { userId: USER, user: client, listId: LIST, proofId: PROOF, acknowledged: true, cookieHeader: cookieFor(nonce) });
  const withHash = sent.filter((r) => /_hash/.test(r.body));
  assert.ok(withHash.length >= 5, `expected the hash-bearing RPCs to be captured, got ${withHash.length}`);
  for (const request of withHash) {
    assert.doesNotMatch(request.body, /"\d+":\d+/, `${request.url} serialized a byte array as an object`);
    const body = JSON.parse(request.body);
    for (const [key, value] of Object.entries(body).filter(([k]) => k.endsWith("_hash"))) {
      assert.equal(typeof value, "string", `${request.url} ${key}`);
      assert.match(value, /^\\x[0-9a-f]{64}$/, `${request.url} ${key} must be a PostgreSQL bytea hex literal`);
    }
  }
  assert.equal(JSON.stringify({ x: sha256Bytea("a") }), `{"x":"\\\\x${sha256Bytea("a").slice(2)}"}`, "one backslash in memory, escaped once on the wire");
});

/** A fetch that takes `ms` per call and honours the abort signal, like a slow provider. */
function slowFetch(ms, reply) {
  const calls = [];
  const impl = (url, init) =>
    new Promise((resolve, reject) => {
      calls.push(String(url));
      const timer = setTimeout(() => resolve(new Response(JSON.stringify(reply(String(url))), { status: 200 })), ms);
      init.signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(Object.assign(new Error("aborted"), { name: "TimeoutError" }));
      });
    });
  impl.calls = calls;
  return impl;
}

test("regression: the callback has one overall deadline, not only a per-request deadline", async () => {
  const cfg = loadConfig(baseEnv(), { production: false });
  const f = slowFetch(40, (url) => (url.includes("access_token") ? { access_token: "ghu_abcdefghijklmnop" } : url.includes("/user/installations?") ? { installations: Array.from({ length: 6 }, (_, i) => ({ id: i + 1 })) } : { repositories: [repo(1)] }));
  const h = harness({ cfg, github: createGitHubClient({ config: cfg.config, fetchImpl: f }), rpc: { code_activity_server_consume_auth_state: consumeOk(), code_activity_server_write_selection_proofs: { data: 1, error: null } } });
  h.deps.callbackDeadlineMs = 100; // each call is 40 ms, so a sequence of nine calls would take 360 ms without a total budget
  const nonce = randomToken();
  const started = Date.now();
  const r = await svc.handleCallback(h.deps, { query: { code: "abc", state: randomToken() }, cookieHeader: cookieFor(nonce) });
  assert.equal(r.redirect, `/lists/${LIST}?codeActivity=timed_out`);
  assert.ok(Date.now() - started < 1500, "the whole sequence stops near the budget");
  assert.ok(f.calls.length < 9, `later calls were not made (${f.calls.length})`);
  assert.ok(!h.calls.some((c) => c.name === "code_activity_server_write_selection_proofs"), "nothing is written after a timeout");
  assert.ok(r.cookies[0].includes("Max-Age=0"));
});

test("regression: the connect verification has its own overall deadline", async () => {
  const cfg = loadConfig(baseEnv(), { production: false });
  const f = slowFetch(60, () => ({}));
  const h = connectHarness();
  h.deps.github = createGitHubClient({ config: cfg.config, fetchImpl: f });
  h.deps.connectDeadlineMs = 30;
  const r = await svc.connect(h.deps, h.input);
  assert.equal(r.status, 504);
  assert.ok(!h.calls.some((c) => c.name === "code_activity_server_mark_proof_verified" || c.name === "code_activity_connect"));
});

test("regression: withDeadline shares one budget and an expired budget fails before any request", async () => {
  const f = fakeFetch(() => ({ installations: [] }));
  const gh = createGitHubClient({ config: config(), fetchImpl: f }).withDeadline(1);
  await new Promise((resolve) => setTimeout(resolve, 15));
  const err = await gh.collectUserRepositories("t").catch((e) => e);
  assert.equal(err.kind, "timeout");
  assert.equal(f.calls.length, 0);
});
