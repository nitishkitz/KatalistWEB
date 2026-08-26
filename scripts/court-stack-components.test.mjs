import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const sheet = readFileSync(
  new URL("../src/features/things/ThingDetailSheet.tsx", import.meta.url),
  "utf8",
);
const content = readFileSync(
  new URL("../src/features/things/ThingDetailContent.tsx", import.meta.url),
  "utf8",
);
const stackGesture = readFileSync(
  new URL("../src/features/court/use-stack-gesture.ts", import.meta.url),
  "utf8",
);
const stackCard = readFileSync(
  new URL("../src/features/court/ThingStackCard.tsx", import.meta.url),
  "utf8",
);
const laneStack = readFileSync(
  new URL("../src/features/court/CourtLaneStack.tsx", import.meta.url),
  "utf8",
);
const packageJson = readFileSync(new URL("../package.json", import.meta.url), "utf8");

test("Thing detail sheet delegates to one shared content implementation", () => {
  assert.match(sheet, /<ThingDetailContent/);
  assert.match(sheet, /initialThing=\{thing\}/);
  assert.equal(sheet.includes("rpcSortThing"), false);
  assert.match(content, /await rpcSortThing\(thing\.id\)/);
  assert.match(content, /await rpcCancelThing\(thing\.id\)/);
  assert.match(content, /await rpcShred\(thing\.id\)/);
});

test("Thing detail Sheet retains an accessible dialog name without a Sheet dependency in shared content", () => {
  assert.match(sheet, /<SheetContent[\s\S]*aria-label="Thing details"/);
  assert.equal(content.includes("SheetContent"), false);
  assert.equal(content.includes("SheetTitle"), false);
});

test("Court stack gestures use native pointer and wheel intent handling without a gesture dependency", () => {
  assert.match(stackGesture, /setPointerCapture\(event\.pointerId\)/);
  assert.match(stackGesture, /lockGestureAxis/);
  assert.match(stackGesture, /resistedDragOffset/);
  assert.match(stackGesture, /resolveHorizontalAction/);
  assert.match(stackGesture, /wheelDeltaRef/);
  assert.match(stackGesture, /lastWheelTimeRef/);
  assert.match(stackGesture, /WHEEL_COOLDOWN_MS = 260/);
  assert.match(stackGesture, /event\.preventDefault\(\)/);
  assert.match(stackGesture, /prefers-reduced-motion/);
  assert.doesNotMatch(packageJson, /framer-motion|@use-gesture|react-swipeable/i);
});

test("Court lane stacks render one active Thing over a capped, hidden decorative deck", () => {
  assert.match(laneStack, /<ThingStackCard[\s\S]*thing=\{activeThing\}/);
  assert.match(laneStack, /Math\.min\(3, Math\.max\(0, things\.length - 1\)\)/);
  assert.match(laneStack, /aria-hidden="true"/);
  assert.match(laneStack, /\{renderIndex \+ 1\} \/ \{things\.length\}/);
});

test("Court stack actions are capability-gated and route to canonical RPCs", () => {
  assert.match(laneStack, /getThingCapabilities\(activeThing, myActorId\)/);
  assert.match(stackCard, /canCatch \?/);
  assert.match(stackCard, /canSetPace && lane !== "later"/);
  assert.match(stackCard, /canSort/);
  assert.match(stackCard, />\s*Caught It\s*</);
  assert.match(stackCard, />\s*Later\s*</);
  assert.match(stackCard, />\s*Sorted\s*</);
  assert.match(laneStack, /await rpcCatchThing\(activeThing\.id\)/);
  assert.match(laneStack, /await rpcSetPersonalPace\(activeThing\.id, "later"\)/);
  assert.match(laneStack, /await rpcSortThing\(activeThing\.id\)/);
});

test("Court stacks never use Doorman snooze and LATER cannot move farther left", () => {
  assert.doesNotMatch(`${stackCard}\n${laneStack}`, /snooze_breakthrough|snoozed_until/);
  assert.match(laneStack, /canMoveLater: capabilities\.canSetPace && lane !== "later"/);
});
