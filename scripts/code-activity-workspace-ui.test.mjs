import "./dom-test-setup.mjs";
globalThis.HTMLFormElement = window.HTMLFormElement;
// Radix popovers and menus read these constructors from the global scope; jsdom exposes them on its window.
for (const name of ["Event", "Element", "HTMLElement", "Node", "MutationObserver", "ResizeObserver", "DocumentFragment", "KeyboardEvent", "MouseEvent", "PointerEvent"]) {
  if (globalThis[name] === undefined && window[name] !== undefined) globalThis[name] = window[name];
}
// Node has its own Event; jsdom's window rejects it in dispatchEvent, so the bare global must be jsdom's.
globalThis.Event = window.Event;
if (globalThis.ResizeObserver === undefined) globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
window.HTMLElement.prototype.scrollIntoView ??= () => {};
window.HTMLElement.prototype.hasPointerCapture ??= () => false;
import assert from "node:assert/strict";
import { mock, test, afterEach } from "node:test";
import { createElement as h, useEffect, useRef } from "react";
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

configure({ asyncUtilTimeout: 8000 });

/**
 * Component acceptance of the workspace in jsdom with a scripted server and a stub Magic Box.
 * NOT covered here: real layout, geometry and scrolling (see the visual harness and the Playwright spec).
 */
const LIST = "10000000-0000-0000-0000-000000000001";
const SHA = (c) => c.repeat(40);
const NOW = Date.now();
const ago = (m) => new Date(NOW - m * 60_000).toISOString();
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const requests = [];
let world;
const commitRow = (c, subject, login, min) => ({ sha: SHA(c), subject, authorName: login, authorLogin: login, avatarUrl: null, committedAt: ago(min), url: `https://github.com/acme/web/commit/${SHA(c)}` });
const savedPr = (n, title, min) => ({ id: `20000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`, kind: "pull_request", title, number: n, prState: "open", author: { name: "ana", kind: "user" }, headBranch: "feat", baseBranch: "main", headSha: SHA("9"), updatedAt: ago(min), additions: null, deletions: null, changedFiles: null, sourceUrl: `https://github.com/acme/web/pull/${n}`, commitUrl: null, description: null, checkState: "passed", checksRevision: SHA("9"), checksStale: false, checks: [], checksPartial: false, files: [], filesPartial: false, gap: null });
const savedPush = (branch, min) => ({ ...savedPr(30, `Push to ${branch}`, min), id: "20000000-0000-0000-0000-0000000000f0", kind: "push", number: null, prState: null, headBranch: branch, baseBranch: null, headSha: SHA("8"), checksRevision: SHA("8") });
const fresh = () => ({
  commits: { main: [commitRow("a", "fix: autofill", "nitish", 10), commitRow("b", "docs: readme", "ajju", 30)], dev: [commitRow("c", "dev only commit", "nitish", 5)] },
  commitDelay: {},
  saved: [savedPr(7, "Add workspace", 20), savedPush("dev", 8)],
  deployments: { permission: "ok", items: [], nextCursor: null, windowComplete: true },
  stats: "ok",
});

