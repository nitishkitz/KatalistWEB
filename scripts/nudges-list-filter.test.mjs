import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * G05: three confirmed defects in nudges.tsx / use-nudges.ts --
 * "All lists" and "Nudge settings" were both inert buttons with no
 * onClick at all; the search placeholder claimed to match "teams" and
 * "skills", which the actual filter logic never checks (only title and
 * person); "See all" next to Recent nudge activity was a plain <span>,
 * not even a button, always showing only the first 5 of an
 * already-fully-loaded-in-memory array.
 */
const useNudges = readFileSync(new URL("../src/features/nudges/use-nudges.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../src/routes/nudges.tsx", import.meta.url), "utf8");

test("NudgeRow carries listId/listName from the underlying Thing, for the All lists filter", () => {
  assert.match(useNudges, /listId:\s*t\.listId/);
  assert.match(useNudges, /listName:\s*t\.listName/);
});

test("the All lists control is a real dropdown wired to setListFilter, scoped to the already-loaded rows", () => {
  assert.match(page, /setListFilter\(null\)/);
  assert.match(page, /setListFilter\(id\)/);
  assert.match(page, /availableLists = useMemo/);
  assert.match(page, /for \(const row of allRows\)/);
  assert.match(page, /!listFilter \|\| n\.listId === listFilter/);
});

test("the search placeholder matches what the filter actually checks (Things or people, not teams/skills)", () => {
  assert.match(page, /placeholder="Search Things or people"/);
  assert.doesNotMatch(page, /Search people, teams, or skills/);
});

test("\"Nudge settings\" is replaced with a real How-nudges-work explanation of the actual server-side rules", () => {
  assert.doesNotMatch(page, />\s*Nudge settings\s*</);
  assert.match(page, /How nudges work/);
  assert.match(page, /setHowNudgesWorkOpen\(true\)/);
  assert.match(page, /At most one automatic nudge per Thing every 24 hours/);
});

test("\"See all\" is a real toggle over already-loaded data, not an inert span, and only appears when there's more to show", () => {
  assert.match(page, /recent\.length > 5 &&/);
  assert.match(page, /setShowAllRecent/);
  assert.match(page, /\(showAllRecent \? recent : recent\.slice\(0, 5\)\)/);
});
