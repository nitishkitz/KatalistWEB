import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("overview is composed as three equal layered stacks", () => {
  const workspace = read("src/features/court/CourtWorkspace.tsx");
  const stack = read("src/features/court/CourtLaneStack.tsx");

  assert.match(workspace, /grid-cols-3/);
  assert.match(workspace, /CourtLaneStack/);
  // The decorative deck cap was intentionally raised from 2 to 6 for a
  // deeper stack illusion; this locks in a bounded, non-linear depth
  // rather than the exact historical number.
  assert.match(stack, /Math\.min\(6, Math\.max\(0, things\.length - 1\)\)/);
  assert.match(stack, /more Things in/);
  assert.doesNotMatch(stack, /\.slice\(0, 2\)/);
});

test("focused mode inserts detail after the selected lane and uses compact lanes", () => {
  const focus = read("src/features/court/CourtFocusView.tsx");
  const compact = read("src/features/court/CourtCompactLane.tsx");

  assert.match(focus, /focusColumns\(selection\)/);
  assert.match(focus, /CourtCompactLane/);
  assert.doesNotMatch(focus, /writing-mode:vertical-rl|overflow-y-auto|max-h-\[/);
  assert.match(compact, /courtLaneContent/);
  assert.match(compact, /things\.slice\(0, 3\)/);
  assert.doesNotMatch(compact, /writing-mode|rotate-|skew-|perspective/);
});

test("stack cards use real optional metadata and approved actions", () => {
  const card = read("src/features/court/ThingStackCard.tsx");

  assert.doesNotMatch(card, /Go through the brief|Work is in progress|Needs to be caught/);
  assert.doesNotMatch(card, /No due date|Standalone|Owner Importance|My Pace/);
  // The Catch/Sort model replaced the earlier Details/Later/Sorted button
  // row: the card now surfaces only Catch, and pace/sort happen via the
  // swipe gesture (CourtLaneStack) or the Thing detail surface.
  assert.match(card, />\s*Catch\s*</);
  assert.doesNotMatch(card, />\s*Details\s*<|>\s*Later\s*<|>\s*Sorted\s*</);
});

test("focused Thing detail remains in natural page flow", () => {
  const focus = read("src/features/court/CourtFocusView.tsx");
  const detail = read("src/features/things/ThingDetailContent.tsx");

  assert.doesNotMatch(focus, /ThingDetailSheet|SheetContent|Drawer|Overlay/);
  assert.doesNotMatch(focus, /overflow-y-auto|max-h-\[calc/);
  assert.doesNotMatch(detail, />My Pace</);
  assert.doesNotMatch(detail, /Owner Importance/);
  assert.match(detail, />Pace</);
});

test("Court preserves With Others and one desktop Magic Box", () => {
  const court = read("src/features/court/CourtDesktop.tsx");
  const route = read("src/routes/index.tsx");

  assert.match(court, /WITH OTHERS/);
  assert.match(court, /Waiting for Catch/);
  assert.match(court, /Moving/);
  assert.match(court, /Needs Attention/);
  assert.equal((court.match(/<MagicBox\s*\n\s*desktop/g) ?? []).length, 1);
  // The mobile branch now shows a dedicated retry state when Court's query
  // has failed (previously falsely rendered as "Your Court is clear" on a
  // fetch failure), so InlineThingDetailWorkspace is the *fallback* branch
  // of that check rather than the div's only child.
  assert.match(route, /<div className="lg:hidden">[\s\S]*<InlineThingDetailWorkspace/);
  assert.match(route, /The Court could not be loaded\./);
  assert.doesNotMatch(route, /className="lg:hidden"\s*>\s*<div>/);
});

test("Court detail uses the approved compact state-driven surface", () => {
  const detail = read("src/features/things/ThingDetailContent.tsx");

  assert.match(detail, /if \(variant === "court"\)[\s\S]*Mark Sorted/);
  // "Choose Buckets" / "Details ›" were replaced by the "Add to bucket"
  // dropdown in the bucket-detail redesign; this Thing detail view is
  // itself the details surface, so no separate "Details ›" link exists.
  assert.match(detail, /if \(variant === "court"\)[\s\S]*Add to bucket/);
  assert.match(read("src/features/court/CourtFocusView.tsx"), /variant="court"/);
});
