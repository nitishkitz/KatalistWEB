import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Lists and Buckets open Thing detail in an inline workspace", () => {
  const lists = read("src/routes/lists.$listId.tsx");
  const buckets = read("src/routes/buckets.$bucketId.tsx");

  assert.match(lists, /InlineThingDetailWorkspace/);
  assert.match(buckets, /InlineThingDetailWorkspace/);
  assert.doesNotMatch(lists, /<ThingDetailSheet/);
  assert.doesNotMatch(buckets, /<ThingDetailSheet/);
});

test("route-level Thing detail never falls back to the legacy sheet", () => {
  const routes = [
    "src/routes/index.tsx",
    "src/routes/lists.$listId.tsx",
    "src/routes/buckets.$bucketId.tsx",
    "src/routes/nudges.tsx",
  ];

  for (const route of routes) {
    const source = read(route);
    assert.match(source, /InlineThingDetailWorkspace/, `${route} should use the inline workspace`);
    assert.doesNotMatch(source, /ThingDetailSheet/, `${route} should not use the legacy sheet`);
  }
});

test("WITH OTHERS keeps its existing groups and opens detail inside its own section", () => {
  const court = read("src/features/court/CourtDesktop.tsx");

  assert.match(court, /Waiting for Catch/);
  assert.match(court, /Moving/);
  assert.match(court, /Needs Attention/);
  assert.match(court, /theirSelectedId/);
  assert.match(court, /InlineThingDetailWorkspace/);
});

test("inline detail does not use a sheet, drawer, overlay, or transformed container", () => {
  const workspace = read("src/features/things/InlineThingDetailWorkspace.tsx");

  assert.doesNotMatch(workspace, /ThingDetailSheet|SheetContent|Drawer|Overlay/);
  assert.doesNotMatch(workspace, /rotate-|skew-|perspective/);
  assert.match(workspace, /ThingDetailContent/);
  assert.match(workspace, /aria-label="Inline Thing details"/);
});

test("Court stack card and lane implementations remain independent", () => {
  const lane = read("src/features/court/CourtLaneStack.tsx");
  const card = read("src/features/court/ThingStackCard.tsx");

  assert.doesNotMatch(lane, /InlineThingDetailWorkspace/);
  assert.doesNotMatch(card, /InlineThingDetailWorkspace/);
});

test("shared detail content is compact and omits redundant standalone and importance labels", () => {
  const detail = read("src/features/things/ThingDetailContent.tsx");

  assert.match(detail, /data-detail-region="people"/);
  assert.match(detail, /data-detail-region="controls"/);
  assert.match(detail, /data-detail-region="metadata"/);
  assert.doesNotMatch(detail, /thing\.listName \?\? "Standalone"/);
  assert.doesNotMatch(detail, /importanceDisplay|importanceTone/);
});
