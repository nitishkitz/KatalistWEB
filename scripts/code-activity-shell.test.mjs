import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConnectorCard, UnconnectedPanel } from "../src/features/code-activity/ConnectionPanels.tsx";
import CodeActivityRoot from "../src/features/code-activity/CodeActivityRoot.tsx";
import { CURRENT_CAPABILITIES, resolveShellStatus } from "../src/features/code-activity/shell-state.ts";

const FEATURE_DIR = new URL("../src/features/code-activity/", import.meta.url).pathname;
const read = (f) => readFileSync(join(FEATURE_DIR, f), "utf8");
const render = (role) =>
  renderToStaticMarkup(createElement(CodeActivityRoot, { listId: "l1", listName: "Website Launch", listRole: role }));

test("status is not_configured unless the server reports configured", () => {
  assert.equal(resolveShellStatus(null), "not_configured");
  assert.equal(resolveShellStatus(undefined), "not_configured");
  assert.equal(resolveShellStatus({ configured: false }), "not_configured");
  assert.equal(resolveShellStatus({ configured: "true" }), "not_configured");
  assert.equal(resolveShellStatus({ configured: true }), "not_connected");
  assert.equal(resolveShellStatus(CURRENT_CAPABILITIES), "not_configured");
});

test("before any server reply the tab is neutral; every readiness state is honest and shows no activity", () => {
  for (const role of ["owner", "collaborator", "view_only"]) {
    const html = render(role);
    assert.match(html, /Checking GitHub connection/);
    for (const forbidden of [/Connected/, /example-org/, /Preview/, /sample/i, /Last synced/, /Refresh/]) {
      assert.doesNotMatch(html, forbidden, `${role}: ${forbidden}`);
    }
  }
  const card = (readiness, isOwner = true, extra = {}) => renderToStaticMarkup(createElement(ConnectorCard, { readiness, isOwner, ...extra }));
  assert.match(card("unavailable"), /GitHub connection is unavailable for this List\./);
  assert.match(card("setup_pending"), /GitHub integration is not enabled yet\. Katalist.s operator needs to finish setup\./);
  assert.doesNotMatch(card("unavailable"), /operator|credential|secret|configured/i, "an unavailable List is not accused of missing credentials");
  for (const readiness of ["loading", "unavailable", "setup_pending"]) {
    const html = card(readiness);
    assert.match(html, /Connect GitHub/, `${readiness}: the action can be found`);
    assert.match(html, /disabled=""/, `${readiness}: and is clearly disabled`);
    assert.match(html, /aria-describedby/, `${readiness}: with the reason attached`);
    assert.doesNotMatch(card(readiness, false), /<button/, `${readiness}: members get no action`);
    assert.doesNotMatch(html, /Connected|example-org|sample/i);
  }
});

test("the connect card: enabled for a ready owner only, never for members, never without an action", () => {
  const ready = renderToStaticMarkup(createElement(UnconnectedPanel, { isOwner: true, variant: "unconnected", onConnect() {} }));
  assert.match(ready, /Use your GitHub account to choose a repository for this List\./);
  assert.match(ready, /Katalist only reads from GitHub/);
  assert.doesNotMatch(ready, /disabled=""/);
  assert.match(renderToStaticMarkup(createElement(UnconnectedPanel, { isOwner: true, variant: "unconnected" })), /disabled=""/, "no action wired: disabled");
  assert.match(renderToStaticMarkup(createElement(UnconnectedPanel, { isOwner: true, variant: "unconnected", busy: true, onConnect() {} })), /Opening GitHub/);
  const member = renderToStaticMarkup(createElement(UnconnectedPanel, { isOwner: false, variant: "unconnected", onConnect() {} }));
  assert.doesNotMatch(member, /<button/);
  assert.match(member, /Only the List owner can connect GitHub\./);
  const revoked = renderToStaticMarkup(createElement(UnconnectedPanel, { isOwner: true, variant: "revoked", onConnect() {} }));
  assert.match(revoked, /GitHub access needs verification\./);
  assert.match(renderToStaticMarkup(createElement(UnconnectedPanel, { isOwner: false, variant: "revoked" })), /Ask the List owner to reconnect it\./);
});

test("no runtime source imports fixtures, the preview adapter, or the preview bar", () => {
  const files = readdirSync(FEATURE_DIR).filter((f) => /\.(ts|tsx)$/.test(f));
  for (const file of files) {
    const code = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, /from "\.\/(fixtures|preview-adapter|PreviewBar)"/, `${file} must not import mock modules`);
    assert.doesNotMatch(code, /scripts\/fixtures/, `${file} must not reach into test fixtures`);
  }
  assert.ok(!files.includes("fixtures.ts") && !files.includes("preview-adapter.ts") && !files.includes("PreviewBar.tsx"));
});

test("the List route wraps the lazy root in a boundary that is not itself lazy", () => {
  const route = readFileSync(new URL("../src/routes/lists.$listId.tsx", import.meta.url), "utf8");
  assert.match(route, /^import \{ CodeActivityBoundary \} from "@\/features\/code-activity\/CodeActivityBoundary";/m);
  const boundary = route.indexOf("<CodeActivityBoundary");
  const suspense = route.indexOf("<Suspense", boundary);
  const root = route.indexOf("<CodeActivityRoot", boundary);
  assert.ok(boundary > 0 && boundary < suspense && suspense < root, "boundary must enclose Suspense and the lazy root");
  assert.doesNotMatch(read("CodeActivityRoot.tsx"), /CodeActivityBoundary/, "the lazy root must not host its own boundary");
});

test("the demo and login settings are untouched by the feature", () => {
  for (const file of readdirSync(FEATURE_DIR).filter((f) => /\.(ts|tsx)$/.test(f))) {
    assert.doesNotMatch(read(file), /KATALIST_DEMO_MODE|isPreviewMode|session-mode/, file);
  }
});
