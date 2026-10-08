import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { mock, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChangeInspector } from "../src/features/code-activity/ChangeInspector.tsx";
import { ConnectedPanel, NoRepositoriesPanel, RepositorySelection, UnconnectedPanel } from "../src/features/code-activity/ConnectionPanels.tsx";
import { mergeRepositoryPages, parseCapabilities, parseConnection, parseRepositories, parseReturnOutcome } from "../src/features/code-activity/live/parse.ts";

const LIST = "10000000-0000-0000-0000-000000000001";
const requests = [];
let reply = () => new Response("{}", { status: 200 });
mock.module(new URL("../src/lib/authed-fetch.ts", import.meta.url).href, {
  namedExports: {
    authedFetch: async (url, init) => {
      requests.push({ url, init });
      return reply(url, init);
    },
  },
});
const { codeActivityApi } = await import("../src/features/code-activity/live/api.ts");
const { default: CodeActivityRoot } = await import("../src/features/code-activity/CodeActivityRoot.tsx");
const jsonReply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("parsers accept only the documented shapes", () => {
  const off = { available: false, consent: false };
  assert.deepEqual(parseCapabilities({ enabled: true, configured: true }), { enabled: true, configured: true, ai: off });
  assert.deepEqual(parseCapabilities({ enabled: true, configured: true, ai: { available: true, consent: true } }).ai, { available: true, consent: true });
  assert.deepEqual(parseCapabilities({ enabled: false, ai: { available: true, consent: true } }).ai, off, "AI never shows through a disabled feature");
  assert.deepEqual(parseCapabilities({ enabled: true }), { enabled: true, configured: false, ai: off });
  assert.deepEqual(parseCapabilities({ enabled: false, configured: true }), { enabled: false, configured: false, ai: off }, "configured never leaks past disabled");
  for (const bad of [null, [], {}, { enabled: "yes" }]) assert.equal(parseCapabilities(bad), null);
  assert.equal(parseConnection({ status: "wat" }), null);
  assert.equal(parseConnection({ status: "none" }).repositoryFullName, null);
  assert.equal(parseConnection({ status: "suspended", needsReverification: true }).needsReverification, true);
  assert.equal(parseConnection({ status: "suspended", needsReverification: "yes" }).needsReverification, false, "only a real boolean counts");
  assert.equal(parseConnection({ status: "revoked", repositoryFullName: "a/b" }).repositoryFullName, "a/b");
  assert.equal(parseRepositories({ items: [{ proofId: "p", fullName: "a/b", visibility: "secret" }] }), null);
  assert.equal(parseRepositories({ items: [{ proofId: "p", fullName: "a/b", visibility: "private" }], nextCursor: "a/b" }).nextCursor, "a/b");
  assert.equal(parseReturnOutcome("?codeActivity=select"), "select");
  assert.equal(parseReturnOutcome("?codeActivity=<script>"), null);
  assert.equal(parseReturnOutcome(""), null);
});

test("api: calls the documented routes with the List id, never sends a nonce, and only navigates to github.com", async () => {
  requests.length = 0;
  reply = (url) => (String(url).includes("/capabilities") ? jsonReply({ enabled: true, configured: true }) : jsonReply({ url: "https://github.com/login/oauth/authorize?x=1" }));
  assert.deepEqual((await codeActivityApi.capabilities(LIST)).data, { enabled: true, configured: true, ai: { available: false, consent: false } });
  assert.equal(requests[0].url, `/api/code-activity/capabilities?listId=${LIST}`);
  const start = await codeActivityApi.start(LIST, "oauth");
  assert.equal(start.ok, true);
  assert.deepEqual(JSON.parse(requests[1].init.body), { listId: LIST, flow: "oauth" });
  for (const hostile of ["https://evil.example/x", "https://github.com.evil.example/x", "javascript:alert(1)", "not a url"]) {
    reply = () => jsonReply({ url: hostile });
    assert.equal((await codeActivityApi.start(LIST, "oauth")).ok, false, hostile);
  }
  reply = () => jsonReply({ connected: true });
  await codeActivityApi.connect(LIST, "proof-1");
  const sent = requests.at(-1);
  assert.equal(sent.init.method, "POST");
  assert.deepEqual(JSON.parse(sent.init.body), { listId: LIST, proofId: "proof-1", sharingAcknowledged: true });
  assert.ok(!/nonce|hash|installation|repository_id/i.test(sent.init.body), "no binding or provider ids from the browser");
  reply = () => jsonReply({ disconnected: true });
  assert.equal((await codeActivityApi.disconnect(LIST)).ok, true);
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { listId: LIST, confirm: true });
});

