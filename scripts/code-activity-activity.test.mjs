import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import { CALLBACK_PATH, ENV_NAMES, loadConfig } from "../src/features/code-activity/server/config.server.ts";
import { createGitHubClient } from "../src/features/code-activity/server/github.server.ts";
import * as read from "../src/features/code-activity/server/github-read.server.ts";
import * as act from "../src/features/code-activity/server/activity.server.ts";
import { parseActivityChange, parseActivityFeed } from "../src/features/code-activity/types.ts";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const LIST = "10000000-0000-0000-0000-000000000001";
const CONN = "30000000-0000-0000-0000-000000000001";
const LEASE = "40000000-0000-0000-0000-000000000001";
const CHANGE = "50000000-0000-0000-0000-000000000001";
const SHA = (c) => c.repeat(40);
const cfg = loadConfig({
  [ENV_NAMES.appId]: "1", [ENV_NAMES.appSlug]: "app", [ENV_NAMES.clientId]: "Iv1", [ENV_NAMES.clientSecret]: "s", [ENV_NAMES.privateKey]: PEM,
  [ENV_NAMES.stateSecret]: "x".repeat(40), [ENV_NAMES.callbackUrl]: `http://localhost:8080${CALLBACK_PATH}`, [ENV_NAMES.allowedOrigins]: "http://localhost:8080",
}, { production: false });

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const pull = (n, minutes, extra = {}) => ({ number: n, title: `PR ${n}`, state: "open", draft: false, merged_at: null, user: { login: "ana", type: "User" }, head: { ref: `b${n}`, sha: SHA("a") }, base: { ref: "main" }, html_url: `https://github.com/acme/web/pull/${n}`, updated_at: new Date(Date.UTC(2026, 9, 7, 12) - minutes * 60_000).toISOString(), ...extra });
const activity = (i, minutes) => ({ id: i, ref: "refs/heads/main", before: SHA("d"), after: SHA("c"), timestamp: new Date(Date.UTC(2026, 9, 7, 12) - minutes * 60_000).toISOString(), activity_type: "push", actor: { login: "bo", type: "User" } });
const run = (id, conclusion = "success") => ({ id, name: `job-${id}`, status: "completed", conclusion, started_at: "2026-10-07T10:00:00Z", completed_at: "2026-10-07T10:01:12Z", html_url: "https://github.com/acme/web/runs/1" });

const abortable = (signal, promise) =>
  new Promise((resolve, reject) => {
    const fail = () => reject(Object.assign(new Error("aborted"), { name: "TimeoutError" }));
    if (signal.aborted) return fail();
    signal.addEventListener("abort", fail, { once: true });
    Promise.resolve(promise).then(resolve, reject);
  });

/** Routes a GitHub request by path. `routes` maps a substring to a body or a function. */
function github(routes = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = String(url);
    calls.push({ url: u, method: init.method ?? "GET", body: init.body });
    if (u.includes("/access_tokens")) return json({ token: "ghs_installation_token", expires_at: "2026-10-07T13:00:00Z", repository_selection: "selected", permissions: { metadata: "read" }, repositories: [{ id: 501 }] });
    if (u.includes("/installation/repositories")) return json({ repositories: [{ id: 501, full_name: "acme/web" }] });
    for (const [needle, value] of Object.entries(routes)) {
      if (u.includes(needle)) {
        const v = typeof value === "function" ? await abortable(init.signal, value(u)) : value;
        return v instanceof Response ? v : json(v);
      }
    }
    return json({}, 404);
  };
  return { client: createGitHubClient({ config: cfg.config, fetchImpl }), calls };
}

function rpcs(handlers = {}) {
  const calls = [];
  const make = (label) => ({
    rpc: async (name, args) => {
      calls.push({ label, name, args });
      const h = handlers[name];
      return (typeof h === "function" ? await h(args) : h) ?? { data: null, error: null };
    },
  });
  return { user: make("user"), admin: make("admin"), calls };
}
const lease = { data: [{ o_connection_id: CONN, o_generation: 1, o_lease_token: LEASE }], error: null };
const provider = { data: [{ o_connection_id: CONN, o_installation_id: 77, o_repository_id: 501, o_generation: 1 }], error: null };

function refreshSetup({ ghRoutes, handlers } = {}) {
  const gh = github({
    "/pulls?": [pull(2, 5), pull(1, 60, { state: "closed", merged_at: "2026-10-07T10:00:00Z" })],
    "/activity?": [activity(1, 30)],
    "/check-runs": { check_runs: [run(1)] },
    "/status": { state: "success", total_count: 0, statuses: [] },
    ...ghRoutes,
  });
  const r = rpcs({ code_activity_begin_refresh: lease, code_activity_server_connection_for_provider: provider, code_activity_server_take_budget: { data: true, error: null }, code_activity_server_finish_refresh: { data: true, error: null }, ...handlers });
  return { gh, r, deps: { config: cfg, github: gh.client, admin: () => r.admin }, input: { user: r.user, listId: LIST } };
}
const finishCall = (r) => r.calls.find((c) => c.name === "code_activity_server_finish_refresh");

// ---- parsers -----------------------------------------------------------------------------------------

