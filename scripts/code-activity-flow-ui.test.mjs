import "./dom-test-setup.mjs";
// The consent switch (Radix Switch) checks for a form ancestor; jsdom exposes the constructor only on its window.
globalThis.HTMLFormElement = window.HTMLFormElement;
import assert from "node:assert/strict";
import { mock, test, afterEach } from "node:test";
import { Component, createElement as h, lazy, Suspense } from "react";
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// The suite runs beside hundreds of other test files. The default 1 s wait is too tight under that load and made three
// of these tests fail only when run in parallel; the behavior was never wrong. Waits below are for slow machines, not for
// slow code: a failing assertion still fails at once.
configure({ asyncUtilTimeout: 8000 });

/**
 * Component-level acceptance of the live feature in jsdom, with the network replaced by a scripted server.
 * Covers: states, roles, Refresh, overlay (Escape, focus return), Thing creation, Coey gating, and containment.
 * NOT covered: real layout, scrolling, mobile viewport behavior and visual match (see the Playwright spec and the runbook).
 */
const LIST = "10000000-0000-0000-0000-000000000001";
const CHANGE = "50000000-0000-0000-0000-000000000001";
const PUSH = "50000000-0000-0000-0000-000000000002";
const ACTOR_O = "60000000-0000-0000-0000-00000000000a";
const ACTOR_C = "60000000-0000-0000-0000-00000000000c";
const SHA = (c) => c.repeat(40);

const requests = [];
let world;
const fresh = () => ({
  caps: { enabled: true, configured: true, ai: { available: false, consent: false } },
  connection: { status: "active", repositoryFullName: "acme/web", lastSyncedAt: "2026-10-07T11:00:00Z", syncStatus: "ok" },
  feed: null,
  detail: null,
  detailStatus: 200,
  refresh: { status: 200, body: { syncStatus: "ok" } },
  confirm: { status: 200, body: { thingId: "70000000-0000-0000-0000-000000000001", replayed: false } },
  draft: { status: 200, body: { title: "Verify nav", description: "Check the menu." } },
  candidates: [{ actorId: ACTOR_O, name: "Olivia", role: "owner", isSelf: true }, { actorId: ACTOR_C, name: "Chen", role: "collaborator", isSelf: false }],
});
const row = (id, title, extra = {}) => ({
  id, kind: "pull_request", title, number: 7, prState: "open", author: { name: "ana", kind: "user" }, headBranch: "nav", baseBranch: "main", headSha: SHA("a"), updatedAt: new Date().toISOString(),
  additions: null, deletions: null, changedFiles: null, sourceUrl: "https://github.com/acme/web/pull/7", commitUrl: null, description: null, checkState: "failing", checksRevision: SHA("a"), checksStale: false,
  checks: [], checksPartial: false, files: [], filesPartial: false, gap: null, ...extra,
});
const detail = (extra = {}) => row(CHANGE, "Responsive nav", {
  description: "Makes the menu <b>responsive</b>", additions: 5, deletions: 1, changedFiles: 1,
  checks: [{ id: "1", name: "build", status: "completed", conclusion: "failure", durationLabel: "1m", url: null }],
  files: [{ path: "src/nav.tsx", status: "modified", additions: 5, deletions: 1, patchState: "available", patch: "@@ -1 +1 @@\n-a\n+<img src=x onerror=alert(1)>" }], ...extra,
});
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

