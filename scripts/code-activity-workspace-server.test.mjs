import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import { CALLBACK_PATH, ENV_NAMES, loadConfig } from "../src/features/code-activity/server/config.server.ts";
import { createGitHubClient } from "../src/features/code-activity/server/github.server.ts";
import * as ws from "../src/features/code-activity/server/workspace.server.ts";
import * as thing from "../src/features/code-activity/server/thing.server.ts";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const LIST = "10000000-0000-0000-0000-000000000001";
const CONN = "30000000-0000-0000-0000-000000000001";
const SHA = (c) => c.repeat(40);
const cfg = loadConfig({
  [ENV_NAMES.appId]: "1", [ENV_NAMES.appSlug]: "app", [ENV_NAMES.clientId]: "Iv1", [ENV_NAMES.clientSecret]: "s", [ENV_NAMES.privateKey]: PEM,
  [ENV_NAMES.stateSecret]: "x".repeat(40), [ENV_NAMES.callbackUrl]: `http://localhost:8080${CALLBACK_PATH}`, [ENV_NAMES.allowedOrigins]: "http://localhost:8080",
}, { production: false });

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
function github({ routes = {}, mint } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = String(url);
    calls.push({ url: u, method: init.method ?? "GET", body: init.body });
    if (u.includes("/access_tokens")) {
      if (mint) return mint(init);
      const asked = JSON.parse(init.body ?? "{}").permissions ?? {};
      return json({ token: "ghs_installation_token", expires_at: "2026-10-07T13:00:00Z", repository_selection: "selected", permissions: asked, repositories: [{ id: 501 }] });
    }
    if (u.includes("/installation/repositories")) return json({ repositories: [{ id: 501, full_name: "acme/web" }] });
    for (const [needle, value] of Object.entries(routes)) if (needle.startsWith("$") ? u.split("?")[0].endsWith(needle.slice(1)) : u.includes(needle)) return value instanceof Response ? value : json(typeof value === "function" ? value(u) : value);
    return json({}, 404);
  };
  return { client: createGitHubClient({ config: cfg.config, fetchImpl }), calls };
}
function rpcs(handlers = {}) {
  const calls = [];
  const make = (label) => ({ rpc: async (name, args) => { calls.push({ label, name, args }); const h = handlers[name]; return (typeof h === "function" ? await h(args) : h) ?? { data: null, error: null }; } });
  return { user: make("user"), admin: make("admin"), calls };
}
const active = { data: [{ status: "active", needs_reverification: false }], error: null };
const provider = { data: [{ o_connection_id: CONN, o_installation_id: 77, o_repository_id: 501, o_generation: 1 }], error: null };
function setup({ routes, mint, handlers } = {}) {
  const gh = github({ routes, mint });
  const r = rpcs({ code_activity_connection_status: active, code_activity_server_connection_for_provider: provider, code_activity_server_take_budget: { data: true, error: null }, ...handlers });
  return { gh, r, deps: { config: cfg, github: gh.client, admin: () => r.admin }, input: { user: r.user, listId: LIST } };
}
const providerCalls = (s) => s.gh.calls.filter((c) => !c.url.includes("/access_tokens") && !c.url.includes("/installation/repositories"));

const commitItem = (n) => ({ sha: SHA(String(n % 10)), commit: { message: `subject ${n}\n\nbody`, author: { name: "Ana", email: "ana@example.com", date: "2026-10-07T10:00:00Z" }, committer: { date: "2026-10-07T10:00:00Z" } }, author: { login: "ana", avatar_url: "https://avatars.githubusercontent.com/u/1" }, html_url: `https://github.com/acme/web/commit/${SHA("1")}` });