test("parsers: pull request state, push filtering, files, checks and bad shapes", () => {
  const prs = read.parsePullRequestList([pull(1, 1), pull(2, 1, { draft: true }), pull(3, 1, { state: "closed" }), pull(4, 1, { state: "closed", merged_at: "2026-10-07T00:00:00Z" })]);
  assert.deepEqual(prs.map((p) => p.state), ["open", "draft", "closed", "merged"]);
  assert.equal(prs[0].authorKind, "user");
  assert.equal(read.parsePullRequestList([pull(1, 1, { user: { login: "dependabot[bot]", type: "Bot" } })])[0].authorKind, "bot");
  assert.equal(read.parsePullRequestList([pull(1, 1, { user: null })])[0].authorKind, "unknown");
  for (const bad of [{}, [{ number: 1 }], [pull(0, 1)], [pull(1, 1, { head: { sha: "nope" } })], [pull(1, 1, { updated_at: "yesterday" })]]) {
    assert.throws(() => read.parsePullRequestList(bad), (e) => e.kind === "bad_response");
  }
  const { pushes } = read.parsePushActivities([activity(1, 1), { ...activity(2, 1), ref: "refs/tags/v1" }, { ...activity(3, 1), after: "0".repeat(40) }, { ...activity(4, 1), before: "0".repeat(40), ref: "refs/heads/feature/x" }]);
  assert.deepEqual(pushes.map((p) => p.key), [`main@${SHA("c")}`, `feature/x@${SHA("c")}`], "tags and branch deletions are not code changes");
  assert.throws(() => read.parsePushActivities({ not: "an array" }), (e) => e.kind === "bad_response");
  const files = read.parseFiles([{ filename: "a.ts", status: "copied", additions: 1, deletions: 0, patch: "@@" }, { filename: "b.png", status: "added", additions: 0, deletions: 0 }]);
  assert.deepEqual(files.map((f) => [f.status, f.patch]), [["modified", "@@"], ["added", null]]);
  const runs = read.parseCheckRuns({ check_runs: [run(1), { id: 2, name: "x", status: "in_progress", conclusion: "success" }, { id: 3, name: "y", status: "completed", conclusion: "weird" }] });
  assert.deepEqual(runs.map((r) => [r.status, r.conclusion]), [["completed", "success"], ["in_progress", null], ["completed", null]], "an unfinished run has no conclusion; an unknown one is not invented");
  assert.equal(runs[0].durationLabel, "1m 12s");
  assert.equal(read.parseCheckRuns({ check_runs: [{ ...run(1), html_url: "javascript:alert(1)" }] })[0].url, null, "only github.com links survive");
});

// ---- patches -----------------------------------------------------------------------------------------

test("patches: states are honest, text is untouched, and the total is bounded", () => {
  const state = { bytes: 0 };
  const file = (patch, extra = {}) => ({ path: "a.ts", status: "modified", additions: 3, deletions: 1, patch, ...extra });
  assert.equal(act.toChangeFile(file(null), state).patchState, "unavailable", "no patch is not claimed to be binary");
  assert.equal(act.toChangeFile(file(null, { status: "renamed", additions: 0, deletions: 0 }), state).patchState, "empty");
  const hostile = '@@ -1 +1 @@\n+<img src=x onerror="alert(1)">';
  const ok = act.toChangeFile(file(hostile), state);
  assert.deepEqual([ok.patchState, ok.patch], ["available", hostile], "provider text is kept verbatim and rendered as text by the client");
  const long = act.toChangeFile(file(Array.from({ length: 2500 }, (_, i) => `+line ${i}`).join("\n")), { bytes: 0 });
  assert.equal(long.patchState, "truncated");
  assert.equal(long.patch.split("\n").length, 2000);
  const capped = { bytes: act.ACTIVITY_LIMITS.patchTotalBytes - 10 };
  const over = act.toChangeFile(file("@@\n+a long enough line to cross the cap"), capped);
  assert.deepEqual([over.patchState, over.patch], ["omitted", null]);
  assert.equal(act.toChangeFiles(Array.from({ length: 400 }, (_, i) => file(null, { path: `f${i}` }))).length, 300, "files are capped at 300");
});

// ---- refresh -----------------------------------------------------------------------------------------

test("refresh: authorizes first, reads GitHub with a narrowed token, stores only feed fields, and spends the lease once", async () => {
  const s = refreshSetup();
  const result = await act.refresh(s.deps, s.input);
  assert.deepEqual([result.status, result.body.syncStatus, result.body.pullRequests, result.body.pushes], [200, "ok", 2, 1]);
  assert.deepEqual(s.r.calls.map((c) => `${c.label}:${c.name}`).filter((n, i, a) => a.indexOf(n) === i), [
    "user:code_activity_begin_refresh",
    "admin:code_activity_server_connection_for_provider",
    "admin:code_activity_server_take_budget",
    "admin:code_activity_server_finish_refresh",
  ]);
  assert.deepEqual(s.r.calls.find((c) => c.name === "code_activity_server_take_budget").args, { p_installation_id: 77, p_cost: 5, p_interactive: true });
  assert.equal(JSON.parse(s.gh.calls[0].body).repository_ids[0], 501);
  assert.match(s.gh.calls[0].url, /access_tokens/);
  assert.ok(s.gh.calls.every((c) => c.method === "GET" || c.url.includes("/access_tokens")), "GitHub is only ever read");
  const f = finishCall(s.r).args;
  assert.deepEqual([f.p_connection_id, f.p_generation, f.p_lease_token, f.p_status, f.p_full_name], [CONN, 1, LEASE, "ok", "acme/web"]);
  assert.equal(f.p_items.length, 3);
  assert.deepEqual(f.p_items.map((i) => i.provider_key), ["2", `main@${SHA("c")}`, "1"], "newest activity first");
  assert.equal(f.p_items.find((i) => i.provider_key === "1").pr_state, "merged");
  assert.ok(f.p_items.every((i) => i.check_state === "passed" && i.checks_revision === i.head_sha), "check state read for the recent rows");
  for (const item of f.p_items) for (const forbidden of ["body", "description", "patch", "files", "additions"]) assert.ok(!(forbidden in item), `${forbidden} is not stored`);
});

