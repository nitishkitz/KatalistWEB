import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { mock, test, afterEach } from "node:test";
import { createElement as h } from "react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

configure({ asyncUtilTimeout: 4000 });
globalThis.HTMLFormElement = window.HTMLFormElement;
// React Query schedules 15-30 s stale-time timers; unref the long ones so a finished file can exit.
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...args) => {
  const timer = realSetTimeout(fn, ms, ...args);
  if (typeof ms === "number" && ms >= 10_000) timer.unref?.();
  return timer;
};
for (const name of ["Event", "Element", "HTMLElement", "Node", "MutationObserver", "ResizeObserver", "DocumentFragment", "KeyboardEvent", "MouseEvent", "PointerEvent"]) {
  if (globalThis[name] === undefined && window[name] !== undefined) globalThis[name] = window[name];
}
globalThis.Event = window.Event;
if (globalThis.ResizeObserver === undefined) globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
window.HTMLElement.prototype.scrollIntoView ??= () => {};
window.HTMLElement.prototype.hasPointerCapture ??= () => false;
window.HTMLElement.prototype.setPointerCapture ??= () => {};
window.HTMLElement.prototype.releasePointerCapture ??= () => {};

/**
 * Component acceptance for the Designs library in jsdom with a scripted data layer.
 * NOT covered: real layout/geometry and screen-reader output (see the report), and the
 * real Supabase round trip (covered at the SQL level by design-resources-sql.test.mjs).
 */
const LIST = "10000000-0000-0000-0000-000000000001";
const ME = "20000000-0000-0000-0000-000000000001";
const PRIYA = "20000000-0000-0000-0000-000000000002";
const KEY = "AbCdEf1234567890xyZ123";
const URL_A = `https://www.figma.com/design/${KEY}/Checkout?node-id=1-2`;

const members = [
  { profileId: ME, name: "Me Owner", initials: "MO" },
  { profileId: PRIYA, name: "Priya Sharma", initials: "PS" },
];

let world;
const calls = [];
const resource = (n, over = {}) => ({
  id: `30000000-0000-0000-0000-${String(n).padStart(12, "0")}`, listId: LIST, kind: "design", fileKey: KEY, nodeId: `${n}-1`,
  startingPointNodeId: null, versionId: null, pageId: null, identityKey: `design:${KEY}:${n}-1::`,
  originalUrl: `https://www.figma.com/design/${KEY}?node-id=${n}-1`, title: `Design ${n}`, notes: null, tags: [],
  ownerProfileId: PRIYA, folderId: null, coverStorageKey: null, createdBy: ME, createdAt: "2026-10-08T10:00:00.000Z",
  updatedAt: "2026-10-08T10:00:00.000Z", archivedAt: null, ...over,
});
const folder = (id, name) => ({ id, listId: LIST, name, createdAt: "2026-10-08T10:00:00Z", updatedAt: "2026-10-08T10:00:00Z" });
const fresh = () => ({
  pages: { first: { items: [resource(1, { title: "Checkout flow", tags: ["payments"], notes: "Coupon errors" }), resource(2, { title: "Profile", kind: "prototype" })], nextCursor: undefined } },
  readError: null,
  folders: [folder("40000000-0000-0000-0000-000000000001", "Onboarding")],
  foldersError: null,
  favorites: [],
  favoritesError: null,
  writeError: null,
  folderWriteError: null,
  archiveError: null,
  links: [],
  linksError: null,
  thingDesigns: [],
  thingDesignsError: null,
  coverUrls: {},
  coverDeps: null,
  linkError: null,
});

