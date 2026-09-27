import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * G12/B01: the nudges-history fetch used to be bounded by an arbitrary row
 * count (`.limit(40)`), not by the cooldown window "recent nudge activity"
 * is actually defined by -- a busy context (more than 40 nudges anywhere
 * in the last two hours) could silently drop a still-in-cooldown nudge from
 * both the "recent" list and the eligibility check, purely because
 * something else got nudged more recently. There is no separate "full
 * history" feature anywhere in this app for "See all" to paginate into --
 * `recent` is definitionally "still within cooldown" -- so the correct fix
 * is a time-bounded fetch, not row-count pagination.
 */
const useNudges = readFileSync(new URL("../src/features/nudges/use-nudges.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../src/routes/nudges.tsx", import.meta.url), "utf8");

test("the history fetch is bounded by the cooldown time window, not an arbitrary row count", () => {
  assert.match(useNudges, /const COOLDOWN_MS = 120 \* 60 \* 1000;/);
  assert.match(useNudges, /const cutoffIso = new Date\(Date\.now\(\) - COOLDOWN_MS\)\.toISOString\(\);/);
  assert.match(useNudges, /\.gte\("created_at", cutoffIso\)/);
  // The one COOLDOWN_MS constant is shared, not redeclared, so the fetch
  // window and the "still in cooldown" check can never silently disagree.
  assert.equal(useNudges.match(/COOLDOWN_MS = /g)?.length, 1);
});

test("See all shows the genuinely complete recent list, not a truncated page of it", () => {
  assert.match(page, /recent\.length > 5 &&/);
  assert.match(page, /\(showAllRecent \? recent : recent\.slice\(0, 5\)\)/);
  assert.match(page, /genuinely the full list, not a truncated/);
});

test("the confirmed-ineligible row gets an accessible reason, mirroring the unconfirmed-case pattern", () => {
  assert.match(page, /title=\{\s*row\.group === "recently_nudged"/);
  assert.match(page, /In cooldown after a recent nudge/);
  assert.match(page, /Not eligible for a nudge right now/);
});

test("the eligibility-checking placeholder announces itself to assistive tech", () => {
  assert.match(page, /role="status"[\s\S]{0,40}aria-live="polite"/);
});

test("the How-nudges-work dialog discloses both the manual and automated limits, and drops the fictional upgrade nudge", () => {
  assert.match(page, /Pressing "Nudge" yourself is capped at once per Thing every 2 hours/);
  assert.match(page, /At most one automatic nudge per Thing every 24 hours/);
  assert.doesNotMatch(page, /upgrade nudge/i);
  // Quiet hours must be scoped to automated nudges, not stated as universal.
  assert.match(page, /Coey's automatic nudges pause/);
  assert.match(page, /never\s+blocked by quiet hours/);
});