test("refresh: no GitHub request without database authorization; every refusal is neutral", async () => {
  for (const [code, status] of [["42501", 403], ["55006", 409], ["54000", 429], ["PGRST202", 503]]) {
    const s = refreshSetup({ handlers: { code_activity_begin_refresh: { data: null, error: { code, message: "private detail" } } } });
    const r = await act.refresh(s.deps, s.input);
    assert.equal(r.status, status, code);
    assert.equal(s.gh.calls.length, 0, `${code}: no provider request`);
    assert.ok(!s.r.calls.some((c) => c.label === "admin"), `${code}: the server credential is never used`);
    assert.ok(!JSON.stringify(r).includes("private detail"));
  }
  assert.equal((await act.refresh(refreshSetup().deps, { user: refreshSetup().r.user, listId: "bad" })).status, 400);
  assert.equal((await act.refresh({ ...refreshSetup().deps, config: loadConfig({}), github: null }, refreshSetup().input)).body.error, "not_configured");
});

test("refresh: a provider failure keeps the last good rows and releases the lease", async () => {
  const cases = [
    [{ "/pulls?": json({}, 503) }, 502],
    [{ "/pulls?": json({}, 429, { "retry-after": "9" }) }, 429],
    [{ "/pulls?": json({ message: "x" }, 200) }, 502], // wrong shape
  ];
  for (const [routes, status] of cases) {
    const s = refreshSetup({ ghRoutes: routes });
    const r = await act.refresh(s.deps, s.input);
    assert.equal(r.status, status);
    const f = finishCall(s.r).args;
    assert.deepEqual([f.p_status, f.p_items], ["unavailable", null], "failure never overwrites saved rows");
  }
  const none = refreshSetup({ handlers: { code_activity_server_connection_for_provider: { data: [], error: null } } });
  assert.equal((await act.refresh(none.deps, none.input)).status, 403);
  assert.equal(finishCall(none.r).args.p_status, "unavailable");
  assert.equal(none.gh.calls.length, 0);
  const lost = refreshSetup({ handlers: { code_activity_server_finish_refresh: { data: false, error: null } } });
  assert.equal((await act.refresh(lost.deps, lost.input)).status, 403, "a lost lease or a disconnect is reported, not hidden");
});

test("refresh: missing push history is partial, never invented, and pull requests still save", async () => {
  const s = refreshSetup({ ghRoutes: { "/activity?": json({}, 404) } });
  const r = await act.refresh(s.deps, s.input);
  assert.deepEqual([r.status, r.body.syncStatus, r.body.pushes], [200, "partial", 0]);
  const f = finishCall(s.r).args;
  assert.equal(f.p_status, "partial");
  assert.ok(f.p_items.every((i) => i.kind === "pull_request"));
});

test("refresh: the whole sequence has one deadline", async () => {
  const s = refreshSetup({ ghRoutes: { "/pulls?": () => new Promise((resolve) => setTimeout(() => resolve([]), 1500)) } });
  s.deps.refreshDeadlineMs = 50;
  const started = Date.now();
  const r = await act.refresh(s.deps, s.input);
  assert.equal(r.status, 504);
  assert.ok(Date.now() - started < 1200, "stopped at the budget, not when the slow provider finally answered");
  assert.equal(finishCall(s.r).args.p_status, "unavailable");
});

test("refresh: check reads are bounded to the most recent rows", async () => {
  const many = Array.from({ length: 40 }, (_, i) => pull(i + 1, i));
  const s = refreshSetup({ ghRoutes: { "/pulls?": many } });
  await act.refresh(s.deps, s.input);
  assert.equal(s.gh.calls.filter((c) => c.url.includes("/check-runs")).length, act.ACTIVITY_LIMITS.checkReads);
  const items = finishCall(s.r).args.p_items;
  assert.equal(items.filter((i) => i.check_state).length, act.ACTIVITY_LIMITS.checkReads);
  assert.ok(items.slice(act.ACTIVITY_LIMITS.checkReads).every((i) => i.check_state === undefined), "unread rows are not marked");
});

// ---- feed --------------------------------------------------------------------------------------------

const feedRow = (n, extra = {}) => ({ id: `60000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`, kind: "pull_request", pr_number: n, pr_state: "open", title: `PR ${n}`, head_sha: SHA("a"), head_ref: "b", base_ref: "main", author_login: "ana", author_kind: "user", source_url: "https://github.com/acme/web/pull/1", check_state: "passed", checks_revision: SHA("a"), last_activity_at: "2026-10-07T11:00:00.000Z", ...extra });
const statusRow = { status: "active", repository_full_name: "acme/web", last_synced_at: "2026-10-07T11:30:00Z", sync_status: "ok" };