mock.module(new URL("../src/lib/authed-fetch.ts", import.meta.url).href, {
  namedExports: {
    authedFetch: async (url, init = {}) => {
      const u = new URL(url, "http://localhost");
      requests.push({ path: u.pathname, search: u.search });
      const p = u.pathname.replace("/api/code-activity", "");
      if (p === "/feed") {
        const cursor = u.searchParams.get("cursor");
        const page = cursor ? world.savedPages?.[cursor] : null;
        return json({ repositoryFullName: "acme/web", freshness: { lastSyncedAt: ago(2), syncStatus: "ok" }, changes: page?.changes ?? world.saved, nextCursor: page ? page.nextCursor : world.savedCursor ?? null, connectionStatus: "active" });
      }
      if (p === "/branches") {
        if (world.branchDelay) await new Promise((r) => setTimeout(r, world.branchDelay));
        if (world.branchFails) return json({ error: "source_unavailable" }, 502);
        return json({ defaultBranch: "main", branches: [{ name: "main", sha: SHA("1") }, { name: "dev", sha: SHA("2") }], nextCursor: null, complete: true });
      }
      if (p === "/commits") {
        const branch = u.searchParams.get("branch");
        const cursor = u.searchParams.get("cursor");
        if (cursor && world.pageGate) await world.pageGate;
        if (cursor && world.pageFails) return json({ error: "source_unavailable" }, 502);
        if (world.commitGate) await world.commitGate;
        const delay = world.commitDelay[branch] ?? 0;
        if (delay) await new Promise((r) => setTimeout(r, delay));
        if (world.commitFails) return json({ error: "source_unavailable" }, 502);
        return json(cursor && world.commitPages?.[cursor] ? world.commitPages[cursor] : { items: world.commits[branch] ?? [], nextCursor: world.commitCursor ?? null, windowComplete: true });
      }
      if (p === "/deployments") {
        if (world.deploymentDelay) await new Promise((r) => setTimeout(r, world.deploymentDelay));
        const cursor = u.searchParams.get("cursor");
        if (cursor && world.deploymentPageGate) await world.deploymentPageGate;
        if (cursor && world.deploymentPageFails) return json({ error: "source_unavailable" }, 502);
        if (cursor && world.deploymentPages?.[cursor]) return json(world.deploymentPages[cursor]);
        return json(world.deployments);
      }
      if (p === "/assignee-candidates") return json({ candidates: [{ actorId: "60000000-0000-0000-0000-00000000000a", name: "Olivia", role: "owner", isSelf: true }] });
      if (p === "/workspace-source") { requests.at(-1).body = JSON.parse(init.body); return world.sourceReply ?? json({ sourceId: "50000000-0000-0000-0000-000000000001", revisionSha: JSON.parse(init.body).key, title: "fix: autofill", url: null }); }
      if (p === "/workspace-confirm") { requests.at(-1).body = JSON.parse(init.body); return world.confirmReply ?? json({ thingId: "70000000-0000-0000-0000-000000000001", replayed: false }); }
      if (p === "/compare") return json({ head: { name: "dev", sha: SHA("2") }, base: { name: "main", sha: SHA("1") }, status: "ahead", ahead: 2, behind: 0, checkedAt: ago(0) });
      if (p === "/change-stats") {
        const ids = (u.searchParams.get("items") ?? "").split(",");
        return json({ results: ids.map((id) => (world.stats === "ok" ? { id, status: "ok", revision: id.slice(7), additions: 4, deletions: 2, files: 2, filesComplete: true, checkState: "passed", checks: { passed: 2, failing: 0, pending: 0, total: 2 } } : { id, status: "unavailable", revision: null, additions: null, deletions: null, files: null, filesComplete: false, checkState: null, checks: null })) });
      }
      if (p === "/commit-detail") {
        const sha = u.searchParams.get("sha");
        return json({ detail: { kind: "commit", id: `commit:${sha}`, title: "fix: autofill", body: "Body text", author: { name: "nitish", login: "nitish", avatarUrl: null }, occurredAt: ago(10), sha, branch: "main", base: null, url: `https://github.com/acme/web/commit/${sha}`, stats: { additions: 4, deletions: 2, files: 2 }, statsComplete: true,
          files: [{ path: "src/a.css", status: "modified", additions: 3, deletions: 1, patchState: "available", patch: "@@ -1,2 +1,2 @@\n ctx\n-old\n+<img src=x onerror=alert(1)>" }, { path: "docs/b.md", status: "added", additions: 1, deletions: 1, patchState: "binary", patch: null }],
          filesPartial: false, filesUnavailableReason: null, checks: [{ id: "1", name: "build", status: "completed", conclusion: "success", durationLabel: "1m", url: null }], checkState: "passed", checksRevision: sha, checksPartial: false, deployment: null } });
      }
      return json({ error: "not_found" }, 404);
    },
  },
});
mock.module(new URL("../src/features/court/MagicBox.tsx", import.meta.url).href, {
  namedExports: {
    MagicBox: ({ listName }) => {
      const ref = useRef(null);
      useEffect(() => {
        const f = () => { if (ref.current && !ref.current.closest("[hidden]")) ref.current.focus(); };
        window.addEventListener("katalist:focus-magic-box", f);
        return () => window.removeEventListener("katalist:focus-magic-box", f);
      }, []);
      return h("input", { ref, "aria-label": "Magic Box", "data-list": listName });
    },
  },
});
const { CodeActivityWorkspace } = await import("../src/features/code-activity/workspace/CodeActivityWorkspace.tsx");
const entry = await import("../src/features/court/magic-box-entry.ts");

