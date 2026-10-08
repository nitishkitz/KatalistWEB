import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import { CALLBACK_PATH, ENV_NAMES, loadConfig, loadWebhookSecret } from "../src/features/code-activity/server/config.server.ts";
import { DRAIN_LIMITS, authorizeDrain, drain } from "../src/features/code-activity/server/drain.server.ts";
import { createGitHubClient } from "../src/features/code-activity/server/github.server.ts";
import * as hook from "../src/features/code-activity/server/webhook.server.ts";

const SECRET = "whsec_test_secret_value_0123456789";
const DELIVERY = "80000000-0000-0000-0000-000000000001";
const SHA = (c) => c.repeat(40);
const sign = (body, secret = SECRET) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

function request(payload, { event = "push", delivery = DELIVERY, secret = SECRET, signature, method = "POST", raw } = {}) {
  const body = raw ?? JSON.stringify(payload);
  return new Request("https://katalist.example/api/public/code-activity/github/webhook", {
    method,
    body: method === "GET" ? undefined : body,
    headers: { "x-github-event": event, "x-github-delivery": delivery, "x-hub-signature-256": signature ?? sign(body, secret), "content-type": "application/json" },
  });
}
function rpcLog(handlers = {}) {
  const calls = [];
  return { calls, admin: () => ({ rpc: async (name, args) => { calls.push({ name, args }); const h = handlers[name]; return (typeof h === "function" ? await h(args) : h) ?? { data: null, error: null }; } }) };
}
const pushPayload = (extra = {}) => ({ ref: "refs/heads/main", before: SHA("d"), after: SHA("c"), repository: { id: 501, full_name: "acme/web" }, installation: { id: 77 }, sender: { login: "ana" }, head_commit: { timestamp: "2026-10-07T11:00:00Z", message: "SECRET COMMIT MESSAGE", author: { email: "a@b.c" } }, commits: [{ message: "SECRET COMMIT MESSAGE", added: ["private/file.ts"] }], ...extra });

// ---- signature and bounds ---------------------------------------------------------------------------

test("signature: only the exact HMAC of the raw bytes passes", () => {
  const body = new TextEncoder().encode('{"a":1}');
  assert.equal(hook.verifySignature(SECRET, body, sign('{"a":1}')), true);
  for (const bad of [null, "", "sha256=", "sha1=abc", `sha256=${"0".repeat(64)}`, sign('{"a":2}'), sign('{"a":1}', "other-secret-other-secret"), sign('{"a":1}').toUpperCase(), ` ${sign('{"a":1}')}`]) {
    assert.equal(hook.verifySignature(SECRET, body, bad), false, String(bad));
  }
  const bytes = new Uint8Array([0xff, 0xfe, 0x00, 0x7b]);
  assert.equal(hook.verifySignature(SECRET, bytes, `sha256=${createHmac("sha256", SECRET).update(bytes).digest("hex")}`), true, "the signature covers bytes, not decoded text");
});

test("bounded body: an oversize declaration or stream is refused without buffering the excess", async () => {
  const mk = (body, headers = {}) => new Request("https://x.test", { method: "POST", body, headers });
  assert.equal((await hook.readBoundedBody(mk("abc"), 10)).length, 3);
  assert.equal((await hook.readBoundedBody(mk("x".repeat(10)), 10)).length, 10, "exactly the limit is allowed");
  assert.equal(await hook.readBoundedBody(mk("x".repeat(11)), 10), null);
  assert.equal(await hook.readBoundedBody(mk("x", { "content-length": "99999999" }), 10), null, "a declared size over the limit is refused before reading");
  let pulls = 0;
  const stream = new ReadableStream({ pull(controller) { pulls += 1; controller.enqueue(new Uint8Array(4)); if (pulls > 1000) controller.close(); } });
  assert.equal(await hook.readBoundedBody(new Request("https://x.test", { method: "POST", body: stream, duplex: "half" }), 10), null);
  assert.ok(pulls < 10, `the stream was cancelled early (${pulls} pulls)`);
});

// ---- intake -----------------------------------------------------------------------------------------

