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
const thingNavigator = readFileSync(
  new URL("../src/features/court/ThingNavigator.tsx", import.meta.url),
  "utf8",
);
const focusView = readFileSync(
  new URL("../src/features/court/CourtFocusView.tsx", import.meta.url),
  "utf8",
);
const detailModal = readFileSync(
  new URL("../src/features/court/CourtDetailModal.tsx", import.meta.url),
  "utf8",
);
const courtDesktop = readFileSync(
  new URL("../src/features/court/CourtDesktop.tsx", import.meta.url),
  "utf8",
);
const courtRoute = readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");
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
  // D02 extracted the reduced-motion check (previously its own inline
  // matchMedia read here) into the shared use-motion-preference.ts
  // contract, so the real assertion is now "this file defers to that
  // shared hook", not the literal media-query string.
  assert.match(stackGesture, /useMotionPreference\(\)/);
  assert.doesNotMatch(packageJson, /framer-motion|@use-gesture|react-swipeable/i);
});

test("Court lane stacks render one active Thing over a capped, hidden decorative deck", () => {
  assert.match(laneStack, /<ThingStackCard[\s\S]*thing=\{activeThing\}/);
  // Cap intentionally raised from 2 to 6 for a deeper stack illusion.
  assert.match(laneStack, /Math\.min\(6, Math\.max\(0, things\.length - 1\)\)/);
  assert.match(laneStack, /aria-hidden="true"/);
  assert.match(laneStack, /depth \* -(5|6)/);
  assert.match(laneStack, /motion-reduce:!transform-none/);
  assert.doesNotMatch(laneStack, /\{renderIndex \+ 1\} \/ \{things\.length\}/);
});