const mount = (role = "owner") => render(h(CodeActivityWorkspace, { listId: LIST, listName: "Friday", role, suspended: false, ai: { available: false, consent: false }, people: [], onManage() {}, onOpenConsent() {} }));
const rows = () => [...document.querySelectorAll("[data-item-id]")];
const rowIds = () => rows().map((r) => r.getAttribute("data-item-id"));
const open = (id) => fireEvent.click(document.querySelector(`[data-item-id="${id}"] button`));
const calls = (p) => requests.filter((r) => r.path === `/api/code-activity${p}`);

afterEach(() => { cleanup(); delete globalThis.IntersectionObserver; });
const setup = () => { requests.length = 0; world = fresh(); };

const observePaging = () => {
  const observers = [];
  globalThis.IntersectionObserver = class {
    constructor(callback, options) { this.callback = callback; this.options = options; this.active = true; observers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.active = false; }
  };
  return { observers, nearEnd: async () => {
    await act(async () => {
      for (const observer of [...observers].filter((o) => o.active)) {
        observer.callback([{ isIntersecting: true, target: observer.target }]);
        observer.callback([{ isIntersecting: true, target: observer.target }]);
      }
    });
  } };
};

test("workspace: scrolling prefetches one page per cursor inside the feed and stops at the end", async () => {
  setup();
  const paging = observePaging();
  world.commitCursor = "page-2";
  world.commitPages = {
    "page-2": { items: [commitRow("c", "older commit", "nitish", 60)], nextCursor: "page-3", windowComplete: true },
    "page-3": { items: [commitRow("d", "oldest commit", "nitish", 90)], nextCursor: null, windowComplete: true },
  };
  mount();
  await waitFor(() => assert.equal(rows().length, 3));
  await waitFor(() => assert.ok(paging.observers.some((o) => o.active && o.target)));
  assert.ok(paging.observers.at(-1).options.root === screen.getByRole("region", { name: "Git activity history" }));
  await paging.nearEnd();
  await waitFor(() => assert.equal(rows().length, 4));
  await paging.nearEnd();
  await waitFor(() => assert.equal(rows().length, 5));
  await screen.findByText("End of available activity");
  await paging.nearEnd();
  assert.equal(calls("/commits").filter((r) => r.search.includes("cursor=")).length, 2);
  assert.equal(Boolean(screen.queryByRole("button", { name: "Load more activity" })), false);
});

test("workspace: a failed older page keeps rows and stops automatic requests until manual retry", async () => {
  setup();
  const paging = observePaging();
  world.commitCursor = "older";
  world.pageFails = true;
  world.commitPages = { older: { items: [commitRow("c", "older commit", "nitish", 60)], nextCursor: null, windowComplete: true } };
  mount();
  await waitFor(() => assert.equal(rows().length, 3));
  await paging.nearEnd();
  const retry = await screen.findByRole("button", { name: "Retry older activity" });
  await paging.nearEnd();
  assert.equal(calls("/commits").filter((r) => r.search.includes("cursor=")).length, 1);
  assert.equal(rows().length, 3);
  world.pageFails = false;
  fireEvent.click(retry);
  await waitFor(() => assert.equal(rows().length, 4));
  await screen.findByText("End of available activity");
});

