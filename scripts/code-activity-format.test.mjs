import assert from "node:assert/strict";
import { test } from "node:test";
import {
  boundPatch,
  checkSummaryText,
  countChecks,
  dayGroup,
  deriveCheckState,
  initialsOf,
  middleEllipsis,
  parsePatch,
  relativeTime,
  shortSha,
  sizeLabel,
} from "../src/features/code-activity/format.ts";
import { applyFeedFilter } from "../src/features/code-activity/feed-filter.ts";
import { buildPreviewChanges } from "./fixtures/code-activity/fixtures.ts";
import { parseRepositoryInput, matchRepository } from "../src/features/code-activity/repository.ts";
import { CODE_ACTIVITY_LIMITS } from "../src/features/code-activity/limits.ts";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const run = (status, conclusion) => ({ id: "x", name: "n", status, conclusion, durationLabel: null, url: null });

test("relative time reads naturally and tolerates bad input", () => {
  const ago = (ms) => new Date(NOW - ms).toISOString();
  assert.equal(relativeTime(ago(10_000), NOW), "just now");
  assert.equal(relativeTime(ago(5 * 60_000), NOW), "5 min ago");
  assert.equal(relativeTime(ago(2 * 3_600_000), NOW), "2 hours ago");
  assert.equal(relativeTime(ago(3_600_000), NOW), "1 hour ago");
  assert.equal(relativeTime(ago(3 * 86_400_000), NOW), "3 days ago");
  assert.equal(relativeTime("nope", NOW), "time unknown");
});

test("day groups are Today, Yesterday, then Earlier", () => {
  const noon = Date.parse("2026-10-07T12:00:00");
  assert.equal(dayGroup(new Date(noon - 3_600_000).toISOString(), noon), "Today");
  assert.equal(dayGroup(new Date(noon - 24 * 3_600_000).toISOString(), noon), "Yesterday");
  assert.equal(dayGroup(new Date(noon - 5 * 24 * 3_600_000).toISOString(), noon), "Earlier");
});

test("size labels never invent a zero", () => {
  assert.equal(sizeLabel(24, 8, 3), "+24 −8 · 3 files");
  assert.equal(sizeLabel(1, 1, 1), "+1 −1 · 1 file");
  assert.equal(sizeLabel(0, 0, 2), "+0 −0 · 2 files", "a real zero is shown as zero");
  assert.equal(sizeLabel(null, null, null), "size not available");
  assert.equal(sizeLabel(null, null, 4), "4 files");
});

test("initials and short revisions", () => {
  assert.equal(initialsOf("Sam B."), "SB");
  assert.equal(initialsOf("dependabot (bot)"), "DE");
  assert.equal(initialsOf(""), "?");
  assert.equal(shortSha("2f4c8e7a91b3"), "2f4c8e7");
  assert.equal(shortSha(null), null);
});

test("check state: unreachable is unavailable, empty is none, never confused", () => {
  assert.equal(deriveCheckState([], false), "unavailable");
  assert.equal(deriveCheckState([], true), "none");
  assert.equal(deriveCheckState([run("completed", "success")]), "passed");
  assert.equal(deriveCheckState([run("completed", "success"), run("in_progress", null)]), "pending");
  assert.equal(deriveCheckState([run("completed", "failure"), run("in_progress", null)]), "failing", "a failure outranks a running check");
  assert.equal(deriveCheckState([run("completed", "timed_out")]), "failing");
  assert.equal(deriveCheckState([run("queued", null)]), "pending");
});

test("neutral and skipped runs are neither passes nor failures", () => {
  const counts = countChecks([run("completed", "neutral"), run("completed", "skipped"), run("completed", "success")]);
  assert.deepEqual(counts, { failing: 0, pending: 0, passed: 1, other: 2, total: 3 });
  assert.equal(deriveCheckState([run("completed", "neutral")]), "passed");
});

test("check summary text lists each outcome", () => {
  assert.equal(
    checkSummaryText([run("completed", "failure"), run("in_progress", null), run("completed", "success"), run("completed", "success")]),
    "1 failing · 1 running · 2 passed",
  );
});

// ---- patches -------------------------------------------------------------

test("a unified patch is parsed with correct line numbers", () => {
  const lines = parsePatch(["@@ -10,3 +10,4 @@ fn()", " keep", "-old", "+new", "+extra", " tail"].join("\n"));
  assert.deepEqual(
    lines.map((l) => [l.kind, l.oldNo, l.newNo, l.text]),
    [
      ["hunk", null, null, "@@ -10,3 +10,4 @@ fn()"],
      ["ctx", 10, 10, "keep"],
      ["del", 11, null, "old"],
      ["add", null, 11, "new"],
      ["add", null, 12, "extra"],
      ["ctx", 12, 13, "tail"],
    ],
  );
});