const { DesignOperationError } = await import("../src/features/designs/design-queries.ts");
mock.module(new URL("../src/hooks/useSession.ts", import.meta.url).href, {
  namedExports: {
    useSession: () => ({ session: { preview: world.preview === true, user: { id: ME } }, user: { id: ME } }),
    getStoredDemoSession: () => null,
    DEMO_PERSONAS: [],
  },
});
mock.module(new URL("../src/lib/session-mode.ts", import.meta.url).href, {
  namedExports: { isPreviewSession: (s) => s?.preview === true, isPreviewMode: () => false, demoEnabled: () => false },
});
mock.module(new URL("../src/features/designs/api.ts", import.meta.url).href, {
  namedExports: {
    fetchDesignResourcePage: async (listId, filter, cursor) => {
      calls.push(["page", filter, cursor]);
      if (world.readError) throw world.readError;
      const key = cursor ? cursor.id : "first";
      return world.pages[key] ?? { items: [], nextCursor: undefined };
    },
    fetchDesignFolders: async () => {
      if (world.foldersError) throw world.foldersError;
      return world.folders;
    },
    fetchDesignFavoriteIds: async () => {
      if (world.favoritesError) throw world.favoritesError;
      return world.favorites;
    },
    fetchDesignThingLinks: async () => {
      if (world.linksError) throw world.linksError;
      return world.links;
    },
    fetchThingDesigns: async () => {
      if (world.thingDesignsError) throw world.thingDesignsError;
      return world.thingDesigns;
    },
    designApi: {
      addResource: async (input) => {
        calls.push(["add", input]);
        if (world.writeError) throw world.writeError;
        return resource(9, { title: input.title });
      },
      updateResource: async (input) => {
        calls.push(["update", input]);
        if (world.writeError) throw world.writeError;
        return resource(1, { title: input.title });
      },
      setArchived: async (id, archived) => {
        calls.push(["archive", id, archived]);
        if (world.archiveError) throw world.archiveError;
        return resource(1);
      },
      setFavorite: async (id, favorite) => {
        calls.push(["favorite", id, favorite]);
        if (favorite) world.favorites = [...world.favorites, id];
        else world.favorites = world.favorites.filter((f) => f !== id);
      },
      createFolder: async (listId, name) => {
        calls.push(["createFolder", name]);
        if (world.folderWriteError) throw world.folderWriteError;
        return folder("40000000-0000-0000-0000-000000000009", name);
      },
      renameFolder: async (id, name) => {
        calls.push(["renameFolder", id, name]);
        return folder(id, name);
      },
      deleteFolder: async (id) => {
        calls.push(["deleteFolder", id]);
      },
      linkThing: async (resourceId, thingId) => {
        calls.push(["link", resourceId, thingId]);
        if (world.linkError) throw world.linkError;
        const link = { id: `50000000-0000-0000-0000-${String(world.links.length + 1).padStart(12, "0")}`, resourceId, thingId, listId: LIST, createdAt: "2026-10-08T10:00:00Z" };
        world.links = [...world.links, link];
        return link;
      },
      unlinkThing: async (resourceId, thingId) => {
        calls.push(["unlink", resourceId, thingId]);
        world.links = world.links.filter((l) => !(l.resourceId === resourceId && l.thingId === thingId));
      },
    },
  },
});
mock.module(new URL("../src/features/designs/covers-supabase.ts", import.meta.url).href, {
  namedExports: {
    signDesignCovers: async (keys) => new Map(keys.filter((k) => world.coverUrls[k]).map((k) => [k, world.coverUrls[k]])),
    supabaseCoverDeps: {
      upload: (...a) => world.coverDeps.upload(...a),
      remove: (...a) => world.coverDeps.remove(...a),
      setCover: (...a) => world.coverDeps.setCover(...a),
      clearCover: (...a) => world.coverDeps.clearCover(...a),
      newId: () => world.coverDeps.newId(),
    },
  },
});
mock.module("@tanstack/react-router", {
  namedExports: { Link: ({ to, params, search, children, ...rest }) => h("a", { href: `${to.replace("$listId", params?.listId ?? "")}?${new URLSearchParams(search ?? {})}`, ...rest }, children) },
});
// PersonAvatar pulls in the Supabase proxy (Vite env); a plain avatar stand-in is enough here.
mock.module(new URL("../src/components/katalist/PersonAvatar.tsx", import.meta.url).href, {
  namedExports: { PersonAvatar: ({ name }) => h("span", { "aria-hidden": "true", "data-avatar": name }) },
});
const { default: DesignsRoot } = await import("../src/features/designs/DesignsRoot.tsx");
const { DesignsBoundary } = await import("../src/features/designs/DesignsBoundary.tsx");

const clients = [];
const mount = async (role = "owner", extra = {}) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(qc);
  await act(async () => {
    render(h(QueryClientProvider, { client: qc }, h(DesignsRoot, { listId: LIST, listRole: role, members, ...extra })));
  });
  await waitFor(() => assert.ok(!screen.queryByRole("status", { name: "Loading designs" }), "finished loading"));
  return qc;
};
const setup = () => { calls.length = 0; world = fresh(); onlineManager.setOnline(true); };
afterEach(() => {
  cleanup();
  // Stale-time timers on live observers would otherwise keep the test process alive.
  for (const qc of clients.splice(0)) qc.clear();
  onlineManager.setOnline(true);
});
const rows = () => screen.queryAllByTestId("design-row");

test("library shows type, owner and clearly labeled Katalist timestamps, never a Figma change time", async () => {
  setup();
  world.pages.first.items[0].updatedAt = "2026-10-09T10:00:00.000Z";
  await mount();
  assert.equal(rows().length, 2);
  const first = rows()[0];
  assert.match(first.textContent, /Checkout flow/);
  assert.match(first.textContent, /Design/);
  assert.match(first.textContent, /Owner: Priya Sharma/);
  assert.match(first.textContent, /Added Oct 8, 2026 by Me Owner/);
  assert.match(first.textContent, /Updated in Katalist Oct 9, 2026/);
  assert.doesNotMatch(document.body.textContent, /last (changed|modified|edited) in figma/i);
  assert.match(rows()[1].textContent, /Prototype/);
  assert.match(document.body.textContent, /All 2 designs in this view are loaded/);
});

test("a failed read is an error with Retry, not an empty library", async () => {
  setup();
  world.readError = new DesignOperationError("unknown", "boom");
  await mount();
  const alert = await screen.findByRole("alert");
  assert.match(alert.textContent, /could not be loaded/i);
  assert.match(alert.textContent, /not an empty library/i);
  assert.doesNotMatch(document.body.textContent, /No designs yet/);
  world.readError = null;
  await act(async () => { fireEvent.click(within(alert).getByRole("button", { name: "Retry" })); });
  await waitFor(() => assert.equal(rows().length, 2));
});