test("workspace: saved activity pages also append automatically, deduplicate and terminate", async () => {
  setup();
  const paging = observePaging();
  world.savedCursor = "saved-2";
  world.savedPages = { "saved-2": { changes: [savedPr(7, "Add workspace", 20), savedPr(8, "Older PR", 80)], nextCursor: null } };
  mount();
  await waitFor(() => assert.equal(rows().length, 3));
  await paging.nearEnd();
  await waitFor(() => assert.equal(rows().length, 4));
  assert.equal(rowIds().filter((id) => id === "pr:7").length, 1);
  assert.ok(rowIds().includes("pr:8"));
  assert.equal(calls("/feed").length, 2);
  await screen.findByText("End of available activity");
});

test("workspace: deployment paging is included in the shared busy state and has a recoverable failure", async () => {
  setup();
  const paging = observePaging();
  world.deployments.nextCursor = "deploy-2";
  let release;
  world.deploymentPageGate = new Promise((resolve) => { release = resolve; });
  world.deploymentPageFails = true;
  world.deploymentPages = { "deploy-2": { permission: "ok", items: [], nextCursor: null, windowComplete: true } };
  mount();
  await waitFor(() => assert.equal(rows().length, 3));
  await paging.nearEnd();
  assert.ok(screen.getByRole("button", { name: "Loading older activity…" }).disabled);
  release();
  const retry = await screen.findByRole("button", { name: "Retry older activity" });
  await paging.nearEnd();
  assert.equal(calls("/deployments").length, 2);
  world.deploymentPageFails = false;
  fireEvent.click(retry);
  await screen.findByText("End of available activity");
  assert.equal(rows().length, 3);
});

test("workspace: the observer and manual action cannot dispatch the same in-flight page twice", async () => {
  setup();
  const paging = observePaging();
  world.commitCursor = "older";
  let release;
  world.pageGate = new Promise((resolve) => { release = resolve; });
  world.commitPages = { older: { items: [commitRow("c", "older commit", "nitish", 60)], nextCursor: null, windowComplete: true } };
  mount();
  await waitFor(() => assert.equal(rows().length, 3));
  const manual = screen.getByRole("button", { name: "Load more activity" });
  await act(async () => {
    const observer = paging.observers.filter((o) => o.active).at(-1);
    observer.callback([{ isIntersecting: true, target: observer.target }]);
    fireEvent.click(manual);
  });
  assert.equal(calls("/commits").filter((r) => r.search.includes("cursor=")).length, 1);
  assert.ok(screen.getByRole("button", { name: "Loading older activity…" }).disabled);
  release();
  await waitFor(() => assert.equal(rows().length, 4));
});

test("workspace: a provider returning the same cursor does not create an automatic request loop", async () => {
  setup();
  const paging = observePaging();
  world.commitCursor = "unchanged";
  mount();
  await waitFor(() => assert.equal(rows().length, 3));
  await paging.nearEnd();
  await paging.nearEnd();
  assert.equal(calls("/commits").filter((r) => r.search.includes("cursor=")).length, 1);
  assert.equal(rows().length, 3, "duplicate rows are not appended");
  assert.ok(screen.getByRole("button", { name: "Load more activity" }));
});

test("workspace: changing branch cancels an older page and does not leak its rows into the new branch", async () => {
  setup();
  world.commitCursor = "older";
  let release;
  world.pageGate = new Promise((resolve) => { release = resolve; });
  world.commitPages = { older: { items: [commitRow("d", "late main page", "nitish", 60)], nextCursor: null, windowComplete: true } };
  mount();
  await waitFor(() => assert.equal(rows().length, 3));
  fireEvent.click(screen.getByRole("button", { name: "Load more activity" }));
  await waitFor(() => assert.equal(calls("/commits").filter((r) => r.search.includes("cursor=")).length, 1));
  fireEvent.click(screen.getByRole("button", { name: "Branch: main" }));
  fireEvent.click(await screen.findByRole("button", { name: /^dev$/ }));
  await waitFor(() => assert.ok(rowIds().includes(`commit:${SHA("c")}`)));
  release();
  await act(async () => {});
  assert.equal(rowIds().includes(`commit:${SHA("d")}`), false);
  assert.equal(rowIds().includes(`commit:${SHA("a")}`), false);
  assert.ok(screen.getByRole("button", { name: "Load more activity" }).disabled === false);
});

