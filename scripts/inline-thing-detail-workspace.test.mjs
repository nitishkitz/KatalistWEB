import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Lists keep Thing detail inline; desktop Buckets use the workspace and retain a mobile sheet", () => {
  const lists = read("src/routes/lists.$listId.tsx");
  const listThingsSection = read("src/features/lists/components/ListThingsSection.tsx");
  const buckets = read("src/routes/buckets.$bucketId.tsx");

  // T11-03 extracted the Things tab's presentation into ListThingsSection.tsx
  // (mutation/selection ownership stayed in the route); the route renders
  // that component, and the component itself is where ThingDetailContent
  // actually mounts inline (no sheet/drawer/modal wrapper anywhere).
  assert.match(lists, /<ListThingsSection/);
  assert.doesNotMatch(lists, /<ThingDetailSheet/);
  assert.match(listThingsSection, /<ThingDetailContent/);
  assert.doesNotMatch(listThingsSection, /<ThingDetailSheet/);

  assert.match(buckets, /<InlineThingDetailWorkspace/);
  assert.match(buckets, /<ThingDetailSheet/);
  assert.doesNotMatch(buckets, /<CourtDetailModal/);
  assert.match(buckets, /narrowViewport \? null : selectedThing/);
  assert.match(buckets, /open=\{narrowViewport && Boolean\(selectedThing\)\}/);
});

test("route-level Thing detail never falls back to the legacy sheet", () => {
  const routes = [
    "src/routes/index.tsx",
    "src/routes/nudges.tsx",
  ];

  for (const route of routes) {
    const source = read(route);
    assert.match(source, /InlineThingDetailWorkspace/, `${route} should use the inline workspace`);
    assert.doesNotMatch(source, /ThingDetailSheet/, `${route} should not use the legacy sheet`);
  }

  const lists = read("src/routes/lists.$listId.tsx");
  assert.doesNotMatch(lists, /ThingDetailSheet/);
  const listThingsSection = read("src/features/lists/components/ListThingsSection.tsx");
  assert.match(listThingsSection, /<ThingDetailContent/);
  assert.doesNotMatch(listThingsSection, /ThingDetailSheet/);

  // Buckets intentionally use the accessible sheet below 1024px while
  // desktop keeps the inline workspace, with only one detail tree active.
  const buckets = read("src/routes/buckets.$bucketId.tsx");
  assert.match(buckets, /ThingDetailSheet/);
  assert.match(buckets, /narrowViewport \? null : selectedThing/);
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
  // T09 item 5 moved the default variant's People and Acknowledgement &
  // Status sections (data-detail-region="people"/"controls") out of
  // ThingDetailContent.tsx into the shared ThingStatusControls component;
  // data-detail-region="metadata" (Due Date/Source) has no court-variant
  // equivalent and stayed inline in ThingDetailContent.tsx.
  const statusControls = read("src/features/things/components/ThingStatusControls.tsx");
  const combined = `${detail}\n${statusControls}`;

  assert.match(statusControls, /data-detail-region="people"/);
  assert.match(statusControls, /data-detail-region="controls"/);
  assert.match(detail, /data-detail-region="metadata"/);
  assert.doesNotMatch(combined, /thing\.listName \?\? "Standalone"/);
  assert.doesNotMatch(combined, /importanceDisplay|importanceTone/);
});