test("feed: rows become honest feed data that passes the UI's own validator", async () => {
  const r = rpcs({ code_activity_feed: { data: [feedRow(1), feedRow(2, { kind: "push", pr_number: null, pr_state: null, check_state: "unavailable", checks_revision: null, source_url: "https://github.com/acme/web/commit/x", title: "Push to main" })], error: null }, code_activity_connection_status: { data: [statusRow], error: null } });
  const result = await act.feed({ user: r.user, listId: LIST });
  assert.equal(result.status, 200);
  assert.ok(parseActivityFeed(result.body).ok, JSON.stringify(parseActivityFeed(result.body)));
  const [pr, push] = result.body.changes;
  assert.deepEqual([pr.additions, pr.changedFiles, pr.description, pr.files.length], [null, null, null, 0], "unknown is null, not zero");
  assert.deepEqual([push.prState, push.number, push.checkState, push.commitUrl !== null, push.sourceUrl], [null, null, "unavailable", true, null]);
  assert.deepEqual(result.body.freshness, { lastSyncedAt: "2026-10-07T11:30:00Z", syncStatus: "ok" });
  assert.equal(result.body.repositoryFullName, "acme/web");
  assert.equal(result.body.nextCursor, null);
});

test("feed: a check result for another revision is marked stale, and paging returns a cursor", async () => {
  const rows = Array.from({ length: 25 }, (_, i) => feedRow(i + 1, i === 0 ? { checks_revision: SHA("b") } : {}));
  const r = rpcs({ code_activity_feed: { data: rows, error: null }, code_activity_connection_status: { data: [statusRow], error: null } });
  const result = await act.feed({ user: r.user, listId: LIST });
  assert.equal(result.body.changes[0].checksStale, true);
  assert.equal(result.body.changes[1].checksStale, false);
  assert.match(result.body.nextCursor, /^2026-10-07T11:00:00.000Z\|[0-9a-f-]{36}$/);
  const next = await act.feed({ user: r.user, listId: LIST, cursor: result.body.nextCursor });
  assert.equal(next.status, 200);
  const args = r.calls.at(-2).args;
  assert.equal(args.p_before_at, "2026-10-07T11:00:00.000Z");
  assert.equal(args.p_limit, 25);
  for (const bad of ["x", "2026-10-07T11:00:00Z|nope", "2026-10-07T11:00:00Z|"]) assert.equal((await act.feed({ user: r.user, listId: LIST, cursor: bad })).status, 400, bad);
});

test("feed: terminal or hidden connections and database refusals give neutral errors", async () => {
  for (const data of [[], [{ ...statusRow, status: "revoked" }], [{ ...statusRow, status: "disconnected" }]]) {
    const r = rpcs({ code_activity_feed: { data: [], error: null }, code_activity_connection_status: { data, error: null } });
    assert.equal((await act.feed({ user: r.user, listId: LIST })).status, 403);
  }
  const err = rpcs({ code_activity_feed: { data: null, error: { code: "PGRST202", message: "x" } } });
  assert.equal((await act.feed({ user: err.user, listId: LIST })).status, 503);
  assert.equal((await act.feed({ user: err.user, listId: "bad" })).status, 400);
});

// ---- detail ------------------------------------------------------------------------------------------

const stored = (extra = {}) => ({ connection_id: CONN, generation: 1, id: CHANGE, kind: "pull_request", pr_number: 7, pr_state: "open", title: "stored title", head_sha: SHA("a"), before_sha: null, head_ref: "feat", base_ref: "main", author_login: "ana", author_kind: "user", source_url: "https://github.com/acme/web/pull/7", last_activity_at: "2026-10-07T11:00:00.000Z", ...extra });
function detailSetup({ row = stored(), ghRoutes, handlers } = {}) {
  const gh = github({
    "/pulls/7/files": [{ filename: "src/a.ts", status: "modified", additions: 2, deletions: 1, patch: "@@ -1 +1,2 @@\n-a\n+b\n+c" }, { filename: "logo.png", status: "added", additions: 0, deletions: 0 }],
    "/pulls/7": { title: "Real title", body: "Body from GitHub", state: "open", merged: false, draft: false, head: { sha: SHA("e") }, additions: 2, deletions: 1, changed_files: 2, html_url: "https://github.com/acme/web/pull/7" },
    "/check-runs": { check_runs: [run(1), run(2, "failure")] },
    "/status": { state: "success", total_count: 0, statuses: [] },
    ...ghRoutes,
  });
  const r = rpcs({ code_activity_change_for_read: { data: [row], error: null }, code_activity_server_connection_for_provider: provider, code_activity_server_take_budget: { data: true, error: null }, ...handlers });
  return { gh, r, deps: { config: cfg, github: gh.client, admin: () => r.admin }, input: { user: r.user, listId: LIST, changeId: CHANGE } };
}

