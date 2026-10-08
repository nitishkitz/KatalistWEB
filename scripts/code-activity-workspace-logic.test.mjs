import assert from "node:assert/strict";
import { test } from "node:test";
import { splitFromPatch, toSplitRows, countFromPatch } from "../src/features/code-activity/workspace/diff.ts";
import { EMPTY_FILTERS, activeFilterCount, authorKey, dateBounds, issuesFor, matchItem, normalizePath, pathMatches, statusOptions, typesFor } from "../src/features/code-activity/workspace/filters.ts";
import { deriveCheckItems, mergeSources, sourcesFor } from "../src/features/code-activity/workspace/merge.ts";
import { statusOf } from "../src/features/code-activity/workspace/types.ts";
import { parsePatch } from "../src/features/code-activity/format.ts";

const SHA = (c) => c.repeat(40);
const T = (minutesAgo) => new Date(Date.UTC(2026, 9, 7, 12) - minutesAgo * 60_000).toISOString();
const item = (id, minutesAgo, extra = {}) => ({
  id, kind: "commit", title: `title ${id}`, author: { name: "Ana", login: "ana", avatarUrl: null }, occurredAt: T(minutesAgo), branch: "main", baseBranch: null,
  sha: id.startsWith("commit:") ? id.slice(7) : null, number: null, prState: null, checkState: null, checksRevision: null, checks: null, stats: null, statsStatus: "unknown",
  url: null, savedId: null, deployment: null, ...extra,
});
const src = (items, hasMore = false, loaded = true) => ({ loaded, items, hasMore });
const ids = (r) => r.items.map((i) => i.id);

// ---- merge ------------------------------------------------------------------------------------------

test("merge: progressive workspaces show available rows without waiting for sources or older pages", () => {
  const ready = src([item("a", 1), item("b", 4)], true);
  const pending = src([], false, false);
  const first = mergeSources([ready, pending], { progressive: true });
  assert.deepEqual(ids(first), ["a", "b"]);
  assert.equal(first.heldBack, 0);
  assert.equal(first.moreAvailable, true);
  const later = mergeSources([ready, src([item("c", 2), item("a", 1)])], { progressive: true });
  assert.deepEqual(ids(later), ["a", "c", "b"], "late rows sort deterministically without repeating identities");
});

test("merge: newest first across sources with a stable tie-break, and an identity never repeats", () => {
  const a = src([item("commit:" + SHA("a"), 5), item("commit:" + SHA("b"), 30)]);
  const b = src([item("pr:7", 10, { kind: "pull_request", sha: SHA("c") }), item("pr:6", 30, { kind: "pull_request", sha: SHA("d") })]);
  const merged = mergeSources([a, b]);
  assert.deepEqual(ids(merged), ["commit:" + SHA("a"), "pr:7", "commit:" + SHA("b"), "pr:6"], "newest first; the two 30-minute-old items tie and order by id");
  const tie = mergeSources([src([item("zz", 5)]), src([item("aa", 5)])]);
  assert.deepEqual(ids(tie), ["aa", "zz"], "equal times order by id");
  const dup = mergeSources([src([item("x", 5)]), src([item("x", 5)])]);
  assert.deepEqual(ids(dup), ["x"], "no repeated identity");
});

test("merge: a late page can never be inserted above something already shown (the horizon)", () => {
  // The commits source has only reached 30 minutes ago and has more pages; the saved source is complete and has a 40-minute-old row.
  const commits = src([item("commit:" + SHA("a"), 5), item("commit:" + SHA("b"), 30)], true);
  const saved = src([item("pr:7", 20, { kind: "pull_request" }), item("pr:6", 40, { kind: "pull_request" })], false);
  const first = mergeSources([commits, saved]);
  assert.deepEqual(ids(first), ["commit:" + SHA("a"), "pr:7"], "only rows strictly newer than the commits horizon (30 min) are shown");
  assert.equal(first.heldBack, 2);
  assert.equal(first.moreAvailable, true);
  // The next commits page brings a 35-minute-old commit and moves the horizon to 60 minutes.
  const second = mergeSources([src([...commits.items, item("commit:" + SHA("c"), 35), item("commit:" + SHA("d"), 60)], true), saved]);
  assert.deepEqual(ids(second), ["commit:" + SHA("a"), "pr:7", "commit:" + SHA("b"), "commit:" + SHA("c"), "pr:6"]);
  // Everything already shown is still in the same relative order: nothing slipped in above it.
  for (let i = 0; i < ids(first).length; i += 1) assert.equal(ids(second)[i], ids(first)[i]);
  const done = mergeSources([src([...second.items], false), saved]);
  assert.equal(done.moreAvailable, false);
  assert.equal(done.heldBack, 0);
});