test("missing migration, preview and offline each get their own state", async () => {
  setup();
  world.readError = new DesignOperationError("migration_missing", "not set up");
  await mount();
  assert.ok(await screen.findByText("Designs are not set up yet"));
  cleanup();

  setup();
  world.preview = true;
  await mount();
  assert.ok(await screen.findByText("Designs are not available in preview"));
  assert.equal(calls.filter((c) => c[0] === "page").length, 0, "preview never reads the shared tables");
  cleanup();

  setup();
  onlineManager.setOnline(false);
  await mount();
  assert.ok(await screen.findByText("You're offline"));
  assert.doesNotMatch(document.body.textContent, /No designs yet/);
});

test("empty library offers Add design to managers and explains to view-only members", async () => {
  setup();
  world.pages.first = { items: [], nextCursor: undefined };
  await mount("owner");
  assert.ok(await screen.findByText("No designs yet"));
  assert.ok(screen.getAllByRole("button", { name: /Add design/ }).length >= 1);
  cleanup();
  setup();
  world.pages.first = { items: [], nextCursor: undefined };
  await mount("view_only");
  assert.ok(await screen.findByText("No designs yet"));
  assert.equal(screen.queryAllByRole("button", { name: /Add design/ }).length, 0);
  assert.match(document.body.textContent, /Owners and collaborators can add designs/);
});

test("search covers titles, tags and notes, and discloses when only loaded pages were searched", async () => {
  setup();
  const second = "30000000-0000-0000-0000-000000000002";
  world.pages.first.nextCursor = { createdAt: "2026-10-08T10:00:00Z", id: second };
  world.pages[second] = { items: [resource(3, { title: "Settings" })], nextCursor: undefined };
  await mount();
  const search = screen.getByRole("searchbox", { name: /search titles, tags and notes/i });
  fireEvent.change(search, { target: { value: "payments" } });
  assert.equal(rows().length, 1);
  assert.match(screen.getByTestId("design-scope-note").textContent, /apply only to the 2 designs loaded so far/);
  fireEvent.change(search, { target: { value: "coupon" } });
  assert.equal(rows().length, 1, "notes are searched");
  fireEvent.change(search, { target: { value: "nonexistent" } });
  const none = screen.getByTestId("design-no-matches");
  assert.match(none.textContent, /No matches among the 2 loaded designs/);
  assert.doesNotMatch(none.textContent, /No designs match/);
  assert.ok(screen.getByRole("button", { name: "Load more" }), "Load more stays available while searching");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Load more" })); });
  await waitFor(() => assert.match(screen.getByTestId("design-scope-note").textContent, /Searched all 3 designs/));
  assert.match(screen.getByTestId("design-no-matches").textContent, /No designs match your filters/);
  fireEvent.change(search, { target: { value: "settings" } });
  assert.equal(rows().length, 1, "results from the second page are searchable after loading it");
});

test("type, owner and favorites filters work, and Clear filters resets them", async () => {
  setup();
  world.favorites = [resource(2).id];
  await mount();
  fireEvent.change(screen.getByLabelText("Type"), { target: { value: "prototype" } });
  assert.deepEqual(rows().map((r) => r.querySelector("h3").textContent), ["Profile"]);
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  assert.equal(rows().length, 2);
  fireEvent.click(screen.getByRole("button", { name: "Favorites" }));
  assert.deepEqual(rows().map((r) => r.querySelector("h3").textContent), ["Profile"]);
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  fireEvent.change(screen.getByLabelText("Owner"), { target: { value: ME } });
  assert.match(screen.getByTestId("design-no-matches").textContent, /No designs match your filters/);
});

test("view-only members can favorite but cannot add, edit, archive or manage folders", async () => {
  setup();
  await mount("view_only");
  assert.match(document.body.textContent, /View only/);
  for (const name of [/Add design/, /New folder/, /^Edit /, /^Archive /]) {
    assert.equal(screen.queryAllByRole("button", { name }).length, 0, String(name));
  }
  const star = screen.getByRole("button", { name: "Add Checkout flow to favorites" });
  assert.equal(star.getAttribute("aria-pressed"), "false");
  await act(async () => { fireEvent.click(star); });
  await waitFor(() => assert.equal(screen.getByRole("button", { name: "Remove Checkout flow from favorites" }).getAttribute("aria-pressed"), "true"));
  assert.deepEqual(calls.find((c) => c[0] === "favorite"), ["favorite", resource(1).id, true]);
});