test("Court stack actions are capability-gated and route to canonical RPCs", () => {
  assert.match(laneStack, /getThingCapabilities\(activeThing, myActorId\)/);
  // Pace capability gating and its RPC call live in the lane's
  // swipe-gesture handler (runAction) only, with no button equivalent
  // (that's the timed Snooze picker, a separate concept -- see the next
  // test). Catch and Sort each have their own capability-gated button on
  // the card itself (E01: Sort's button is new -- it used to be
  // swipe-right/Thing-detail-only) that calls the same onAction() the
  // gesture handler already dispatches to, not a second RPC path.
  assert.match(stackCard, /capabilities\.canCatch && \(/);
  assert.match(stackCard, />\s*Catch\s*</);
  assert.match(stackCard, /capabilities\.canSort && \(/);
  assert.match(stackCard, />\s*Mark Sorted\s*</);
  assert.doesNotMatch(stackCard, />\s*Later\s*</);
  assert.match(laneStack, /actionCapabilities\.canMoveLater/);
  assert.match(laneStack, /capabilities\.canSort/);
  assert.match(laneStack, /await rpcCatchAndStart\(activeThing\.id\)/);
  assert.match(laneStack, /await rpcSetPersonalPace\(target\.id, "later"\)/);
  assert.match(laneStack, /await rpcSortThing\(target\.id\)/);
});

test("Court stacks never use Doorman snooze and LATER cannot move farther left", () => {
  assert.doesNotMatch(`${stackCard}\n${laneStack}`, /snooze_breakthrough|snoozed_until/);
  assert.match(laneStack, /canMoveLater: capabilities\.canSetPace && lane !== "later"/);
});

test("Court focus navigator selects stable Thing identities with accessible buttons", () => {
  assert.match(thingNavigator, /key=\{thing\.id\}/);
  assert.match(thingNavigator, /selectedThingId === thing\.id/);
  assert.match(thingNavigator, /<button[\s\S]*aria-current=\{selected\}/);
  assert.match(thingNavigator, /onSelect\(thing\.id\)/);
});

test("Court focus is inline detail with two contextual compact lanes", () => {
  assert.match(focusView, /<ThingDetailContent/);
  assert.doesNotMatch(focusView, /ThingDetailSheet/);
  assert.match(focusView, /focusColumns\(selection\)/);
  assert.match(focusView, /<CourtCompactLane/);
  assert.doesNotMatch(focusView, /writing-mode:vertical-rl/);
});

test("Court focus has a real close control and identity-keyed restrained detail transition", () => {
  assert.match(focusView, /<button[\s\S]*onClick=\{onClose\}/);
  assert.match(focusView, /aria-label="Back to Court stacks"/);
  assert.match(focusView, /key=\{`detail-\$\{column\.thingId\}`\}/);
  assert.match(focusView, /duration-\[240ms\]/);
  assert.match(focusView, /motion-reduce:transition-none/);
});

test("D03: CourtDetailModal and CourtFocusView only consume Escape if no nested overlay already did", () => {
  // A window-level Escape listener that doesn't check defaultPrevented
  // would also close the outer view in the same keystroke a nested Radix
  // layer (a popover, a confirm dialog, a file preview) just used to
  // dismiss itself with -- Radix's DismissableLayer attaches its own
  // listener at capture:true and calls preventDefault() once it commits
  // to closing, so checking !e.defaultPrevented here is what makes "only
  // the topmost overlay closes" actually hold for these two custom,
  // non-Radix overlays. (InlineThingDetailWorkspace already had this
  // check; these two didn't.)
  assert.match(detailModal, /e\.key === "Escape" && !e\.defaultPrevented/);
  assert.match(detailModal, /e\.preventDefault\(\);\s*onClose\(\)/);
  assert.match(focusView, /e\.key === "Escape" && !e\.defaultPrevented/);
  assert.match(focusView, /e\.preventDefault\(\);\s*onClose\(\)/);
});

test("Court desktop switches only the three personal lanes between stacks and inline focus", () => {
  assert.match(courtDesktop, /<CourtWorkspace/);
  assert.match(courtDesktop, /import type \{ CourtFocusSelection \}/);
  assert.match(courtDesktop, /useState<CourtFocusSelection \| null>/);
  assert.match(courtDesktop, /setFocusSelection\(\{ lane, thingId: thing\.id \}\)/);
  assert.doesNotMatch(courtDesktop, /focusIndex:\s*number/);
});

test("Court desktop retains Magic Box, controls, quick filters, and With Others", () => {
  assert.match(courtDesktop, /<MagicBox desktop/);
  for (const label of ["All", "Due", "Waiting", "In Progress"]) {
    assert.ok(courtDesktop.includes(`"${label}"`), `missing ${label} quick filter`);
  }
  assert.match(courtDesktop, /aria-label="Search Court"/);
  assert.match(courtDesktop, /Sort within each lane/);
  assert.match(courtDesktop, /Clear detailed filters/);
  assert.match(courtDesktop, /WITH OTHERS/);
  assert.match(courtDesktop, /setTheirSelectedId\(selectedThing\.id\)/);
});

test("E01: With Others sits behind a named lg-only toggle, and is always visible at xl", () => {
  // 1024-1279px (Tailwind lg but not xl): three lanes plus a permanently
  // visible sidebar left each lane too narrow to be readable there --
  // the toggle exists only in that band (hidden lg:inline-flex xl:hidden),
  // and the sidebar wrapper is CSS-hidden unless toggled open UNLESS xl
  // is reached, at which point xl:block makes it always visible again
  // regardless of the toggle's state.
  assert.match(courtDesktop, /hidden lg:inline-flex xl:hidden[\s\S]{0,400}With Others/);
  assert.match(courtDesktop, /withOthersOpenNarrow \? "block" : "hidden", "xl:block"/);
  assert.match(courtDesktop, /setWithOthersOpenNarrow/);
});

test("Court route provides actor identity while retaining the existing inline selection flow", () => {
  assert.match(courtRoute, /myActorId,[\s\S]*= useCourt\(\)/);
  assert.match(courtRoute, /<CourtDesktop[\s\S]*myActorId=\{myActorId\}/);
  assert.match(courtRoute, /<InlineThingDetailWorkspace/);
  assert.doesNotMatch(courtDesktop, /navigate\(|useNavigate|Link to=/);
});