mock.module(new URL("../src/lib/authed-fetch.ts", import.meta.url).href, {
  namedExports: {
    authedFetch: async (url, init = {}) => {
      const u = new URL(url, "http://localhost");
      const body = init.body ? JSON.parse(init.body) : null;
      requests.push({ path: u.pathname, search: u.search, method: init.method ?? "GET", body });
      switch (u.pathname) {
        case "/api/code-activity/capabilities": return world.caps ? json(world.caps) : json({ error: "source_unavailable" }, 502);
        case "/api/code-activity/github/authorize/start": { const r = world.start ? await world.start() : { status: 200, body: { url: "https://github.com/login/oauth/authorize?x=1", flow: "oauth" } }; return json(r.body, r.status); }
        case "/api/code-activity/connection": return init.method === "DELETE" ? json({ disconnected: true }) : json(world.connection);
        case "/api/code-activity/feed": return world.feed ? json({ repositoryFullName: "acme/web", freshness: { lastSyncedAt: world.connection.lastSyncedAt, syncStatus: world.connection.syncStatus }, changes: world.feed, nextCursor: null, connectionStatus: world.connection.status }) : json({ error: "not_allowed" }, 403);
        case "/api/code-activity/refresh": return json(world.refresh.body, world.refresh.status);
        case "/api/code-activity/changes/detail": return world.detailStatus === 200 ? json({ change: world.detail }) : json({ error: "source_unavailable" }, world.detailStatus);
        case "/api/code-activity/assignee-candidates": {
          const r = world.candidatesReply ? await world.candidatesReply() : { status: 200, body: { candidates: world.candidates } };
          return json(r.body, r.status);
        }
        case "/api/code-activity/drafts/confirm": return json(world.confirm.body, world.confirm.status);
        case "/api/code-activity/changes/draft": return json(world.draft.body, world.draft.status);
        case "/api/code-activity/consent": world.caps.ai.consent = body.enabled; return json({ consent: body.enabled });
        default: return json({ error: "not_found" }, 404);
      }
    },
  },
});
const { default: CodeActivityRoot } = await import("../src/features/code-activity/CodeActivityRoot.tsx");
const { CodeActivityBoundary } = await import("../src/features/code-activity/CodeActivityBoundary.tsx");

const mount = (role = "owner") => render(h(CodeActivityRoot, { listId: LIST, listName: "Website", listRole: role, onOpenThings: () => requests.push({ path: "OPEN_THINGS" }) }));
const calls = (path) => requests.filter((r) => r.path === path);
const button = (name) => screen.getByRole("button", { name });

afterEach(() => {
  cleanup();
  requests.length = 0;
});

function connectedWorld() {
  world = fresh();
  world.feed = [row(CHANGE, "Responsive nav"), row(PUSH, "Push to main", { kind: "push", prState: null, number: null, checkState: "passed", sourceUrl: null, commitUrl: "https://github.com/acme/web/commit/x" })];
  world.detail = detail();
}

test("readiness is told apart: unavailable for this List, operator setup unfinished, and a network failure; the owner always sees the action", async () => {
  const cases = [
    [{ enabled: false }, /GitHub connection is unavailable for this List\./, "unavailable"],
    [{ enabled: true, configured: false, ai: { available: false, consent: false } }, /GitHub integration is not enabled yet\. Katalist.s operator needs to finish setup\./, "setup"],
  ];
  for (const [caps, text, label] of cases) {
    world = fresh();
    world.caps = caps;
    mount();
    await screen.findByText(text);
    const connect = screen.getByRole("button", { name: /Connect GitHub/ });
    assert.equal(connect.disabled, true, `${label}: visible but disabled`);
    assert.ok(connect.getAttribute("aria-describedby"), `${label}: the reason is attached to it`);
    assert.equal(calls("/api/code-activity/feed").length + calls("/api/code-activity/connection").length, 0, `${label}: no activity is requested`);
    fireEvent.click(connect);
    assert.equal(calls("/api/code-activity/github/authorize/start").length, 0, `${label}: clicking a disabled action starts nothing`);
    cleanup();
    requests.length = 0;
    mount("view_only");
    await screen.findByText(text);
    assert.equal(screen.queryByRole("button", { name: /Connect GitHub/ }), null, `${label}: a member gets no action`);
    cleanup();
    requests.length = 0;
  }
  // A failed capabilities request is an error with Retry, never "the operator has not set it up".
  world = fresh();
  world.connection = { status: "none", repositoryFullName: null, lastSyncedAt: null, syncStatus: null, needsReverification: false };
  const original = world.caps;
  world.caps = null;
  mount();
  await screen.findByRole("alert");
  assert.match(screen.getByRole("alert").textContent, /could not be loaded/);
  assert.equal(screen.queryByText(/operator needs to finish setup/), null);
  assert.equal(screen.queryByText(/unavailable for this List/), null);
  world.caps = original;
  fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
  await waitFor(() => assert.equal(screen.getByRole("button", { name: /Connect GitHub/ }).disabled, false), { timeout: 8000 });
});