test("add dialog: validation focuses the first invalid field and keeps what was typed", async () => {
  setup();
  await mount();
  const trigger = screen.getAllByRole("button", { name: /Add design/ })[0];
  await act(async () => { fireEvent.click(trigger); });
  const dialog = await screen.findByRole("dialog");
  assert.ok(dialog.contains(document.activeElement), "focus moves into the dialog");
  assert.ok(within(dialog).getByLabelText(/Figma link/));
  assert.ok(within(dialog).getByLabelText(/Title/));
  fireEvent.change(within(dialog).getByLabelText(/Title/), { target: { value: "My title" } });
  await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Add design" })); });
  const url = within(dialog).getByLabelText(/Figma link/);
  assert.equal(url.getAttribute("aria-invalid"), "true");
  await waitFor(() => assert.ok(document.activeElement === url, "focus moves to the first invalid field"));
  assert.equal(within(dialog).getByLabelText(/Title/).value, "My title");
  assert.equal(calls.filter((c) => c[0] === "add").length, 0, "invalid drafts never reach the server");
  // Optional fields are tucked away until requested.
  assert.equal(document.getElementById(url.id.replace("-url", "-more")).hidden, true);
});

test("a failed save keeps the dialog open with the draft; closing then reopening restores it; success clears it", async () => {
  setup();
  world.writeError = new DesignOperationError("unknown", "Server hiccup");
  await mount();
  await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /Add design/ })[0]); });
  let dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText(/Figma link/), { target: { value: URL_A } });
  fireEvent.change(within(dialog).getByLabelText(/Title/), { target: { value: "Checkout" } });
  await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Add design" })); });
  await waitFor(() => assert.match(within(screen.getByRole("dialog")).getByRole("alert").textContent, /Server hiccup/));
  assert.equal(within(screen.getByRole("dialog")).getByLabelText(/Title/).value, "Checkout");
  assert.match(screen.getByRole("dialog").textContent, /Your draft is kept/);
  // Close and reopen: the draft comes back.
  await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" })); });
  await waitFor(() => assert.equal(screen.queryByRole("dialog"), null));
  await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /Add design/ })[0]); });
  dialog = await screen.findByRole("dialog");
  assert.equal(within(dialog).getByLabelText(/Title/).value, "Checkout");
  assert.match(dialog.textContent, /Restored your unsaved draft/);
  // Retry succeeds, closes, and the next open is blank.
  world.writeError = null;
  await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Add design" })); });
  await waitFor(() => assert.equal(screen.queryByRole("dialog"), null));
  const add = calls.filter((c) => c[0] === "add").at(-1)[1];
  assert.equal(add.url, URL_A);
  assert.equal(add.title, "Checkout");
  assert.equal(add.listId, LIST, "list id comes from the route via the mutation hook, never from the form");
  await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /Add design/ })[0]); });
  assert.equal(within(await screen.findByRole("dialog")).getByLabelText(/Title/).value, "");
});

test("duplicate links are explained clearly and can jump to the saved design", async () => {
  setup();
  const existing = resource(1).id;
  world.writeError = new DesignOperationError("duplicate_design", "This design is already saved in this List.", existing);
  await mount();
  await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /Add design/ })[0]); });
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText(/Figma link/), { target: { value: URL_A } });
  fireEvent.change(within(dialog).getByLabelText(/Title/), { target: { value: "Dup" } });
  await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Add design" })); });
  const alert = await within(dialog).findByRole("alert");
  assert.match(alert.textContent, /already saved in this List/);
  await act(async () => { fireEvent.click(within(alert).getByRole("button", { name: "Show the saved design" })); });
  await waitFor(() => assert.equal(screen.queryByRole("dialog"), null));
  assert.match(document.getElementById(`design-${existing}`).className, /border-\[#975ee2\]/);
});

test("Escape closes the dialog and returns focus to the control that opened it", async () => {
  setup();
  await mount();
  const trigger = screen.getAllByRole("button", { name: /Add design/ })[0];
  trigger.focus();
  await act(async () => { fireEvent.click(trigger); });
  const dialog = await screen.findByRole("dialog");
  await act(async () => { fireEvent.keyDown(dialog, { key: "Escape", code: "Escape" }); });
  await waitFor(() => assert.equal(screen.queryByRole("dialog"), null));
  await waitFor(() => assert.ok(document.activeElement === trigger, "focus returns to the opener"));
});

test("edit sends only a changed URL and archive/restore conflicts are explained", async () => {
  setup();
  await mount();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Edit Checkout flow" })); });
  const dialog = await screen.findByRole("dialog");
  assert.equal(within(dialog).getByLabelText(/Title/).value, "Checkout flow");
  fireEvent.change(within(dialog).getByLabelText(/Title/), { target: { value: "Checkout v2" } });
  await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" })); });
  await waitFor(() => assert.equal(screen.queryByRole("dialog"), null));
  const update = calls.filter((c) => c[0] === "update").at(-1)[1];
  assert.equal(update.title, "Checkout v2");
  assert.equal(update.url, null, "an unchanged link is not re-sent");
  assert.deepEqual(update.tags, ["payments"]);

  // Archived view: a restore conflict is reported without losing the row.
  world.pages.first = { items: [resource(5, { title: "Old checkout", archivedAt: "2026-10-08T12:00:00Z" })], nextCursor: undefined };
  world.archiveError = new DesignOperationError("duplicate_design", "dup");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Archived" })); });
  await waitFor(() => assert.equal(rows().length, 1));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Restore Old checkout" })); });
  const alert = await screen.findByRole("alert");
  assert.match(alert.textContent, /was not restored: an active design with the same link already exists/);
  assert.equal(rows().length, 1);
});

