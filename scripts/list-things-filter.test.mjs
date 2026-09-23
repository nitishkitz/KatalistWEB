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

test("the filter choice is persisted per profile + List, with \"all\" as the compatibility default", () => {
  assert.match(page, /katalist\.lists\.things_filter\.\$\{user\?\.id/);
  assert.match(page, /return \(stored as QuickFilterType\) \|\| "all"/);
});
