import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseActivityChange,
  parseActivityFeed,
  validateDraft,
} from "../src/features/code-activity/types.ts";
import {
  buildPreviewChanges,
  buildPreviewFeed,
  previewCandidates,
  PREVIEW_PEOPLE,
} from "./fixtures/code-activity/fixtures.ts";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const clone = (v) => JSON.parse(JSON.stringify(v));

test("every fixture change passes the runtime guard, and the feed does too", () => {
  const feed = buildPreviewFeed(NOW);
  const parsed = parseActivityFeed(feed);
  assert.equal(parsed.ok, true, parsed.ok ? "" : parsed.error);
  assert.ok(feed.changes.length >= 7);
});

test("fixtures cover each pull request state, each check state, a push, a gap, and a bot", () => {
  const changes = buildPreviewChanges(NOW);
  const prStates = new Set(changes.map((c) => c.prState).filter(Boolean));
  assert.deepEqual([...prStates].sort(), ["closed", "draft", "merged", "open"]);
  const checkStates = new Set(changes.map((c) => c.checkState));
  for (const s of ["passed", "failing", "pending", "none", "unavailable"]) assert.ok(checkStates.has(s), `missing check state ${s}`);
  assert.ok(changes.some((c) => c.kind === "push" && c.prState === null));
  assert.ok(changes.some((c) => c.kind === "gap" && c.gap));
  assert.ok(changes.some((c) => c.author.kind === "bot"));
  assert.ok(changes.some((c) => c.author.kind === "unknown"));
  assert.ok(changes.some((c) => c.checksStale), "a stale-check example must exist");
  assert.ok(changes.some((c) => c.filesPartial), "a partial-files example must exist");
});

test("pull request state and check state are independent: a merged change can have failing checks in the type", () => {
  const change = clone(buildPreviewChanges(NOW).find((c) => c.prState === "merged"));
  change.checkState = "failing";
  assert.equal(parseActivityChange(change).ok, true);
  assert.equal(change.prState, "merged");
});

test("unknown counts stay null and are never invented as zero", () => {
  const push = buildPreviewChanges(NOW).find((c) => c.kind === "push");
  assert.equal(push.additions, null);
  assert.equal(push.deletions, null);
  assert.equal(push.changedFiles, null);
  const bad = clone(push);
  bad.additions = -1;
  assert.equal(parseActivityChange(bad).ok, false);
  bad.additions = 1.5;
  assert.equal(parseActivityChange(bad).ok, false);
});

test("the guard rejects malformed changes", () => {
  const good = clone(buildPreviewChanges(NOW)[0]);
  const cases = [
    ["not an object", null],
    ["missing id", { ...good, id: "" }],
    ["unknown kind", { ...good, kind: "tag" }],
    ["unknown check state", { ...good, checkState: "green" }],
    ["bad timestamp", { ...good, updatedAt: "yesterday" }],
    ["pull request without state", { ...good, prState: null }],
    ["push with a pull request state", { ...good, kind: "push" }],
    ["files not an array", { ...good, files: "none" }],
    ["gap without a range", { ...good, kind: "gap", prState: null, gap: null }],
    ["pull request with a gap range", { ...good, gap: { from: "a", to: "b", reason: "limit_reached" } }],
  ];
  for (const [name, input] of cases) assert.equal(parseActivityChange(input).ok, false, name);
});

test("patch text must match its state", () => {
  const change = clone(buildPreviewChanges(NOW)[0]);
  const available = change.files.find((f) => f.patchState === "available");
  available.patch = null;
  assert.equal(parseActivityChange(change).ok, false, "available needs text");
  const binary = clone(buildPreviewChanges(NOW)[0]);
  binary.files.find((f) => f.patchState === "binary").patch = "x";
  assert.equal(parseActivityChange(binary).ok, false, "binary must have no text");
  const state = clone(buildPreviewChanges(NOW)[0]);
  state.files[0].patchState = "enormous";
  assert.equal(parseActivityChange(state).ok, false);
});

test("a feed with duplicate change ids is rejected", () => {
  const feed = clone(buildPreviewFeed(NOW));
  feed.changes.push(clone(feed.changes[0]));
  assert.equal(parseActivityFeed(feed).ok, false);
});

test("invalid freshness is rejected", () => {
  const feed = clone(buildPreviewFeed(NOW));
  feed.freshness.syncStatus = "fine";
  assert.equal(parseActivityFeed(feed).ok, false);
});

// ---- assignee candidates -------------------------------------------------

test("assignee candidates are the Owner and Collaborators, never View Only", () => {
  for (const role of ["owner", "collaborator", "view_only"]) {
    const list = previewCandidates(role);
    assert.deepEqual(
      list.map((c) => c.role).sort(),
      ["collaborator", "collaborator", "owner"],
      `role ${role}`,
    );
    const viewOnly = PREVIEW_PEOPLE.find((p) => p.role === "view_only");
    assert.ok(!list.some((c) => c.actorId === viewOnly.actorId));
  }
  assert.equal(previewCandidates("owner").filter((c) => c.isSelf).length, 1);
  assert.equal(previewCandidates("view_only").filter((c) => c.isSelf).length, 0);
});

// ---- draft validation ----------------------------------------------------

const candidates = previewCandidates("owner");
const okFields = () => ({
  title: "Verify navigation",
  description: "Check it.",
  assigneeActorId: candidates[0].actorId,
  dueDate: null,
  ownerImportance: "next",
});

test("a draft needs an explicit assignee and never defaults one", () => {
  const v = validateDraft({ ...okFields(), assigneeActorId: null }, candidates);
  assert.equal(v.ok, false);
  assert.match(v.errors.assignee, /Choose who will own/);
  assert.match(v.errors.assignee, /does not choose for you/);
});

test("an assignee outside the candidate set is rejected, including a View Only member", () => {
  const viewOnly = PREVIEW_PEOPLE.find((p) => p.role === "view_only");
  const v = validateDraft({ ...okFields(), assigneeActorId: viewOnly.actorId }, candidates);
  assert.equal(v.ok, false);
  assert.ok(v.errors.assignee);
});

test("a due date is optional and, when present, must be a real date", () => {
  assert.equal(validateDraft({ ...okFields(), dueDate: null }, candidates).ok, true);
  assert.equal(validateDraft({ ...okFields(), dueDate: "2026-10-09" }, candidates).ok, true);
  assert.ok(validateDraft({ ...okFields(), dueDate: "Friday" }, candidates).errors.dueDate);
  assert.ok(validateDraft({ ...okFields(), dueDate: "2026-13-45" }, candidates).errors.dueDate);
});

test("title and description are bounded", () => {
  assert.ok(validateDraft({ ...okFields(), title: "   " }, candidates).errors.title);
  assert.ok(validateDraft({ ...okFields(), title: "x".repeat(301) }, candidates).errors.title);
  assert.equal(validateDraft({ ...okFields(), title: "x".repeat(300) }, candidates).ok, true);
  assert.ok(validateDraft({ ...okFields(), description: "x".repeat(8001) }, candidates).errors.description);
});