test("folders: a duplicate name keeps what was typed; deleting asks first and explains designs are kept", async () => {
  setup();
  world.folderWriteError = new DesignOperationError("duplicate_folder", "A folder with that name already exists.");
  await mount();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /New folder/ })); });
  const dialog = await screen.findByRole("dialog");
  const input = within(dialog).getByLabelText("Folder name");
  fireEvent.change(input, { target: { value: "Onboarding" } });
  await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Create folder" })); });
  await waitFor(() => assert.match(within(screen.getByRole("dialog")).getByRole("alert").textContent, /already exists/));
  assert.equal(within(screen.getByRole("dialog")).getByLabelText("Folder name").value, "Onboarding");
  await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" })); });
  await waitFor(() => assert.equal(screen.queryByRole("dialog"), null));

  fireEvent.change(screen.getByLabelText("Folder"), { target: { value: world.folders[0].id } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Delete folder Onboarding" })); });
  const confirm = await screen.findByRole("alertdialog");
  assert.match(confirm.textContent, /not deleted\. They move to Unfiled/);
  assert.equal(calls.filter((c) => c[0] === "deleteFolder").length, 0, "nothing is deleted before confirmation");
  await act(async () => { fireEvent.click(within(confirm).getByRole("button", { name: "Delete folder" })); });
  await waitFor(() => assert.equal(calls.filter((c) => c[0] === "deleteFolder").length, 1));
});

test("favorites or folders failing to load never blocks the library and is stated", async () => {
  setup();
  world.favoritesError = new DesignOperationError("unknown", "fav fail");
  world.foldersError = new DesignOperationError("unknown", "folder fail");
  await mount();
  assert.equal(rows().length, 2);
  assert.match(document.body.textContent, /Favorites could not be loaded/);
  assert.match(document.body.textContent, /Folders could not be loaded/);
  assert.equal(screen.getByRole("button", { name: "Favorites" }).disabled, true);
});

test("controls are native, labelled and reachable; the Designs tab boundary contains render failures", async () => {
  setup();
  await mount();
  for (const label of ["Folder", "Type", "Owner", "Search titles, tags and notes"]) assert.ok(screen.getByLabelText(label), label);
  assert.ok(screen.getByRole("search", { name: "Search designs" }));
  for (const button of screen.getAllByRole("button")) {
    assert.ok(button.getAttribute("aria-label") || button.textContent.trim(), "every button has an accessible name");
  }
  cleanup();
  const Bomb = () => { throw new Error("boom"); };
  const original = console.error;
  console.error = () => {};
  try {
    render(h(DesignsBoundary, { resetKey: "a" }, h(Bomb)));
  } finally {
    console.error = original;
  }
  const alert = screen.getByRole("alert");
  assert.match(alert.textContent, /Designs hit a problem/);
  assert.match(alert.textContent, /Things, Chat, and Members still work/);
});

// ---- Stage 4: official embedded viewer ----------------------------------------------------------
const { DesignViewer } = await import("../src/features/designs/DesignViewer.tsx");
const iframes = () => [...document.querySelectorAll("iframe")];

test("viewer: nothing is embedded until a design is selected; then exactly one official embed is mounted", async () => {
  setup();
  await mount();
  assert.equal(iframes().length, 0, "no iframes for an unselected library");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "View Checkout flow" })); });
  assert.equal(iframes().length, 1);
  const frame = iframes()[0];
  assert.equal(frame.src, `https://embed.figma.com/design/${KEY}?node-id=1-1&embed-host=katalist`);
  assert.equal(frame.title, "Figma design: Checkout flow");
  assert.equal(frame.hasAttribute("srcdoc"), false);
  assert.ok(frame.hasAttribute("allowfullscreen"));
  const viewer = screen.getByTestId("design-viewer");
  assert.match(viewer.textContent, /View only/);
  assert.match(viewer.textContent, /Edits happen in Figma/);
  assert.equal(screen.getByRole("button", { name: "View Checkout flow" }).getAttribute("aria-pressed"), "true");
  // Selecting another design replaces the embed rather than stacking a second one.
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "View Profile" })); });
  assert.equal(iframes().length, 1);
  assert.match(iframes()[0].src, /node-id=2-1/);
  assert.equal(iframes()[0].title, "Figma prototype: Profile"); // fixture kind; real rows derive kind from the link
});

test("viewer: Open in Figma uses the canonical link safely; Copy link copies it; failure is reported, not hidden", async () => {
  setup();
  const written = [];
  Object.defineProperty(window.navigator, "clipboard", { value: { writeText: async (t) => { written.push(t); } }, configurable: true });
  await mount();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "View Checkout flow" })); });
  const open = screen.getByRole("link", { name: /Open in Figma/ });
  assert.equal(open.getAttribute("href"), `https://www.figma.com/design/${KEY}?node-id=1-1`);
  assert.equal(open.getAttribute("target"), "_blank");
  assert.match(open.getAttribute("rel"), /noopener/);
  assert.match(open.getAttribute("rel"), /noreferrer/);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Copy link/ })); });
  assert.deepEqual(written, [`https://www.figma.com/design/${KEY}?node-id=1-1`]);
  Object.defineProperty(window.navigator, "clipboard", { value: { writeText: async () => { throw new Error("denied"); } }, configurable: true });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Copy link/ })); });
  assert.equal(written.length, 1, "a failed copy never claims success");
});