test("workspace: authorization comes first and nothing reaches GitHub when it fails", async () => {
  for (const handlers of [
    { code_activity_connection_status: { data: [], error: null } },
    { code_activity_connection_status: { data: [{ status: "active", needs_reverification: true }], error: null } },
    { code_activity_connection_status: { data: null, error: { code: "42501", message: "x" } } },
  ]) {
    const s = setup({ handlers });
    const r = await ws.branches(s.deps, s.input);
    assert.notEqual(r.status, 200);
    assert.equal(s.gh.calls.length, 0, "no provider request");
    assert.equal(s.r.calls.some((c) => c.name === "code_activity_server_connection_for_provider"), false, "the server-only function is not reached");
  }
  const suspended = setup({ handlers: { code_activity_connection_status: { data: [{ status: "suspended", needs_reverification: false }], error: null } } });
  assert.equal((await ws.branches(suspended.deps, suspended.input)).status, 502);
  assert.equal(suspended.gh.calls.length, 0);
  const bad = setup();
  assert.equal((await ws.branches(bad.deps, { ...bad.input, listId: "nope" })).status, 400);
});

test("workspace: a connection replaced during the read discards the result", async () => {
  const s = setup({ routes: { "$/branches": [{ name: "main", commit: { sha: SHA("a") }, protected: false }], "$/repos/acme/web": { default_branch: "main" } }, handlers: { code_activity_server_connection_for_provider: (a) => (a.p_expected_connection_id ? { data: [], error: null } : provider) } });
  const r = await ws.branches(s.deps, s.input);
  assert.equal(r.status, 403);
  assert.equal(r.body.branches, undefined, "no data from the old connection is returned");
});

test("workspace cursors: scoped, versioned and tamper-resistant", () => {
  const scope = { k: "commits", branch: "main" };
  const c = ws.encodeCursor(2, scope);
  assert.deepEqual(ws.decodeCursor(c, scope), { page: 2 });
  assert.equal(ws.decodeCursor(c, { k: "commits", branch: "dev" }), "invalid", "another branch cannot replay it");
  for (const bad of ["x", "v2.abc", "v1.!!!", `v1.${Buffer.from("{}").toString("base64url")}`, `v1.${Buffer.from(JSON.stringify({ p: 99, s: "x" })).toString("base64url")}`]) assert.equal(ws.decodeCursor(bad, scope), "invalid");
  assert.deepEqual(ws.decodeCursor(null, scope), { page: 1 });
});

test("branches: lists branches and reports truncation honestly", async () => {
  const s = setup({ routes: { "$/repos/acme/web": { default_branch: "main" }, "$/branches": [{ name: "main", commit: { sha: SHA("a") }, protected: true }, { name: "feature/ü-x", commit: { sha: SHA("b") }, protected: false }] } });
  const r = await ws.branches(s.deps, s.input);
  assert.equal(r.status, 200);
  assert.equal(r.body.defaultBranch, "main");
  assert.deepEqual(r.body.branches.map((b) => b.name), ["main", "feature/ü-x"]);
  assert.ok(s.gh.calls.every((c) => c.method === "GET" || c.url.includes("/access_tokens")));
  assert.equal((await ws.branches(s.deps, { ...s.input, cursor: "garbage" })).status, 400);
});

test("compare: unsafe refs are rejected, identical refs are reported, unknown refs are 404", async () => {
  const s = setup({ routes: { "$/branches/main": { name: "main", commit: { sha: SHA("a") } } } });
  for (const head of ["", "a..b", "-x", "a b", "a~1", "x".repeat(300), 5, null, "a\u0000b", "@{u}"]) {
    assert.equal((await ws.compare(s.deps, { ...s.input, head, base: "main" })).status, 400, `rejects ${String(head).slice(0, 12)}`);
  }
  assert.equal(s.gh.calls.length, 0, "validation happens before any provider request");
  const same = await ws.compare(s.deps, { ...s.input, head: "main", base: "main" });
  assert.deepEqual([same.status, same.body.status, same.body.ahead, same.body.behind], [200, "identical", 0, 0]);
  const missing = await ws.compare(s.deps, { ...s.input, head: "gone", base: "main" });
  assert.deepEqual([missing.status, missing.body.error, missing.body.which], [404, "ref_not_found", "head"]);
});