test("intake: nothing is trusted or stored before the signature verifies", async () => {
  const log = rpcLog();
  const deps = { secret: SECRET, admin: log.admin };
  assert.equal((await hook.handleWebhook(deps, request(pushPayload(), { signature: sign("other") }))).status, 401);
  assert.equal((await hook.handleWebhook(deps, request(null, { raw: "not json", signature: sign("other") }))).status, 401, "a bad signature wins over bad JSON: the body is never parsed");
  assert.equal((await hook.handleWebhook(deps, request(null, { raw: "not json" }))).status, 400, "signed but malformed");
  assert.equal((await hook.handleWebhook(deps, request(null, { method: "GET" }))).status, 405);
  assert.equal((await hook.handleWebhook({ secret: null, admin: log.admin }, request(pushPayload()))).status, 503, "no secret configured: nothing is accepted");
  assert.equal((await hook.handleWebhook(deps, request(pushPayload(), { delivery: "not-a-uuid" }))).status, 400);
  assert.equal(log.calls.length, 0, "no database call for any rejected request");
  const big = "x".repeat(hook.WEBHOOK_LIMITS.bodyBytes + 1);
  assert.equal((await hook.handleWebhook(deps, request(null, { raw: big }))).status, 413);
  assert.equal(log.calls.length, 0);
});

test("intake: ping and unsubscribed events are acknowledged without storing anything", async () => {
  const log = rpcLog();
  const deps = { secret: SECRET, admin: log.admin };
  assert.equal((await hook.handleWebhook(deps, request({ zen: "x" }, { event: "ping" }))).status, 200);
  assert.equal((await hook.handleWebhook(deps, request({ x: 1 }, { event: "workflow_run" }))).status, 202);
  assert.equal((await hook.handleWebhook(deps, request({ no: "installation" }, { event: "push" }))).status, 202, "a payload without identifiers is skipped");
  assert.equal(log.calls.length, 0);
});

test("intake: only compact identifiers are stored, never content", async () => {
  const log = rpcLog({ code_activity_server_record_delivery: { data: "recorded", error: null } });
  const deps = { secret: SECRET, admin: log.admin };
  assert.equal((await hook.handleWebhook(deps, request(pushPayload()))).status, 202);
  const args = log.calls[0].args;
  assert.deepEqual([args.p_delivery_id, args.p_event, args.p_installation_id, args.p_repository_id], [DELIVERY, "push", 77, 501]);
  assert.deepEqual(args.p_refetch, { ref: "refs/heads/main", before: SHA("d"), after: SHA("c"), timestamp: "2026-10-07T11:00:00Z", sender: "ana", deleted: false });
  const text = JSON.stringify(log.calls);
  for (const secretText of ["SECRET COMMIT MESSAGE", "a@b.c", "private/file.ts", "acme/web"]) assert.ok(!text.includes(secretText), `${secretText} must not be stored`);
  assert.ok(JSON.stringify(args.p_refetch).length < 4096);
});