test("ready owner: Connect is enabled, shows Opening GitHub once, ignores a double click, and recovers from a failure with Retry", async () => {
  world = fresh();
  world.connection = { status: "none", repositoryFullName: null, lastSyncedAt: null, syncStatus: null, needsReverification: false };
  let release;
  world.start = () => new Promise((resolve) => { release = resolve; });
  mount();
  await waitFor(() => assert.equal(screen.getByRole("button", { name: /Connect GitHub/ }).disabled, false), { timeout: 8000 });
  const connect = screen.getByRole("button", { name: /Connect GitHub/ });
  assert.ok(screen.getByText(/Use your GitHub account to choose a repository for this List/));
  fireEvent.click(connect);
  fireEvent.click(connect);
  fireEvent.click(connect);
  const opening = await screen.findByRole("button", { name: /Opening GitHub/ });
  assert.equal(opening.disabled, true);
  assert.equal(calls("/api/code-activity/github/authorize/start").length, 1, "a double click does not start two authorizations");
  assert.deepEqual(calls("/api/code-activity/github/authorize/start")[0].body, { listId: LIST, flow: "oauth" });
  release({ status: 200, body: { url: "https://evil.example/phish", flow: "oauth" } }); // never navigated to
  await screen.findByText(/GitHub could not be reached/);
  const retry = await screen.findByRole("button", { name: /Connect GitHub/ });
  assert.equal(retry.disabled, false, "after a failure the same action is available again");
  world.start = null;
});

test("connected owner: real header, rows from the server, filters, Refresh, and the saved feed survives a failed Refresh", async () => {
  connectedWorld();
  mount();
  await screen.findByText("Responsive nav");
  assert.ok(screen.getByText("acme/web"));
  assert.ok(screen.getByText("Connected"));
  assert.ok(screen.getByText(/Last synced/));
  assert.ok(screen.getByText("Push to main"));
  assert.ok(button(/Refresh/));
  assert.ok(button(/Manage/));
  fireEvent.click(screen.getByRole("button", { name: "Pull requests" }));
  assert.equal(screen.queryByText("Push to main"), null, "the filter narrows the list");
  fireEvent.click(screen.getByRole("button", { name: "All activity" }));
  assert.ok(await screen.findByText("Push to main"));

  world.refresh = { status: 502, body: { error: "source_unavailable" } };
  world.connection = { ...world.connection, syncStatus: "unavailable" };
  fireEvent.click(button(/Refresh/));
  await screen.findByText(/Refresh did not finish/);
  assert.equal(calls("/api/code-activity/refresh").length, 1);
  assert.ok(screen.getByText("Responsive nav"), "saved activity stays visible");
  assert.ok(await screen.findByText(/GitHub is unavailable/));
});

test("roles: a collaborator refreshes but cannot manage; View Only reads only", async () => {
  connectedWorld();
  mount("collaborator");
  await screen.findByText("Responsive nav");
  assert.ok(button(/Refresh/));
  assert.equal(screen.queryByRole("button", { name: /Manage/ }), null);
  cleanup();
  mount("view_only");
  await screen.findByText("Responsive nav");
  assert.equal(screen.queryByRole("button", { name: /Refresh/ }), null);
  assert.equal(screen.queryByRole("button", { name: /Manage/ }), null);
  assert.equal(calls("/api/code-activity/assignee-candidates").length, 0, "View Only never asks for assignee candidates");
});

test("the first open of a never-synced List runs one Refresh for people who may refresh", async () => {
  connectedWorld();
  world.connection = { ...world.connection, lastSyncedAt: null, syncStatus: "unavailable" };
  world.feed = [];
  mount();
  await screen.findByText(/Not synced yet|Reading from GitHub/);
  await waitFor(() => assert.equal(calls("/api/code-activity/refresh").length, 1));
  cleanup();
  requests.length = 0;
  mount("view_only");
  await screen.findByText(/An owner or collaborator can refresh/);
  assert.equal(calls("/api/code-activity/refresh").length, 0, "View Only never triggers a read of GitHub");
});