test("compare: ahead and behind come from the provider between resolved commits", async () => {
  const s = setup({ routes: { "$/branches/feat": { name: "feat", commit: { sha: SHA("b") } }, "$/branches/main": { name: "main", commit: { sha: SHA("a") } }, "/compare/": { status: "diverged", ahead_by: 3, behind_by: 1, total_commits: 3 } } });
  const r = await ws.compare(s.deps, { ...s.input, head: "feat", base: "main" });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.status, r.body.ahead, r.body.behind], ["diverged", 3, 1]);
  assert.match(providerCalls(s).find((c) => c.url.includes("/compare/")).url, new RegExp(`/compare/${SHA("a")}\\.\\.\\.${SHA("b")}`));
});

test("commits: validates input, pushes filters down, and never returns the git e-mail address", async () => {
  const s = setup({ routes: { "/commits?": [commitItem(1), commitItem(2)] } });
  for (const bad of [{ branch: "a..b" }, { author: "bad name!" }, { path: "../etc" }, { path: "/abs" }, { since: "yesterday" }]) {
    assert.equal((await ws.commits(s.deps, { ...s.input, branch: "main", ...bad })).status, 400);
  }
  const r = await ws.commits(s.deps, { ...s.input, branch: "main", author: "ana", path: "src/a.ts", since: "2026-10-01T00:00:00Z" });
  assert.equal(r.status, 200);
  assert.equal(r.body.items.length, 2);
  assert.equal(JSON.stringify(r.body).includes("ana@example.com"), false);
  const url = providerCalls(s).find((c) => c.url.includes("/commits?")).url;
  assert.match(url, /sha=main/);
  assert.match(url, /author=ana/);
  assert.match(url, /path=src%2Fa\.ts/);
  assert.match(url, /since=2026-10-01T00%3A00%3A00Z/);
});

test("commits: a cursor for one branch is refused for another", async () => {
  const s = setup({ routes: { "/commits?": Array.from({ length: 50 }, (_, i) => commitItem(i)) } });
  const first = await ws.commits(s.deps, { ...s.input, branch: "main" });
  assert.equal(first.status, 200);
  assert.ok(first.body.nextCursor);
  assert.equal((await ws.commits(s.deps, { ...s.input, branch: "other", cursor: first.body.nextCursor })).status, 400);
});

test("change stats: validates ids, returns null not zero when unavailable, and stops on budget", async () => {
  const s = setup({ routes: { [`$/commits/${SHA("a")}`]: { sha: SHA("a"), commit: { message: "x", author: { name: "A", date: "2026-10-07T10:00:00Z" }, committer: { date: "2026-10-07T10:00:00Z" } }, stats: { additions: 4, deletions: 2, total: 6 }, files: [{ filename: "a.ts", status: "modified", additions: 4, deletions: 2 }], html_url: "https://github.com/acme/web/commit/x" }, "/check-runs": { check_runs: [{ id: 1, name: "ci", status: "completed", conclusion: "success", html_url: "https://github.com/acme/web/runs/1" }] }, "/status": { state: "success", total_count: 0, statuses: [] } } });
  for (const items of [null, "", "commit:zz", "pr:0", "pr:1,pr:1", Array.from({ length: 11 }, (_, i) => `pr:${i + 1}`).join(","), "commit:" + SHA("a") + ",../x"]) {
    assert.equal((await ws.changeStats(s.deps, { ...s.input, items })).status, 400);
  }
  assert.equal(s.gh.calls.length, 0);
  const r = await ws.changeStats(s.deps, { ...s.input, items: `commit:${SHA("a")}` });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.results[0].status, r.body.results[0].additions, r.body.results[0].deletions, r.body.results[0].files], ["ok", 4, 2, 1]);
  assert.equal(r.body.results[0].checkState, "passed");
  const missing = await ws.changeStats(s.deps, { ...s.input, items: `commit:${SHA("b")}` });
  assert.deepEqual([missing.body.results[0].status, missing.body.results[0].additions, missing.body.results[0].deletions], ["unavailable", null, null], "unknown is never shown as zero");
  const denied = setup({ handlers: { code_activity_server_take_budget: { data: false, error: null } } });
  const budget = await ws.changeStats(denied.deps, { ...denied.input, items: `commit:${SHA("a")},commit:${SHA("b")}` });
  assert.ok(budget.status === 200 || budget.status === 429);
  if (budget.status === 200) assert.ok(budget.body.results.every((x) => x.status === "unavailable"));
});

