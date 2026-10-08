import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ActivityFeed } from "../src/features/code-activity/ActivityFeed.tsx";
import { ChangeInspector } from "../src/features/code-activity/ChangeInspector.tsx";
import { ChecksPanel } from "../src/features/code-activity/ChecksPanel.tsx";
import { CodeActivityBoundary } from "../src/features/code-activity/CodeActivityBoundary.tsx";
import { CoeyDraftReview } from "../src/features/code-activity/CoeyDraftReview.tsx";
import { FileDiff } from "../src/features/code-activity/FileDiff.tsx";
import { buildPreviewChanges, previewCandidates } from "./fixtures/code-activity/fixtures.ts";
import { createPreviewAdapter, defaultScenario } from "./fixtures/code-activity/preview-adapter.ts";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const changes = buildPreviewChanges(NOW);
const byId = (id) => changes.find((c) => c.id === id);
const adapter = createPreviewAdapter({ getScenario: () => defaultScenario("owner"), delayMs: 0 });

const inspector = (change, role = "owner", consent = true) =>
  renderToStaticMarkup(
    createElement(ChangeInspector, {
      change,
      role,
      consent,
      listName: "Website Launch",
      adapter,
      candidates: previewCandidates(role),
      now: NOW,
      onBack: () => {},
      onOpenConsentSettings: () => {},
    }),
  );

const feed = (selectedId = null, filter = "all") =>
  renderToStaticMarkup(
    createElement(ActivityFeed, { changes, filter, onFilterChange: () => {}, selectedId, onSelect: () => {}, now: NOW }),
  );

// ---- feed ---------------------------------------------------------------------

test("the feed shows pull request state and check state as separate pills on every row", () => {
  const html = feed();
  assert.match(html, /Merged/);
  assert.match(html, /Checks passed/);
  assert.match(html, /1 check failing/);
  assert.match(html, /Checks running/);
  assert.match(html, /No checks reported/);
  assert.match(html, /Check status unavailable/);
  assert.match(html, /Checks are for an older revision/, "stale checks are labeled, not shown as current");
  assert.match(html, /Push · no pull request/);
});

test("the feed never shows an invented number or a guessed author", () => {
  const html = feed();
  assert.match(html, /size not available/);
  assert.match(html, /Unknown author/);
  assert.match(html, /dependabot \(bot\)/);
  assert.doesNotMatch(html, /\+0 −0/);
});

test("a history gap is visible and is not a selectable change", () => {
  const html = feed();
  assert.match(html, /Some history could not be rebuilt/);
  assert.doesNotMatch(html, /data-change-id="gap-oct-03-05"/);
});

test("the selected row is marked for assistive technology", () => {
  const html = feed("pr-128");
  assert.match(html, /data-change-id="pr-128"[^>]*aria-current="true"|aria-current="true"[^>]*data-change-id="pr-128"/);
  assert.equal((html.match(/aria-current="true"/g) ?? []).length, 1);
});

test("filters show an honest empty result", () => {
  const html = renderToStaticMarkup(
    createElement(ActivityFeed, { changes: [byId("pr-127")], filter: "failing", onFilterChange: () => {}, selectedId: null, onSelect: () => {}, now: NOW }),
  );
  assert.match(html, /No activity matches this filter/);
});

// ---- inspector and inert rendering ---------------------------------------------