test("markup in a patch stays plain text", () => {
  const payload = `<img src=x onerror="alert(1)"><script>alert(2)</script>`;
  const [, line] = parsePatch(`@@ -1 +1 @@\n+${payload}`);
  assert.equal(line.text, payload, "parsing never alters or interprets the text");
});

test("bounding a patch honors the line limit and cuts on a line boundary", () => {
  const patch = Array.from({ length: 50 }, (_, i) => `+line ${i}`).join("\n");
  const out = boundPatch(patch, { maxBytes: 1_000_000, maxLines: 10 });
  assert.equal(out.state, "truncated");
  assert.equal(out.text.split("\n").length, 10);
  assert.ok(patch.startsWith(out.text));
});

test("bounding a patch honors the byte limit", () => {
  const patch = Array.from({ length: 100 }, () => "x".repeat(99)).join("\n"); // about 100 bytes per line
  const out = boundPatch(patch, { maxBytes: 1_000, maxLines: 1_000_000 });
  assert.equal(out.state, "truncated");
  assert.ok(new TextEncoder().encode(out.text).length <= 1_000);
});

test("bounding counts bytes, not characters", () => {
  const patch = "é".repeat(100); // 200 bytes
  assert.equal(boundPatch(patch, { maxBytes: 150, maxLines: 10 }).state, "omitted");
});

test("small, empty, and missing patches get the right states", () => {
  assert.deepEqual(boundPatch("+a"), { state: "available", text: "+a" });
  assert.equal(boundPatch("").state, "empty");
  assert.equal(boundPatch(null).state, "unavailable");
  assert.equal(boundPatch(undefined).state, "unavailable");
});

test("the default limits are the documented provisional ones", () => {
  assert.equal(CODE_ACTIVITY_LIMITS.patchMaxBytes, 102_400);
  assert.equal(CODE_ACTIVITY_LIMITS.patchMaxLines, 2_000);
  const long = Array.from({ length: 2_600 }, (_, i) => `+r${i}`).join("\n");
  const out = boundPatch(long);
  assert.equal(out.state, "truncated");
  assert.equal(out.text.split("\n").length, 2_000);
});

test("the fixture with a generated file is actually truncated", () => {
  const change = buildPreviewChanges(NOW).find((c) => c.id === "pr-128");
  assert.equal(change.files.find((f) => f.path.endsWith("routes.gen.ts")).patchState, "truncated");
  assert.equal(change.files.find((f) => f.path.endsWith(".png")).patchState, "binary");
});

test("middle ellipsis keeps the file name", () => {
  assert.equal(middleEllipsis("src/a.ts"), "src/a.ts");
  const out = middleEllipsis("src/very/long/directory/structure/that/goes/on/forever/file.tsx", 30);
  assert.ok(out.endsWith("file.tsx"));
  assert.ok(out.length <= 30);
});

// ---- feed filter ---------------------------------------------------------

test("feed filters select the right entries", () => {
  const changes = buildPreviewChanges(NOW);
  assert.ok(applyFeedFilter(changes, "pull_request").every((c) => c.kind === "pull_request"));
  assert.ok(applyFeedFilter(changes, "push").every((c) => c.kind === "push"));
  assert.equal(applyFeedFilter(changes, "all").length, changes.length);
  const failing = applyFeedFilter(changes, "failing");
  assert.ok(failing.length >= 1 && failing.every((c) => c.checkState === "failing" && !c.checksStale));
});

test("a stale check result is not counted as a current failure", () => {
  const changes = buildPreviewChanges(NOW).map((c) => (c.id === "pr-124" ? { ...c, checkState: "failing" } : c));
  assert.ok(!applyFeedFilter(changes, "failing").some((c) => c.id === "pr-124"));
});

// ---- repository input ----------------------------------------------------

test("approved repository URL forms parse to owner/name", () => {
  for (const input of [
    "https://github.com/example-org/website",
    "http://github.com/example-org/website/",
    "github.com/example-org/website",
    "https://www.github.com/example-org/website.git",
    "https://github.com/example-org/website/pull/12?x=1#y",
    "example-org/website",
  ]) {
    assert.equal(parseRepositoryInput(input), "example-org/website", input);
  }
});

test("unapproved or malformed repository input is rejected", () => {
  for (const input of ["", "   ", "https://gitlab.com/a/b", "https://github.com/onlyowner", "javascript:alert(1)", "https://evil.example/github.com/a/b", "a/b/c/d"]) {
    assert.equal(parseRepositoryInput(input), null, input);
  }
});

test("a repository only matches the verified list, case-insensitively", () => {
  const list = [{ id: "1", fullName: "Example-Org/Website", visibility: "private", updatedLabel: "" }];
  assert.equal(matchRepository("https://github.com/example-org/website", list)?.id, "1");
  assert.equal(matchRepository("https://github.com/example-org/other", list), null, "not in the verified list means no connection");
});