test("viewer: Retry remounts the embed; a slow load offers the external fallback; onLoad never claims access", async () => {
  setup();
  const resourceRow = resource(1);
  const { rerender } = render(h(DesignViewer, { resource: resourceRow, onClose() {}, slowAfterMs: 40 }));
  const first = iframes()[0];
  assert.equal(screen.queryByTestId("viewer-slow"), null, "no slow notice immediately");
  await waitFor(() => assert.ok(screen.getByTestId("viewer-slow")));
  assert.match(screen.getByTestId("viewer-slow").textContent, /Open the design in Figma|open the design in Figma/);
  // The browser's load event proves nothing about authorization, so the wording stays neutral.
  fireEvent.load(first);
  assert.doesNotMatch(document.body.textContent, /loaded successfully|access granted|you have access|authorized/i);
  assert.match(document.body.textContent, /Figma controls access/);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Retry/ })); });
  const second = iframes()[0];
  assert.notEqual(second, first, "Retry creates a fresh iframe");
  assert.equal(screen.queryByTestId("viewer-slow"), null, "Retry restarts the slow timer");
  rerender(h(DesignViewer, { resource: resourceRow, onClose() {}, slowAfterMs: 40 }));
});

test("viewer: a stored link that no longer validates never becomes an iframe or an external link", async () => {
  setup();
  render(h(DesignViewer, { resource: resource(1, { originalUrl: "https://evil.example/design/x?x=<script>" }), onClose() {} }));
  assert.equal(iframes().length, 0);
  assert.equal(screen.queryByRole("link", { name: /Open in Figma/ }), null);
  assert.match(screen.getByRole("alert").textContent, /not a valid Figma link/);
  assert.equal(screen.getByRole("button", { name: /Copy link/ }).disabled, true);
  assert.equal(screen.getByRole("button", { name: /Retry/ }).disabled, true);
  assert.ok(screen.getByRole("button", { name: /Close viewer/ }), "the viewer can still be closed");
});

test("viewer: version links explain the version limitation; fullscreen targets the viewer frame", async () => {
  setup();
  let fullscreenOn = null;
  document.documentElement.requestFullscreen = async () => {};
  window.HTMLElement.prototype.requestFullscreen = async function () { fullscreenOn = this; };
  try {
    render(h(DesignViewer, { resource: resource(1, { versionId: "99", originalUrl: `https://www.figma.com/design/${KEY}?node-id=1-1&version-id=99` }), onClose() {} }));
    assert.match(document.body.textContent, /names a specific version, but the viewer may show the latest/);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Fullscreen/ })); });
    assert.ok(fullscreenOn?.contains(iframes()[0]), "the frame container goes fullscreen");
  } finally {
    delete document.documentElement.requestFullscreen;
    delete window.HTMLElement.prototype.requestFullscreen;
  }
});

test("viewer: Close returns focus to the control that opened it", async () => {
  setup();
  await mount();
  const opener = screen.getByRole("button", { name: "View Checkout flow" });
  opener.focus();
  await act(async () => { fireEvent.click(opener); });
  await waitFor(() => assert.ok(document.activeElement?.tagName === "H3", "focus moves to the viewer heading"));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Close viewer/ })); });
  assert.equal(iframes().length, 0);
  await waitFor(() => assert.ok(document.activeElement === opener, "focus returns to the opener"));
});

// ---- Stage 5: covers and Thing links ------------------------------------------------------------
const { LinkedDesigns } = await import("../src/features/designs/LinkedDesigns.tsx");
const THING_1 = "60000000-0000-0000-0000-000000000001";
const THING_2 = "60000000-0000-0000-0000-000000000002";
const things = [{ id: THING_1, title: "Build checkout" }, { id: THING_2, title: "QA coupons" }];
const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
const pngFile = (name = "cover.png") => new File([PNG_BYTES], name, { type: "image/png" });
const scriptedCoverDeps = (over = {}) => {
  const log = [];
  let n = 0;
  return {
    log,
    upload: async (k, f, t) => { log.push(["upload", k, t]); if (over.upload) throw over.upload; },
    remove: async (keys) => { log.push(["remove", ...keys]); if (over.remove) throw over.remove; },
    setCover: async (id, k) => { log.push(["setCover", id, k]); if (over.setCover) throw over.setCover; return over.previous ?? null; },
    clearCover: async (id) => { log.push(["clearCover", id]); return over.previous ?? null; },
    newId: () => `u${++n}`,
  };
};
const openEdit = async (name = "Edit Checkout flow") => {
  await act(async () => { fireEvent.click(screen.getByRole("button", { name })); });
  return screen.findByRole("dialog");
};
const chooseFile = async (dialog, file) => {
  const input = dialog.querySelector('input[type="file"]');
  await act(async () => { fireEvent.change(input, { target: { files: [file] } }); });
};

