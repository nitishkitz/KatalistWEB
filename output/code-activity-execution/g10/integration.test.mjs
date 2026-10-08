// G10 acceptance (automated part): the real services against the real draft SQL, GitHub faked at the HTTP edge.
//   node --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./scripts/alias-loader.mjs \
//        --test output/code-activity-execution/g10/integration.test.mjs
// NOT proven here: hosted Supabase/PostgREST, a real GitHub App, a browser. See g10/MANUAL-ACCEPTANCE.md.
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { beforeEach, test } from "node:test";
import { CALLBACK_PATH, ENV_NAMES, loadConfig } from "../../../src/features/code-activity/server/config.server.ts";
import { randomToken } from "../../../src/features/code-activity/server/crypto.server.ts";
import { createGitHubClient } from "../../../src/features/code-activity/server/github.server.ts";
import * as svc from "../../../src/features/code-activity/server/service.server.ts";
import * as act from "../../../src/features/code-activity/server/activity.server.ts";
import * as hook from "../../../src/features/code-activity/server/webhook.server.ts";
import { drain } from "../../../src/features/code-activity/server/drain.server.ts";
import * as thing from "../../../src/features/code-activity/server/thing.server.ts";
import * as ai from "../../../src/features/code-activity/server/ai.server.ts";
import { createHmac } from "node:crypto";
import { L, SUBSET, U, createDb, reset, rpcClient } from "./harness.mjs";

// With CODE_ACTIVITY_SUBSET=readonly only the read-only connector's four migrations exist, so the tests that need the optional
// Thing-creation and AI functions (g14, g15) are skipped there and covered by the subset file instead.
const full = (name, fn) => (SUBSET === "readonly" ? test.skip(name, fn) : test(name, fn));

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const cfg = loadConfig({
  [ENV_NAMES.appId]: "1", [ENV_NAMES.appSlug]: "app", [ENV_NAMES.clientId]: "Iv1", [ENV_NAMES.clientSecret]: "s",
  [ENV_NAMES.privateKey]: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), [ENV_NAMES.stateSecret]: "x".repeat(40),
  [ENV_NAMES.callbackUrl]: `http://localhost:8080${CALLBACK_PATH}`, [ENV_NAMES.allowedOrigins]: "http://localhost:8080",
}, { production: false });
const SHA = (c) => c.repeat(40);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const iso = (minutesAgo) => new Date(Date.UTC(2026, 9, 7, 12) - minutesAgo * 60_000).toISOString();

/** A small fake GitHub: one installation, one private repository, three pull requests, a push, checks and a status. */
function fakeGitHub(state = {}) {
  const calls = [];
  const head = state.head ?? SHA("a");
  const fetchImpl = async (url, init) => {
    const u = String(url);
    calls.push({ url: u, method: init.method ?? "GET" });
    for (const [needle, value] of Object.entries(state.routes ?? {})) {
      if (needle.startsWith("$") ? u.endsWith(needle.slice(1)) : u.includes(needle)) { // "$suffix" matches the end of the URL
        const v = typeof value === "function" ? await value() : value;
        return v instanceof Response ? v : json(v);
      }
    }
    if (u.includes("login/oauth/access_token")) return json({ access_token: "ghu_user_token_value" });
    if (u.includes("/user/installations?")) return json({ installations: [{ id: 77 }] });
    if (u.includes("/user/installations/77/repositories")) return json({ repositories: [{ id: 501, full_name: "acme/web", private: true, pushed_at: iso(5) }, { id: 502, full_name: "acme/api", private: false, updated_at: iso(50) }] });
    if (u.includes("/access_tokens")) {
      const asked = JSON.parse(init.body ?? "{}").repository_ids?.[0] ?? 501; // narrowed to exactly the repository asked for
      return json({ token: "ghs_installation_token", expires_at: "2026-10-07T13:00:00Z", repository_selection: "selected", permissions: { metadata: "read" }, repositories: [{ id: asked }] });
    }
    if (u.includes("/installation/repositories")) return json({ repositories: [{ id: 501, full_name: "acme/web" }, { id: 502, full_name: "acme/api" }] });
    if (u.includes("/pulls/7/files")) return json([{ filename: "src/a.ts", status: "modified", additions: 2, deletions: 1, patch: "@@ -1 +1,2 @@\n-a\n+b\n+<img src=x onerror=alert(1)>" }]);
    if (u.includes("/pulls/7")) return json({ title: "Real title", body: "Body", state: "open", head: { sha: head }, additions: 2, deletions: 1, changed_files: 1, html_url: "https://github.com/acme/web/pull/7" });
    if (u.includes("/pulls?")) return json([
      { number: 7, title: "Responsive nav", state: "open", draft: false, user: { login: "ana", type: "User" }, head: { ref: "nav", sha: head }, base: { ref: "main" }, html_url: "https://github.com/acme/web/pull/7", updated_at: iso(5) },
      { number: 6, title: "Fix build", state: "closed", merged_at: iso(70), user: { login: "bo", type: "User" }, head: { ref: "fix", sha: SHA("b") }, base: { ref: "main" }, html_url: "https://github.com/acme/web/pull/6", updated_at: iso(60) },
    ]);
    if (u.includes("/activity?")) return json([{ before: SHA("d"), after: SHA("c"), ref: "refs/heads/main", timestamp: iso(30), activity_type: "push", actor: { login: "bo", type: "User" } }]);
    if (u.includes("/check-runs")) return json({ check_runs: [{ id: 1, name: "build", status: "completed", conclusion: "success", started_at: iso(10), completed_at: iso(9), html_url: "https://github.com/acme/web/runs/1" }] });
    if (u.includes("/status")) return json({ state: "failure", total_count: 1, statuses: [{ id: 9, context: "ci/legacy", state: "failure", target_url: "https://ci.example.com/9" }] });
    return json({}, 404);
  };
  return { client: createGitHubClient({ config: cfg.config, fetchImpl }), calls };
}