test("workspace: progressive commit arrival transfers a selected push to the same verified revision", async () => {
  setup();
  let release;
  world.commitGate = new Promise((resolve) => { release = resolve; });
  const push = { ...savedPush("main", 10), headSha: SHA("a"), checksRevision: SHA("a") };
  world.saved = [push];
  mount();
  await waitFor(() => assert.ok(rowIds().includes(`push:${push.id}`)));
  open(`push:${push.id}`);
  release();
  await waitFor(() => assert.ok(rowIds().includes(`commit:${SHA("a")}`)));
  await waitFor(() => assert.equal(document.querySelector(`[data-item-id="commit:${SHA("a")}"]`)?.getAttribute("data-selected"), "true"));
  await screen.findByRole("tab", { name: /files/i });
  assert.equal(calls("/commit-detail").length, 1);
});

test("workspace: available rows render while optional deployments are still loading; feed arrival does not restart branches", async () => {
  setup();
  world.deploymentDelay = 600;
  mount();
  await waitFor(() => assert.equal(rows().length, 3));
  assert.ok(screen.getByText("Loading remaining activity…"));
  assert.equal(Boolean(screen.queryByText("No activity on this branch")), false);
  assert.equal(calls("/branches").length, 1);
  await waitFor(() => assert.equal(Boolean(screen.queryByText("Loading remaining activity…")), false));
  assert.equal(rows().length, 3);
});

test("workspace: initial loading has feedback and no false empty message; branch errors offer a working retry", async () => {
  setup();
  world.saved = [];
  world.branchDelay = 100;
  world.branchFails = true;
  mount();
  assert.ok(screen.getByRole("status", { name: "Loading activity" }));
  assert.equal(Boolean(screen.queryByText("No activity on this branch")), false);
  await screen.findByText("Some activity could not be loaded");
  world.branchFails = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => assert.equal(rows().length, 2));
  assert.equal(calls("/branches").length, 2);
});

test("workspace: filtering all loaded rows out still permits paging older activity", async () => {
  setup();
  world.commitCursor = "older";
  mount();
  await waitFor(() => assert.equal(rows().length, 3));
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "no matching title" } });
  await screen.findByText("No activity matches these filters");
  assert.ok(screen.getByRole("button", { name: "Load more activity" }));
});

test("workspace: commits, pull requests and deployments merge newest first and categories narrow the list", async () => {
  setup();
  mount();
  await waitFor(() => assert.equal(rows().length, 3));
  assert.deepEqual(rowIds(), [`commit:${SHA("a")}`, "pr:7", `commit:${SHA("b")}`], "newest first, across sources");
  fireEvent.click(screen.getByRole("tab", { name: /Pull requests/ }));
  await waitFor(() => assert.deepEqual(rowIds(), ["pr:7"]));
  fireEvent.click(screen.getByRole("tab", { name: "Commits" }));
  await waitFor(() => assert.equal(rowIds().every((id) => id.startsWith("commit:")), true));
  assert.equal(rows().length, 2);
});

test("workspace: unknown numbers are never shown as zero, and known ones replace the dashes", async () => {
  setup();
  world.stats = "unavailable";
  mount();
  await waitFor(() => assert.equal(rows().length, 3));
  const first = rows()[0];
  await waitFor(() => assert.ok(within(first).getByText(/Check status unavailable/)));
  assert.ok(within(first).getByText("– files"));
  assert.equal(within(first).queryByText(/^\+0$/), null);
  cleanup();
  setup();
  mount();
  await waitFor(() => assert.ok(within(rows()[0]).getByText(/2 checks passed/)));
  assert.ok(within(rows()[0]).getByText("+4"));
});