test("intake: each subscribed event yields exactly the identifiers its processing needs", () => {
  const inst = { installation: { id: 77 } };
  const repo = { repository: { id: 501 } };
  assert.deepEqual(hook.extractDelivery("pull_request", { action: "opened", number: 7, title: "SECRET", ...inst, ...repo }).refetch, { number: 7 });
  assert.deepEqual(hook.extractDelivery("check_run", { action: "completed", check_run: { head_sha: SHA("a"), name: "SECRET" }, ...inst, ...repo }).refetch, { sha: SHA("a") });
  assert.deepEqual(hook.extractDelivery("status", { sha: SHA("a"), context: "SECRET", state: "failure", ...inst, ...repo }).refetch, { sha: SHA("a") });
  const i = hook.extractDelivery("installation", { action: "suspend", ...inst });
  assert.deepEqual([i.action, i.repositoryId, i.refetch], ["suspend", null, {}]);
  const clean = hook.extractDelivery("installation_repositories", { action: "removed", repositories_removed: [{ id: 5, name: "SECRET" }, { id: 6 }], ...inst });
  assert.deepEqual([clean.removedRepositoryIds, clean.refetch, clean.removedOverflow], [[5, 6], {}, undefined]);
  const unreadable = hook.extractDelivery("installation_repositories", { action: "removed", repositories_removed: [{ id: 5 }, { id: "x" }], ...inst });
  assert.equal(unreadable.removedOverflow, true, "an entry that cannot be read is never silently dropped: fail closed");
  const many = hook.extractDelivery("installation_repositories", { action: "removed", repositories_removed: Array.from({ length: 450 }, (_, k) => ({ id: k + 1 })), ...inst });
  assert.equal(many.removedRepositoryIds.length, 450, "every removed repository is kept (the database splits them into rows of 200)");
  const huge = hook.extractDelivery("installation_repositories", { action: "removed", repositories_removed: Array.from({ length: hook.REMOVAL_ID_LIMIT + 1 }, (_, k) => ({ id: k + 1 })), ...inst });
  assert.deepEqual([huge.removedOverflow, huge.removedRepositoryIds], [true, undefined]);
  for (const [event, payload] of [["pull_request", { number: -1, ...inst, ...repo }], ["push", { ref: "refs/heads/x", before: "a", after: "nope", ...inst, ...repo }], ["status", { sha: "zz", ...inst, ...repo }], ["push", { ...inst }], ["check_run", { check_run: {}, ...inst, ...repo }]]) {
    assert.equal(hook.extractDelivery(event, payload), null, event);
  }
  assert.equal(hook.extractDelivery("push", "string"), null);
});

test("intake: redelivery, kill switch and database failure give the right answers", async () => {
  const answer = async (data, error = null) => (await hook.handleWebhook({ secret: SECRET, admin: rpcLog({ code_activity_server_record_delivery: { data, error } }).admin }, request(pushPayload()))).status;
  assert.equal(await answer("recorded"), 202);
  assert.equal(await answer("duplicate"), 200, "a redelivery is acknowledged, not stored twice");
  assert.equal(await answer("disabled"), 503, "GitHub then shows a failed delivery that can be redelivered once sync is back on");
  assert.equal(await answer(null, { code: "XX000", message: "db down" }), 503);
});

test("webhook secret: absent or too short means intake is off", () => {
  assert.equal(loadWebhookSecret({}), null);
  assert.equal(loadWebhookSecret({ [ENV_NAMES.webhookSecret]: "short" }), null);
  assert.equal(loadWebhookSecret({ [ENV_NAMES.webhookSecret]: SECRET }), SECRET);
});

test("regression (revocation completeness): a removal event reaches the database with EVERY repository id, or as an overflow", async () => {
  const removal = (repos, extra = {}) => ({ action: "removed", repositories_removed: repos, installation: { id: 77 }, ...extra });
  const run = async (payload, n = 1, handler = { data: "recorded", error: null }) => {
    const log = rpcLog({ code_activity_server_record_removal: handler });
    const response = await hook.handleWebhook({ secret: SECRET, admin: log.admin }, request(payload, { event: "installation_repositories", delivery: delivery(n) }));
    return { response, log };
  };
  function delivery(n) { return `80000000-0000-0000-0000-${String(n).padStart(12, "0")}`; }
  const ids = Array.from({ length: 450 }, (_, k) => 1000 + k);
  const big = await run(removal(ids.map((id) => ({ id, name: "SECRET-REPO" }))));
  assert.equal(big.response.status, 202);
  const args = big.log.calls[0].args;
  assert.deepEqual([args.p_repository_ids.length, args.p_overflow, args.p_installation_id], [450, false, 77], "nothing beyond the first 200 is discarded");
  assert.deepEqual(args.p_repository_ids, ids);
  assert.ok(!JSON.stringify(big.log.calls).includes("SECRET-REPO"), "names are not passed on");
  assert.equal(big.log.calls.length, 1, "one atomic call, not one per chunk");
  const overflow = await run(removal(Array.from({ length: hook.REMOVAL_ID_LIMIT + 5 }, (_, k) => ({ id: k + 1 }))));
  assert.deepEqual([overflow.log.calls[0].args.p_overflow, overflow.log.calls[0].args.p_repository_ids], [true, []]);
  assert.equal((await run(removal([{ id: 5 }, { id: "bad" }]))).log.calls[0].args.p_overflow, true, "an unreadable entry is not skipped");
  assert.equal((await run(removal(ids.map((id) => ({ id }))), 1, { data: "duplicate", error: null })).response.status, 200);
  assert.equal((await run(removal(ids.map((id) => ({ id }))), 1, { data: "disabled", error: null })).response.status, 503);
  assert.equal((await run(removal(ids.map((id) => ({ id }))), 1, { data: null, error: { code: "XX000", message: "x" } })).response.status, 503, "a database failure is never answered as success");
  const added = await run({ action: "added", repositories_added: [{ id: 1 }], installation: { id: 77 } });
  assert.deepEqual([added.response.status, added.log.calls.length], [202, 0], "additions need no processing");
});