test("detail: a pull request returns description, files, patches and checks bound to the provider's current head", async () => {
  const s = detailSetup();
  const r = await act.changeDetail(s.deps, s.input);
  assert.equal(r.status, 200);
  const change = r.body.change;
  assert.ok(parseActivityChange(change).ok);
  assert.deepEqual([change.title, change.description, change.headSha, change.changedFiles, change.additions, change.deletions], ["Real title", "Body from GitHub", SHA("e"), 2, 2, 1]);
  assert.equal(change.checkState, "failing");
  assert.equal(change.checksRevision, SHA("e"));
  assert.equal(change.checksStale, false);
  assert.deepEqual(change.files.map((f) => f.patchState), ["available", "unavailable"]);
  assert.match(s.gh.calls.find((c) => c.url.includes("/check-runs")).url, new RegExp(`/commits/${SHA("e")}/check-runs`));
  assert.ok(s.gh.calls.every((c) => c.method === "GET" || c.url.includes("/access_tokens")));
});

test("detail: authorization comes first, and an unreadable change makes no provider request", async () => {
  for (const handlers of [{ code_activity_change_for_read: { data: [], error: null } }, { code_activity_change_for_read: { data: null, error: { code: "42501", message: "x" } } }]) {
    const s = detailSetup({ handlers });
    assert.equal((await act.changeDetail(s.deps, s.input)).status, 403);
    assert.equal(s.gh.calls.length, 0);
    assert.ok(!s.r.calls.some((c) => c.label === "admin"));
  }
  const noConn = detailSetup({ handlers: { code_activity_server_connection_for_provider: { data: [], error: null } } });
  assert.equal((await act.changeDetail(noConn.deps, noConn.input)).status, 502);
  assert.equal(noConn.gh.calls.length, 0);
  assert.equal(detailSetup().r.calls.length, 0);
  assert.equal((await act.changeDetail(detailSetup().deps, { ...detailSetup().input, changeId: "nope" })).status, 400);
  const gen = detailSetup();
  await act.changeDetail(gen.deps, gen.input);
  assert.equal(gen.r.calls.find((c) => c.name === "code_activity_server_connection_for_provider").args.p_expected_generation, 1, "the read is fenced to the generation just authorized");
});

test("detail: a failed check read is 'unavailable', never 'none'; other failures are neutral", async () => {
  const s = detailSetup({ ghRoutes: { "/check-runs": json({}, 403) } });
  const r = await act.changeDetail(s.deps, s.input);
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.change.checkState, r.body.change.checksRevision, r.body.change.checks.length], ["unavailable", null, 0]);
  assert.equal(r.body.change.files.length, 2, "files still shown");
  const none = detailSetup({ ghRoutes: { "/check-runs": { check_runs: [] } } });
  assert.equal((await act.changeDetail(none.deps, none.input)).body.change.checkState, "none");
  for (const [routes, status] of [[{ "/pulls/7/files": json({}, 503) }, 502], [{ "/pulls/7/files": json({}, 429, { "retry-after": "3" }) }, 429]]) {
    const f = detailSetup({ ghRoutes: routes });
    assert.equal((await act.changeDetail(f.deps, f.input)).status, status);
  }
  const slow = detailSetup({ ghRoutes: { "/pulls/7/files": () => new Promise((resolve) => setTimeout(() => resolve([]), 200)) } });
  slow.deps.detailDeadlineMs = 50;
  assert.equal((await act.changeDetail(slow.deps, slow.input)).status, 504);
});

test("detail: a push uses the commit for a new branch and a comparison otherwise, and marks truncation", async () => {
  const row = stored({ kind: "push", pr_number: null, pr_state: null, head_sha: SHA("c"), before_sha: SHA("d"), title: "Push to main", source_url: null });
  const push = detailSetup({ row, ghRoutes: { "/compare/": { html_url: "https://github.com/acme/web/compare/x", commits: [{ commit: { message: "Fix nav\n\nlong body" }, author: { login: "bo", type: "User" } }], files: [{ filename: "a.ts", status: "modified", additions: 1, deletions: 0, patch: "@@\n+x" }] } } });
  const r = await act.changeDetail(push.deps, push.input);
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.change.kind, r.body.change.prState, r.body.change.number, r.body.change.title, r.body.change.changedFiles, r.body.change.additions], ["push", null, null, "Fix nav", 1, 1]);
  assert.equal(r.body.change.description, "Fix nav\n\nlong body");
  assert.match(push.gh.calls.find((c) => c.url.includes("/compare/")).url, new RegExp(`${SHA("d")}\\.\\.\\.${SHA("c")}`));
  const fresh = detailSetup({ row: { ...row, before_sha: "0".repeat(40) }, ghRoutes: { [`/commits/${SHA("c")}`]: { html_url: "https://github.com/acme/web/commit/c", commit: { message: "Initial" }, author: { login: "bo", type: "User" }, files: [] }, "/check-runs": { check_runs: [] } } });
  const created = await act.changeDetail(fresh.deps, fresh.input);
  assert.equal(created.status, 200);
  assert.ok(fresh.gh.calls.some((c) => c.url.endsWith(`/commits/${SHA("c")}`)));
  assert.equal(created.body.change.checkState, "none");
});

// ======================================================================================================
// Provider-shaped regressions from the code review
// ======================================================================================================