test("overlay: opens from a row, shows real detail as text, and closes with Escape", async () => {
  connectedWorld();
  mount();
  const rowButton = (await screen.findByText("Responsive nav")).closest("button");
  fireEvent.click(rowButton);
  const dialog = await screen.findByRole("dialog");
  await within(dialog).findByText("Reading from GitHub…").catch(() => null);
  await within(dialog).findByText(/Makes the menu <b>responsive<\/b>/);
  assert.equal(dialog.querySelector("b"), null, "provider markup is shown as text, not parsed");
  assert.equal(calls("/api/code-activity/changes/detail").length, 1);
  assert.equal(calls("/api/code-activity/changes/detail")[0].search.includes(`changeId=${CHANGE}`), true);
  fireEvent.click(within(dialog).getByRole("tab", { name: /Files/ }));
  assert.ok(await within(dialog).findByText(/onerror=alert\(1\)/));
  assert.equal(dialog.querySelector("img"), null, "a patch never becomes an element");
  fireEvent.click(within(dialog).getByRole("tab", { name: /Checks/ }));
  assert.ok(within(dialog).getByText("build"));
  fireEvent.keyDown(dialog, { key: "Escape" });
  await waitFor(() => assert.equal(screen.queryByRole("dialog"), null));
  // Focus RETURN to the row is NOT asserted here: pre-focusing the row and closing a Radix dialog makes jsdom spin
  // (a jsdom/Radix interaction; a bare Radix dialog also fails to restore focus under jsdom). It is checked in a real
  // browser by tests/e2e/preview/code-activity.spec.ts and listed as unverified in the G13 notes.
  assert.ok(screen.getByText("Push to main"), "the feed is still there");
});

test("overlay: a failed detail read is contained with a retry, and the feed is unaffected", async () => {
  connectedWorld();
  world.detailStatus = 502;
  mount();
  fireEvent.click((await screen.findByText("Responsive nav")).closest("button"));
  const dialog = await screen.findByRole("dialog");
  await within(dialog).findByText(/could not be reached/);
  world.detailStatus = 200;
  fireEvent.click(within(dialog).getByRole("button", { name: /Try again/ }));
  await within(dialog).findByText(/Makes the menu/);
  fireEvent.keyDown(dialog, { key: "Escape" });
  await waitFor(() => assert.equal(screen.queryByRole("dialog"), null));
  assert.ok(screen.getByText("Push to main"));
});

test("Coey is hidden while the operator switch is off; Thing creation by hand is still offered to owners and collaborators only", async () => {
  connectedWorld();
  mount();
  fireEvent.click((await screen.findByText("Responsive nav")).closest("button"));
  const dialog = await screen.findByRole("dialog");
  await within(dialog).findByRole("button", { name: /Create a Thing from this change/ });
  for (const text of [/Draft with Coey/, /Summarize change/, /consent/i, /Preview/]) assert.equal(within(dialog).queryByText(text), null, String(text));
  cleanup();
  requests.length = 0;
  connectedWorld();
  mount("view_only");
  fireEvent.click((await screen.findByText("Responsive nav")).closest("button"));
  const d2 = await screen.findByRole("dialog");
  await within(d2).findByText(/View Only members can read this change/);
  assert.equal(within(d2).queryByRole("button", { name: /Create a Thing/ }), null);
});

test("creating a Thing from a change: explicit assignee, no invented date, a stable key, and a real result", async () => {
  connectedWorld();
  mount();
  fireEvent.click((await screen.findByText("Responsive nav")).closest("button"));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(await within(dialog).findByRole("button", { name: /Create a Thing from this change/ }));
  await within(dialog).findByText("Create a Thing from this change", { selector: "h3" });
  assert.equal(within(dialog).queryByText(/PREVIEW|Preview/), null, "nothing in the live feature is labeled Preview");
  assert.equal(within(dialog).getByLabelText(/Title/).value, "Responsive nav", "starts from the change title, which the person can edit");
  const create = within(dialog).getByRole("button", { name: /^Create Thing$/ });
  assert.equal(create.disabled, true, "no assignee is chosen for the person");
  assert.equal(within(dialog).getByLabelText(/Due date/).value, "");
  const options = within(dialog).getAllByRole("option").map((o) => o.textContent).join("|");
  assert.match(options, /Assign to me/);
  assert.match(options, /Chen/);
  fireEvent.change(within(dialog).getByLabelText(/Assignee/), { target: { value: ACTOR_C } });
  assert.equal(create.disabled, false);
  fireEvent.click(create);
  await within(dialog).findByText(/was created/);
  const sent = calls("/api/code-activity/drafts/confirm");
  assert.equal(sent.length, 1);
  assert.deepEqual(
    { ...sent[0].body, key: typeof sent[0].body.key },
    { listId: LIST, changeId: CHANGE, key: "string", title: "Responsive nav", notes: null, assigneeActorId: ACTOR_C, dueAt: null, importance: "next", headSha: SHA("a"), acknowledgeSourceChange: false, aiGenerated: false },
  );
  assert.match(within(dialog).getByText(/Waiting for Catch/).textContent, /Waiting for Catch/);
  fireEvent.click(within(dialog).getByRole("button", { name: /Open Things/ }));
  assert.ok(requests.some((r) => r.path === "OPEN_THINGS"));
});

