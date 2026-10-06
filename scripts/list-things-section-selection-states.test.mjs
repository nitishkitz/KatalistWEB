import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h } from "react";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";

/**
 * T11-01: "Preserve selected Thing by ID. If filtering hides it, provide an
 * explanation and Clear filter action; avoid silently jumping to another
 * Thing... Distinguish selected-visible, selected-filtered-out,
 * selected-unavailable and no-selection."
 *
 * This is a fresh, DOM-level reproduction (mounting the real extracted
 * ListThingsSection.tsx component, not a source-string assertion) of the
 * two states the plan explicitly requires to be told apart:
 *   - selected-filtered-out: the Thing still exists (the route's `selected`
 *     lookup against the full, unfiltered `listThings` succeeded) but the
 *     active quick-filter/person/due filter hides it from `filteredThings`.
 *     This must show a "hidden by your filters" explanation with a Clear
 *     filters action -- never the same copy used for real unavailability.
 *   - selected-unavailable (revoked/deleted): the Thing no longer exists in
 *     `listThings` at all (the route's `selected` lookup itself returned
 *     null). This must show a distinct "no longer available" state with
 *     only a Close action -- no Clear filters, since clearing filters
 *     cannot bring back a genuinely gone/inaccessible Thing.
 * ThingDetailContent/MagicBox/PDFViewer are mocked at their module
 * boundaries (each has its own dedicated coverage elsewhere) so this test
 * exercises only ListThingsSection's own branching between these states.
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

mock.module("@/features/things/ThingDetailContent", {
  namedExports: { ThingDetailContent: () => h("div", { "data-testid": "thing-detail-content" }, "detail") },
});
mock.module("@/features/court/MagicBox", {
  namedExports: { MagicBox: () => null },
});
mock.module("@/features/things/PDFViewer", {
  namedExports: { PDFViewer: () => null },
});

const { ListThingsSection } = await import("@/features/lists/components/ListThingsSection");

function makeThing(id, overrides = {}) {
  return {
    id,
    title: `Thing ${id}`,
    workStatus: "not_started",
    acknowledgement: "waiting_for_catch",
    assignee: { id: "me", name: "Me", initials: "M", avatarUrl: null },
    creator: { id: "me", name: "Me", initials: "M", avatarUrl: null },
    owner: { id: "owner-1", name: "Owner", initials: "O", avatarUrl: null },
    dueAt: null,
    commentCount: 0,
    unreadCommentCount: 0,
    files: [],
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const list = {
  id: "list-1",
  name: "Test List",
  context: "work",
  role: "owner",
  ownerLine: "You",
  members: [],
  memberCount: 1,
  thingCount: 1,
  doneCount: 0,
  inProgressCount: 0,
  unread: 0,
  latestActivity: "",
  updatedAt: "",
  color: "",
};

const laneTabs = [
  { id: "now", label: "Now", color: "#fe1016" },
  { id: "next", label: "NEXT", color: "#022dfb" },
  { id: "later", label: "LATER", color: "#5c0bed" },
];

function baseProps(overrides = {}) {
  return {
    list,
    viewOnly: false,
    laneTabs,
    navLane: "now",
    onSelectLane: mock.fn(),
    laneCounts: { now: 0, next: 0, later: 0 },
    navSearch: "",
    onNavSearchChange: mock.fn(),
    thingsFilter: "all",
    onThingsFilterChange: mock.fn(),
    laneThings: [],
    selectedId: null,
    selected: null,
    selectedIsVisible: false,
    activeThing: null,
    selTint: { bg: "#fff", border: "#000" },
    onSelectThing: mock.fn(),
    onCloseSelected: mock.fn(),
    onClearFilters: mock.fn(),
    selectedFile: null,
    onFileSelect: mock.fn(),
    ...overrides,
  };
}

test("sidebar search stays collapsed until its trailing toolbar button is activated", () => {
  render(h(ListThingsSection, baseProps()));

  const searchButton = screen.getByRole("button", { name: /^search things$/i });
  assert.equal(searchButton.getAttribute("aria-expanded"), "false");
  assert.equal(screen.queryByRole("searchbox", { name: /^search things$/i }), null);
  assert.equal(screen.queryByText(/^0 things$/i), null, "the redundant lane total row should not render");

  fireEvent.click(searchButton);

  const searchInput = screen.getByRole("searchbox", { name: /^search things$/i });
  assert.equal(searchInput, document.activeElement);
  assert.equal(screen.getByRole("button", { name: /close thing search/i }).getAttribute("aria-expanded"), "true");

  fireEvent.keyDown(searchInput, { key: "Escape" });
  assert.equal(screen.queryByRole("searchbox", { name: /^search things$/i }), null);

  cleanup();
});

test("selected-filtered-out: Thing exists but is hidden by the active filter -- shows Clear filters + Close, not the unavailable copy", () => {
  const onClearFilters = mock.fn();
  const onCloseSelected = mock.fn();
  const thing = makeThing("t1");
  render(
    h(ListThingsSection, baseProps({
      selectedId: "t1",
      selected: thing,
      selectedIsVisible: false,
      activeThing: null,
      onClearFilters,
      onCloseSelected,
    })),
  );

  assert.ok(screen.getByText(/hidden by your filters/i));
  assert.ok(screen.queryByText(/no longer available/i) === null, "must not show the unavailable copy for a merely-filtered Thing");
  assert.ok(screen.queryByTestId("thing-detail-content") === null, "detail content must not render while filtered out");

  fireEvent.click(screen.getByRole("button", { name: /clear filters/i }));
  assert.equal(onClearFilters.mock.calls.length, 1);

  fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
  assert.equal(onCloseSelected.mock.calls.length, 1);

  cleanup();
});

test("selected-unavailable: Thing no longer resolves at all -- shows a distinct 'no longer available' state with only Close, no Clear filters", () => {
  const onClearFilters = mock.fn();
  const onCloseSelected = mock.fn();
  render(
    h(ListThingsSection, baseProps({
      selectedId: "gone-id",
      selected: null,
      selectedIsVisible: false,
      activeThing: null,
      onClearFilters,
      onCloseSelected,
    })),
  );

  assert.ok(screen.getByText(/no longer available/i));
  assert.ok(screen.queryByText(/hidden by your filters/i) === null, "must not show the filtered-out copy for a genuinely gone Thing");
  assert.ok(
    screen.queryByRole("button", { name: /clear filters/i }) === null,
    "Clear filters cannot recover a Thing that is actually gone, so it must not be offered here",
  );

  fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
  assert.equal(onCloseSelected.mock.calls.length, 1);
  assert.equal(onClearFilters.mock.calls.length, 0);

  cleanup();
});

test("selected-visible: a visible selection renders the real detail content, not either fallback state", () => {
  const thing = makeThing("t1");
  render(
    h(ListThingsSection, baseProps({
      selectedId: "t1",
      selected: thing,
      selectedIsVisible: true,
      activeThing: thing,
      laneThings: [thing],
    })),
  );

  assert.ok(screen.getByTestId("thing-detail-content"));
  assert.ok(screen.queryByText(/hidden by your filters/i) === null);
  assert.ok(screen.queryByText(/no longer available/i) === null);

  cleanup();
});

test("no-selection with Things present falls back to the first available Thing's detail (existing activeThing behavior), not an error/empty state", () => {
  const thing = makeThing("t1");
  render(
    h(ListThingsSection, baseProps({
      selectedId: null,
      selected: null,
      selectedIsVisible: false,
      activeThing: thing,
      laneThings: [thing],
    })),
  );

  assert.ok(screen.getByTestId("thing-detail-content"));
  assert.ok(screen.queryByText(/no longer available/i) === null);

  cleanup();
});