// ---- drain (unit; the SQL path is covered by the G10 integration tests) --------------------------------

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const cfg = loadConfig({
  [ENV_NAMES.appId]: "1", [ENV_NAMES.appSlug]: "app", [ENV_NAMES.clientId]: "Iv1", [ENV_NAMES.clientSecret]: "s", [ENV_NAMES.privateKey]: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  [ENV_NAMES.stateSecret]: "x".repeat(40), [ENV_NAMES.callbackUrl]: `http://localhost:8080${CALLBACK_PATH}`, [ENV_NAMES.allowedOrigins]: "http://localhost:8080",
}, { production: false });
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
function gh(routes = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    const u = String(url);
    calls.push(u);
    if (u.includes("/access_tokens")) return json({ token: "ghs_installation_token", expires_at: "x", repository_selection: "selected", permissions: { metadata: "read" }, repositories: [{ id: 501 }] });
    if (u.includes("/installation/repositories")) return json({ repositories: [{ id: 501, full_name: "acme/web" }] });
    for (const [needle, value] of Object.entries(routes)) if (u.includes(needle)) return value instanceof Response ? value : json(value);
    return json({}, 404);
  };
  return { client: createGitHubClient({ config: cfg.config, fetchImpl }), calls };
}
const claimedRow = (event, refetch, extra = {}) => ({ o_delivery_id: DELIVERY, o_event: event, o_action: null, o_installation_id: 77, o_repository_id: 501, o_refetch: refetch, o_attempts: 1, o_lease_token: "90000000-0000-0000-0000-000000000001", ...extra });
const follows = { data: [{ o_connection_id: "30000000-0000-0000-0000-000000000001", o_list_id: "10000000-0000-0000-0000-000000000001", o_generation: 3 }], error: null };
function drainSetup(rows, { github = gh(), handlers = {} } = {}) {
  const queue = [...rows];
  const log = rpcLog({ code_activity_server_claim_deliveries: () => ({ data: queue.length ? [queue.shift()] : [], error: null }), code_activity_server_connections_for_event: follows, code_activity_server_take_budget: { data: true, error: null }, code_activity_server_finish_delivery: { data: true, error: null }, code_activity_server_apply_items: { data: 1, error: null }, code_activity_server_set_check_state: { data: 1, error: null }, code_activity_server_apply_installation_event: { data: 1, error: null }, code_activity_server_begin_reconcile: { data: [], error: null }, code_activity_server_prune_deliveries: { data: 0, error: null }, ...handlers });
  return { log, github, deps: { config: cfg, github: github.client, admin: log.admin } };
}
const finishArgs = (log) => log.calls.filter((c) => c.name === "code_activity_server_finish_delivery").map((c) => [c.args.p_outcome, c.args.p_error_code]);

test("drain: a pull request event refetches current state from GitHub instead of trusting the payload", async () => {
  const pull = { number: 7, title: "Title from GitHub", state: "open", user: { login: "ana", type: "User" }, head: { ref: "nav", sha: SHA("a") }, base: { ref: "main" }, html_url: "https://github.com/acme/web/pull/7", updated_at: "2026-10-07T11:00:00Z" };
  const s = drainSetup([claimedRow("pull_request", { number: 7 })], { github: gh({ "/pulls/7": pull, "/check-runs": { check_runs: [] }, "/status": { total_count: 0, statuses: [] } }) });
  const result = await drain(s.deps);
  assert.deepEqual([result.claimed, result.processed], [1, 1]);
  const applied = s.log.calls.find((c) => c.name === "code_activity_server_apply_items").args;
  assert.deepEqual([applied.p_connection_id, applied.p_generation], ["30000000-0000-0000-0000-000000000001", 3], "fenced to the generation read just now");
  assert.deepEqual([applied.p_items[0].title, applied.p_items[0].check_state, applied.p_items[0].checks_revision], ["Title from GitHub", "none", SHA("a")]);
  assert.deepEqual(finishArgs(s.log), [["processed", null]]);
  assert.ok(s.github.calls.every((u) => !/\/(issues|comments)/.test(u)));
});