test("api: server errors keep only the neutral code; transport and malformed replies become source_unavailable", async () => {
  reply = () => jsonReply({ error: "rate_limited", message: "x" }, 429);
  assert.deepEqual(await codeActivityApi.connection(LIST), { ok: false, status: 429, code: "rate_limited" });
  reply = () => new Response("<html>", { status: 502 });
  assert.equal((await codeActivityApi.connection(LIST)).code, "source_unavailable");
  reply = () => jsonReply({ status: "nonsense" });
  assert.equal((await codeActivityApi.connection(LIST)).ok, false);
  reply = () => {
    throw new Error("network down");
  };
  assert.deepEqual(await codeActivityApi.connection(LIST), { ok: false, status: 0, code: "source_unavailable" });
});

test("the runtime tab starts in a neutral loading state and shows no repository, activity, or connected claim", () => {
  const html = renderToStaticMarkup(createElement(CodeActivityRoot, { listId: LIST, listName: "Website", listRole: "owner" }));
  assert.match(html, /Checking GitHub connection/);
  for (const forbidden of [/Connected/, /example-org/, /sample/i, /Preview/, /pull request #/i, /Last synced/]) assert.doesNotMatch(html, forbidden);
});

test("panels are honest: a pending connection shows nothing made up, members cannot manage, empty selection offers install", () => {
  const owner = renderToStaticMarkup(createElement(ConnectedPanel, { repository: "acme/web", status: "active", isOwner: true, onManage() {} }));
  assert.match(owner, /acme\/web/);
  assert.match(owner, /being set up/);
  assert.doesNotMatch(owner, /pull request|Last synced/i);
  assert.match(owner, /Manage/);
  const member = renderToStaticMarkup(createElement(ConnectedPanel, { repository: "acme/web", status: "active", isOwner: false, onManage() {} }));
  assert.doesNotMatch(member, /Manage/);
  assert.match(renderToStaticMarkup(createElement(ConnectedPanel, { repository: "acme/web", status: "suspended", isOwner: true, onManage() {} })), /suspended/);
  const empty = renderToStaticMarkup(createElement(NoRepositoriesPanel, { busy: false, onInstall() {}, onRetry() {}, onCancel() {} }));
  assert.match(empty, /Install or manage GitHub access/);
  const member2 = renderToStaticMarkup(createElement(UnconnectedPanel, { isOwner: false, variant: "unconnected", onConnect() {} }));
  assert.doesNotMatch(member2, /<button/);
  const selection = renderToStaticMarkup(
    createElement(RepositorySelection, { repositories: [{ id: "p1", fullName: "acme/web", visibility: "private", updatedLabel: "updated 1 hour ago" }], onCancel() {}, onConnect() {}, error: "Nope" }),
  );
  assert.match(selection, /every member of this List/);
  assert.match(selection, /aria-disabled="true"/);
  assert.doesNotMatch(selection, /sample|Preview/i);
});

test("live folder: network access is confined to api.ts and the folder has no raw HTML, eval, or fixture imports", () => {
  const dir = new URL("../src/features/code-activity/live/", import.meta.url).pathname;
  for (const file of readdirSync(dir)) {
    const text = readFileSync(dir + file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(text, /dangerouslySetInnerHTML|\.innerHTML\b|\beval\s*\(|new Function\s*\(/, file);
    assert.doesNotMatch(text, /fixtures|preview-adapter/, file);
    assert.doesNotMatch(text, /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/, `${file} must go through authedFetch`);
    assert.doesNotMatch(text, /localStorage|sessionStorage|document\.cookie/, `${file} must not persist or read cookies`);
  }
  assert.match(readFileSync(dir + "api.ts", "utf8"), /authedFetch/);
});

test("regression: repository pages beyond the first can be requested, merged without duplicates, and offered in the UI", async () => {
  requests.length = 0;
  reply = () => jsonReply({ items: [{ proofId: "p51", fullName: "acme/r51", visibility: "private" }], nextCursor: null });
  const page = await codeActivityApi.repositories(LIST, undefined, "acme/r50 & more");
  assert.equal(requests[0].url, `/api/code-activity/github/repositories?listId=${LIST}&cursor=${encodeURIComponent("acme/r50 & more")}`);
  assert.equal(page.data.items[0].proofId, "p51");
  const first = Array.from({ length: 50 }, (_, i) => ({ proofId: `p${i}`, fullName: `acme/r${i}`, visibility: "private", updatedAt: null }));
  const merged = mergeRepositoryPages(first, [...page.data.items, first[3]]);
  assert.equal(merged.length, 51, "a repeated row is not duplicated");
  assert.equal(merged[50].proofId, "p51");
  const render = (props) => renderToStaticMarkup(createElement(RepositorySelection, { repositories: [{ id: "p1", fullName: "acme/web", visibility: "private", updatedLabel: "x" }], onCancel() {}, onConnect() {}, ...props }));
  assert.match(render({ hasMore: true, onLoadMore() {} }), /Load more repositories/);
  assert.doesNotMatch(render({ hasMore: false }), /Load more repositories/);
  assert.match(render({ hasMore: true, loadingMore: true }), /disabled=""[^>]*>Loading…/);
  assert.equal(parseReturnOutcome("?codeActivity=timed_out"), "timed_out");
});

const detail = {
  id: "c1", kind: "pull_request", title: "Real title", number: 7, prState: "open", author: { name: "ana", kind: "user" }, headBranch: "feat", baseBranch: "main",
  headSha: "a".repeat(40), updatedAt: "2026-10-07T11:00:00Z", additions: 2, deletions: 1, changedFiles: 1, sourceUrl: "https://github.com/acme/web/pull/7", commitUrl: null,
  description: "Body <b>from</b> GitHub", checkState: "failing", checksRevision: "a".repeat(40), checksStale: false,
  checks: [{ id: "1", name: "build", status: "completed", conclusion: "failure", durationLabel: "1m 12s", url: null }], checksPartial: false,
  files: [{ path: "src/a.ts", status: "modified", additions: 2, deletions: 1, patchState: "available", patch: "@@ -1 +1,2 @@\n-a\n+<img src=x onerror=alert(1)>" }], filesPartial: false, gap: null,
};

test("the live inspector shows real detail as text and hides every AI action until Coey is released", async () => {
  const { liveAdapter } = await import("../src/features/code-activity/live/adapter.ts");
  const render = (props) => renderToStaticMarkup(createElement(ChangeInspector, { change: detail, role: "owner", consent: false, listName: "Web", adapter: liveAdapter, candidates: [], now: Date.parse("2026-10-07T12:00:00Z"), onBack() {}, onOpenConsentSettings() {}, ...props }));
  const live = render({ aiEnabled: false });
  assert.match(live, /Real title/);
  assert.match(live, /build/);
  for (const forbidden of [/Draft with Coey/, /Summarize change/, /consent/i, /View Only members can read/]) assert.doesNotMatch(live, forbidden);
  assert.doesNotMatch(live, /<img src=x/, "patch markup never becomes elements");
  assert.match(render({}), /Draft with Coey/, "the preview-era default is unchanged for later gates");
  const adapter = liveAdapter;
  assert.deepEqual(await adapter.generateDraft({ change: detail, note: "" }), { ok: false, reason: "unavailable" });
  assert.deepEqual(await adapter.confirmDraft({ key: "k", draft: {} }), { ok: false, reason: "not_allowed" });
});

test("the connected view starts in a neutral loading state and never claims activity it has not read", async () => {
  const { ActivityView } = await import("../src/features/code-activity/ActivityView.tsx");
  const html = renderToStaticMarkup(createElement(ActivityView, { listId: LIST, listName: "Web", role: "owner", suspended: false, onManage() {} }));
  assert.match(html, /Loading activity/);
  assert.match(html, /Refresh/);
  for (const forbidden of [/example-org/, /sample/i, /Preview/, /pull request #/i]) assert.doesNotMatch(html, forbidden);
  const viewOnly = renderToStaticMarkup(createElement(ActivityView, { listId: LIST, listName: "Web", role: "view_only", suspended: false, onManage() {} }));
  assert.doesNotMatch(viewOnly, /Refresh|Manage/, "View Only can read but not refresh or manage");
  const collaborator = renderToStaticMarkup(createElement(ActivityView, { listId: LIST, listName: "Web", role: "collaborator", suspended: false, onManage() {} }));
  assert.match(collaborator, /Refresh/);
  assert.doesNotMatch(collaborator, /Manage/);
});

test("the live adapter: due dates are the person's own calendar day, failures keep their meaning, and a lost reply stays 'no reply'", async () => {
  const { createLiveAdapter, dueDateToInstant } = await import("../src/features/code-activity/live/adapter.ts");
  assert.equal(dueDateToInstant(null), null);
  assert.equal(dueDateToInstant("nonsense"), null);
  assert.equal(new Date(dueDateToInstant("2026-10-20")).getDate(), 20, "local midnight: never shifted to the day before");
  const adapter = createLiveAdapter(LIST);
  const draftBody = { evidence: { changeId: "c1", headSha: "a".repeat(40) }, title: "T", description: "  ", assigneeActorId: "act", dueDate: null, ownerImportance: "now", aiGenerated: false, acknowledgeSourceChange: false };
  requests.length = 0;
  reply = () => jsonReply({ thingId: "t1", replayed: false });
  assert.deepEqual(await adapter.confirmDraft({ key: "k1", draft: draftBody }), { ok: true, thingId: "t1", replayed: false });
  assert.deepEqual(JSON.parse(requests[0].init.body), { listId: LIST, changeId: "c1", key: "k1", title: "T", notes: null, assigneeActorId: "act", dueAt: null, importance: "now", headSha: "a".repeat(40), acknowledgeSourceChange: false, aiGenerated: false });
  for (const [status, code, reason] of [[409, "source_changed", "source_changed"], [409, "conflict", "conflict"], [403, "not_allowed", "not_allowed"], [400, "invalid_request", "invalid"], [502, "source_unavailable", "no_response"], [504, "timed_out", "no_response"]]) {
    reply = () => jsonReply({ error: code }, status);
    assert.deepEqual(await adapter.confirmDraft({ key: "k1", draft: draftBody }), { ok: false, reason }, code);
  }
  reply = () => { throw new Error("network down"); };
  assert.deepEqual(await adapter.confirmDraft({ key: "k1", draft: draftBody }), { ok: false, reason: "no_response" }, "a reply that never arrived may have created the Thing");
  const change = { id: "c1" };
  for (const [code, reason] of [["timed_out", "timeout"], ["invalid_output", "invalid_output"], ["consent_withdrawn", "consent_withdrawn"], ["source_unavailable", "unavailable"], ["not_allowed", "unavailable"]]) {
    reply = () => jsonReply({ error: code }, 502);
    assert.deepEqual(await adapter.generateDraft({ change, note: "" }), { ok: false, reason }, code);
  }
  reply = () => jsonReply({ title: "Check", description: "Why" });
  assert.deepEqual(await adapter.generateDraft({ change, note: "n" }), { ok: true, fields: { title: "Check", description: "Why" } });
  reply = () => jsonReply({ summary: "S", partial: true });
  assert.deepEqual(await adapter.summarizeChange({ change }), { ok: true, text: "S", partial: true });
  reply = () => jsonReply({ candidates: [{ actorId: "a", name: "Ana", role: "owner", isSelf: true }, { actorId: "b", name: "Bo", role: "collaborator", isSelf: false }] });
  assert.equal((await adapter.loadAssigneeCandidates()).length, 2);
  reply = () => jsonReply({ error: "not_allowed" }, 403);
  assert.deepEqual(await adapter.loadAssigneeCandidates(), []);
});