test("workspace: opening a commit loads its detail in place, patches stay text, Split is one click away", async () => {
  setup();
  mount();
  await waitFor(() => assert.equal(rows().length, 3));
  open(`commit:${SHA("a")}`);
  const filesTab = await screen.findByRole("tab", { name: /files/i });
  assert.equal(calls("/commit-detail").length, 1);
  assert.equal(document.querySelector("[role=dialog]"), null, "no modal on the workspace");
  fireEvent.click(filesTab);
  await screen.findByRole("region", { name: /Unified patch for src\/a.css/ });
  assert.equal(document.querySelector("img"), null, "provider text is never parsed as markup");
  assert.ok(screen.getByText(/onerror=alert\(1\)/));
  fireEvent.click(screen.getByRole("button", { name: "split" }));
  await screen.findByRole("region", { name: /Side by side patch for src\/a.css/ });
  fireEvent.click(screen.getByRole("button", { name: /docs\/b.md/ }));
  await screen.findByText(/Binary file/);
});

test("workspace: filters combine, report what they cannot check, and clear", async () => {
  setup();
  mount();
  await waitFor(() => assert.equal(rows().length, 3));
  fireEvent.change(screen.getByPlaceholderText(/Search commits/), { target: { value: "readme" } });
  await waitFor(() => assert.deepEqual(rowIds(), [`commit:${SHA("b")}`]));
  fireEvent.change(screen.getByPlaceholderText(/Search commits/), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: /File path/ }));
  fireEvent.change(await screen.findByPlaceholderText("src/features/auth"), { target: { value: "src/a.css" } });
  await waitFor(() => assert.ok(calls("/commits").some((c) => c.search.includes("path=src%2Fa.css"))), "path is pushed down to GitHub for commits");
  await waitFor(() => assert.ok(screen.getAllByText("path not checked").length >= 1), "a saved row with unknown files is kept and marked");
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  fireEvent.click(screen.getAllByRole("button", { name: "Clear filters" })[0]);
  await waitFor(() => assert.equal(screen.queryAllByText("path not checked").length, 0));
});

test("workspace: switching branch drops a slow reply from the previous branch", async () => {
  setup();
  world.commitDelay = { main: 400 };
  mount();
  // The default branch is slow; choose dev before it answers.
  const picker = await screen.findByRole("button", { name: /Branch:/ });
  await waitFor(() => assert.match(picker.getAttribute("aria-label"), /main/));
  fireEvent.click(picker);
  fireEvent.click(await screen.findByRole("button", { name: /^dev$/ }));
  await waitFor(() => assert.ok(rowIds().includes(`commit:${SHA("c")}`)));
  await new Promise((r) => setTimeout(r, 600));
  assert.ok(rowIds().includes(`commit:${SHA("c")}`));
  assert.equal(rowIds().includes(`commit:${SHA("a")}`), false, "main's late reply never reaches the dev view");
});

test("workspace: Create Thing and Ctrl/Cmd+K share one handler; the composer opens in place, once, and Escape returns focus", async () => {
  setup();
  mount();
  await waitFor(() => assert.equal(rows().length, 3));
  assert.equal(screen.queryByLabelText("Magic Box"), null, "no composer until asked");
  const create = screen.getByRole("button", { name: "Capture Thing" });
  create.focus();
  fireEvent.click(create);
  const box = await screen.findByLabelText("Magic Box");
  await waitFor(() => assert.ok(document.activeElement === box, "focus is on the expected element"));
  assert.ok(box.closest("[data-create-thing-dock]").parentElement === document.body, "composer is portaled out of the scrolling workspace");
  assert.equal(document.querySelectorAll("[aria-label='Magic Box']").length, 1, "never two composers");
  assert.equal(rows().length, 3, "the list and detail are untouched");
  fireEvent.keyDown(box, { key: "Escape" });
  await waitFor(() => assert.equal(box.closest("[hidden]") !== null, true));
  await waitFor(() => assert.ok(document.activeElement === create, "focus is on the expected element"));
  // The keyboard shortcut path is the same function.
  assert.equal(await entry.tryHandleMagicBoxCapture(), true);
  await waitFor(() => assert.ok(document.activeElement === screen.getByLabelText("Magic Box"), "focus is on the expected element"));
  assert.equal(await entry.tryHandleMagicBoxCapture(), true, "repeating the shortcut does not replace the return-focus target");
  fireEvent.keyDown(box, { key: "Escape" });
  await waitFor(() => assert.ok(document.activeElement === create));
  cleanup();
  assert.equal(await entry.tryHandleMagicBoxCapture(), false, "with the workspace gone, the shortcut falls back to Court");
});