test("merge: a source that has not loaded, or loaded nothing yet but has more, holds everything back", () => {
  assert.deepEqual(ids(mergeSources([src([], true, false), src([item("a", 1)])])), []);
  assert.deepEqual(ids(mergeSources([src([], true, true), src([item("a", 1)])])), []);
  assert.deepEqual(ids(mergeSources([src([], false, true), src([item("a", 1)])])), ["a"], "an empty finished source holds nothing back");
});

test("merge: a push is hidden only when a loaded commit has the same SHA; otherwise it stays, as a push", () => {
  const commit = item("commit:" + SHA("a"), 5);
  const covered = item("push:1", 5, { kind: "push", sha: SHA("a") });
  const orphan = item("push:2", 9, { kind: "push", sha: SHA("f"), title: "Push to old" });
  const merged = mergeSources([src([commit]), src([covered, orphan])]);
  assert.deepEqual(ids(merged), ["commit:" + SHA("a"), "push:2"]);
  assert.equal(merged.items[1].kind, "push", "never relabelled as a commit");
});

test("merge: categories read the sources they need; checks are derived only from current results", () => {
  assert.deepEqual(sourcesFor("commits"), ["commits"]);
  assert.deepEqual(sourcesFor("all"), ["commits", "saved", "deployments"]);
  assert.deepEqual(sourcesFor("checks"), ["commits", "saved"]);
  const rows = [
    item("commit:" + SHA("a"), 5, { sha: SHA("a"), checkState: "passed", checksRevision: SHA("a") }),
    item("commit:" + SHA("b"), 6, { sha: SHA("b"), checkState: "failing", checksRevision: SHA("z") }),
    item("commit:" + SHA("c"), 7, { sha: SHA("c"), checkState: "none", checksRevision: SHA("c") }),
    item("commit:" + SHA("d"), 8, { sha: SHA("d"), checkState: null }),
    item("pr:1", 9, { kind: "pull_request", sha: SHA("a"), checkState: "passed", checksRevision: SHA("a") }),
  ];
  const checks = deriveCheckItems(rows);
  assert.deepEqual(checks.map((c) => c.id), ["check:" + SHA("a")], "stale, none, unknown and duplicate-revision results are not shown as checks");
  assert.equal(checks[0].kind, "check");
});

// ---- filters ----------------------------------------------------------------------------------------

test("filters: all compose with AND, several choices inside one filter with OR", () => {
  const rows = [
    item("commit:" + SHA("a"), 5, { checkState: "passed" }),
    item("commit:" + SHA("b"), 6, { checkState: "failing", author: { name: "Bo", login: "bo", avatarUrl: null } }),
    item("pr:7", 7, { kind: "pull_request", prState: "open", author: { name: "Bo", login: "bo", avatarUrl: null } }),
  ];
  const ctx = { knownPaths: new Map() };
  const run = (f) => rows.filter((r) => matchItem(r, { ...EMPTY_FILTERS, ...f }, ctx).match).map((r) => r.id);
  assert.equal(run({}).length, 3);
  assert.deepEqual(run({ authors: ["bo"] }), ["commit:" + SHA("b"), "pr:7"]);
  assert.deepEqual(run({ authors: ["bo"], types: ["pull_request"] }), ["pr:7"], "AND between filters");
  assert.deepEqual(run({ authors: ["ana", "bo"], statuses: ["passed", "open"] }), ["commit:" + SHA("a"), "pr:7"], "OR inside a filter");
  assert.deepEqual(run({ statuses: ["failing"], types: ["commit"], authors: ["bo"] }), ["commit:" + SHA("b")]);
  assert.equal(authorKey(rows[1]), "bo");
  assert.equal(authorKey({ author: { name: "No Login", login: null } }), "no login");
});