test("regression 1: push entries are read in the documented shape AND the older example shape; one bad entry is counted, not fatal", () => {
  const documented = { id: 1, node_id: "x", before: SHA("d"), after: SHA("c"), ref: "refs/heads/main", timestamp: "2026-10-07T11:00:00Z", activity_type: "push", actor: { login: "ana", type: "User" } };
  const example = { id: 2, before: SHA("d"), after: SHA("b"), ref: "refs/heads/dev", pushed_at: "2026-10-07T10:00:00Z", pusher: { name: "bo" } };
  const { pushes, skipped } = read.parsePushActivities([documented, example]);
  assert.deepEqual(pushes.map((p) => [p.branch, p.authorLogin, p.timestamp]), [["main", "ana", "2026-10-07T11:00:00Z"], ["dev", "bo", "2026-10-07T10:00:00Z"]]);
  assert.equal(skipped, 0);
  const mixed = read.parsePushActivities([documented, { id: 3, ref: "refs/heads/x", after: SHA("c") }, "junk", { ...documented, timestamp: "last week" }, example]);
  assert.deepEqual([mixed.pushes.length, mixed.skipped], [2, 3], "bad entries are counted; the good ones survive");
  const types = ["push", "force_push", "branch_creation", "branch_deletion", "pr_merge", "merge_queue_merge"].map((activity_type) => ({ ...documented, activity_type, after: activity_type === "branch_deletion" ? "0".repeat(40) : SHA("c") }));
  assert.equal(read.parsePushActivities(types).pushes.length, 3, "force pushes and new branches are code changes; deletions and merges are not");
  assert.equal(read.parsePushActivities([{ ...documented, actor: null }]).pushes[0].authorKind, "unknown");
});

test("regression 1: refresh requests push activity unfiltered, saves what it understands, and reports a partial sync", async () => {
  const documented = { before: SHA("d"), after: SHA("c"), ref: "refs/heads/main", timestamp: "2026-10-07T11:00:00Z", activity_type: "push", actor: { login: "ana", type: "User" } };
  const s = refreshSetup({ ghRoutes: { "/activity?": [documented, { ref: "refs/heads/broken" }, { ...documented, activity_type: "force_push", after: SHA("b") }] } });
  const r = await act.refresh(s.deps, s.input);
  assert.deepEqual([r.status, r.body.syncStatus, r.body.pushes], [200, "partial", 2]);
  assert.doesNotMatch(s.gh.calls.find((c) => c.url.includes("/activity?")).url, /activity_type=/, "no filter that would hide force pushes");
  assert.equal(finishCall(s.r).args.p_items.filter((i) => i.kind === "push").length, 2);
});

test("regression 2: commit statuses are read and mapped, so status-only CI failures are not missed", async () => {
  const combined = { state: "failure", total_count: 4, statuses: [
    { id: 1, context: "ci/legacy", state: "failure", target_url: "https://ci.example.com/run/1", created_at: "x", updated_at: "y" },
    { id: 2, context: "ci/lint", state: "error", target_url: "javascript:alert(1)" },
    { id: 3, context: "ci/deploy", state: "pending" },
    { id: 4, context: "ci/unit", state: "success" },
  ] };
  const { runs, total } = read.parseCombinedStatus(combined);
  assert.equal(total, 4);
  assert.deepEqual(runs.map((r) => [r.name, r.status, r.conclusion]), [["ci/legacy", "completed", "failure"], ["ci/lint", "completed", "failure"], ["ci/deploy", "in_progress", null], ["ci/unit", "completed", "success"]]);
  assert.deepEqual([runs[0].url, runs[1].url], ["https://ci.example.com/run/1", null], "https links only");
  assert.deepEqual(read.parseCombinedStatus({ state: "pending", total_count: 0, statuses: [] }).runs, [], "GitHub reports 'pending' for NO statuses; that is no check, not a running one");
  assert.throws(() => read.parseCombinedStatus({ statuses: [{ id: 1, context: "x", state: "weird" }] }), (e) => e.kind === "bad_response");

  const reader = (routes) => read.createGitHubReader(async (url) => {
    for (const [needle, value] of Object.entries(routes)) if (url.includes(needle)) { if (value instanceof Error) throw value; return value; }
    throw new Error("unrouted " + url);
  });
  const stateOf = async (routes) => act.checkStateFor(await reader(routes).listChecks("t", "acme/web", SHA("a")));
  const ok = { "/check-runs": { check_runs: [run(1)] }, "/status": { statuses: [], total_count: 0 } };
  assert.equal(await stateOf(ok), "passed");
  assert.equal(await stateOf({ ...ok, "/check-runs": { check_runs: [] } }), "none");
  assert.equal(await stateOf({ ...ok, "/status": combined }), "failing", "a failing status beats passing check runs");
  assert.equal(await stateOf({ "/check-runs": { check_runs: [] }, "/status": { total_count: 1, statuses: [{ id: 1, context: "ci", state: "failure" }] } }), "failing", "status-only CI");
  const { GitHubError } = await import("../src/features/code-activity/server/github.server.ts");
  const down = new GitHubError("unavailable", 503);
  assert.equal(await stateOf({ ...ok, "/status": down }), "unavailable", "a status source that failed must not read as passed");
  assert.equal(await stateOf({ ...ok, "/check-runs": down }), "unavailable", "nor a check-run source that failed");
  assert.equal(await stateOf({ "/check-runs": down, "/status": combined }), "failing", "a known failure is still reported when the other source fails");
  assert.equal(await stateOf({ ...ok, "/status": { total_count: 250, statuses: Array.from({ length: 100 }, (_, i) => ({ id: i, context: `c${i}`, state: "success" })) } }), "unavailable", "more statuses than read: not claimed as passed");
  await assert.rejects(reader({ "/check-runs": new GitHubError("rate_limited", 429), "/status": combined }).listChecks("t", "acme/web", SHA("a")), (e) => e.kind === "rate_limited", "a rate limit ends the read");
});

