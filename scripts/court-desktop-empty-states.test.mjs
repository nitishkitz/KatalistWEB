import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * T09/E-04: CourtDesktop (the >=1024px experience) previously had no
 * distinction at all between a genuinely empty Court and a Court with
 * Things that a search/filter had narrowed to zero -- both rendered the
 * same generic per-lane "No Things match this view." with no visible/total
 * count and no single recovery action. This is a source-inspection test
 * (matching this file's existing test precedent, e.g.
 * court-stack-components.test.mjs) -- CourtDesktop pulls in useCatchup,
 * useMorningBrief, useProfileDirectory and a dozen other live hooks that a
 * full DOM mount would need to fully stub out for a behavioral assertion
 * disproportionate to what this specific fix needs.
 */

const courtDesktop = readFileSync(new URL("../src/features/court/CourtDesktop.tsx", import.meta.url), "utf8");

test("a genuinely empty Court (nothing tossed in any of the three personal lanes) is computed from the RAW lane data, not the post-filter view", () => {
  assert.match(courtDesktop, /const rawMyLaneTotal = now\.length \+ next\.length \+ later\.length;/);
  assert.match(courtDesktop, /const isCourtGenuinelyEmpty = rawMyLaneTotal === 0;/);
});

test("filtered-to-zero is distinct from genuinely empty, and only true when the raw data is non-empty", () => {
  assert.match(
    courtDesktop,
    /const isFilteredToZero = !isCourtGenuinelyEmpty && visibleMyLaneTotal === 0;/,
  );
});

test("the genuinely-empty banner names Magic Box as the capture action, and the filtered-to-zero banner states the true total plus a Clear-filters recovery action", () => {
  assert.match(courtDesktop, /Your Court is clear\. Toss something below to get started\./);
  assert.match(courtDesktop, /No Things match your current search\/filters \(\{rawMyLaneTotal\} in Court overall\)\./);
  assert.match(courtDesktop, /onClick=\{clearAllFilters\}/);
  assert.match(courtDesktop, />\s*Clear filters\s*</);
});

test("Clear filters resets both the filter state AND the search query, a more complete reset than the existing detailed-filters-only clear", () => {
  const fnMatch = courtDesktop.match(/const clearAllFilters = \(\) => \{[\s\S]{0,80}\};/);
  assert.ok(fnMatch, "expected to find the clearAllFilters function");
  assert.match(fnMatch[0], /setFilters\(DEFAULT_COURT_FILTERS\);/);
  assert.match(fnMatch[0], /setQuery\(""\);/);
});

test("hasActiveSearchOrFilters checks every filter dimension the plan's quick tabs and detailed filters can set, including the search query", () => {
  const block = courtDesktop.match(/const hasActiveSearchOrFilters =[\s\S]{0,260}?;/);
  assert.ok(block);
  for (const needle of [
    "query.trim()",
    "filters.personId",
    'filters.due !== "any"',
    'filters.acknowledgement !== "any"',
    'filters.workStatus !== "any"',
    "filters.starredOnly",
    "filters.quick !== DEFAULT_COURT_FILTERS.quick",
  ]) {
    assert.ok(block[0].includes(needle), `expected hasActiveSearchOrFilters to check ${needle}`);
  }
});