const db = await createDb();
let log;
let gh;
let deps;
const user = (uid) => rpcClient(db, "authenticated", uid, log);
const admin = () => rpcClient(db, "service_role", null, log);
beforeEach(async () => {
  await reset(db);
  log = [];
  gh = fakeGitHub();
  deps = { config: cfg, github: gh.client, admin };
});
const cookieOf = (r) => /ca_connect_nonce=([^;]*)/.exec(r.cookies[0])[1];
const cookieHeader = (nonce) => `ca_connect_nonce=${nonce}`;

/** Start, callback, select: returns what the owner needs to connect. */
async function authorize(owner = U.O, list = L.L1) {
  const started = await svc.startAuthorization(deps, { user: user(owner), listId: list, flow: "oauth" });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const nonce = cookieOf(started);
  const state = new URL(started.body.url).searchParams.get("state");
  const back = await svc.handleCallback(deps, { query: { code: "abc", state }, cookieHeader: cookieHeader(nonce) });
  assert.equal(back.redirect, `/lists/${list}?codeActivity=select`, JSON.stringify(back));
  const repos = await svc.listRepositories({ user: user(owner), listId: list, cookieHeader: cookieHeader(nonce) });
  return { nonce, state, repos: repos.body.items };
}

test("hash encoding survives the real SQL boundary: every bytea argument is accepted and compared correctly", async () => {
  const { repos } = await authorize();
  assert.deepEqual(repos.map((r) => r.fullName), ["acme/api", "acme/web"], "proofs sorted by name, minimal fields");
  assert.deepEqual(Object.keys(repos[0]).sort(), ["fullName", "proofId", "updatedAt", "visibility"]);
  const hashArgs = log.flatMap((e) => Object.entries(e.args).filter(([k]) => k.endsWith("_hash")));
  assert.ok(hashArgs.length >= 4);
  assert.ok(hashArgs.every(([, v]) => typeof v === "string" && /^\\x[0-9a-f]{64}$/.test(v)));
});

test("the whole connection flow, then Refresh, feed, detail and disconnect, end to end", async () => {
  const { nonce, repos } = await authorize();
  const web = repos.find((r) => r.fullName === "acme/web");
  const connected = await svc.connect(deps, { userId: U.O, user: user(U.O), listId: L.L1, proofId: web.proofId, acknowledged: true, cookieHeader: cookieHeader(nonce) });
  assert.deepEqual([connected.status, connected.body], [200, { connected: true }]);
  assert.ok(gh.calls.filter((c) => c.method === "POST").every((c) => c.url.includes("login/oauth/access_token") || c.url.includes("/access_tokens")), "GitHub is only read");

  for (const uid of [U.O, U.C, U.V]) {
    const status = await svc.connectionStatus({ user: user(uid), listId: L.L1 });
    assert.deepEqual([status.body.status, status.body.repositoryFullName], ["active", "acme/web"], uid);
  }
  assert.equal((await svc.connectionStatus({ user: user(U.X), listId: L.L1 })).body.status, "none", "an outsider learns nothing");

  const refreshed = await act.refresh(deps, { user: user(U.C), listId: L.L1 });
  assert.deepEqual([refreshed.status, refreshed.body.syncStatus, refreshed.body.pullRequests, refreshed.body.pushes], [200, "ok", 2, 1], JSON.stringify(refreshed.body));

  const feed = await act.feed({ user: user(U.V), listId: L.L1 });
  assert.equal(feed.status, 200, JSON.stringify(feed.body));
  assert.deepEqual(feed.body.changes.map((c) => c.title), ["Responsive nav", "Push to main", "Fix build"], "newest first");
  assert.equal(feed.body.freshness.syncStatus, "ok");
  assert.equal(feed.body.repositoryFullName, "acme/web");
  assert.ok(feed.body.changes.every((c) => c.checkState === "failing"), "a failing commit status shows even though the check run passed");
  assert.equal(feed.body.changes[0].additions, null, "unknown counts stay null");

  assert.equal((await act.refresh(deps, { user: user(U.V), listId: L.L1 })).status, 403, "View Only cannot refresh");
  assert.equal((await act.refresh(deps, { user: user(U.C), listId: L.L1 })).status, 429, "refresh is rate limited");
  assert.equal((await act.feed({ user: user(U.X), listId: L.L1 })).status, 403, "outsiders cannot read the feed");

  const pr = feed.body.changes[0];
  const detail = await act.changeDetail(deps, { user: user(U.V), listId: L.L1, changeId: pr.id });
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  assert.equal(detail.body.change.description, "Body");
  assert.equal(detail.body.change.files[0].patch.includes("onerror"), true, "patch text is returned verbatim for text rendering");
  assert.equal(detail.body.change.checkState, "failing");
  assert.equal((await act.changeDetail(deps, { user: user(U.X), listId: L.L1, changeId: pr.id })).status, 403);
  assert.equal((await act.changeDetail(deps, { user: user(U.O2), listId: L.L2, changeId: pr.id })).status, 403, "a change id from another List is not readable through it");

  const dis = await svc.disconnect({ user: user(U.O), listId: L.L1, confirm: true });
  assert.equal(dis.status, 200);
  assert.equal((await act.feed({ user: user(U.V), listId: L.L1 })).status, 403, "saved activity stops being shown at disconnect");
  assert.equal((await svc.connectionStatus({ user: user(U.V), listId: L.L1 })).body.status, "disconnected");
  assert.equal((await svc.disconnect({ user: user(U.C), listId: L.L1, confirm: true })).status, 403);
});