test("covers: the edit dialog uploads, associates and confirms; the row shows the signed cover", async () => {
  setup();
  const firstId = resource(1).id;
  world.coverDeps = scriptedCoverDeps({ previous: `${LIST}/${firstId}/old.png` });
  await mount();
  const dialog = await openEdit();
  assert.match(dialog.textContent, /Cover image \(optional\)/);
  assert.match(dialog.textContent, /Katalist never captures covers automatically/);
  await chooseFile(dialog, pngFile());
  await waitFor(() => assert.match(screen.getByRole("dialog").textContent, /Cover updated\./));
  assert.deepEqual(world.coverDeps.log.map((c) => c[0]), ["upload", "setCover", "remove"]);
  assert.equal(world.coverDeps.log[0][1], `${LIST}/${firstId}/u1.png`);
  assert.equal(world.coverDeps.log[2][1], `${LIST}/${firstId}/old.png`, "the replaced object is cleaned up");
  // A row with a signed cover shows it (decorative image).
  cleanup();
  setup();
  world.pages.first.items[0] = resource(1, { title: "Checkout flow", coverStorageKey: `${LIST}/${firstId}/c.png` });
  world.coverUrls[`${LIST}/${firstId}/c.png`] = "https://signed.example/c.png?token=1";
  await mount();
  await waitFor(() => assert.equal(rows()[0].querySelector("img")?.getAttribute("src"), "https://signed.example/c.png?token=1"));
  assert.equal(rows()[0].querySelector("img").getAttribute("alt"), "");
});

test("covers: invalid files are refused before any upload, with a clear message", async () => {
  setup();
  world.coverDeps = scriptedCoverDeps();
  await mount();
  const dialog = await openEdit();
  await chooseFile(dialog, new File([Uint8Array.from([..."GIF89a"].map((c) => c.charCodeAt(0)))], "a.gif", { type: "image/gif" }));
  await waitFor(() => assert.match(screen.getByRole("dialog").textContent, /PNG, JPEG or WebP/));
  await chooseFile(screen.getByRole("dialog"), new File([new Uint8Array(16)], "fake.png", { type: "image/png" }));
  await waitFor(() => assert.match(screen.getByRole("dialog").textContent, /does not look like a PNG, JPEG or WebP/));
  const big = new File([PNG_BYTES], "big.png", { type: "image/png" });
  Object.defineProperty(big, "size", { value: 6 * 1024 * 1024 });
  await chooseFile(screen.getByRole("dialog"), big);
  await waitFor(() => assert.match(screen.getByRole("dialog").textContent, /larger than 5 MB/));
  assert.deepEqual(world.coverDeps.log, [], "nothing was uploaded");
  assert.doesNotMatch(screen.getByRole("dialog").textContent, /Cover updated/);
});

test("covers: an upload or association failure is shown, never reported as success, and cleans up", async () => {
  setup();
  world.coverDeps = scriptedCoverDeps({ upload: new DesignOperationError("unknown", "Storage is down.") });
  await mount();
  let dialog = await openEdit();
  await chooseFile(dialog, pngFile());
  await waitFor(() => assert.match(within(screen.getByRole("dialog")).getByRole("alert").textContent, /Storage is down\. Your current cover is unchanged\./));
  assert.doesNotMatch(screen.getByRole("dialog").textContent, /Cover updated/);
  assert.deepEqual(world.coverDeps.log.map((c) => c[0]), ["upload"]);
  // Association rejected (for example: lost permission): the new object is deleted again.
  world.coverDeps = scriptedCoverDeps({ setCover: new DesignOperationError("forbidden", "You don't have permission to manage designs in this List.") });
  await chooseFile(screen.getByRole("dialog"), pngFile());
  await waitFor(() => assert.match(within(screen.getByRole("dialog")).getByRole("alert").textContent, /don't have permission/));
  assert.deepEqual(world.coverDeps.log.map((c) => c[0]), ["upload", "setCover", "remove"]);
  assert.doesNotMatch(screen.getByRole("dialog").textContent, /Cover updated/);
});

test("covers: removing a cover works and an unremovable old object is disclosed", async () => {
  setup();
  const id = resource(1).id;
  world.pages.first.items[0] = resource(1, { title: "Checkout flow", coverStorageKey: `${LIST}/${id}/c.png` });
  world.coverDeps = scriptedCoverDeps({ previous: `${LIST}/${id}/c.png`, remove: new Error("storage refused") });
  await mount();
  const dialog = await openEdit();
  await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Remove cover" })); });
  await waitFor(() => assert.match(screen.getByRole("dialog").textContent, /Cover removed\. The image could not be deleted from storage\./));
  assert.deepEqual(world.coverDeps.log.map((c) => c[0]), ["clearCover", "remove"]);
});

test("covers: view-only members never get cover controls", async () => {
  setup();
  await mount("view_only");
  assert.equal(screen.queryAllByRole("button", { name: /^Edit / }).length, 0);
  assert.equal(document.querySelector('input[type="file"]'), null);
});

test("Thing links: link, list, open the Thing's discussion, and unlink", async () => {
  setup();
  const opened = [];
  await mount("collaborator", { things, onOpenThing: (id) => opened.push(id) });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "View Checkout flow" })); });
  const panel = await screen.findByTestId("design-thing-links");
  await waitFor(() => assert.match(panel.textContent, /No Things are linked to this design yet/));
  const select = within(panel).getByLabelText("Link a Thing from this List");
  assert.deepEqual([...select.options].map((o) => o.textContent), ["Choose a Thing", "Build checkout", "QA coupons"]);
  fireEvent.change(select, { target: { value: THING_1 } });
  await act(async () => { fireEvent.click(within(panel).getByRole("button", { name: "Link Thing" })); });
  assert.deepEqual(calls.find((c) => c[0] === "link"), ["link", resource(1).id, THING_1]);
  await waitFor(() => assert.match(screen.getByTestId("design-thing-links").textContent, /Build checkout/));
  assert.deepEqual([...within(screen.getByTestId("design-thing-links")).getByLabelText("Link a Thing from this List").options].map((o) => o.textContent), ["Choose a Thing", "QA coupons"], "linked Things are not offered twice");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Open discussion for Build checkout" })); });
  assert.deepEqual(opened, [THING_1]);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Unlink Build checkout" })); });
  assert.deepEqual(calls.find((c) => c[0] === "unlink"), ["unlink", resource(1).id, THING_1]);
  await waitFor(() => assert.match(screen.getByTestId("design-thing-links").textContent, /No Things are linked/));
});

