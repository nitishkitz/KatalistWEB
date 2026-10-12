import assert from "node:assert/strict";
import { test } from "node:test";
import { EMPTY_FILTERS } from "../src/features/code-activity/workspace/filters.ts";
import { branchPageMatches, filtersForCategory } from "../src/features/code-activity/workspace/use-workspace.ts";

test("code activity: a branch page from an old scope or cursor is rejected", () => {
  assert.equal(branchPageMatches("list-b|acme/new", "list-a|acme/old", "cursor-2", "cursor-2"), false);
  assert.equal(branchPageMatches("list-a|acme/old", "list-a|acme/old", "cursor-3", "cursor-2"), false);
  assert.equal(branchPageMatches("list-a|acme/old", "list-a|acme/old", "cursor-2", "cursor-2"), true);
});

test("code activity: changing category removes hidden status and type selections", () => {
  const next = filtersForCategory("commits", {
    ...EMPTY_FILTERS,
    statuses: ["open", "passed"],
    types: ["pull_request", "commit"],
  });
  assert.deepEqual(next.statuses, ["passed"]);
  assert.deepEqual(next.types, ["commit"]);
});