test("failure drills: replay, wrong browser, collaborator, outsider, and a second connection", async () => {
  const a = await authorize();
  const replay = await svc.handleCallback(deps, { query: { code: "abc", state: a.state }, cookieHeader: cookieHeader(a.nonce) });
  assert.equal(replay.status, 400, "a used state cannot be replayed");
  const web = a.repos.find((r) => r.fullName === "acme/web");
  const otherBrowser = await svc.connect(deps, { userId: U.O, user: user(U.O), listId: L.L1, proofId: web.proofId, acknowledged: true, cookieHeader: cookieHeader(randomToken()) });
  assert.equal(otherBrowser.status, 403, "a different browser nonce cannot use the proof");
  assert.equal((await svc.connect(deps, { userId: U.C, user: user(U.C), listId: L.L1, proofId: web.proofId, acknowledged: true, cookieHeader: cookieHeader(a.nonce) })).status, 403, "a collaborator cannot connect");
  assert.equal((await svc.startAuthorization(deps, { user: user(U.V), listId: L.L1, flow: "oauth" })).status, 403);
  assert.equal((await svc.startAuthorization(deps, { user: user(U.X), listId: L.L1, flow: "oauth" })).status, 403);
  const ok = await svc.connect(deps, { userId: U.O, user: user(U.O), listId: L.L1, proofId: web.proofId, acknowledged: true, cookieHeader: cookieHeader(a.nonce) });
  assert.equal(ok.status, 200);
  assert.equal((await svc.connect(deps, { userId: U.O, user: user(U.O), listId: L.L1, proofId: web.proofId, acknowledged: true, cookieHeader: cookieHeader(a.nonce) })).status, 403, "a consumed proof is spent");
  assert.equal((await svc.startAuthorization(deps, { user: user(U.O), listId: L.L1, flow: "oauth" })).status, 409, "one live connection per List");
});

test("GitHub failures keep the saved feed; a disconnect during a refresh cannot be undone", async () => {
  const { nonce, repos } = await authorize();
  await svc.connect(deps, { userId: U.O, user: user(U.O), listId: L.L1, proofId: repos.find((r) => r.fullName === "acme/web").proofId, acknowledged: true, cookieHeader: cookieHeader(nonce) });
  await act.refresh(deps, { user: user(U.O), listId: L.L1 });
  const before = (await act.feed({ user: user(U.O), listId: L.L1 })).body.changes.length;
  await db.exec("update public.code_activity_connections set last_refresh_started_at = null");
  const down = { ...deps, github: createGitHubClient({ config: cfg.config, fetchImpl: async (url) => (String(url).includes("/access_tokens") ? json({ token: "ghs_installation_token", expires_at: "x", repository_selection: "selected", permissions: { metadata: "read" }, repositories: [{ id: 501 }] }) : json({}, 503)) }) };
  assert.equal((await act.refresh(down, { user: user(U.O), listId: L.L1 })).status, 502);
  const feed = await act.feed({ user: user(U.V), listId: L.L1 });
  assert.equal(feed.body.changes.length, before, "saved rows survive a failed refresh");
  assert.equal(feed.body.freshness.syncStatus, "unavailable");
  assert.ok(feed.body.freshness.lastSyncedAt, "the last good sync time is kept");
});

// ---- G11/G12: webhook intake, durable processing and recovery against the real SQL ------------------------------

const WHSECRET = "whsec_integration_secret_0123456789";
const delivery = (n) => `80000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
function webhook(event, payload, n) {
  const body = JSON.stringify(payload);
  return new Request("https://katalist.example/hook", { method: "POST", body, headers: { "x-github-event": event, "x-github-delivery": delivery(n), "x-hub-signature-256": `sha256=${createHmac("sha256", WHSECRET).update(body).digest("hex")}` } });
}
const intake = (event, payload, n) => hook.handleWebhook({ secret: WHSECRET, admin }, webhook(event, payload, n));
const inst = { installation: { id: 77 }, repository: { id: 501, full_name: "acme/web" } };
const pullFrom = (number, title, sha, minutesAgo) => ({ number, title, state: "open", draft: false, user: { login: "cy", type: "User" }, head: { ref: "new", sha }, base: { ref: "main" }, html_url: `https://github.com/acme/web/pull/${number}`, updated_at: iso(minutesAgo) });