test("drain: push, check_run and status events update the right rows", async () => {
  const push = drainSetup([claimedRow("push", { ref: "refs/heads/main", before: SHA("d"), after: SHA("c"), timestamp: "2026-10-07T11:00:00Z", sender: "ana", deleted: false })], { github: gh({ "/check-runs": { check_runs: [] }, "/status": { total_count: 1, statuses: [{ id: 1, context: "ci", state: "failure" }] } }) });
  await drain(push.deps);
  const item = push.log.calls.find((c) => c.name === "code_activity_server_apply_items").args.p_items[0];
  assert.deepEqual([item.kind, item.provider_key, item.head_sha, item.before_sha, item.check_state, item.source_url], ["push", `main@${SHA("c")}`, SHA("c"), SHA("d"), "failing", `https://github.com/acme/web/commit/${SHA("c")}`]);
  for (const event of ["check_run", "status"]) {
    const s = drainSetup([claimedRow(event, { sha: SHA("a") })], { github: gh({ "/check-runs": { check_runs: [{ id: 1, name: "b", status: "completed", conclusion: "success" }] }, "/status": { total_count: 0, statuses: [] } }) });
    await drain(s.deps);
    const set = s.log.calls.find((c) => c.name === "code_activity_server_set_check_state");
    assert.deepEqual([set.args.p_sha, set.args.p_state, set.args.p_generation], [SHA("a"), "passed", 3], event);
    assert.ok(!s.log.calls.some((c) => c.name === "code_activity_server_apply_items"));
  }
  const tag = drainSetup([claimedRow("push", { ref: "refs/tags/v1", before: SHA("d"), after: SHA("c") })]);
  await drain(tag.deps);
  assert.deepEqual(finishArgs(tag.log), [["ignored", null]], "tags are not code changes");
  assert.equal(tag.github.calls.length, 0);
});

test("drain: events nobody follows are ignored without touching GitHub; installation events apply directly", async () => {
  const nobody = drainSetup([claimedRow("pull_request", { number: 1 })], { handlers: { code_activity_server_connections_for_event: { data: [], error: null } } });
  await drain(nobody.deps);
  assert.deepEqual(finishArgs(nobody.log), [["ignored", null]]);
  assert.equal(nobody.github.calls.length, 0);
  const susp = drainSetup([claimedRow("installation", {}, { o_action: "suspend", o_repository_id: null })]);
  await drain(susp.deps);
  assert.deepEqual(susp.log.calls.find((c) => c.name === "code_activity_server_apply_installation_event").args, { p_installation_id: 77, p_action: "suspend", p_removed_repository_ids: null, p_delivery_id: DELIVERY, p_lease_token: "90000000-0000-0000-0000-000000000001" }, "the write carries this delivery's lease");
  assert.equal(susp.github.calls.length, 0, "no provider request for lifecycle events");
  const removed = drainSetup([claimedRow("installation_repositories", { removed: [501, 502] }, { o_action: "removed", o_repository_id: null })]);
  await drain(removed.deps);
  assert.deepEqual(removed.log.calls.find((c) => c.name === "code_activity_server_apply_installation_event").args.p_removed_repository_ids, [501, 502]);
  const overflow = drainSetup([claimedRow("installation_repositories", { overflow: true }, { o_action: "removed_overflow", o_repository_id: null })]);
  await drain(overflow.deps);
  assert.equal(overflow.log.calls.find((c) => c.name === "code_activity_server_apply_installation_event").args.p_action, "removed_overflow", "an unlistable removal is processed fail-closed, not ignored");
  const added = drainSetup([claimedRow("installation_repositories", {}, { o_action: "added", o_repository_id: null }), claimedRow("installation", {}, { o_action: "created", o_delivery_id: "80000000-0000-0000-0000-000000000002" })]);
  await drain(added.deps);
  assert.deepEqual(finishArgs(added.log), [["ignored", null], ["ignored", null]]);
});