test("missing assignee schema is explained inline, not shown as an empty working dropdown", async () => {
  connectedWorld();
  world.candidatesReply = () => ({ status: 503, body: { error: "not_configured" } });
  mount();
  fireEvent.click((await screen.findByText("Responsive nav")).closest("button"));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(await within(dialog).findByRole("button", { name: /Create a Thing from this change/ }));
  await within(dialog).findByText(/Creating Things from Code Activity is not set up yet/);
  assert.equal(within(dialog).getByLabelText(/Assignee/).disabled, true);
  assert.equal(within(dialog).getByRole("button", { name: /^Create Thing$/ }).disabled, true);
  assert.equal(within(dialog).queryByRole("button", { name: /Retry assignees/ }), null);
  assert.equal(calls("/api/code-activity/drafts/confirm").length, 0);
});

test("retrying failed assignee loading preserves the draft and restores real eligible choices", async () => {
  connectedWorld();
  world.candidatesReply = () => ({ status: 502, body: { error: "source_unavailable" } });
  mount();
  fireEvent.click((await screen.findByText("Responsive nav")).closest("button"));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(await within(dialog).findByRole("button", { name: /Create a Thing from this change/ }));
  await within(dialog).findByText(/List assignees could not be loaded/);
  fireEvent.change(within(dialog).getByLabelText(/Title/), { target: { value: "Keep my edited title" } });
  fireEvent.change(within(dialog).getByLabelText(/Description/), { target: { value: "Keep my notes" } });
  world.candidatesReply = null;
  fireEvent.click(within(dialog).getByRole("button", { name: /Retry assignees/ }));
  await within(dialog).findByRole("option", { name: /Chen/ });
  assert.equal(within(dialog).getByLabelText(/Title/).value, "Keep my edited title");
  assert.equal(within(dialog).getByLabelText(/Description/).value, "Keep my notes");
  assert.equal(within(dialog).getByLabelText(/Assignee/).value, "");
  fireEvent.change(within(dialog).getByLabelText(/Assignee/), { target: { value: ACTOR_C } });
  assert.equal(within(dialog).getByRole("button", { name: /^Create Thing$/ }).disabled, false);
  assert.equal(calls("/api/code-activity/drafts/confirm").length, 0);
});

test("loading and no eligible assignees are distinct, and neither permits creation", async () => {
  connectedWorld();
  let release;
  world.candidatesReply = () => new Promise(resolve => { release = resolve; });
  mount();
  fireEvent.click((await screen.findByText("Responsive nav")).closest("button"));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(await within(dialog).findByRole("button", { name: /Create a Thing from this change/ }));
  await within(dialog).findByRole("option", { name: /Loading List assignees/ });
  assert.equal(within(dialog).getByLabelText(/Assignee/).disabled, true);
  release({ status: 200, body: { candidates: [] } });
  await within(dialog).findByText(/No eligible List assignees were returned/);
  assert.equal(within(dialog).getByRole("button", { name: /^Create Thing$/ }).disabled, true);
  assert.equal(calls("/api/code-activity/drafts/confirm").length, 0);
});