test("regression 2: refresh and detail use the statuses", async () => {
  const failingStatus = { "/check-runs": { check_runs: [run(1)] }, "/status": { total_count: 1, statuses: [{ id: 9, context: "ci/legacy", state: "failure", target_url: "https://ci.example.com/9" }] } };
  const s = refreshSetup({ ghRoutes: failingStatus });
  await act.refresh(s.deps, s.input);
  assert.ok(finishCall(s.r).args.p_items.every((i) => i.check_state === "failing"));
  const d = detailSetup({ ghRoutes: failingStatus });
  const r = await act.changeDetail(d.deps, d.input);
  assert.equal(r.body.change.checkState, "failing");
  assert.deepEqual(r.body.change.checks.map((c) => c.name), ["job-1", "ci/legacy"]);
  assert.equal(r.body.change.checksPartial, false);
  const broken = detailSetup({ ghRoutes: { "/check-runs": { check_runs: [run(1)] }, "/status": json({}, 500) } });
  const b = await act.changeDetail(broken.deps, broken.input);
  assert.deepEqual([b.body.change.checkState, b.body.change.checksRevision], ["unavailable", null], "check runs alone do not prove the statuses passed");
  const refreshBroken = refreshSetup({ ghRoutes: { "/status": json({}, 500) } });
  const rb = await act.refresh(refreshBroken.deps, refreshBroken.input);
  assert.equal(rb.body.syncStatus, "partial");
});

/** A PR whose head commit moves while it is read: `heads` is consumed one metadata read at a time. */
function movingPull(heads, filesBody = [{ filename: "a.ts", status: "modified", additions: 1, deletions: 0, patch: "@@\n+x" }]) {
  let reads = 0;
  const seen = [];
  const routes = {
    "/pulls/7/files": filesBody,
    "/pulls/7": () => {
      const sha = heads[Math.min(reads, heads.length - 1)];
      reads += 1;
      seen.push(sha);
      return { title: "T", body: "b", state: "open", head: { sha }, additions: 1, deletions: 0, changed_files: 1, html_url: "https://github.com/acme/web/pull/7" };
    },
  };
  return { routes, seen, reads: () => reads };
}

test("regression 3: a push between the metadata and the files is detected and the read is retried", async () => {
  const moving = movingPull([SHA("a"), SHA("b"), SHA("b"), SHA("b")]);
  const s = detailSetup({ ghRoutes: moving.routes });
  const r = await act.changeDetail(s.deps, s.input);
  assert.equal(r.status, 200);
  assert.equal(moving.reads(), 4, "two reads per attempt; the first attempt saw a different head");
  assert.equal(r.body.change.headSha, SHA("b"));
  assert.equal(r.body.change.files.length, 1);
  assert.equal(r.body.change.filesUnavailableReason ?? null, null);
  assert.match(s.gh.calls.find((c) => c.url.includes("/check-runs")).url, new RegExp(`/commits/${SHA("b")}/`), "checks are bound to the revision the files belong to");
});

test("regression 3: a stable head costs exactly one metadata read before and one after the files", async () => {
  const stable = movingPull([SHA("a")]);
  const s = detailSetup({ ghRoutes: stable.routes });
  await act.changeDetail(s.deps, s.input);
  assert.equal(stable.reads(), 2);
});

test("regression 3: if the head never settles, files are withheld with a stated reason instead of mismatched patches", async () => {
  const unstable = movingPull([SHA("a"), SHA("b"), SHA("c"), SHA("d"), SHA("e"), SHA("f")]);
  const s = detailSetup({ ghRoutes: unstable.routes });
  const r = await act.changeDetail(s.deps, s.input);
  assert.equal(r.status, 200);
  const change = r.body.change;
  assert.deepEqual([change.files.length, change.filesPartial, change.filesUnavailableReason], [0, true, "revision_changed"]);
  assert.equal(unstable.reads(), 6, "bounded at three attempts");
  assert.equal(change.headSha, SHA("f"), "metadata and checks use the latest head, and no patch from another revision is attached");
  assert.ok(JSON.stringify(change).indexOf("@@") === -1, "no patch text is returned");
  assert.ok(act.ACTIVITY_LIMITS.detailDeadlineMs > 0);
});