test("drain: budget, rate limits and provider failures retry with a code; nothing is applied", async () => {
  const noBudget = drainSetup([claimedRow("pull_request", { number: 7 })], { handlers: { code_activity_server_take_budget: { data: false, error: null } } });
  await drain(noBudget.deps);
  assert.deepEqual(finishArgs(noBudget.log), [["retry", "budget"]]);
  assert.equal(noBudget.github.calls.length, 0, "no provider request without budget (the very first one, minting the token, is metered too)");

  const limited = drainSetup([claimedRow("pull_request", { number: 7 })], { github: gh({ "/pulls/7": json({}, 429, { "retry-after": "120" }) }) });
  const r = await drain(limited.deps);
  assert.equal(r.retried, 1);
  assert.deepEqual(finishArgs(limited.log), [["retry", "github_rate_limited"]]);
  assert.deepEqual(limited.log.calls.find((c) => c.name === "code_activity_server_block_installation").args, { p_installation_id: 77, p_seconds: 120 });

  const down = drainSetup([claimedRow("pull_request", { number: 7 })], { github: gh({ "/pulls/7": json({}, 503) }) });
  await drain(down.deps);
  assert.deepEqual(finishArgs(down.log), [["retry", "github_unavailable"]]);
  assert.ok(!down.log.calls.some((c) => c.name === "code_activity_server_apply_items"));

  const dbDown = drainSetup([claimedRow("pull_request", { number: 7 })], { github: gh({ "/pulls/7": { number: 7, title: "t", state: "open", head: { sha: SHA("a") }, updated_at: "2026-10-07T11:00:00Z" }, "/check-runs": { check_runs: [] }, "/status": { statuses: [], total_count: 0 } }), handlers: { code_activity_server_apply_items: { data: null, error: { code: "XX000", message: "x" } } } });
  await drain(dbDown.deps);
  assert.deepEqual(finishArgs(dbDown.log), [["retry", "database"]]);

  const unconfigured = drainSetup([claimedRow("pull_request", { number: 7 })]);
  unconfigured.deps.github = null;
  await drain(unconfigured.deps);
  assert.deepEqual(finishArgs(unconfigured.log), [["retry", "not_configured"]], "missing App configuration retries instead of dropping work");
});

test("drain: a lost lease is not counted, the per-run cap holds, and the run budget stops claiming", async () => {
  const lost = drainSetup([claimedRow("installation", {}, { o_action: "suspend", o_repository_id: null })], { handlers: { code_activity_server_finish_delivery: { data: false, error: null } } });
  const r = await drain(lost.deps);
  assert.deepEqual([r.claimed, r.processed], [1, 0], "the new lease holder owns that outcome");
  const rows = Array.from({ length: 10 }, (_, i) => claimedRow("installation", {}, { o_action: "created", o_delivery_id: `80000000-0000-0000-0000-0000000000${String(i + 10)}` }));
  const capped = drainSetup(rows);
  const out = await drain(capped.deps, { limit: 99 });
  assert.equal(out.claimed, DRAIN_LIMITS.deliveriesPerRun, "at most four per run, however many are asked for");
  let t = 0;
  const slow = drainSetup([claimedRow("installation", {}, { o_action: "suspend" })]);
  const none = await drain(slow.deps, { now: () => (t += DRAIN_LIMITS.runBudgetMs + 1) });
  assert.equal(none.claimed, 0);
  assert.ok(!slow.log.calls.some((c) => c.name === "code_activity_server_claim_deliveries"), "past the budget nothing is claimed, so no lease is started and then wasted");
  assert.ok(!slow.log.calls.some((c) => c.name === "code_activity_server_begin_reconcile"), "no reconcile once the budget is spent");
});

