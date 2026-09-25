import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * G02: lists.$listId.tsx's thingsFilter state and its filtering logic
 * (feeding filteredThings -> grouped -> laneThings, so it genuinely
 * affects what's rendered) already existed, but had NO UI control ever
 * calling setThingsFilter -- confirmed by the pre-existing
 * 'setThingsFilter' is assigned a value but never used lint warning.
 * Users had no way to ever change it from the "all" default.
 */
const page = readFileSync(new URL("../src/routes/lists.$listId.tsx", import.meta.url), "utf8");
const filterHook = readFileSync(new URL("../src/features/lists/use-list-things-filter.ts", import.meta.url), "utf8");

test("an Active/All/Completed control now actually calls setThingsFilter", () => {
  assert.match(page, /onClick=\{\(\) => setThingsFilter\(id\)\}/);
  assert.match(page, /\["active", "Active"\]/);
  assert.match(page, /\["all", "All"\]/);
  assert.match(page, /\["completed", "Completed"\]/);
});

test("\"active\" means nonterminal (neither sorted nor cancelled), a new filter value added for this control", () => {
  assert.match(
    page,
    /thingsFilter === "active" && \(t\.workStatus === "sorted" \|\| t\.workStatus === "cancelled"\)/,
  );
});

test("the filter choice is persisted per resolved identity + List, with validated all fallback", () => {
  assert.match(page, /useListThingsFilter\(filterIdentityId, listId\)/);
  assert.match(filterHook, /katalist\.lists\.things_filter\.\$\{identityId\}\.\$\{listId\}/);
  assert.match(filterHook, /LIST_THING_FILTERS\.includes/);
  assert.match(filterHook, /: "all"/);
  assert.doesNotMatch(filterHook, /anon/);
});

test("a reused route re-keys filter state before persistence and only explicit changes write storage", () => {
  assert.match(filterHook, /if \(owned\.key !== key\) \{\s*setOwned\(\{ key, value: readFilter\(key\) \}\)/);
  assert.match(filterHook, /const setValue = \(next: ListThingFilter\)/);
  assert.doesNotMatch(filterHook, /useEffect/);
});