test("workspace: View Only members read but cannot create", async () => {
  setup();
  mount("viewer");
  await waitFor(() => assert.equal(rows().length, 3));
  assert.equal(screen.queryAllByRole("button", { name: "Create Thing" }).length, 0);
  assert.equal(screen.queryByRole("button", { name: /Sync/ }), null);
  assert.equal(await entry.tryHandleMagicBoxCapture(), false);
});

test("workspace: a deployments permission refusal is a state in the tab, not an error", async () => {
  setup();
  world.deployments = { permission: "needed", items: [], nextCursor: null, windowComplete: true };
  mount();
  fireEvent.click(screen.getByRole("tab", { name: "Deployments" }));
  await screen.findByText(/Deployments unavailable · permission needed/);
  assert.equal(screen.queryByText(/could not be loaded/), null);
});

test("workspace: below 1024 px a row opens the detail and Back returns to the same row", async () => {
  setup();
  mount();
  await waitFor(() => assert.equal(rows().length, 3));
  const root = document.querySelector("[data-code-activity-workspace]");
  assert.equal(root.getAttribute("data-view"), "list");
  open(`commit:${SHA("b")}`);
  assert.equal(root.getAttribute("data-view"), "detail");
  await screen.findByRole("tab", { name: /files/i });
  fireEvent.click(screen.getByRole("button", { name: "Back to activity" }));
  assert.equal(root.getAttribute("data-view"), "list");
  await waitFor(() => assert.ok(document.activeElement === document.querySelector(`[data-item-id="commit:${SHA("b")}"] button`)), { timeout: 3000, onTimeout: () => new Error(`focus not restored; active element is ${document.activeElement?.outerHTML.slice(0, 160)}`) });
});

test("workspace: a failed source is contained with a retry and the others stay", async () => {
  setup();
  world.commitFails = true;
  mount();
  await screen.findByText(/Commits could not be loaded/);
  await waitFor(() => assert.ok(rowIds().includes("pr:7")), "saved pull requests are still listed");
  assert.ok(screen.getByRole("button", { name: "Retry" }));
});

test("review fix 1: a branch is compared with the default branch without choosing a base", async () => {
  setup();
  mount();
  await waitFor(() => assert.equal(rows().length > 0, true));
  const picker = await screen.findByRole("button", { name: /Branch: main/ });
  fireEvent.click(picker);
  fireEvent.click(await screen.findByRole("button", { name: /^dev$/ }));
  await waitFor(() => assert.ok(calls("/compare").some((c) => c.search.includes("head=dev") && c.search.includes("base=main"))));
  await screen.findByText(/2 ahead/);
});

test("review fix 2: the selected branch applies to pull requests and pushes, not only commits", async () => {
  setup();
  mount();
  await waitFor(() => assert.ok(rowIds().includes("pr:7")), "on main the pull request into main is shown");
  assert.equal(rowIds().some((id) => id.startsWith("push:")), false, "a push to dev is not shown under main");
  fireEvent.click(await screen.findByRole("button", { name: /Branch: main/ }));
  fireEvent.click(await screen.findByRole("button", { name: /^dev$/ }));
  await waitFor(() => assert.ok(rowIds().includes(`commit:${SHA("c")}`)));
  assert.equal(rowIds().includes("pr:7"), false, "the pull request into main is not shown under dev");
  assert.ok(rowIds().some((id) => id.startsWith("push:")), "the push to dev is");
});