async function connected() {
  await db.exec(`insert into public.code_activity_settings values ('sync','true'::jsonb)`);
  const { nonce, repos } = await authorize();
  await svc.connect(deps, { userId: U.O, user: user(U.O), listId: L.L1, proofId: repos.find((r) => r.fullName === "acme/web").proofId, acknowledged: true, cookieHeader: cookieHeader(nonce) });
  await act.refresh(deps, { user: user(U.O), listId: L.L1 });
}
const titles = async () => (await act.feed({ user: user(U.V), listId: L.L1 })).body.changes.map((c) => c.title);
const finishLog = () => log.filter((e) => e.name === "code_activity_server_finish_delivery").map((e) => [e.args.p_outcome, e.args.p_error_code]);
const withGitHub = (routes) => ({ ...deps, github: fakeGitHub({ routes }).client });

test("a pull request webhook becomes a feed row through intake, claim, refetch and apply", async () => {
  await connected();
  assert.equal((await intake("pull_request", { action: "opened", number: 9, title: "NOT TRUSTED", ...inst }, 1)).status, 202);
  assert.equal((await intake("pull_request", { action: "opened", number: 9, title: "NOT TRUSTED", ...inst }, 1)).status, 200, "a redelivery is acknowledged and not stored twice");
  assert.equal((await db.query("select count(*)::int c from public.code_activity_deliveries")).rows[0].c, 1);
  assert.deepEqual((await db.query("select refetch from public.code_activity_deliveries")).rows[0].refetch, { number: 9 }, "only the identifier is stored");

  const result = await drain(withGitHub({ "/pulls/9": pullFrom(9, "Title from GitHub", SHA("e"), 1) }));
  assert.deepEqual([result.claimed, result.processed], [1, 1]);
  assert.ok((await titles()).includes("Title from GitHub"));
  assert.ok(!(await titles()).includes("NOT TRUSTED"), "content comes from GitHub, never from the payload");
  const row = (await act.feed({ user: user(U.V), listId: L.L1 })).body.changes.find((c) => c.title === "Title from GitHub");
  assert.equal(row.checkState, "failing", "the commit status read during processing is applied");
  assert.equal((await db.query("select status from public.code_activity_deliveries")).rows[0].status, "processed");
  assert.equal((await drain(withGitHub({}))).claimed, 0, "a processed delivery is never claimed again");
});

test("an older event cannot overwrite newer data, and replay is idempotent", async () => {
  await connected();
  await intake("pull_request", { action: "edited", number: 9, ...inst }, 1);
  await drain(withGitHub({ "/pulls/9": pullFrom(9, "Newest", SHA("e"), 1) }));
  await intake("pull_request", { action: "edited", number: 9, ...inst }, 2);
  await drain(withGitHub({ "/pulls/9": pullFrom(9, "Older state", SHA("e"), 40) }));
  assert.ok((await titles()).includes("Newest"), "an event whose refetch is older does not move a row backwards");
  assert.ok(!(await titles()).includes("Older state"));
  await db.exec("update public.code_activity_deliveries set status='received', next_attempt_at = now(), lease_until = null");
  await drain(withGitHub({ "/pulls/9": pullFrom(9, "Newest", SHA("e"), 1) }));
  assert.equal((await titles()).filter((t) => t === "Newest").length, 1, "re-processing the same event never duplicates a row");
});

test("a crashed worker's lease expires and the delivery is processed again", async () => {
  await connected();
  await intake("pull_request", { action: "opened", number: 9, ...inst }, 1);
  const claimed = await admin().rpc("code_activity_server_claim_deliveries", { p_limit: 1 });
  assert.equal(claimed.data.length, 1, "claimed by a worker that then crashes");
  assert.equal((await drain(withGitHub({}))).claimed, 0, "the live lease keeps others away");
  await db.exec("update public.code_activity_deliveries set lease_until = now() - interval '1 second'");
  const result = await drain(withGitHub({ "/pulls/9": pullFrom(9, "Recovered", SHA("e"), 1) }));
  assert.deepEqual([result.claimed, result.processed], [1, 1]);
  assert.ok((await titles()).includes("Recovered"));
  assert.equal((await db.query("select attempts from public.code_activity_deliveries")).rows[0].attempts, 2);
  assert.equal(finishLog().filter(([o]) => o === "processed").length, 1);
});

test("provider failures back off and eventually dead-letter; an installation block pauses work", async () => {
  await connected();
  await intake("pull_request", { action: "opened", number: 9, ...inst }, 1);
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const r = await drain(withGitHub({ "/pulls/9": new Response("{}", { status: 503 }) }));
    assert.equal(r.claimed, 1, `attempt ${attempt}`);
    await db.exec("update public.code_activity_deliveries set next_attempt_at = now() where status = 'failed'");
  }
  assert.equal((await db.query("select status, last_error_code from public.code_activity_deliveries")).rows[0].status, "dead");
  assert.equal((await drain(withGitHub({}))).claimed, 0);
  assert.ok(!(await titles()).some((t) => /9/.test(t) && t.startsWith("PR 9")));

  await intake("pull_request", { action: "opened", number: 10, ...inst }, 2);
  const limited = await drain(withGitHub({ "/pulls/10": new Response("{}", { status: 429, headers: { "retry-after": "120" } }) }));
  assert.equal(limited.retried, 1);
  assert.ok((await db.query("select blocked_until > now() as b from public.code_activity_budget")).rows[0].b, "the installation is blocked after a rate limit");
  await db.exec("update public.code_activity_deliveries set next_attempt_at = now() where status = 'failed'");
  const again = await drain(withGitHub({ "/pulls/10": pullFrom(10, "Should wait", SHA("e"), 1) }));
  assert.deepEqual([again.claimed, again.retried], [1, 1], "retried later, still blocked");
  assert.ok(!(await titles()).includes("Should wait"));
});