test("deployments: reads with the extra permission and reports a refused permission as a state", async () => {
  const dep = (id) => ({ id, sha: SHA("a"), ref: "main", environment: "production", created_at: "2026-10-07T10:00:00Z", description: "ship", creator: { login: "ana" } });
  const s = setup({ routes: { "/deployments?": [dep(1)], "/deployments/1/statuses": [{ id: 9, state: "success", created_at: "2026-10-07T10:05:00Z", log_url: "https://example.com/log", environment_url: "https://example.com" }] } });
  const r = await ws.deployments(s.deps, s.input);
  assert.equal(r.status, 200);
  assert.equal(r.body.permission, "ok");
  assert.equal(r.body.items[0].state, "success");
  const mint = JSON.parse(s.gh.calls.find((c) => c.url.includes("/access_tokens")).body);
  assert.equal(mint.permissions.deployments, "read");
  assert.equal(mint.repository_ids.length, 1);
  for (const status of [403, 422]) {
    const refused = setup({ mint: () => json({ message: "denied" }, status) });
    const res = await ws.deployments(refused.deps, refused.input);
    assert.deepEqual([res.status, res.body.permission, res.body.items.length], [200, "needed", 0]);
  }
  const other = setup({ mint: () => json({ message: "down" }, 500) });
  assert.notEqual((await ws.deployments(other.deps, other.input)).status, 200, "a provider outage is an error, not a permission state");
  // Other endpoints never ask for the optional permission.
  const b = setup({ routes: { "$/repos/acme/web": { default_branch: "main" }, "$/branches": [] } });
  await ws.branches(b.deps, b.input);
  assert.equal(JSON.parse(b.gh.calls.find((c) => c.url.includes("/access_tokens")).body).permissions.deployments, undefined);
});

test("commit detail: returns files, exact totals and checks, and rejects malformed shas", async () => {
  for (const sha of ["", "abc", "g".repeat(40), `${SHA("a")}/../x`, 7]) assert.equal((await ws.commitDetail(setup().deps, { ...setup().input, sha })).status, 400);
  const files = Array.from({ length: 2 }, (_, i) => ({ filename: `f${i}.ts`, status: "modified", additions: 1, deletions: 1, patch: `@@ -1 +1 @@\n-a\n+<script>alert(1)</script>` }));
  const s = setup({ routes: { [`$/commits/${SHA("a")}`]: { sha: SHA("a"), commit: { message: "title\n\nbody text", author: { name: "A", date: "2026-10-07T10:00:00Z" }, committer: { date: "2026-10-07T10:00:00Z" } }, stats: { additions: 2, deletions: 2, total: 4 }, files, html_url: "https://github.com/acme/web/commit/x" }, "/check-runs": { check_runs: [] }, "/status": { state: "pending", total_count: 0, statuses: [] } } });
  const r = await ws.commitDetail(s.deps, { ...s.input, sha: SHA("A") });
  assert.equal(r.status, 200);
  const d = r.body.detail;
  assert.deepEqual([d.kind, d.title, d.body, d.stats.additions, d.stats.files, d.filesPartial], ["commit", "title", "body text", 2, 2, false]);
  assert.equal(d.files[0].patch.includes("<script>"), true, "patch text is carried as inert text");
});

const COMMIT_BODY = (sha) => ({ sha, commit: { message: "fix: autofill\n\nbody", author: { name: "A", date: "2026-10-07T10:00:00Z" }, committer: { date: "2026-10-07T10:00:00Z" } }, stats: { additions: 1, deletions: 0, total: 1 }, files: [], html_url: `https://github.com/acme/web/commit/${sha}` });
const SOURCE = "50000000-0000-0000-0000-000000000001";