test("Thing links: view-only members can read and open Things but not link or unlink; link errors are explained", async () => {
  setup();
  world.links = [{ id: "50000000-0000-0000-0000-000000000001", resourceId: resource(1).id, thingId: THING_1, listId: LIST, createdAt: "2026-10-08T10:00:00Z" }];
  await mount("view_only", { things, onOpenThing() {} });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "View Checkout flow" })); });
  const panel = await screen.findByTestId("design-thing-links");
  await waitFor(() => assert.match(panel.textContent, /Build checkout/));
  assert.ok(within(panel).getByRole("button", { name: /Open discussion for Build checkout/ }));
  assert.equal(within(panel).queryByRole("button", { name: /Unlink/ }), null);
  assert.equal(within(panel).queryByLabelText("Link a Thing from this List"), null);
  cleanup();

  setup();
  world.linkError = new DesignOperationError("cross_list", "Thing not found in this List.");
  await mount("owner", { things });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "View Checkout flow" })); });
  const p2 = await screen.findByTestId("design-thing-links");
  fireEvent.change(within(p2).getByLabelText("Link a Thing from this List"), { target: { value: THING_2 } });
  await act(async () => { fireEvent.click(within(p2).getByRole("button", { name: "Link Thing" })); });
  await waitFor(() => assert.match(within(screen.getByTestId("design-thing-links")).getByRole("alert").textContent, /different List|Thing not found/));
});

test("deep link from a Thing opens the design in the viewer; a missing target is explained", async () => {
  setup();
  await mount("owner", { initialDesignId: resource(2).id });
  await waitFor(() => assert.ok(screen.getByTestId("design-viewer")));
  assert.match(screen.getByTestId("design-viewer").textContent, /Profile/);
  cleanup();
  setup();
  await mount("owner", { initialDesignId: "30000000-0000-0000-0000-0000000000ff" });
  await waitFor(() => assert.match(document.body.textContent, /linked design is not in the active list/));
  assert.equal(screen.queryByTestId("design-viewer"), null);
});

test("Thing detail: linked designs keep the exact frame link; empty and failed reads behave", async () => {
  setup();
  world.thingDesigns = [resource(1, { title: "Checkout flow", originalUrl: `https://www.figma.com/design/${KEY}?node-id=12-34`, nodeId: "12-34" })];
  const tree = () => h(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, h(LinkedDesigns, { thingId: THING_1, listId: LIST }));
  await act(async () => { render(tree()); });
  const section = await screen.findByTestId("thing-linked-designs");
  const figma = within(section).getByRole("link", { name: /Open in Figma/ });
  assert.equal(figma.getAttribute("href"), `https://www.figma.com/design/${KEY}?node-id=12-34`);
  assert.equal(figma.getAttribute("rel"), "noopener noreferrer");
  assert.match(section.textContent, /frame 12-34/);
  const inApp = within(section).getByRole("link", { name: /View in Designs/ });
  assert.match(inApp.getAttribute("href"), new RegExp(`^/lists/${LIST}\\?tab=designs&design=${resource(1).id}`));
  cleanup();

  setup();
  world.thingDesigns = [];
  await act(async () => { render(tree()); });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(screen.queryByTestId("thing-linked-designs"), null, "nothing is rendered when no design is linked");
  assert.equal(document.body.textContent.trim(), "");
  cleanup();

  setup();
  world.thingDesignsError = new DesignOperationError("unknown", "boom");
  await act(async () => { render(tree()); });
  await waitFor(() => assert.match(screen.getByRole("alert").textContent, /Linked designs could not be loaded/));
  assert.ok(screen.getByRole("button", { name: "Retry" }));
});