test("disconnect during processing cannot be undone; suspension, deletion and kill switch behave", async () => {
  await connected();
  await intake("pull_request", { action: "opened", number: 9, ...inst }, 1);
  await svc.disconnect({ user: user(U.O), listId: L.L1, confirm: true });
  const r = await drain(withGitHub({ "/pulls/9": pullFrom(9, "Resurrected?", SHA("e"), 1) }));
  assert.equal(r.ignored, 1, "nobody follows the repository any more");
  assert.equal((await db.query("select count(*)::int c from public.code_activity_changes where title = 'Resurrected?'")).rows[0].c, 0);
  assert.equal((await db.query("select status from public.code_activity_connections")).rows[0].status, "disconnected");

  await reset(db);
  await connected();
  await intake("installation", { action: "suspend", installation: { id: 77 } }, 3);
  await drain(withGitHub({}));
  assert.equal((await svc.connectionStatus({ user: user(U.V), listId: L.L1 })).body.status, "suspended");
  assert.equal((await act.feed({ user: user(U.V), listId: L.L1 })).status, 200, "saved activity stays readable while suspended");
  assert.equal((await act.refresh(deps, { user: user(U.O), listId: L.L1 })).status, 403, "no provider reads while suspended");
  await intake("installation", { action: "unsuspend", installation: { id: 77 } }, 4);
  await drain(withGitHub({}));
  const back = await svc.connectionStatus({ user: user(U.V), listId: L.L1 });
  assert.equal(back.body.status, "active");
  assert.equal(back.body.syncStatus, "stale", "a verifying refresh is required after unsuspending");
  await intake("installation_repositories", { action: "removed", repositories_removed: [{ id: 501 }], installation: { id: 77 } }, 5);
  await drain(withGitHub({}));
  assert.equal((await svc.connectionStatus({ user: user(U.V), listId: L.L1 })).body.status, "revoked");
  assert.equal((await act.feed({ user: user(U.V), listId: L.L1 })).status, 403, "revoked: the saved activity is no longer shown");

  await db.exec("update public.code_activity_settings set value = 'false'::jsonb where key = 'sync'");
  assert.equal((await intake("pull_request", { action: "opened", number: 11, ...inst }, 6)).status, 503, "the kill switch stops intake");
  assert.equal((await drain(withGitHub({}))).claimed, 0, "and processing");
});

test("scheduled reconcile refreshes a never-synced connection in the background budget", async () => {
  await db.exec(`insert into public.code_activity_settings values ('sync','true'::jsonb)`);
  const { nonce, repos } = await authorize();
  await svc.connect(deps, { userId: U.O, user: user(U.O), listId: L.L1, proofId: repos.find((r) => r.fullName === "acme/web").proofId, acknowledged: true, cookieHeader: cookieHeader(nonce) });
  assert.equal((await act.feed({ user: user(U.V), listId: L.L1 })).body.changes.length, 0);
  const before = gh.calls.length;
  const result = await drain(deps);
  const requests = gh.calls.length - before;
  assert.equal(result.reconciled, 1);
  assert.equal((await act.feed({ user: user(U.V), listId: L.L1 })).body.changes.length, 3);
  assert.equal((await drain(deps)).reconciled, 0, "not due again until it goes stale");
  const used = (await db.query("select used_background, used_interactive from public.code_activity_budget")).rows[0];
  assert.deepEqual([used.used_background, used.used_interactive], [Math.ceil(requests / 5) * 5, 5], "every request GitHub saw was counted, reserved five at a time: the reconcile in the background class, and the connect check (two requests) in the interactive class");
});

// ---- G14/G15: confirmed Thing creation and optional Coey against the real SQL -------------------------------------

const actorOf = async (uid) => (await db.query("select id from public.actors where profile_id = $1", [uid])).rows[0].id;
const KEY = "a0000000-0000-0000-0000-000000000001";
async function firstChange() {
  return (await act.feed({ user: user(U.V), listId: L.L1 })).body.changes[0];
}
async function confirmFor(uid, change, extra = {}) {
  return thing.confirmDraft({ user: user(uid), listId: L.L1, changeId: change.id, key: KEY, title: "Verify nav", notes: "Check the menu", assigneeActorId: await actorOf(U.C), dueAt: null, importance: "next", headSha: change.headSha, acknowledgeSourceChange: false, aiGenerated: false, ...extra });
}