test("regression (worker safety): each delivery is claimed immediately before it is processed, never as a batch", async () => {
  const rows = [claimedRow("installation", {}, { o_action: "suspend", o_delivery_id: "80000000-0000-0000-0000-000000000011" }), claimedRow("installation", {}, { o_action: "unsuspend", o_delivery_id: "80000000-0000-0000-0000-000000000012" }), claimedRow("installation", {}, { o_action: "deleted", o_delivery_id: "80000000-0000-0000-0000-000000000013" })];
  const s = drainSetup(rows);
  await drain(s.deps);
  const sequence = s.log.calls.map((c) => c.name.replace("code_activity_server_", "")).filter((n) => ["claim_deliveries", "apply_installation_event", "finish_delivery"].includes(n));
  assert.deepEqual(sequence.slice(0, 6), ["claim_deliveries", "apply_installation_event", "finish_delivery", "claim_deliveries", "apply_installation_event", "finish_delivery"], "claim, work, finish, then claim the next");
  assert.ok(s.log.calls.filter((c) => c.name === "code_activity_server_claim_deliveries").every((c) => c.args.p_limit === 1), "one lease at a time, so a later delivery's 60 seconds start when its own work starts");
  const writes = s.log.calls.filter((c) => c.name === "code_activity_server_apply_installation_event");
  assert.deepEqual(writes.map((c) => c.args.p_delivery_id), rows.map((r) => r.o_delivery_id), "each write carries the lease of the delivery it belongs to");
});

test("regression (worker safety): a lease lost during processing makes the write fail and the delivery retry", async () => {
  const s = drainSetup([claimedRow("installation", {}, { o_action: "suspend", o_repository_id: null })], { handlers: { code_activity_server_apply_installation_event: { data: null, error: { code: "40001", message: "lease lost" } } } });
  await drain(s.deps);
  assert.deepEqual(finishArgs(s.log), [["retry", "lease_lost"]]);
});

test("drain: due connections are reconciled with the shared refresh read, in the background budget class", async () => {
  const pulls = [{ number: 1, title: "PR", state: "open", user: { login: "a", type: "User" }, head: { ref: "b", sha: SHA("a") }, base: { ref: "main" }, updated_at: "2026-10-07T11:00:00Z" }];
  const s = drainSetup([], {
    github: gh({ "/pulls?": pulls, "/activity?": [], "/check-runs": { check_runs: [] }, "/status": { total_count: 0, statuses: [] } }),
    handlers: {
      code_activity_server_begin_reconcile: { data: [{ o_connection_id: "30000000-0000-0000-0000-000000000001", o_list_id: "10000000-0000-0000-0000-000000000001", o_generation: 3, o_lease_token: "40000000-0000-0000-0000-000000000001" }], error: null },
      code_activity_server_connection_for_provider: { data: [{ o_installation_id: 77, o_repository_id: 501 }], error: null },
      code_activity_server_finish_refresh: { data: true, error: null },
    },
  });
  const r = await drain(s.deps);
  assert.equal(r.reconciled, 1);
  assert.equal(s.log.calls.find((c) => c.name === "code_activity_server_take_budget").args.p_interactive, false);
  assert.equal(s.log.calls.find((c) => c.name === "code_activity_server_finish_refresh").args.p_status, "ok");
});

test("drain authorization: constant-time credential, bearer or header, and a short secret is never accepted", () => {
  const SECRET_LONG = "cron-secret-0123456789abcdef";
  const req = (headers) => new Request("https://x.test/api/jobs/code-activity-drain", { headers });
  assert.equal(authorizeDrain(req({ authorization: `Bearer ${SECRET_LONG}` }), SECRET_LONG), true);
  assert.equal(authorizeDrain(req({ "x-cron-secret": SECRET_LONG }), SECRET_LONG), true);
  for (const [headers, secret] of [[{}, SECRET_LONG], [{ authorization: "Bearer nope" }, SECRET_LONG], [{ authorization: `bearer ${SECRET_LONG}` }, SECRET_LONG], [{ authorization: "Bearer " }, ""], [{ authorization: "Bearer short" }, "short"], [{ authorization: `Bearer ${SECRET_LONG}` }, undefined]]) {
    assert.equal(authorizeDrain(req(headers), secret), false);
  }
});