test("regression 4: a comparison is ONE request; its files are the first page only, up to 300, and 300 means truncated", async () => {
  const mk = (n) => Array.from({ length: n }, (_, i) => ({ filename: `f${i}.ts`, status: "modified", additions: 1, deletions: 0, patch: "@@\n+x" }));
  const compare = (n) => ({ html_url: "https://github.com/acme/web/compare/x", status: "ahead", total_commits: 3, commits: [{ commit: { message: "m" }, author: { login: "bo", type: "User" } }], files: mk(n) });
  const row = stored({ kind: "push", pr_number: null, pr_state: null, head_sha: SHA("c"), before_sha: SHA("d"), title: "Push to main", source_url: null });

  for (const [n, truncated] of [[120, false], [299, false], [300, true]]) {
    const s = detailSetup({ row, ghRoutes: { "/compare/": compare(n) } });
    const r = await act.changeDetail(s.deps, s.input);
    const compareCalls = s.gh.calls.filter((c) => c.url.includes("/compare/"));
    assert.equal(compareCalls.length, 1, `${n} files: a second page does not exist for comparisons`);
    assert.doesNotMatch(compareCalls[0].url, /page=|per_page=/, "no pagination parameters are sent");
    assert.equal(r.body.change.filesPartial, truncated, `${n} files`);
    assert.equal(r.body.change.files.length, n);
    assert.equal(r.body.change.changedFiles, truncated ? null : n, "an unknown total is null, not 300");
    assert.equal(r.body.change.additions, truncated ? null : n);
  }
  const over = detailSetup({ row, ghRoutes: { "/compare/": compare(450) } });
  const o = await act.changeDetail(over.deps, over.input);
  assert.equal(o.body.change.files.length, 300, "never more than 300 files are returned");
  assert.equal(o.body.change.filesPartial, true);

  const fresh = detailSetup({ row: { ...row, before_sha: "0".repeat(40) }, ghRoutes: { [`/commits/${SHA("c")}`]: { html_url: "https://github.com/acme/web/commit/c", commit: { message: "Initial" }, author: { login: "bo", type: "User" }, files: mk(300) } } });
  const f = await act.changeDetail(fresh.deps, fresh.input);
  assert.equal(fresh.gh.calls.filter((c) => c.url.endsWith(`/commits/${SHA("c")}`) || c.url.includes(`/commits/${SHA("c")}?`)).length, 1, "a single commit is also read once");
  assert.equal(f.body.change.filesPartial, true, "300 on the first page means there may be more");
});

test("regression 3 and 4: the inspector says why files are absent instead of implying there are none", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createElement } = await import("react");
  const { ChangeInspector } = await import("../src/features/code-activity/ChangeInspector.tsx");
  const { liveAdapter } = await import("../src/features/code-activity/live/adapter.ts");
  const base = { id: "c", kind: "pull_request", title: "T", number: 7, prState: "open", author: { name: "a", kind: "user" }, headBranch: "f", baseBranch: "main", headSha: SHA("a"), updatedAt: "2026-10-07T11:00:00Z", additions: null, deletions: null, changedFiles: null, sourceUrl: "https://github.com/acme/web/pull/7", commitUrl: null, description: null, checkState: "none", checksRevision: null, checksStale: false, checks: [], checksPartial: false, files: [], filesPartial: true, gap: null };
  const html = (change) => renderToStaticMarkup(createElement(ChangeInspector, { change, role: "owner", consent: false, aiEnabled: false, listName: "W", adapter: liveAdapter, candidates: [], now: 0, onBack() {}, onOpenConsentSettings() {} }));
  assert.match(html({ ...base, filesUnavailableReason: "revision_changed" }), /changed while it was being read/);
  assert.match(html(base), /No files to show/);
});

test("refresh: no budget means no provider request, and a rate limit blocks the installation", async () => {
  const none = refreshSetup({ handlers: { code_activity_server_take_budget: { data: false, error: null } } });
  const r = await act.refresh(none.deps, none.input);
  assert.equal(r.status, 429);
  assert.equal(none.gh.calls.length, 0);
  assert.equal(finishCall(none.r).args.p_status, "unavailable", "the lease is released and the last good rows stay");
  const limited = refreshSetup({ ghRoutes: { "/pulls?": json({}, 429, { "retry-after": "90" }) } });
  assert.equal((await act.refresh(limited.deps, limited.input)).status, 429);
  assert.deepEqual(limited.r.calls.find((c) => c.name === "code_activity_server_block_installation").args, { p_installation_id: 77, p_seconds: 90 });
});

test("regression (reconnect): provider lookups are bound to the connection id AND generation they were authorized against", async () => {
  const refreshing = refreshSetup();
  await act.refresh(refreshing.deps, refreshing.input);
  const a = refreshing.r.calls.filter((c) => c.name === "code_activity_server_connection_for_provider").map((c) => c.args);
  assert.ok(a.length >= 1 && a.every((x) => x.p_expected_connection_id === CONN && x.p_expected_generation === 1), JSON.stringify(a));
  const detailing = detailSetup();
  await act.changeDetail(detailing.deps, detailing.input);
  const b = detailing.r.calls.find((c) => c.name === "code_activity_server_connection_for_provider").args;
  assert.deepEqual([b.p_expected_connection_id, b.p_expected_generation], [CONN, 1]);
  // If the replacement connection answers nothing for the old id, the read stops before GitHub.
  const gone = detailSetup({ handlers: { code_activity_server_connection_for_provider: { data: [], error: null } } });
  assert.equal((await act.changeDetail(gone.deps, gone.input)).status, 502);
  assert.equal(gone.gh.calls.length, 0);
});

test("regression (fail closed): a connection that needs re-verification is neither listed nor readable", async () => {
  const r = rpcs({ code_activity_feed: { data: [feedRow(1)], error: null }, code_activity_connection_status: { data: [{ ...statusRow, status: "suspended", needs_reverification: true }], error: null } });
  assert.equal((await act.feed({ user: r.user, listId: LIST })).status, 403, "even if the database returned rows");
  const status = await (await import("../src/features/code-activity/server/service.server.ts")).connectionStatus({ user: r.user, listId: LIST });
  assert.deepEqual([status.body.status, status.body.needsReverification], ["suspended", true], "the owner and members are told why");
});
