import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EMPTY_CRITERIA,
  EMPTY_DRAFT,
  describeUrl,
  filterDesigns,
  hasClientCriteria,
  matchesSearch,
  parseTagInput,
  resolveLibraryState,
  validateDraft,
} from "@/features/designs/design-library-model";
import { DesignOperationError, toDesignError } from "@/features/designs/design-queries";

const KEY = "AbCdEf1234567890xyZ123";
const r = (id, over = {}) => ({
  id, listId: "L", kind: "design", fileKey: KEY, nodeId: null, startingPointNodeId: null, versionId: null, pageId: null,
  identityKey: id, originalUrl: `https://www.figma.com/design/${KEY}`, title: id, notes: null, tags: [], ownerProfileId: null,
  folderId: null, coverStorageKey: null, createdBy: null, createdAt: "2026-10-08T10:00:00Z", updatedAt: "2026-10-08T10:00:00Z",
  archivedAt: null, ...over,
});
const base = { preview: false, online: true, isPaused: false, isLoading: false, hasFetchedOnce: true, error: null, itemCount: 1 };
const err = (code) => new DesignOperationError(code, code);

test("search matches title, tags and notes; every term must match", () => {
  const d = r("a", { title: "Checkout Flow", tags: ["Payments", "web"], notes: "Handles coupon errors" });
  assert.equal(matchesSearch(d, "checkout"), true);
  assert.equal(matchesSearch(d, "PAYMENTS"), true);
  assert.equal(matchesSearch(d, "coupon"), true);
  assert.equal(matchesSearch(d, "checkout coupon"), true);
  assert.equal(matchesSearch(d, "checkout mobile"), false);
  assert.equal(matchesSearch(d, "   "), true);
  assert.equal(matchesSearch(d, d.originalUrl), false, "search never reaches into the Figma link or file key");
});

test("type, owner and favorites filters combine with search", () => {
  const items = [
    r("a", { kind: "design", ownerProfileId: "p1", tags: ["web"] }),
    r("b", { kind: "prototype", ownerProfileId: "p2" }),
    r("c", { kind: "design", ownerProfileId: null }),
  ];
  const favs = new Set(["b"]);
  const ids = (c) => filterDesigns(items, { ...EMPTY_CRITERIA, ...c }, favs).map((x) => x.id);
  assert.deepEqual(ids({}), ["a", "b", "c"]);
  assert.deepEqual(ids({ kind: "design" }), ["a", "c"]);
  assert.deepEqual(ids({ owner: "p2" }), ["b"]);
  assert.deepEqual(ids({ owner: "unowned" }), ["c"]);
  assert.deepEqual(ids({ favoritesOnly: true }), ["b"]);
  assert.deepEqual(ids({ kind: "design", search: "web" }), ["a"]);
  assert.deepEqual(ids({ kind: "prototype", favoritesOnly: true, owner: "p1" }), []);
});

test("hasClientCriteria is false only for the untouched defaults", () => {
  assert.equal(hasClientCriteria(EMPTY_CRITERIA), false);
  assert.equal(hasClientCriteria({ ...EMPTY_CRITERIA, search: " " }), false);
  for (const c of [{ search: "x" }, { kind: "figjam" }, { owner: "p" }, { favoritesOnly: true }]) {
    assert.equal(hasClientCriteria({ ...EMPTY_CRITERIA, ...c }), true);
  }
});

test("a failed or paused read is never presented as an empty library", () => {
  const none = { ...base, hasFetchedOnce: false, itemCount: 0 };
  assert.equal(resolveLibraryState({ ...none, error: err("unknown") }).state, "error");
  assert.equal(resolveLibraryState({ ...none, error: err("unknown"), isLoading: false }).state, "error");
  assert.equal(resolveLibraryState({ ...none, isPaused: true }).state, "offline");
  assert.equal(resolveLibraryState({ ...none, online: false }).state, "offline");
  assert.equal(resolveLibraryState({ ...none, isLoading: true }).state, "loading");
  assert.equal(resolveLibraryState({ ...none }).state, "loading", "unknown is never empty");
  assert.equal(resolveLibraryState({ ...base, itemCount: 0 }).state, "empty");
});

test("distinct states: preview, missing migration, lost access, stale refresh failure", () => {
  assert.equal(resolveLibraryState({ ...base, preview: true, hasFetchedOnce: false }).state, "preview-unavailable");
  assert.equal(resolveLibraryState({ ...base, hasFetchedOnce: false, error: err("migration_missing") }).state, "migration-missing");
  assert.equal(resolveLibraryState({ ...base, error: err("forbidden") }).state, "access-lost");
  assert.equal(resolveLibraryState({ ...base, error: err("not_authenticated") }).state, "access-lost");
  const stale = resolveLibraryState({ ...base, error: err("unknown") });
  assert.deepEqual(stale, { state: "ready", refreshFailed: true });
});

test("missing-table and missing-function database errors map to migration_missing", () => {
  for (const code of ["PGRST205", "PGRST202", "42P01", "42883"]) {
    assert.equal(toDesignError({ message: "x", code }).code, "migration_missing", code);
  }
});

test("draft validation: URL and title required, optional fields bounded", () => {
  assert.deepEqual(Object.keys(validateDraft(EMPTY_DRAFT)).sort(), ["title", "url"]);
  const ok = { ...EMPTY_DRAFT, url: `https://www.figma.com/design/${KEY}/N`, title: "Checkout" };
  assert.deepEqual(validateDraft(ok), {});
  assert.ok(validateDraft({ ...ok, url: "https://evil.com/design/x" }).url);
  assert.ok(validateDraft({ ...ok, title: "x".repeat(201) }).title);
  assert.ok(validateDraft({ ...ok, notes: "n".repeat(4001) }).notes);
  assert.ok(validateDraft({ ...ok, tags: Array.from({ length: 21 }, (_, i) => `t${i}`).join(",") }).tags);
  assert.ok(validateDraft({ ...ok, tags: "g".repeat(41) }).tags);
});

test("tag input is normalized and the URL helper describes the target", () => {
  assert.deepEqual(parseTagInput("Web, web ,Mobile,,\nAPI"), ["Web", "Mobile", "API"]);
  assert.equal(describeUrl(""), null);
  assert.deepEqual(describeUrl(`https://www.figma.com/design/${KEY}/N?node-id=1-2`), { ok: true, text: "Design · frame 1-2" });
  assert.equal(describeUrl("https://evil.com/x").ok, false);
});