test("register source: reads the commit from GitHub first, then records it bound to the connection and generation", async () => {
  const s = setup({ routes: { [`$/commits/${SHA("a")}`]: COMMIT_BODY(SHA("a")) }, handlers: { code_activity_server_record_workspace_source: { data: SOURCE, error: null } } });
  for (const bad of [{ kind: "commit", key: "zz" }, { kind: "commit", key: "../x" }, { kind: "pull_request", key: "0" }, { kind: "push", key: SHA("a") }, { kind: "commit", key: 5 }]) {
    assert.equal((await ws.registerSource(s.deps, { ...s.input, ...bad })).status, 400);
  }
  assert.equal(s.r.calls.some((c) => c.name === "code_activity_server_record_workspace_source"), false, "nothing is recorded for invalid input");
  const r = await ws.registerSource(s.deps, { ...s.input, kind: "commit", key: SHA("A") });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.sourceId, r.body.revisionSha, r.body.title], [SOURCE, SHA("a"), "fix: autofill"]);
  const call = s.r.calls.find((c) => c.name === "code_activity_server_record_workspace_source");
  assert.equal(call.label, "admin", "recorded by the server, never as the caller");
  assert.deepEqual([call.args.p_connection_id, call.args.p_generation, call.args.p_kind, call.args.p_provider_key], [CONN, 1, "commit", SHA("a")]);
});

test("register source: a commit GitHub does not have is never recorded, and authorization comes first", async () => {
  const s = setup({ handlers: { code_activity_server_record_workspace_source: { data: SOURCE, error: null } } });
  assert.notEqual((await ws.registerSource(s.deps, { ...s.input, kind: "commit", key: SHA("b") })).status, 200);
  assert.equal(s.r.calls.some((c) => c.name === "code_activity_server_record_workspace_source"), false);
  const denied = setup({ handlers: { code_activity_connection_status: { data: [], error: null } } });
  await ws.registerSource(denied.deps, { ...denied.input, kind: "commit", key: SHA("a") });
  assert.equal(denied.gh.calls.length, 0);
  const unapplied = setup({ routes: { [`$/commits/${SHA("a")}`]: COMMIT_BODY(SHA("a")) }, handlers: { code_activity_server_record_workspace_source: { data: null, error: { code: "PGRST202", message: "missing" } } } });
  const r = await ws.registerSource(unapplied.deps, { ...unapplied.input, kind: "commit", key: SHA("a") });
  assert.equal(r.body.error, "not_configured", "an unapplied database package is reported as setup, not as a failure of GitHub");
});

test("confirm workspace Thing: validates shape, sends no AI flag, and maps database errors", async () => {
  const r = rpcs({ confirm_code_activity_workspace_thing: { data: [{ o_thing_id: "70000000-0000-0000-0000-000000000001", o_replayed: false }], error: null } });
  const base = { user: r.user, listId: LIST, sourceId: SOURCE, key: "a0000000-0000-0000-0000-000000000001", title: "Verify", notes: null, assigneeActorId: "60000000-0000-0000-0000-00000000000a", dueAt: null, importance: "next", reviewedSha: SHA("a"), acknowledgeSourceChange: false };
  for (const bad of [{ title: "  " }, { title: "x".repeat(301) }, { importance: "urgent" }, { assigneeActorId: "nope" }, { sourceId: "nope" }, { dueAt: "tomorrow" }, { reviewedSha: "zz" }, { acknowledgeSourceChange: "yes" }, { notes: 5 }]) {
    assert.equal((await thing.confirmWorkspaceThing({ ...base, ...bad })).status, 400, JSON.stringify(bad).slice(0, 40));
  }
  assert.equal(r.calls.length, 0);
  const ok = await thing.confirmWorkspaceThing(base);
  assert.deepEqual([ok.status, ok.body.thingId, ok.body.replayed], [200, "70000000-0000-0000-0000-000000000001", false]);
  assert.ok(!("p_ai_generated" in r.calls[0].args), "a manual Thing carries no AI flag");
  assert.equal(r.calls[0].label, "user");
  for (const [code, want] of [["55000", "source_changed"], ["23505", "conflict"], ["42501", "not_allowed"], ["PGRST202", "not_configured"]]) {
    const e = rpcs({ confirm_code_activity_workspace_thing: { data: null, error: { code, message: "x" } } });
    assert.equal((await thing.confirmWorkspaceThing({ ...base, user: e.user })).body.error, want, code);
  }
});