test("filters: dates use the local calendar day and an invalid range applies nothing", () => {
  const local = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min).toISOString();
  const late = item("a", 0, { occurredAt: local(2026, 10, 7, 23, 59) });
  const early = item("b", 0, { occurredAt: local(2026, 10, 8, 0, 1) });
  const ctx = { knownPaths: new Map() };
  const day = { ...EMPTY_FILTERS, dateFrom: "2026-10-07", dateTo: "2026-10-07" };
  assert.equal(matchItem(late, day, ctx).match, true, "23:59 local is still that day");
  assert.equal(matchItem(early, day, ctx).match, false, "00:01 the next day is not");
  assert.equal(matchItem(early, { ...EMPTY_FILTERS, dateFrom: "2026-10-08" }, ctx).match, true);
  assert.equal(matchItem(late, { ...EMPTY_FILTERS, dateTo: "2026-10-06" }, ctx).match, false);
  for (const bad of [["2026-10-09", "2026-10-07"], ["2026-02-31", null], ["yesterday", null]]) {
    const b = dateBounds(...bad);
    assert.ok(b.issue, JSON.stringify(bad));
    assert.deepEqual([b.fromMs, b.toMs], [null, null], "an invalid range filters nothing");
  }
  assert.ok(issuesFor({ ...EMPTY_FILTERS, dateFrom: "2026-10-09", dateTo: "2026-10-07" }).date);
});

test("filters: a path is literal (prefix or exact), and rows whose files are unknown stay and say so", () => {
  assert.deepEqual(normalizePath("./src//features/"), { path: "src/features" });
  assert.deepEqual(normalizePath("  "), { path: null });
  assert.ok(normalizePath("../etc/passwd").issue);
  assert.ok(normalizePath("src/./x").issue);
  assert.equal(normalizePath("a\\b").path, "a/b");
  assert.ok(pathMatches("src/features/auth/gate.css", "src/features"));
  assert.ok(pathMatches("src/features/auth/gate.css", "gate.css"), "a bare file name matches at a path boundary");
  assert.ok(!pathMatches("src/features/auth/gate.css", "ate.css"), "never a partial name");
  assert.ok(!pathMatches("src/featuresX/a.css", "src/features"), "never a partial directory");
  assert.ok(!pathMatches("a.ts", ".*"), "no regular expressions");
  const row = item("commit:" + SHA("a"), 1);
  const f = { ...EMPTY_FILTERS, path: "src/auth" };
  assert.deepEqual(matchItem(row, f, { knownPaths: new Map() }), { match: true, pathChecked: false });
  assert.deepEqual(matchItem(row, f, { knownPaths: new Map([[row.id, ["src/auth/gate.css"]]]) }), { match: true, pathChecked: true });
  assert.deepEqual(matchItem(row, f, { knownPaths: new Map([[row.id, ["docs/readme.md"]]]) }), { match: false, pathChecked: true });
});

test("search: case-insensitive text over title, author, branch, known paths and SHA prefix; hostile text is only text", () => {
  const row = item("commit:" + SHA("a"), 1, { title: "Fix: preserve (auth) styling [v2]", branch: "feature/Auth", sha: "abc123def456" + "0".repeat(28) });
  const ctx = { knownPaths: new Map([[row.id, ["src/Auth/gate.css"]]]) };
  const hit = (q) => matchItem(row, { ...EMPTY_FILTERS, search: q }, ctx).match;
  for (const q of ["PRESERVE", "ana", "feature/auth", "gate.css", "abc123", "(auth)", "[v2]"]) assert.ok(hit(q), q);
  for (const q of ["zzz", ".*", "^fix", "abc124", "<script>"]) assert.ok(!hit(q), q);
  assert.ok(!matchItem({ ...row, sha: null }, { ...EMPTY_FILTERS, search: "abc123" }, ctx).match);
  assert.equal(activeFilterCount({ ...EMPTY_FILTERS, authors: ["a"], search: "x", dateFrom: "2026-10-01" }), 3);
  assert.equal(activeFilterCount(EMPTY_FILTERS), 0);
});

test("status options: only states that can occur in the category are offered", () => {
  assert.deepEqual(statusOptions("pull_requests"), ["open", "draft", "merged", "closed"]);
  assert.ok(statusOptions("deployments").includes("success") && !statusOptions("deployments").includes("open"));
  assert.deepEqual(statusOptions("checks"), ["passed", "failing", "pending"]);
  assert.ok(statusOptions("all").includes("merged") && statusOptions("all").includes("success") && statusOptions("all").includes("failing"));
  assert.deepEqual(typesFor("commits"), ["commit"]);
  assert.deepEqual(typesFor("all"), ["commit", "pull_request", "push", "deployment"]);
  assert.equal(statusOf(item("a", 1, { kind: "pull_request", prState: "merged" })), "merged");
  assert.equal(statusOf(item("d", 1, { kind: "deployment", deployment: { state: "failure" } })), "failure");
  assert.equal(statusOf(item("c", 1, { checkState: "passed" })), "passed");
  assert.equal(statusOf(item("n", 1)), "unknown");
});

