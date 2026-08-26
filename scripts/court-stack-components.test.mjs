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