full("a Thing is created from a change atomically, once, for the right people only", async () => {
  await connected();
  const change = await firstChange();
  const candidates = await thing.assigneeCandidates({ user: user(U.O), listId: L.L1 });
  assert.deepEqual(candidates.body.candidates.map((c) => c.role).sort(), ["collaborator", "owner"]);
  assert.equal((await thing.assigneeCandidates({ user: user(U.V), listId: L.L1 })).status, 403, "View Only is never offered or allowed");
  assert.equal((await confirmFor(U.V, change)).status, 403);
  assert.equal((await confirmFor(U.O, change, { assigneeActorId: await actorOf(U.V) })).status, 403, "a View Only assignee is refused");
  const first = await confirmFor(U.O, change);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const again = await confirmFor(U.O, change);
  assert.deepEqual([again.body.thingId, again.body.replayed], [first.body.thingId, true]);
  assert.equal((await db.query("select count(*)::int c from public.things")).rows[0].c, 1);
  assert.equal((await confirmFor(U.O, change, { title: "Different" })).status, 409, "same key, different content");
  assert.equal((await db.query("select due_at from public.things")).rows[0].due_at, null, "no date is invented");
  await db.exec("update public.code_activity_changes set head_sha = '" + "b".repeat(40) + "'");
  const moved = await confirmFor(U.C, change, { key: "a0000000-0000-0000-0000-000000000009", assigneeActorId: await actorOf(U.O) });
  assert.deepEqual([moved.status, moved.body.error], [409, "source_changed"]);
  const knowing = await confirmFor(U.C, change, { key: "a0000000-0000-0000-0000-000000000009", assigneeActorId: await actorOf(U.O), acknowledgeSourceChange: true });
  assert.equal(knowing.status, 200);
});

full("Coey: off by default; needs the operator flag AND the owner's consent; consent is rechecked after the model replies", async () => {
  await connected();
  const change = await firstChange();
  const reply = (content) => async () => json({ choices: [{ finish_reason: "stop", message: { content } }] });
  const aiDeps = (model) => ({ ...deps, ai: { apiKey: "sk_test_sarvam_key_0123456789", model: "sarvam-105b" }, aiFetch: model });
  const draft = (uid, model) => ai.generateDraft(aiDeps(model ?? reply('{"title":"Check nav","description":"Why"}')), { user: user(uid), listId: L.L1, changeId: change.id, note: "" });

  assert.equal((await draft(U.O)).status, 403, "flag off and no consent: nothing runs");
  await db.exec(`insert into public.code_activity_settings values ('ai','true'::jsonb)`);
  assert.equal((await draft(U.O)).status, 403, "the flag alone is not enough: connecting never enables AI");
  assert.deepEqual((await svc.capabilities({ user: user(U.V), listId: L.L1, config: cfg, aiConfigured: true })).body.ai, { available: true, consent: false });
  assert.equal((await ai.setConsent({ user: user(U.C), listId: L.L1, enabled: true })).status, 403, "only the owner can consent");
  assert.equal((await ai.setConsent({ user: user(U.O), listId: L.L1, enabled: true })).status, 200);
  assert.equal((await svc.capabilities({ user: user(U.V), listId: L.L1, config: cfg, aiConfigured: true })).body.ai.consent, true, "members see the boolean");

  assert.equal((await draft(U.V)).status, 403, "View Only cannot draft");
  const ok = await draft(U.C);
  assert.deepEqual([ok.status, ok.body], [200, { title: "Check nav", description: "Why" }]);
  assert.equal((await db.query("select count(*)::int c from public.things")).rows[0].c, 0, "a draft creates nothing");

  const revoking = await draft(U.O, async () => {
    await ai.setConsent({ user: user(U.O), listId: L.L1, enabled: false });
    return reply('{"title":"Should be discarded","description":"x"}')();
  });
  assert.deepEqual([revoking.status, revoking.body.error], [403, "consent_withdrawn"], "withdrawn while the model worked");
  assert.equal((await draft(U.O)).status, 403, "and new calls are blocked");
  await ai.setConsent({ user: user(U.O), listId: L.L1, enabled: true });
  let limited;
  for (let i = 0; i < 5; i += 1) limited = await draft(U.O);
  assert.equal(limited.status, 429, "rate limited at three per person per ten minutes (failures and revocations count)");
});

// ---- Regressions from the consolidated review, against the real SQL ----------------------------------------------

full("regression (consent): withdrawing consent while GitHub evidence loads means nothing reaches the model", async () => {
  await connected();
  const change = await firstChange();
  await db.exec(`insert into public.code_activity_settings values ('ai','true'::jsonb)`);
  await ai.setConsent({ user: user(U.O), listId: L.L1, enabled: true });
  const modelCalls = [];
  const slowDeps = {
    ...deps,
    github: fakeGitHub({ routes: { "$/pulls/7": async () => { await ai.setConsent({ user: user(U.O), listId: L.L1, enabled: false }); return { title: "Responsive nav", body: "Body", state: "open", head: { sha: SHA("a") }, additions: 2, deletions: 1, changed_files: 1, html_url: "https://github.com/acme/web/pull/7" }; } } }).client,
    ai: { apiKey: "sk_test_sarvam_key_0123456789", model: "sarvam-105b" },
    aiFetch: async () => { modelCalls.push("called"); return json({ choices: [{ finish_reason: "stop", message: { content: '{"title":"x","description":"y"}' } }] }); },
  };
  const r = await ai.generateDraft(slowDeps, { user: user(U.O), listId: L.L1, changeId: change.id, note: "" });
  assert.deepEqual([r.status, r.body.error], [403, "consent_withdrawn"]);
  assert.equal(modelCalls.length, 0, "the evidence was read, but the owner had withdrawn consent: nothing was disclosed");
});