test("a lost reply is retried with the SAME key; a changed revision needs a knowing second confirmation", async () => {
  connectedWorld();
  world.confirm = { status: 502, body: { error: "source_unavailable" } };
  mount();
  fireEvent.click((await screen.findByText("Responsive nav")).closest("button"));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(await within(dialog).findByRole("button", { name: /Create a Thing from this change/ }));
  fireEvent.change(await within(dialog).findByLabelText(/Assignee/), { target: { value: ACTOR_C } });
  fireEvent.click(within(dialog).getByRole("button", { name: /^Create Thing$/ }));
  await within(dialog).findByText(/did not get a reply/);
  world.confirm = { status: 200, body: { thingId: "70000000-0000-0000-0000-000000000001", replayed: true } };
  fireEvent.click(within(dialog).getByRole("button", { name: /Check again/ }));
  assert.ok((await within(dialog).findAllByText(/already succeeded/)).length >= 1);
  const [first, second] = calls("/api/code-activity/drafts/confirm");
  assert.equal(first.body.key, second.body.key, "the retry cannot create a second Thing");

  cleanup();
  requests.length = 0;
  connectedWorld();
  world.confirm = { status: 409, body: { error: "source_changed" } };
  mount();
  fireEvent.click((await screen.findByText("Responsive nav")).closest("button"));
  const d2 = await screen.findByRole("dialog");
  fireEvent.click(await within(d2).findByRole("button", { name: /Create a Thing from this change/ }));
  fireEvent.change(await within(d2).findByLabelText(/Assignee/), { target: { value: ACTOR_C } });
  fireEvent.click(within(d2).getByRole("button", { name: /^Create Thing$/ }));
  await within(d2).findByText(/changed/);
  world.confirm = { status: 200, body: { thingId: "70000000-0000-0000-0000-000000000002", replayed: false } };
  fireEvent.click(within(d2).getByRole("button", { name: /Confirm again/ }));
  await within(d2).findByText(/was created/);
  const [a, b] = calls("/api/code-activity/drafts/confirm");
  assert.deepEqual([a.body.acknowledgeSourceChange, b.body.acknowledgeSourceChange, a.body.key === b.body.key], [false, true, true]);
});

test("Coey on: drafting needs consent, an explicit click, and the person's confirmation; the owner can grant consent", async () => {
  connectedWorld();
  world.caps.ai = { available: true, consent: false };
  mount();
  fireEvent.click((await screen.findByText("Responsive nav")).closest("button"));
  const dialog = await screen.findByRole("dialog");
  const draft = await within(dialog).findByRole("button", { name: /Draft with Coey/ });
  assert.equal(draft.disabled, true, "off until the owner consents");
  assert.match(dialog.textContent, /does not turn this on/);
  assert.equal(calls("/api/code-activity/changes/draft").length, 0, "no AI call without a click");
  fireEvent.click(within(dialog).getByRole("button", { name: /Open consent settings/ }));
  await waitFor(() => assert.equal(screen.queryByText("Responsive nav", { selector: "h2" }), null));
  const manage = await screen.findByRole("dialog", { name: /Manage Code Activity/ });
  fireEvent.click(within(manage).getByRole("switch"));
  await waitFor(() => assert.equal(calls("/api/code-activity/consent").length, 1));
  assert.deepEqual(calls("/api/code-activity/consent")[0].body, { listId: LIST, enabled: true });
  await waitFor(() => assert.equal(within(manage).getByRole("switch").getAttribute("aria-checked"), "true"));
  fireEvent.keyDown(manage, { key: "Escape" });
  await waitFor(() => assert.equal(screen.queryByRole("dialog"), null));

  fireEvent.click((await screen.findByText("Responsive nav")).closest("button"));
  const d2 = await screen.findByRole("dialog");
  const enabled = await within(d2).findByRole("button", { name: /Draft with Coey/ });
  await waitFor(() => assert.equal(enabled.disabled, false));
  fireEvent.click(enabled);
  fireEvent.click(await within(d2).findByRole("button", { name: /Generate draft/ }));
  await within(d2).findByDisplayValue("Verify nav");
  assert.equal(calls("/api/code-activity/drafts/confirm").length, 0, "nothing is created by drafting");
  fireEvent.change(within(d2).getByLabelText(/Assignee/), { target: { value: ACTOR_O } });
  fireEvent.click(within(d2).getByRole("button", { name: /^Create Thing$/ }));
  await within(d2).findByText(/was created/);
  assert.equal(calls("/api/code-activity/drafts/confirm")[0].body.aiGenerated, true);
});

test("a failed model reply is shown as such and creates nothing", async () => {
  connectedWorld();
  world.caps.ai = { available: true, consent: true };
  world.draft = { status: 502, body: { error: "invalid_output" } };
  mount();
  fireEvent.click((await screen.findByText("Responsive nav")).closest("button"));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(await within(dialog).findByRole("button", { name: /Draft with Coey/ }));
  fireEvent.click(await within(dialog).findByRole("button", { name: /Generate draft/ }));
  await within(dialog).findByText(/could not be used/);
  assert.equal(calls("/api/code-activity/drafts/confirm").length, 0);
});