test("review fix 3: Checks fills in after switching there before details were loaded", async () => {
  setup();
  world.saved = [];
  mount();
  fireEvent.click(screen.getByRole("tab", { name: "Checks" }));
  await waitFor(() => assert.ok(rowIds().includes(`check:${SHA("a")}`), `check rows appear, got ${rowIds().join(",")}`));
});

test("review fix 4: Clear filters also clears search and returns to the default branch", async () => {
  setup();
  mount();
  await waitFor(() => assert.ok(rows().length >= 3));
  fireEvent.click(await screen.findByRole("button", { name: /Branch: main/ }));
  fireEvent.click(await screen.findByRole("button", { name: /^dev$/ }));
  fireEvent.change(screen.getByPlaceholderText(/Search commits/), { target: { value: "zzz-no-match" } });
  await waitFor(() => assert.equal(rows().length, 0));
  fireEvent.click(screen.getAllByRole("button", { name: "Clear filters" })[0]);
  await waitFor(() => assert.equal(screen.getByPlaceholderText(/Search commits/).value, ""));
  await screen.findByRole("button", { name: /Branch: main/ });
  await waitFor(() => assert.ok(rowIds().includes(`commit:${SHA("a")}`)));
});

async function openCommitForm() {
  mount();
  await waitFor(() => assert.ok(rowIds().includes(`commit:${SHA("a")}`)));
  open(`commit:${SHA("a")}`);
  await screen.findByRole("tab", { name: /files/i });
  fireEvent.click(screen.getAllByRole("button", { name: "Create Thing" }).find((b) => b.closest(".ca-detail")));
  await screen.findByRole("heading", { name: /Create a Thing from this commit/ });
}

test("review fix 5: a commit becomes a Thing through a registered source, with the person's own words and a stable key", async () => {
  setup();
  await openCommitForm();
  const reg = calls("/workspace-source")[0];
  assert.deepEqual([reg.body.kind, reg.body.key], ["commit", SHA("a")]);
  assert.equal(screen.getAllByRole("button", { name: "Create Thing" }).at(-1).disabled, true, "an assignee must be chosen, never guessed");
  fireEvent.change(await screen.findByLabelText("Assignee"), { target: { value: "60000000-0000-0000-0000-00000000000a" } });
  fireEvent.change(screen.getByLabelText("Notes (optional)"), { target: { value: "check the form" } });
  fireEvent.click(screen.getAllByRole("button", { name: "Create Thing" }).at(-1));
  await screen.findByText("Thing created");
  const sent = calls("/workspace-confirm")[0].body;
  assert.deepEqual([sent.sourceId, sent.title, sent.notes, sent.dueAt, sent.reviewedSha, sent.acknowledgeSourceChange], ["50000000-0000-0000-0000-000000000001", "fix: autofill", "check the form", null, SHA("a"), false]);
  assert.ok(!("aiGenerated" in sent), "no AI flag exists on this path");
});

test("review fix 5: an unapplied database package is explained, the text is kept, and a retry reuses the same key", async () => {
  setup();
  world.confirmReply = json({ error: "not_configured" }, 503);
  await openCommitForm();
  fireEvent.change(await screen.findByLabelText("Assignee"), { target: { value: "60000000-0000-0000-0000-00000000000a" } });
  fireEvent.change(screen.getByLabelText("Notes (optional)"), { target: { value: "keep me" } });
  fireEvent.click(screen.getAllByRole("button", { name: "Create Thing" }).at(-1));
  await screen.findByText(/has not been set up in this environment yet/);
  assert.equal(screen.getByLabelText("Notes (optional)").value, "keep me");
  fireEvent.click(screen.getAllByRole("button", { name: "Create Thing" }).at(-1));
  await waitFor(() => assert.equal(calls("/workspace-confirm").length, 2));
  assert.equal(calls("/workspace-confirm")[0].body.key, calls("/workspace-confirm")[1].body.key);
});
