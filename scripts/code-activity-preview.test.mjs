import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { aiActionState, capabilitiesFor } from "../src/features/code-activity/access.ts";
import { resolveCodeActivityPreview } from "../src/features/code-activity/preview-gate.ts";
import { createPreviewAdapter, defaultScenario } from "./fixtures/code-activity/preview-adapter.ts";
import { parseActivityFeed } from "../src/features/code-activity/types.ts";

const FEATURE_DIR = new URL("../src/features/code-activity/", import.meta.url).pathname;

function makeAdapter(patch = {}, role = "owner") {
  let scenario = { ...defaultScenario(role), ...patch };
  const adapter = createPreviewAdapter({ getScenario: () => scenario, delayMs: 0, now: () => Date.parse("2026-10-07T12:00:00Z") });
  return { adapter, set: (p) => (scenario = { ...scenario, ...p }) };
}

async function firstChange(adapter) {
  const feed = await adapter.loadFeed();
  return feed.changes.find((c) => c.id === "pr-128");
}

const draftFor = (change, assignee, extra = {}) => ({
  title: "Verify navigation",
  description: "Check the menu.",
  assigneeActorId: assignee,
  dueDate: null,
  ownerImportance: "next",
  evidence: { changeId: change.id, headSha: change.headSha, number: change.number, title: change.title, sourceUrl: change.sourceUrl },
  aiGenerated: true,
  acknowledgeSourceChange: false,
  ...extra,
});

// ---- isolation: no network --------------------------------------------------

test("the preview adapter makes no network request of any kind", async () => {
  const trap = (name) => () => {
    throw new Error(`${name} must not be used in preview`);
  };
  const saved = { fetch: globalThis.fetch, xhr: globalThis.XMLHttpRequest, ws: globalThis.WebSocket, es: globalThis.EventSource };
  globalThis.fetch = trap("fetch");
  globalThis.XMLHttpRequest = trap("XMLHttpRequest");
  globalThis.WebSocket = trap("WebSocket");
  globalThis.EventSource = trap("EventSource");
  try {
    const { adapter } = makeAdapter();
    const change = await firstChange(adapter);
    const people = await adapter.loadAssigneeCandidates();
    await adapter.generateDraft({ change, note: "x" });
    await adapter.summarizeChange({ change });
    await adapter.confirmDraft({ key: "k1", draft: draftFor(change, people[0].actorId) });
  } finally {
    globalThis.fetch = saved.fetch;
    globalThis.XMLHttpRequest = saved.xhr;
    globalThis.WebSocket = saved.ws;
    globalThis.EventSource = saved.es;
  }
});