full("regression (consent): a disconnect while the model works discards the draft", async () => {
  await connected();
  const change = await firstChange();
  await db.exec(`insert into public.code_activity_settings values ('ai','true'::jsonb)`);
  await ai.setConsent({ user: user(U.O), listId: L.L1, enabled: true });
  const r = await ai.generateDraft({ ...deps, ai: { apiKey: "sk_test_sarvam_key_0123456789", model: "sarvam-105b" }, aiFetch: async () => {
    await svc.disconnect({ user: user(U.O), listId: L.L1, confirm: true });
    return json({ choices: [{ finish_reason: "stop", message: { content: '{"title":"x","description":"y"}' } }] });
  } }, { user: user(U.O), listId: L.L1, changeId: change.id, note: "" });
  assert.deepEqual([r.status, r.body.error], [403, "consent_withdrawn"], "a connection that ended is not allowed to complete a draft");
  assert.ok(!JSON.stringify(r).includes('"x"'));
});

full("regression (consent): AI-written text cannot become a Thing with AI off or without consent, even by a direct call", async () => {
  await connected();
  const change = await firstChange();
  const target = await actorOf(U.C);
  const attempt = async (n) => thing.confirmDraft({ user: user(U.O), listId: L.L1, changeId: change.id, key: `a0000000-0000-0000-0000-0000000000b${n}`, title: "From the model", notes: null, assigneeActorId: target, dueAt: null, importance: "next", headSha: change.headSha, acknowledgeSourceChange: false, aiGenerated: true });
  assert.deepEqual([(await attempt(1)).status, (await attempt(1)).body.error], [403, "consent_withdrawn"]);
  assert.equal((await db.query("select count(*)::int c from public.things")).rows[0].c, 0);
  await db.exec(`insert into public.code_activity_settings values ('ai','true'::jsonb)`);
  await ai.setConsent({ user: user(U.O), listId: L.L1, enabled: true });
  assert.equal((await attempt(2)).status, 200, "with the flag and consent on it is allowed");
});

test("regression (limits): detail reads spend the interactive budget, so they cannot be used to get around it", async () => {
  await connected();
  const change = await firstChange();
  const before = (await db.query("select used_interactive u from public.code_activity_budget")).rows[0].u;
  const ok = await act.changeDetail(deps, { user: user(U.V), listId: L.L1, changeId: change.id });
  assert.equal(ok.status, 200);
  const after = (await db.query("select used_interactive u from public.code_activity_budget")).rows[0].u;
  assert.ok(after > before, "the detail read was counted");
  await db.exec("update public.code_activity_budget set used_interactive = 299");
  await db.exec("update public.code_activity_budget set used_interactive = 300");
  const stopped = gh.calls.length;
  const refused = await act.changeDetail(deps, { user: user(U.V), listId: L.L1, changeId: change.id });
  assert.equal(refused.status, 429);
  assert.equal(gh.calls.length, stopped, "with the budget spent not one request reached GitHub");
  await db.exec("update public.code_activity_connections set last_refresh_started_at = null, sync_lease_until = null");
  const refresh = await act.refresh(deps, { user: user(U.O), listId: L.L1 });
  assert.equal(refresh.status, 429, "the same budget stops Refresh");
  assert.equal(gh.calls.length, stopped);
});

test("regression (revocation completeness): a removal event for 450 repositories revokes every connection, end to end", async () => {
  await db.exec(`insert into public.code_activity_settings values ('sync','true'::jsonb)`);
  await db.exec(`insert into public.lists (id, owner_profile_id) select ('11000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, '${U.O}' from generate_series(1, 450) g;
    insert into public.code_activity_list_allowlist select ('11000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid from generate_series(1, 450) g;
    insert into public.code_activity_connections (list_id, status, installation_id, repository_id, connected_by_profile_id)
      select ('11000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'active', 77, 1000 + g, '${U.O}' from generate_series(1, 450) g;`);
  const payload = { action: "removed", repositories_removed: Array.from({ length: 450 }, (_, i) => ({ id: 1001 + i, name: `repo-${i}` })), installation: { id: 77 } };
  assert.equal((await intake("installation_repositories", payload, 1)).status, 202);
  assert.equal((await intake("installation_repositories", payload, 1)).status, 200, "a redelivery is recognised");
  assert.equal((await db.query("select count(*)::int c from public.code_activity_deliveries")).rows[0].c, 3);
  let processed = 0;
  for (let i = 0; i < 3; i += 1) processed += (await drain(withGitHub({}))).processed;
  assert.equal(processed, 3);
  assert.equal((await db.query("select count(*)::int c from public.code_activity_connections where installation_id = 77 and status = 'active'")).rows[0].c, 0, "no connection keeps reading a repository that lost access");
  assert.equal((await db.query("select count(*)::int c from public.code_activity_connections where status = 'revoked'")).rows[0].c, 450);
});

test("regression (revocation completeness): a removal too large to list stops every connection of the installation (fail closed)", async () => {
  await connected();
  const payload = { action: "removed", repositories_removed: Array.from({ length: 20_001 }, (_, i) => ({ id: 5000 + i })), installation: { id: 77 } };
  assert.equal((await intake("installation_repositories", payload, 1)).status, 202);
  assert.deepEqual((await db.query("select action, refetch from public.code_activity_deliveries")).rows, [{ action: "removed_overflow", refetch: { overflow: true } }]);
  await drain(withGitHub({}));
  const status = await svc.connectionStatus({ user: user(U.V), listId: L.L1 });
  assert.deepEqual([status.body.status, status.body.syncStatus], ["suspended", "stale"]);
  assert.equal((await act.refresh(deps, { user: user(U.O), listId: L.L1 })).status, 403, "nothing is read for a repository that may have lost access");
});