// ---- split diff ---------------------------------------------------------------------------------------

const PATCH = ["@@ -20,3 +20,9 @@ .auth-input {", " }", " ", "-old one", "-old two", "+new one", "+new two", "+new three", " }", "\\ No newline at end of file"].join("\n");

test("split diff: hunk line numbers, ordered pairing of removals with additions, and blanks opposite extras", () => {
  const rows = splitFromPatch(PATCH);
  assert.deepEqual(rows[0], { type: "hunk", text: "@@ -20,3 +20,9 @@ .auth-input {" });
  assert.deepEqual(rows[1], { type: "ctx", left: { no: 20, text: "}" }, right: { no: 20, text: "}" } });
  assert.deepEqual(rows[2].left, { no: 21, text: "" });
  const changes = rows.filter((r) => r.type === "change");
  assert.equal(changes.length, 3, "two removals paired with the first two additions, then the third addition alone");
  assert.deepEqual(changes[0], { type: "change", left: { no: 22, text: "old one" }, right: { no: 22, text: "new one" } });
  assert.deepEqual(changes[1], { type: "change", left: { no: 23, text: "old two" }, right: { no: 23, text: "new two" } });
  assert.deepEqual(changes[2], { type: "change", left: null, right: { no: 24, text: "new three" } }, "a placeholder faces the extra addition; no invented line");
  assert.equal(rows.at(-1).type, "meta");
  assert.equal(rows.at(-2).type, "ctx");
});

test("split diff: insert-only, delete-only, and several change groups in one hunk", () => {
  const insertOnly = toSplitRows(parsePatch("@@ -1,1 +1,3 @@\n a\n+b\n+c"));
  assert.deepEqual(insertOnly.filter((r) => r.type === "change").map((r) => [r.left, r.right?.text]), [[null, "b"], [null, "c"]]);
  const deleteOnly = toSplitRows(parsePatch("@@ -1,3 +1,1 @@\n a\n-b\n-c"));
  assert.deepEqual(deleteOnly.filter((r) => r.type === "change").map((r) => [r.left?.text, r.right]), [["b", null], ["c", null]]);
  const groups = toSplitRows(parsePatch("@@ -1,5 +1,5 @@\n-a\n+A\n m\n-b\n+B\n"));
  const kinds = groups.map((r) => r.type);
  assert.deepEqual(kinds.slice(0, 5), ["hunk", "change", "ctx", "change", "ctx"]);
  assert.deepEqual(groups[1], { type: "change", left: { no: 1, text: "a" }, right: { no: 1, text: "A" } });
  assert.deepEqual(groups[3], { type: "change", left: { no: 3, text: "b" }, right: { no: 3, text: "B" } });
  // removal AFTER additions starts a new pairing group instead of pairing backwards
  const reversed = toSplitRows(parsePatch("@@ -1,2 +1,2 @@\n+x\n-y"));
  assert.equal(reversed.filter((r) => r.type === "change").length, 2);
});

test("split diff: the same patch gives identical counts in both modes, and text is never altered", () => {
  const hostile = '@@ -1,1 +1,1 @@\n-<script>alert(1)</script>\n+<img src=x onerror="alert(1)">';
  const rows = splitFromPatch(hostile);
  const change = rows.find((r) => r.type === "change");
  assert.equal(change.left.text, "<script>alert(1)</script>");
  assert.equal(change.right.text, '<img src=x onerror="alert(1)">');
  const unified = parsePatch(PATCH);
  const counts = countFromPatch(PATCH);
  assert.deepEqual(counts, { additions: unified.filter((l) => l.kind === "add").length, deletions: unified.filter((l) => l.kind === "del").length });
  const split = splitFromPatch(PATCH).filter((r) => r.type === "change");
  assert.equal(split.filter((r) => r.right).length, counts.additions);
  assert.equal(split.filter((r) => r.left).length, counts.deletions);
  assert.deepEqual(splitFromPatch(""), splitFromPatch("") , "empty is stable");
});