test("no feature source file can reach the network, a database, or markup injection", () => {
  const forbidden = [
    [/\bfetch\s*\(/, "fetch("],
    [/XMLHttpRequest/, "XMLHttpRequest"],
    [/\bWebSocket\b/, "WebSocket"],
    [/\bEventSource\b/, "EventSource"],
    [/sendBeacon/, "sendBeacon"],
    [/@supabase|supabase\./i, "supabase"],
    [/dangerouslySetInnerHTML|\.innerHTML\b|insertAdjacentHTML/, "raw HTML injection"],
    [/\beval\s*\(|new Function\s*\(/, "dynamic code execution"],
  ];
  const files = readdirSync(FEATURE_DIR).filter((f) => /\.(ts|tsx)$/.test(f));
  assert.ok(files.length >= 14, "expected the feature files to be present");
  for (const file of files) {
    const text = readFileSync(join(FEATURE_DIR, file), "utf8");
    for (const [pattern, label] of forbidden) {
      // Comments may name these things in order to forbid them.
      const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      assert.doesNotMatch(code, pattern, `${file} must not use ${label}`);
    }
  }
});

// ---- the gate ---------------------------------------------------------------

test("normal dev enables the preview without changing sessions; production always disables it", () => {
  assert.equal(resolveCodeActivityPreview({ development: true, flag: "true" }), true);
  assert.equal(resolveCodeActivityPreview({ development: true, flag: undefined }), true);
  assert.equal(resolveCodeActivityPreview({ development: false, flag: "true" }), false);
  assert.equal(resolveCodeActivityPreview({ development: false, flag: undefined }), false);
  const hook = readFileSync(new URL("../src/features/code-activity/use-code-activity-enabled.ts", import.meta.url), "utf8");
  assert.match(hook, /development: import\.meta\.env\.DEV/);
  assert.doesNotMatch(hook, /isPreviewMode|session-mode/);
  for (const flag of ["false", "", "TRUE", "1", "yes", " true", "true "]) {
    assert.equal(resolveCodeActivityPreview({ development: true, flag }), false, `flag ${JSON.stringify(flag)}`);
  }
});

test("the List route loads the feature lazily and gates the tab", () => {
  const route = readFileSync(new URL("../src/routes/lists.$listId.tsx", import.meta.url), "utf8");
  assert.match(route, /lazy\(\(\) => import\("@\/features\/code-activity\/CodeActivityRoot"\)\)/);
  assert.doesNotMatch(route, /^import .*CodeActivityRoot/m, "no static import of the feature root");
  assert.match(route, /codeActivityEnabled \? \(\[\["code", "Code Activity"\]\]/);
  assert.match(route, /tab === "code" && codeActivityEnabled/);
  assert.match(route, /useState<TabType>\("things"\)/, "Things stays the default tab");
  for (const kept of ['["things", "Things"]', '["chat", "Chat"]', '["members", "Members & Permissions"]']) {
    assert.ok(route.includes(kept), `existing tab ${kept} must remain`);
  }
  assert.match(readFileSync(new URL("../.env.example", import.meta.url), "utf8"), /VITE_CODE_ACTIVITY_PREVIEW=false/);
});

// ---- access and consent -----------------------------------------------------

test("roles map to the documented capabilities", () => {
  const owner = capabilitiesFor("owner");
  const collab = capabilitiesFor("collaborator");
  const view = capabilitiesFor("view_only");
  assert.deepEqual([owner.canManageConnection, owner.canChangeConsent, owner.canCreateThings, owner.showAiActions], [true, true, true, true]);
  assert.deepEqual([collab.canManageConnection, collab.canChangeConsent, collab.canCreateThings, collab.showAiActions], [false, false, true, true]);
  assert.deepEqual([view.canRead, view.canManageConnection, view.canChangeConsent, view.canCreateThings, view.showAiActions], [true, false, false, false, false]);
});

test("drafting actions: hidden for View Only, disabled with a reason when consent is off", () => {
  assert.deepEqual(aiActionState("view_only", true), { visible: false });
  assert.deepEqual(aiActionState("view_only", false), { visible: false });
  assert.deepEqual(aiActionState("owner", true), { visible: true, enabled: true });
  const owner = aiActionState("owner", false);
  assert.equal(owner.enabled, false);
  assert.equal(owner.reason, "consent_off_owner");
  assert.match(owner.message, /does not turn this on/);
  const collab = aiActionState("collaborator", false);
  assert.equal(collab.reason, "consent_off_member");
  assert.match(collab.message, /Ask the List Owner to enable/);
});

// ---- generation -------------------------------------------------------------

test("generation succeeds, and each failure is a local result, never a throw", async () => {
  const { adapter, set } = makeAdapter();
  const change = await firstChange(adapter);
  const ok = await adapter.generateDraft({ change, note: "check narrow screens" });
  assert.equal(ok.ok, true);
  assert.match(ok.fields.description, /check narrow screens/);
  for (const [generation, reason] of [["timeout", "timeout"], ["invalid_output", "invalid_output"], ["unavailable", "unavailable"]]) {
    set({ generation });
    assert.deepEqual(await adapter.generateDraft({ change, note: "" }), { ok: false, reason });
  }
});

test("generation is refused when consent is off, regardless of who asks", async () => {
  const { adapter } = makeAdapter({ consent: false });
  const change = await firstChange(adapter);
  assert.deepEqual(await adapter.generateDraft({ change, note: "" }), { ok: false, reason: "consent_withdrawn" });
  assert.deepEqual(await adapter.summarizeChange({ change }), { ok: false, reason: "consent_withdrawn" });
});

test("generation honors cancellation", async () => {
  const controller = new AbortController();
  const adapter = createPreviewAdapter({ getScenario: () => defaultScenario("owner"), delayMs: 50 });
  const feed = await adapter.loadFeed();
  const pending = adapter.generateDraft({ change: feed.changes[0], note: "" }, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});

test("a generated draft never fills in an assignee or a date", async () => {
  const { adapter } = makeAdapter();
  const change = await firstChange(adapter);
  const out = await adapter.generateDraft({ change, note: "by Friday" });
  assert.deepEqual(Object.keys(out.fields).sort(), ["description", "title"]);
});

// ---- feed -------------------------------------------------------------------

test("the feed loads valid data and reflects the sync scenario; a failing feed rejects locally", async () => {
  const { adapter, set } = makeAdapter({ sync: "stale" });
  const feed = await adapter.loadFeed();
  assert.equal(parseActivityFeed(feed).ok, true);
  assert.equal(feed.freshness.syncStatus, "stale");
  set({ feed: "empty" });
  assert.equal((await adapter.loadFeed()).changes.length, 0);
  set({ feed: "error" });
  await assert.rejects(adapter.loadFeed(), /could not be loaded/);
});

// ---- confirmation -----------------------------------------------------------

test("a confirmed draft succeeds once and is labeled as a preview id", async () => {
  const { adapter } = makeAdapter();
  const change = await firstChange(adapter);
  const [first] = await adapter.loadAssigneeCandidates();
  const out = await adapter.confirmDraft({ key: "k-1", draft: draftFor(change, first.actorId) });
  assert.equal(out.ok, true);
  assert.equal(out.replayed, false);
  assert.match(out.thingId, /^preview-thing-/);
});

test("retrying with the same key returns the original result and never a second one", async () => {
  const { adapter } = makeAdapter();
  const change = await firstChange(adapter);
  const [first] = await adapter.loadAssigneeCandidates();
  const draft = draftFor(change, first.actorId);
  const a = await adapter.confirmDraft({ key: "k-2", draft });
  const b = await adapter.confirmDraft({ key: "k-2", draft });
  const c = await adapter.confirmDraft({ key: "k-2", draft });
  assert.equal(b.thingId, a.thingId);
  assert.equal(c.thingId, a.thingId);
  assert.deepEqual([a.replayed, b.replayed, c.replayed], [false, true, true]);
  const other = await adapter.confirmDraft({ key: "k-3", draft });
  assert.notEqual(other.thingId, a.thingId, "a new key is a new request");
});

test("a lost reply is recovered by retrying: one Thing, found on retry", async () => {
  const { adapter } = makeAdapter({ confirm: "lost_response" });
  const change = await firstChange(adapter);
  const [first] = await adapter.loadAssigneeCandidates();
  const draft = draftFor(change, first.actorId);
  assert.deepEqual(await adapter.confirmDraft({ key: "k-4", draft }), { ok: false, reason: "no_response" });
  const retry = await adapter.confirmDraft({ key: "k-4", draft });
  assert.equal(retry.ok, true);
  assert.equal(retry.replayed, true, "the earlier attempt already succeeded");
});

test("the same key with a different payload is a conflict", async () => {
  const { adapter } = makeAdapter();
  const change = await firstChange(adapter);
  const [first, second] = await adapter.loadAssigneeCandidates();
  await adapter.confirmDraft({ key: "k-5", draft: draftFor(change, first.actorId) });
  assert.deepEqual(await adapter.confirmDraft({ key: "k-5", draft: draftFor(change, second.actorId) }), { ok: false, reason: "conflict" });
});

test("a successful retry is never blocked by later changes to the scenario", async () => {
  const { adapter, set } = makeAdapter();
  const change = await firstChange(adapter);
  const [first] = await adapter.loadAssigneeCandidates();
  const draft = draftFor(change, first.actorId);
  const a = await adapter.confirmDraft({ key: "k-6", draft });
  set({ connection: "disconnected", consent: false, confirm: "source_changed" });
  const retry = await adapter.confirmDraft({ key: "k-6", draft });
  assert.deepEqual(retry, { ok: true, thingId: a.thingId, replayed: true });
});

test("a NEW creation is blocked by a disconnected repository, withdrawn consent, or a View Only role", async () => {
  const { adapter, set } = makeAdapter();
  const change = await firstChange(adapter);
  const [first] = await adapter.loadAssigneeCandidates();
  set({ connection: "revoked" });
  assert.deepEqual(await adapter.confirmDraft({ key: "n-1", draft: draftFor(change, first.actorId) }), { ok: false, reason: "not_allowed" });
  set({ connection: "active", consent: false });
  assert.deepEqual(await adapter.confirmDraft({ key: "n-2", draft: draftFor(change, first.actorId) }), { ok: false, reason: "consent_withdrawn" });
  set({ consent: true, role: "view_only" });
  assert.deepEqual(await adapter.confirmDraft({ key: "n-3", draft: draftFor(change, first.actorId) }), { ok: false, reason: "not_allowed" });
});

test("a source change needs an explicit second confirmation, which is a distinct request", async () => {
  const { adapter } = makeAdapter({ confirm: "source_changed" });
  const change = await firstChange(adapter);
  const [first] = await adapter.loadAssigneeCandidates();
  assert.deepEqual(await adapter.confirmDraft({ key: "s-1", draft: draftFor(change, first.actorId) }), { ok: false, reason: "source_changed" });
  const again = await adapter.confirmDraft({ key: "s-1", draft: draftFor(change, first.actorId, { acknowledgeSourceChange: true }) });
  assert.equal(again.ok, true);
});

test("creation re-validates the assignee: none, or a View Only member, is refused", async () => {
  const { adapter } = makeAdapter();
  const change = await firstChange(adapter);
  assert.deepEqual(await adapter.confirmDraft({ key: "v-1", draft: draftFor(change, null) }), { ok: false, reason: "invalid" });
  assert.deepEqual(await adapter.confirmDraft({ key: "v-2", draft: draftFor(change, "sample-viewer") }), { ok: false, reason: "invalid" });
});