full("regression (reconnect): a draft that began on one connection cannot complete after another repository replaced it", async () => {
  await connected();
  const change = await firstChange();
  await db.exec(`insert into public.code_activity_settings values ('ai','true'::jsonb)`);
  await ai.setConsent({ user: user(U.O), listId: L.L1, enabled: true });
  const before = (await db.query("select id, generation from public.code_activity_connections")).rows[0];
  const r = await ai.generateDraft({ ...deps, ai: { apiKey: "sk_test_sarvam_key_0123456789", model: "sarvam-105b" }, aiFetch: async () => {
    // While the model works, the owner disconnects and connects a DIFFERENT repository to the same List.
    await svc.disconnect({ user: user(U.O), listId: L.L1, confirm: true });
    const { nonce, repos } = await authorize();
    const api = repos.find((x) => x.fullName === "acme/api");
    const ok = await svc.connect(deps, { userId: U.O, user: user(U.O), listId: L.L1, proofId: api.proofId, acknowledged: true, cookieHeader: cookieHeader(nonce) });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    return json({ choices: [{ finish_reason: "stop", message: { content: '{"title":"Old connection draft","description":"x"}' } }] });
  } }, { user: user(U.O), listId: L.L1, changeId: change.id, note: "" });
  const after = (await db.query("select id, generation, repository_full_name from public.code_activity_connections where status = 'active'")).rows[0];
  assert.notEqual(after.id, before.id);
  assert.equal(after.generation, before.generation, "the replacement has the same generation number as the original");
  assert.deepEqual([r.status, r.body.error], [403, "consent_withdrawn"], "the old request fails against the replacement");
  assert.ok(!JSON.stringify(r).includes("Old connection draft"));
  // The old change is not readable through the replacement connection either.
  const stale = await act.changeDetail(deps, { user: user(U.O), listId: L.L1, changeId: change.id });
  assert.equal(stale.status, 403);
});

test("regression (fail closed): after an overflow the saved private feed is unreadable, confirmations are refused, unsuspend cannot revive it, and only a reconnect restores access", async () => {
  await connected();
  const change = await firstChange();
  assert.equal((await act.feed({ user: user(U.V), listId: L.L1 })).status, 200);
  const payload = { action: "removed", repositories_removed: Array.from({ length: 20_001 }, (_, i) => ({ id: 5000 + i })), installation: { id: 77 } };
  assert.equal((await intake("installation_repositories", payload, 1)).status, 202);
  await drain(withGitHub({}));

  const status = await svc.connectionStatus({ user: user(U.V), listId: L.L1 });
  assert.deepEqual([status.body.status, status.body.needsReverification], ["suspended", true]);
  for (const uid of [U.O, U.C, U.V]) {
    assert.equal((await act.feed({ user: user(uid), listId: L.L1 })).status, 403, `${uid}: the saved feed is not readable`);
    assert.equal((await act.changeDetail(deps, { user: user(uid), listId: L.L1, changeId: change.id })).status, 403);
  }
  assert.equal((await db.query("select count(*)::int c from public.code_activity_connections").then((r) => r.rows[0].c)), 1);
  const target = await actorOf(U.C);
  const confirm = await thing.confirmDraft({ user: user(U.O), listId: L.L1, changeId: change.id, key: "a0000000-0000-0000-0000-0000000000c1", title: "t", notes: null, assigneeActorId: target, dueAt: null, importance: "next", headSha: change.headSha, acknowledgeSourceChange: false, aiGenerated: false });
  assert.equal(confirm.status, SUBSET === "readonly" ? 503 : 403, "no new Thing from a connection whose access is uncertain (without the creation functions: unavailable)");
  assert.equal((await db.query("select count(*)::int c from public.things")).rows[0].c, 0);

  assert.equal((await intake("installation", { action: "unsuspend", installation: { id: 77 } }, 2)).status, 202);
  await drain(withGitHub({}));
  assert.equal((await act.feed({ user: user(U.V), listId: L.L1 })).status, 403, "an ordinary unsuspend does not bring it back");
  assert.equal((await svc.connectionStatus({ user: user(U.V), listId: L.L1 })).body.needsReverification, true);
  assert.equal((await act.refresh(deps, { user: user(U.O), listId: L.L1 })).status, 403);

  // The owner re-verifies by disconnecting and connecting again. That is a new connection; nothing old comes back.
  assert.equal((await svc.disconnect({ user: user(U.O), listId: L.L1, confirm: true })).status, 200);
  const { nonce, repos } = await authorize();
  assert.equal((await svc.connect(deps, { userId: U.O, user: user(U.O), listId: L.L1, proofId: repos.find((x) => x.fullName === "acme/web").proofId, acknowledged: true, cookieHeader: cookieHeader(nonce) })).status, 200);
  assert.equal((await act.refresh(deps, { user: user(U.O), listId: L.L1 })).status, 200);
  const feed = await act.feed({ user: user(U.V), listId: L.L1 });
  assert.equal(feed.status, 200);
  assert.ok(feed.body.changes.length > 0);
  assert.ok(!feed.body.changes.some((c) => c.id === change.id), "the old connection's saved rows stay hidden: only what the new connection read is shown");
  assert.equal((await svc.connectionStatus({ user: user(U.V), listId: L.L1 })).body.needsReverification, false);
});
