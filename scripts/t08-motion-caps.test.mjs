import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * D02/T08: Court's spatial-motion durations drifted from motion-tokens.ts's
 * documented bands -- CourtLaneStack.tsx's card-swap tween ran at 360ms and
 * its drag-release snap-back at 300ms, both exceeding the plan's <=280ms
 * workspace ceiling. CourtLaneStack.tsx also duplicated its own
 * `window.matchMedia("(prefers-reduced-motion: reduce)")` listener instead
 * of sharing use-motion-preference.ts's combined OS/storage/broadcast
 * wiring -- exactly the ad hoc check that hook's own header comment says it
 * was meant to replace.
 */

const laneStack = readFileSync(new URL("../src/features/court/CourtLaneStack.tsx", import.meta.url), "utf8");
const focusView = readFileSync(new URL("../src/features/court/CourtFocusView.tsx", import.meta.url), "utf8");
const motionHook = readFileSync(new URL("../src/hooks/use-motion-preference.ts", import.meta.url), "utf8");

test("CourtLaneStack's card-swap tweens no longer hardcode a duration exceeding the workspace band", () => {
  assert.doesNotMatch(laneStack, /duration:\s*0\.36/, "360ms exceeded the <=280ms workspace cap");
  assert.doesNotMatch(laneStack, /duration:\s*0\.28,/, "must be sourced from motionDurationSeconds, not a bare 0.28 literal");
  assert.match(laneStack, /motionDurationSeconds\("workspace",\s*false\)/);
});

test("CourtLaneStack's drag-release snap-back no longer uses a bare 300ms Tailwind duration class", () => {
  assert.doesNotMatch(laneStack, /duration-300\b/, "300ms exceeded the <=280ms workspace cap");
  assert.match(laneStack, /duration-\[260ms\]/);
});

test("CourtFocusView's hero-flight tween is sourced from the workspace motion token, not a hardcoded literal", () => {
  assert.doesNotMatch(focusView, /duration:\s*0\.26,/, "must be sourced from motionDurationSeconds, not a bare 0.26 literal");
  assert.match(focusView, /motionDurationSeconds\("workspace",\s*false\)/);
});

test("CourtLaneStack no longer duplicates its own matchMedia reduced-motion listener", () => {
  assert.doesNotMatch(
    laneStack,
    /window\.matchMedia\("\(prefers-reduced-motion: reduce\)"\)/,
    "must share use-motion-preference.ts's combined listener instead of re-deriving one",
  );
  assert.match(laneStack, /subscribeToMotionPreference\(snapIfAnimating\)/);
});

test("use-motion-preference.ts exports a subscribe function for imperative (non-hook) consumers", () => {
  assert.match(motionHook, /export function subscribeToMotionPreference/);
});
