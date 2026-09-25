import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * T08 step 6: motion/gesture contract verification. GSAP's Observer plugin
 * depends on real browser wheel/pointer event dispatch semantics that jsdom
 * does not faithfully reproduce, so (matching this codebase's existing
 * precedent in scripts/court-stack-components.test.mjs) these are grounded
 * source-inspection assertions of the actual implementation, not a jsdom
 * simulation of GSAP itself. Each assertion below was verified by reading
 * the exact lines cited in its description before being encoded here.
 */

const laneStack = readFileSync(new URL("../src/features/court/CourtLaneStack.tsx", import.meta.url), "utf8");
const thingStackCard = readFileSync(new URL("../src/features/court/ThingStackCard.tsx", import.meta.url), "utf8");

test("wheel/scroll outside the active gesture region remains ordinary document scrolling: both the wheel-hold listener and the GSAP Observer attach to the lane's own scoped node, never window/document", () => {
  assert.match(laneStack, /node\.addEventListener\("wheel", holdPage/);
  assert.doesNotMatch(laneStack, /window\.addEventListener\("wheel"/);
  assert.doesNotMatch(laneStack, /document\.addEventListener\("wheel"/);
  assert.match(laneStack, /Observer\.create\(\{\s*\n\s*target: node,/);
});

test("the lane's swipeable card renders no editable input/textarea, so its wheel-capture listener can never steal focus/scroll from an in-card text field", () => {
  assert.doesNotMatch(thingStackCard, /<textarea/);
  assert.doesNotMatch(thingStackCard, /<input\b/);
  assert.doesNotMatch(thingStackCard, /contentEditable/);
});

test("rapid navigation does not queue stale animations: starting a new navigation is blocked while one is already animating", () => {
  assert.match(laneStack, /if \(!activeThing \|\| things\.length <= 1 \|\| pendingAction \|\| animatingRef\.current\) return;/g);
});

test("active tweens are cleaned up (not left running) whenever a new navigation supersedes the current one, and on unmount", () => {
  // The tween effect's cleanup calls gsap.context(...).revert(), and runs
  // every time `anim` changes (a new navigation) as well as on unmount --
  // both are the same React effect-cleanup mechanism.
  assert.match(laneStack, /return \(\) => \{\s*\n\s*animatingRef\.current = false;\s*\n\s*context\.revert\(\);\s*\n\s*\};\s*\n\s*\}, \[anim\]\);/);
});

test("the GSAP Observer instance is killed on unmount / dependency change, not leaked", () => {
  assert.match(laneStack, /return \(\) => observer\.kill\(\);/);
});

test("changing reduced-motion preference immediately snaps an in-flight card-swap animation to its end state instead of letting it keep running", () => {
  assert.match(laneStack, /snapIfAnimating/);
  assert.match(laneStack, /gsap\.killTweensOf\(activeCardRef\.current\)/);
  assert.match(laneStack, /gsap\.killTweensOf\(outgoingCardRef\.current\)/);
  assert.match(laneStack, /subscribeToMotionPreference\(snapIfAnimating\)/);
});

test("reduced motion uses an immediate state change, not a spatial animation, for card navigation", () => {
  assert.match(
    laneStack,
    /const reduceMotion = getEffectiveReducedMotion\(\);\s*\n\s*\n\s*if \(reduceMotion\) \{\s*\n\s*setActiveIndex\(nextIndex\);/,
  );
});