test("containment: a chunk that fails to load, or a render that throws, stays inside the tab", async () => {
  const consoleError = console.error;
  console.error = () => undefined; // React logs boundary-caught errors
  try {
    const Broken = lazy(() => Promise.reject(new Error("Loading chunk failed")));
    render(h("div", null, h("button", null, "Things tab still here"), h(CodeActivityBoundary, { resetKey: LIST }, h(Suspense, { fallback: h("p", null, "Loading") }, h(Broken)))));
    await screen.findByRole("alert");
    assert.match(screen.getByRole("alert").textContent, /Things, Chat, and Members still work/);
    assert.ok(screen.getByRole("button", { name: "Things tab still here" }));
    cleanup();
    const Boom = () => { throw new Error("render failure"); };
    render(h("div", null, h("button", null, "Chat still here"), h(CodeActivityBoundary, { resetKey: LIST }, h(Boom))));
    await screen.findByRole("alert");
    assert.ok(screen.getByRole("button", { name: "Chat still here" }));
  } finally {
    console.error = consoleError;
  }
});

test("connection flow states from the server: owner connect screen, member message, revoked, and disconnect", async () => {
  world = fresh();
  world.connection = { status: "none", repositoryFullName: null, lastSyncedAt: null, syncStatus: null };
  mount();
  await screen.findByText("Use your GitHub account to choose a repository for this List.");
  assert.equal(button(/Connect GitHub/).disabled, false);
  cleanup();
  mount("collaborator");
  await screen.findByText(/Only the List owner can connect GitHub\./);
  assert.equal(screen.queryByRole("button", { name: /Connect GitHub/ }), null);
  cleanup();
  world.connection = { status: "revoked", repositoryFullName: "acme/web", lastSyncedAt: null, syncStatus: null };
  mount();
  await screen.findByText("GitHub access needs verification.");
  assert.equal(calls("/api/code-activity/feed").length, 0, "no activity is requested for a revoked connection");
  cleanup();
  connectedWorld();
  mount();
  await screen.findByText("Responsive nav");
  fireEvent.click(button(/Manage/));
  const manage = await screen.findByRole("dialog", { name: /Manage Code Activity/ });
  assert.equal(within(manage).queryByRole("switch"), null, "no consent control while Coey is off");
  fireEvent.click(within(manage).getByRole("button", { name: /Disconnect repository/ }));
  fireEvent.click(await screen.findByRole("button", { name: /^Disconnect$/ }));
  await waitFor(() => assert.equal(calls("/api/code-activity/connection").filter((r) => r.method === "DELETE").length, 1));
  assert.deepEqual(calls("/api/code-activity/connection").find((r) => r.method === "DELETE").body, { listId: LIST, confirm: true });
});

test("regression (fail closed): a connection that needs re-verification shows an explanation and NO activity, and the owner can reset it", async () => {
  world = fresh();
  world.connection = { status: "suspended", repositoryFullName: "acme/web", lastSyncedAt: "2026-10-07T11:00:00Z", syncStatus: "stale", needsReverification: true };
  world.feed = [row(CHANGE, "SECRET PRIVATE TITLE")];
  mount("view_only");
  await screen.findByText(/GitHub access needs to be verified again/);
  assert.match(screen.getByText(/Ask the List Owner to reconnect it/).textContent, /Owner/);
  assert.equal(screen.queryByText("SECRET PRIVATE TITLE"), null);
  assert.equal(calls("/api/code-activity/feed").length, 0, "the feed is not even requested");
  assert.equal(screen.queryByRole("button", { name: /Disconnect/ }), null, "members cannot reset it");
  cleanup();
  requests.length = 0;
  mount("owner");
  await screen.findByText(/GitHub access needs to be verified again/);
  assert.equal(calls("/api/code-activity/feed").length, 0);
  fireEvent.click(screen.getByRole("button", { name: /Disconnect so I can reconnect/ }));
  await waitFor(() => assert.equal(calls("/api/code-activity/connection").filter((r) => r.method === "DELETE").length, 1));
  assert.deepEqual(calls("/api/code-activity/connection").find((r) => r.method === "DELETE").body, { listId: LIST, confirm: true });
});
