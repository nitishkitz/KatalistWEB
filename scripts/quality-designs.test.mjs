import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("../src/features/designs/DesignsRoot.tsx", import.meta.url), "utf8");

test("deep-link state resets missing and bounded-search status when the target changes", () => {
  assert.match(source, /useEffect\(\(\) => \{\s*const dl = deepLinkRef\.current;\s*Object\.assign\(dl, \{ target: initialDesignId, pages: 0, done: false \}\);\s*setDeepLinkMissing\(false\);\s*setDeepLinkBudgetReached\(false\);\s*\}, \[initialDesignId\]\);/s);
  assert.match(source, /const DEEP_LINK_PAGE_BUDGET = 100/);
  assert.match(source, /dl\.pages < DEEP_LINK_PAGE_BUDGET/);
  assert.match(source, /setDeepLinkBudgetReached\(true\)/);
  assert.doesNotMatch(source, /dl\.pages < 10/);
});

test("incomplete client filtering exposes a direct more-results action", () => {
  assert.match(source, /data-testid="design-scope-note"/);
  assert.match(source, /Search and filters apply only to the/);
  assert.match(source, /More designs exist\./);
  assert.match(source, /disabled=\{library\.isFetchingNextPage\} onClick=\{\(\) => void library\.fetchNextPage\(\)\}/);
  assert.match(source, /Load more results/);
});

test("bounded deep-link exhaustion has an explicit continuation affordance", () => {
  assert.match(source, /We searched the first \{DEEP_LINK_PAGE_BUDGET\} pages but the linked design was not found\./);
  assert.match(source, /onClick=\{continueDeepLinkSearch\}/);
  assert.match(source, /Continue searching/);
});