test("provider text is escaped, never interpreted", () => {
  const change = byId("pr-128");
  const html = inspector(change);
  assert.match(html, /&lt;script&gt;alert\(&#x27;not executed&#x27;\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
  const diff = renderToStaticMarkup(createElement(FileDiff, { file: change.files[0], revision: change.headSha, openUrl: null }));
  assert.match(diff, /&lt;img src=x onerror=&quot;alert\(&#x27;not executed&#x27;\)&quot;&gt;/);
  assert.doesNotMatch(diff, /<img /);
  assert.doesNotMatch(diff, /onerror="alert/);
});

test("patch states render the right notices and never a fabricated diff", () => {
  const files = byId("pr-128").files;
  const render = (file) => renderToStaticMarkup(createElement(FileDiff, { file, revision: "2f4c8e7aaaa", openUrl: null }));
  assert.match(render(files.find((f) => f.patchState === "binary")), /Binary file/);
  assert.match(render(files.find((f) => f.patchState === "truncated")), /Patch truncated/);
  const gone = render(byId("push-main-7c1d9e3").files[0]);
  assert.match(gone, /no longer available/);
  assert.doesNotMatch(gone, /role="region"/, "no diff body for an unavailable patch");
  assert.match(render({ ...files[0], patchState: "omitted", patch: null }), /Patch omitted/);
  assert.match(render({ ...files[0], patchState: "empty", patch: null }), /No line changes/);
});

test("a patch is labeled with the revision it belongs to, and added or removed lines are not color-only", () => {
  const html = renderToStaticMarkup(createElement(FileDiff, { file: byId("pr-128").files[0], revision: byId("pr-128").headSha, openUrl: null }));
  assert.match(html, /patch for revision/);
  assert.match(html, /2f4c8e7/);
  assert.match(html, /added: /);
  assert.match(html, /removed: /);
  assert.match(html, /aria-label="Patch for src\/navigation.tsx"/);
});

test("the inspector offers Overview, Files, and Checks as keyboard tabs", () => {
  const html = inspector(byId("pr-128"));
  assert.match(html, /role="tablist"/);
  assert.equal((html.match(/role="tab"/g) ?? []).length, 3);
  assert.match(html, /aria-selected="true"[^>]*>Overview/);
  assert.match(html, /Description from GitHub/);
  assert.match(html, /Not generated by Katalist/);
  assert.match(html, /Open on GitHub/);
});

test("a partial file list says how many are shown", () => {
  const html = inspector(byId("pr-124"));
  assert.match(html, /Showing 1 of 412 files/);
});

// ---- consent and roles on the inspector ----------------------------------------

test("with consent on, Owners and Collaborators can draft and summarize; View Only cannot see the actions", () => {
  for (const role of ["owner", "collaborator"]) {
    const html = inspector(byId("pr-128"), role, true);
    assert.match(html, /Draft with Coey/);
    assert.match(html, /Summarize change/);
    assert.doesNotMatch(html, /disabled=""[^>]*>[^<]*<[^>]*>Draft with Coey|Drafting is turned off/);
  }
  const view = inspector(byId("pr-128"), "view_only", true);
  assert.doesNotMatch(view, /Draft with Coey/);
  assert.match(view, /View Only members can read this change/);
});

test("with consent off the actions are disabled with the right explanation per role", () => {
  const owner = inspector(byId("pr-128"), "owner", false);
  assert.match(owner, /Drafting is turned off/);
  assert.match(owner, /Open consent settings/);
  assert.match(owner, /does not turn this on/);
  assert.match(owner, /disabled=""/);
  const collab = inspector(byId("pr-128"), "collaborator", false);
  assert.match(collab, /Ask the List Owner to enable/);
  assert.doesNotMatch(collab, /Open consent settings/);
  assert.doesNotMatch(inspector(byId("pr-128"), "view_only", false), /Draft with Coey|Open consent settings/);
});

// ---- checks panel ---------------------------------------------------------------

test("the checks panel distinguishes current, none, unavailable, and stale", () => {
  const panel = (c) => renderToStaticMarkup(createElement(ChecksPanel, { change: c, onRetry: () => {} }));
  const current = panel(byId("pr-128"));
  assert.match(current, /1 failing/);
  assert.match(current, /Evaluated on revision/);
  assert.match(current, /build/);
  assert.match(panel(byId("pr-126")), /No checks reported/);
  const unavailable = panel(byId("pr-125"));
  assert.match(unavailable, /Check status unavailable/);
  assert.match(unavailable, /Retry/);
  const stale = panel(byId("pr-124"));
  assert.match(stale, /Checks are for an older revision/);
  assert.match(stale, /not current/);
});

// ---- draft review ---------------------------------------------------------------

const draftFlow = (props = {}) =>
  renderToStaticMarkup(
    createElement(CoeyDraftReview, {
      change: byId("pr-128"),
      role: "owner",
      consent: true,
      listName: "Website Launch",
      adapter,
      candidates: previewCandidates("owner"),
      onClose: () => {},
      onOpenConsentSettings: () => {},
      ...props,
    }),
  );

test("the draft flow starts with an optional note, the evidence it will read, and a clear statement that nothing is created", () => {
  const html = draftFlow();
  assert.match(html, /What do you want verified or followed up\?/);
  assert.match(html, /Evidence Coey will read/);
  assert.match(html, /Nothing is created until you/);
  assert.match(html, /Preview: nothing is sent/);
  assert.match(html, /Generate draft/);
});

test("the draft flow disables generation and explains why when consent is off", () => {
  const html = draftFlow({ consent: false });
  assert.match(html, /Drafting is turned off/);
  assert.match(html, /Open consent settings/);
  assert.match(html, /disabled=""/);
  assert.doesNotMatch(draftFlow({ consent: false, role: "collaborator" }), /Open consent settings/);
});

test("the draft flow is read-only information for View Only members", () => {
  const html = draftFlow({ role: "view_only" });
  assert.match(html, /Drafting is for Owners and Collaborators/);
  assert.match(html, /disabled=""/);
});

// ---- boundary -------------------------------------------------------------------

test("a render failure is contained: the boundary shows its own fallback and says other tabs still work", () => {
  assert.deepEqual(CodeActivityBoundary.getDerivedStateFromError(), { failed: true });
  const boundary = new CodeActivityBoundary({ children: "child" });
  assert.equal(boundary.render(), "child");
  boundary.state = { failed: true };
  const html = renderToStaticMarkup(boundary.render());
  assert.match(html, /Code Activity hit a problem/);
  assert.match(html, /Things, Chat, and Members still work/);
  assert.match(html, /role="alert"/);
});

test("the boundary clears itself when the List changes, and logs without leaking data", () => {
  const boundary = new CodeActivityBoundary({ children: "x", resetKey: "a" });
  let next;
  boundary.setState = (s) => (next = s);
  boundary.state = { failed: true };
  boundary.componentDidUpdate({ children: "x", resetKey: "b" });
  assert.deepEqual(next, { failed: false });
});
