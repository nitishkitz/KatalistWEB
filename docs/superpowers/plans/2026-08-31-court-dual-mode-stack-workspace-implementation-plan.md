# Court Dual-Mode Stack Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reproduce the two approved Court states exactly and connect them with a restrained, accessible, identity-preserving transition.

**Architecture:** Keep `CourtDesktop` as the data/filter owner and add a single `CourtWorkspace` composition that renders overview or focused mode from the same lane arrays and stable Thing IDs. Reuse the existing stack, navigator, detail, capability, RPC, focus-restoration, and gesture boundaries; replace the current thin focus rails with compact lanes and make the structural transition an explicit four-phase state machine.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4, native Pointer/Wheel Events, TanStack Query, existing Supabase RPC wrappers, Node test runner, Playwright for local visual/interaction QA.

**Spec:** `docs/superpowers/specs/2026-08-31-court-dual-mode-stack-workspace-design.md`

## Global Constraints

- Work only on desktop Court presentation and the shared Thing-detail surface required by Court.
- Preserve the existing mobile Court implementation.
- Preserve all Supabase queries, RPC signatures, schemas, permissions, capability rules, lifecycle rules, and realtime reconciliation.
- Preserve sidebar, Court header, metrics, filtering, avatar filtering, search, sorting, WITH OTHERS, and the single AppShell Magic Box.
- Initial Court is three equal layered stack lanes; focused Court is selected-lane navigator + detail immediately after its lane + compact remaining lanes.
- Never render a Sheet, drawer, modal, overlay, dimmer, internal detail scroller, vertical writing-mode rail, duplicate Magic Box, `+ N more`, fabricated description, `Standalone`, `No due date`, Owner Importance, or `My Pace`.
- Use lane-colored depth layers: NOW coral, NEXT blue, LATER violet.
- Use `Catch`, `Later`, and `Sorted` as visible stack actions when capabilities permit.
- Structural transitions use 240ms/220ms durations and `cubic-bezier(0.2, 0.8, 0.2, 1)`; focused-item replacement uses 180ms.
- Reduced motion preserves behavior with zero travel and no delayed state change.
- Preserve unrelated dirty-worktree changes. Do not rebase, amend, squash, force-push, deploy, or modify Netlify configuration.

---

## File Structure

### Create

- `src/features/court/CourtWorkspace.tsx` — the overview/focused composition and structural transition phase.
- `src/features/court/CourtCompactLane.tsx` — real, readable non-selected lane preview used only in focused mode.
- `scripts/court-dual-mode-workspace.test.mjs` — source-contract tests for both fixed layouts and forbidden regressions.
- `scripts/court-transition-model.test.mjs` — pure transition/reconciliation tests.

### Modify

- `src/features/court/CourtDesktop.tsx` — delegate the personal-lane region to `CourtWorkspace`; retain data, filters, WITH OTHERS, and focus origin.
- `src/features/court/CourtLaneStack.tsx` — exact overview stack geometry, lane-colored layers, two queued rows, and smooth navigation.
- `src/features/court/ThingStackCard.tsx` — approved metadata/actions; remove fabricated descriptions and obsolete labels.
- `src/features/court/CourtFocusView.tsx` — contextual lane ordering, natural-height detail, and compact non-selected lanes.
- `src/features/court/ThingNavigator.tsx` — strong lane-colored selected row with no persistent browse-state selection.
- `src/features/court/court-stack-model.ts` — pure workspace ordering and transition helpers.
- `src/features/court/use-stack-gesture.ts` — exact motion duration/easing, input lock, and reduced-motion completion.
- `src/features/things/ThingDetailContent.tsx` — state-driven compact detail, optional Due, `Pace`, external bucket access, and natural height.
- `src/features/things/use-thing-comments.ts` — resolve author identities through the existing identity resolver.
- `scripts/court-stack-components.test.mjs` — update old rail/label assertions to the approved contracts.
- `scripts/inline-thing-detail-workspace.test.mjs` — assert natural page flow and shared state-driven detail.

## Interfaces

```ts
export type CourtWorkspacePhase = "overview" | "opening" | "focused" | "closing";

export type CourtFocusSelection = {
  lane: CourtLaneId;
  thingId: string;
};

export type FocusColumn =
  | { kind: "navigator"; lane: CourtLaneId }
  | { kind: "detail"; lane: CourtLaneId; thingId: string }
  | { kind: "compact"; lane: CourtLaneId };

export function focusColumns(selection: CourtFocusSelection): FocusColumn[];
export function transitionDuration(phase: CourtWorkspacePhase, reduceMotion: boolean): number;
```

`focusColumns` must return:

```ts
focusColumns({ lane: "now", thingId: "n" });
// navigator(now), detail(now/n), compact(next), compact(later)

focusColumns({ lane: "next", thingId: "x" });
// compact(now), navigator(next), detail(next/x), compact(later)

focusColumns({ lane: "later", thingId: "l" });
// compact(now), compact(next), navigator(later), detail(later/l)
```

---

### Task 1: Freeze the two-state Court contract in tests

**Files:**
- Create: `scripts/court-dual-mode-workspace.test.mjs`
- Modify: `scripts/court-stack-components.test.mjs`

**Interfaces:**
- Consumes: current Court component source files.
- Produces: failing contract tests that guard overview stacks, contextual focus order, compact lanes, natural detail height, and forbidden UI.

- [ ] **Step 1: Write the new failing contract tests**

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const workspace = read("src/features/court/CourtWorkspace.tsx");
const focus = read("src/features/court/CourtFocusView.tsx");
const compact = read("src/features/court/CourtCompactLane.tsx");
const stack = read("src/features/court/CourtLaneStack.tsx");
const card = read("src/features/court/ThingStackCard.tsx");

test("overview is three equal layered stacks", () => {
  assert.match(workspace, /grid-cols-3/);
  assert.match(workspace, /CourtLaneStack/);
  assert.match(stack, /depthCount/);
  assert.match(stack, /Scroll for more/);
  assert.doesNotMatch(stack, /\+\s*\{?.*more/i);
});

test("focused mode inserts detail immediately after the selected lane", () => {
  assert.match(focus, /focusColumns\(selection\)/);
  assert.match(focus, /CourtCompactLane/);
  assert.doesNotMatch(focus, /writing-mode:vertical-rl|overflow-y-auto|max-h-\[/);
});

test("stack cards render only real optional metadata", () => {
  assert.doesNotMatch(card, /Go through the brief|Work is in progress|Needs to be caught/);
  assert.doesNotMatch(card, /No due date|Standalone|Owner Importance|My Pace/);
  assert.match(card, />\s*Catch\s*</);
  assert.match(card, />\s*Later\s*</);
  assert.match(card, />\s*Sorted\s*</);
});

test("focused compact lanes remain readable lanes, not rails", () => {
  assert.match(compact, /courtLaneContent/);
  assert.match(compact, /things\.slice\(0, 3\)/);
  assert.doesNotMatch(compact, /writing-mode|rotate-|skew-|perspective/);
});
```

- [ ] **Step 2: Replace stale assertions in `court-stack-components.test.mjs`**

Replace the `Caught It`, thin `rails`, and writing-mode expectations with `Catch`, `focusColumns`, and `CourtCompactLane`. Keep canonical RPC, capability, native gesture, shared-detail, Magic Box, and WITH OTHERS assertions unchanged.

- [ ] **Step 3: Run the focused tests and confirm the new contract fails**

Run:

```bash
node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/court-dual-mode-workspace.test.mjs scripts/court-stack-components.test.mjs
```

Expected: FAIL because `CourtWorkspace.tsx` and `CourtCompactLane.tsx` do not exist and current focus mode still renders vertical rails/internal scrolling.

- [ ] **Step 4: Commit the contract tests**

```bash
git add scripts/court-dual-mode-workspace.test.mjs scripts/court-stack-components.test.mjs
git commit -m "test: lock Court overview and focus layouts"
```

---

### Task 2: Add pure contextual ordering and transition rules

**Files:**
- Modify: `src/features/court/court-stack-model.ts`
- Create: `scripts/court-transition-model.test.mjs`

**Interfaces:**
- Consumes: `CourtLaneId` and `CourtFocusSelection`.
- Produces: `focusColumns(selection)`, `transitionDuration(phase, reduceMotion)`, and stable lane order shared by view components.

Move the existing `CourtFocusSelection` type from `CourtFocusView.tsx` into `court-stack-model.ts`; `CourtDesktop`, `CourtWorkspace`, and `CourtFocusView` must import that one definition rather than declaring parallel types.

- [ ] **Step 1: Write failing pure tests**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { focusColumns, transitionDuration } from "@/features/court/court-stack-model";

const kinds = (lane) => focusColumns({ lane, thingId: "thing-1" }).map(
  (column) => `${column.kind}:${column.lane}`,
);

test("detail follows its selected lane", () => {
  assert.deepEqual(kinds("now"), ["navigator:now", "detail:now", "compact:next", "compact:later"]);
  assert.deepEqual(kinds("next"), ["compact:now", "navigator:next", "detail:next", "compact:later"]);
  assert.deepEqual(kinds("later"), ["compact:now", "compact:next", "navigator:later", "detail:later"]);
});

test("transition timings are fixed and reduced motion is immediate", () => {
  assert.equal(transitionDuration("opening", false), 240);
  assert.equal(transitionDuration("closing", false), 220);
  assert.equal(transitionDuration("focused", false), 180);
  assert.equal(transitionDuration("opening", true), 0);
});
```

- [ ] **Step 2: Run and confirm failure**

Run:

```bash
node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/court-transition-model.test.mjs
```

Expected: FAIL because the two exported helpers do not exist.

- [ ] **Step 3: Implement the pure helpers**

```ts
export type CourtWorkspacePhase = "overview" | "opening" | "focused" | "closing";

export type CourtFocusSelection = { lane: CourtLaneId; thingId: string };

export type FocusColumn =
  | { kind: "navigator"; lane: CourtLaneId }
  | { kind: "detail"; lane: CourtLaneId; thingId: string }
  | { kind: "compact"; lane: CourtLaneId };

const laneOrder: CourtLaneId[] = ["now", "next", "later"];

export function focusColumns(selection: CourtFocusSelection): FocusColumn[] {
  return laneOrder.flatMap((lane): FocusColumn[] => {
    if (lane !== selection.lane) return [{ kind: "compact", lane }];
    return [
      { kind: "navigator", lane },
      { kind: "detail", lane, thingId: selection.thingId },
    ];
  });
}

export function transitionDuration(
  phase: CourtWorkspacePhase,
  reduceMotion: boolean,
): number {
  if (reduceMotion) return 0;
  if (phase === "opening") return 240;
  if (phase === "closing") return 220;
  if (phase === "focused") return 180;
  return 0;
}
```

- [ ] **Step 4: Run the pure tests**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/court/court-stack-model.ts scripts/court-transition-model.test.mjs
git commit -m "feat: define Court workspace transition model"
```

---

### Task 3: Match the approved overview stack cards

**Files:**
- Modify: `src/features/court/CourtLaneStack.tsx`
- Modify: `src/features/court/ThingStackCard.tsx`
- Modify: `src/features/court/KatalistIcon.tsx` only if an existing registered icon needs to be selected; do not add a dependency.
- Test: `scripts/court-dual-mode-workspace.test.mjs`
- Test: `scripts/court-stack-components.test.mjs`

**Interfaces:**
- Consumes: existing `CourtLaneStackProps`, `CourtLaneStackHandle`, capabilities, RPC wrappers, `formatCourtDue`, and `PersonAvatar`.
- Produces: exact overview lane presentation without changing the public lane API.

- [ ] **Step 1: Add assertions for exact depth and preview counts**

Add:

```js
assert.match(stack, /Math\.min\(2, Math\.max\(0, things\.length - 1\)\)/);
assert.match(stack, /\.slice\(0, 2\)/);
assert.match(stack, /min-h-\[190px\]/);
assert.match(stack, /border-status-now|border-status-next|border-status-later/);
```

- [ ] **Step 2: Run and confirm failure**

Run the Task 1 focused-test command. Expected: FAIL because current depth is three, previews are three, layers use generic borders, and card copy includes fabricated descriptions.

- [ ] **Step 3: Implement the lane-colored depth contract**

Add one presentation map inside `CourtLaneStack.tsx`:

```ts
const stackTone: Record<CourtLaneId, { layer: string; selected: string }> = {
  now: { layer: "border-status-now/25 bg-red-50/55", selected: "border-status-now/45" },
  next: { layer: "border-status-next/25 bg-blue-50/55", selected: "border-status-next/45" },
  later: { layer: "border-status-later/25 bg-violet-50/55", selected: "border-status-later/45" },
};
```

Render exactly two non-interactive layers using `translateY(-6px)` and `translateY(-3px)` with opacity above `0.72`. Keep all layers straight and `aria-hidden="true"`. Set the active-card region to `min-h-[220px]`, the card itself to `min-h-[190px]`, and remove the separate numeric `current / total` footer from the card stack because header count plus stack depth already communicates quantity.

- [ ] **Step 4: Render exactly two queued rows and the approved hint**

Filter out the active Thing, call `.slice(0, 2)`, omit due text when `formatCourtDue` returns `No due date`, and render `Scroll for more` only when more than two non-active Things remain. Do not render `+ N more`.

- [ ] **Step 5: Simplify `ThingStackCard` to real data**

Remove the generic subtitle block. Preserve title, assignment/avatar, optional due, one acknowledgement/work-status treatment, optional List, and action rail. Change `Caught It` to `Catch` and `Snooze` to `Later`. Add a neutral `Details` action that calls `onOpen` without triggering mutation; keep `Later` and `Sorted` capability-gated.

- [ ] **Step 6: Run focused tests**

Run:

```bash
node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/court-stack-model.test.mjs scripts/court-stack-components.test.mjs scripts/court-dual-mode-workspace.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/court/CourtLaneStack.tsx src/features/court/ThingStackCard.tsx src/features/court/KatalistIcon.tsx scripts/court-dual-mode-workspace.test.mjs scripts/court-stack-components.test.mjs
git commit -m "feat: match approved Court stack cards"
```

---

### Task 4: Make stack navigation feel physical but restrained

**Files:**
- Modify: `src/features/court/use-stack-gesture.ts`
- Modify: `src/features/court/CourtLaneStack.tsx`
- Modify: `src/features/court/court-stack-model.ts`
- Test: `scripts/court-stack-model.test.mjs`
- Test: `scripts/court-stack-components.test.mjs`

**Interfaces:**
- Consumes: `stepStackIndex`, `lockGestureAxis`, `resolveHorizontalAction`, `resistedDragOffset`.
- Produces: one-card wheel/swipe navigation, smooth outgoing/incoming states, and input lock.

- [ ] **Step 1: Add failing timing and lock assertions**

```js
assert.match(laneStack, /duration-\[240ms\]/);
assert.match(laneStack, /cubic-bezier\(0\.2,0\.8,0\.2,1\)/);
assert.match(laneStack, /navigationLocked/);
assert.match(laneStack, /motion-reduce:transition-none/);
```

- [ ] **Step 2: Run and confirm failure**

Run the Task 3 test command. Expected: FAIL because the existing stack transition uses 280ms and has no explicit navigation lock.

- [ ] **Step 3: Add a single navigation lock**

Set `navigationLocked` before advancing. Ignore wheel, pointer completion, preview clicks, and arrow keys while locked. Release it from `transitionend`, with a `window.setTimeout(260)` safety fallback cleared on unmount.

- [ ] **Step 4: Implement the two-phase card motion**

Outgoing active card: `translate3d(0, 12px, 0) scale(0.985)` and opacity `0`. Incoming card begins `translate3d(0, -8px, 0) scale(0.99)` and settles to rest. Decorative layers shift forward by 3px during the transition. Use `duration-[240ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]` and no rotation or overshoot.

- [ ] **Step 5: Preserve reduced motion and page scroll**

When reduced motion is true, update the active index synchronously and release the lock in the same microtask. Continue to call `preventDefault()` only when the active stack consumes wheel direction; keep the existing cooldown and threshold.

- [ ] **Step 6: Run gesture and stack tests**

Run:

```bash
node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/court-stack-model.test.mjs scripts/court-stack-components.test.mjs scripts/court-dual-mode-workspace.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/court/use-stack-gesture.ts src/features/court/CourtLaneStack.tsx src/features/court/court-stack-model.ts scripts/court-stack-model.test.mjs scripts/court-stack-components.test.mjs
git commit -m "feat: smooth Court stack navigation"
```

---

### Task 5: Build the focused lane/detail composition

**Files:**
- Create: `src/features/court/CourtCompactLane.tsx`
- Modify: `src/features/court/CourtFocusView.tsx`
- Modify: `src/features/court/ThingNavigator.tsx`
- Test: `scripts/court-dual-mode-workspace.test.mjs`

**Interfaces:**
- Consumes: `focusColumns`, `courtLaneContent`, current lane arrays, `ThingDetailContent`, and `formatCourtDue`.
- Produces: contextual focused ordering with a selected navigator, natural-height detail, and two compact non-selected lanes.

- [ ] **Step 1: Implement the compact lane with real data**

`CourtCompactLane` accepts:

```ts
type CourtCompactLaneProps = {
  lane: CourtLaneId;
  things: Thing[];
  onOpen: (lane: CourtLaneId, thing: Thing, origin: HTMLElement) => void;
};
```

Render lane icon, label, count, descriptor, and up to three real Thing buttons. Each button shows a two-line title, avatar, one status cue, and optional due. Do not show `+ N more`; the header count is sufficient.

- [ ] **Step 2: Replace the rail map with `focusColumns`**

In `CourtFocusView`, map the pure column model:

```tsx
{focusColumns(selection).map((column) => {
  if (column.kind === "navigator") {
    return <ThingNavigator key={`navigator-${column.lane}`} {...navigatorProps} />;
  }
  if (column.kind === "detail") {
    return <ThingDetailContent key={column.thingId} initialThing={selectedThing} headerAction={closeButton} />;
  }
  return <CourtCompactLane key={`compact-${column.lane}`} lane={column.lane} things={lanes[column.lane]} onOpen={onOpen} />;
})}
```

Use a dynamic CSS grid in which navigator is `minmax(210px, 250px)`, detail is `minmax(480px, 1fr)`, and compact lanes are `minmax(126px, 160px)`. At narrower desktop widths, reduce gaps and compact lane padding before changing typography. Never apply `overflow-y-auto` or a viewport `max-height` to detail.

- [ ] **Step 3: Apply the selected-row contract**

In `ThingNavigator`, use `aria-current={selected}` plus lane-specific 3px left border, tinted background, and border. Keep `focus-visible:ring-2` only for keyboard focus. Remove the screen-reader sentence `Selected …` if it produces duplicate announcements; announce the new detail title once from the workspace live region.

- [ ] **Step 4: Run focused layout tests**

Run the Task 3 test command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/court/CourtCompactLane.tsx src/features/court/CourtFocusView.tsx src/features/court/ThingNavigator.tsx scripts/court-dual-mode-workspace.test.mjs
git commit -m "feat: add contextual Court focus workspace"
```

---

### Task 6: Orchestrate the seamless overview-to-focus transition

**Files:**
- Create: `src/features/court/CourtWorkspace.tsx`
- Modify: `src/features/court/CourtDesktop.tsx`
- Modify: `src/features/court/CourtFocusView.tsx`
- Test: `scripts/court-dual-mode-workspace.test.mjs`

**Interfaces:**
- Consumes: `CourtFocusSelection`, `CourtWorkspacePhase`, three lane arrays, origin element/input modality, `CourtLaneStackHandle`, and `transitionDuration`.
- Produces: one mounted workspace state machine with stable stack positions and focus restoration.

- [ ] **Step 1: Define the workspace props**

```ts
type CourtWorkspaceProps = {
  lanes: Record<CourtLaneId, Thing[]>;
  myActorId: string | null;
  selection: CourtFocusSelection | null;
  phase: CourtWorkspacePhase;
  onOpen: (lane: CourtLaneId, thing: Thing, origin: HTMLElement, input: "pointer" | "keyboard") => void;
  onSelectThing: (thingId: string) => void;
  onClose: () => void;
  onRefresh: () => Promise<void> | void;
  registerLaneRef: (lane: CourtLaneId, handle: CourtLaneStackHandle | null) => void;
};
```

- [ ] **Step 2: Render overview and focused layers from one boundary**

Overview uses `grid grid-cols-3 gap-3`. Focus uses `CourtFocusView`. During `opening`, keep the overview visible but inert while focused content enters; during `closing`, keep focused content inert while overview returns. Use `aria-hidden` and `inert` on the outgoing layer so duplicate controls never enter the accessibility tree.

- [ ] **Step 3: Add the four-phase state machine in `CourtDesktop`**

On open: record `{ lane, thingId, origin, input }`, set phase to `opening`, then `focused` after 240ms (or immediately for reduced motion). On close: set phase to `closing`, clear selection after 220ms, then set `overview`. Ignore repeated open/close commands during `opening` or `closing`.

- [ ] **Step 4: Restore focus without a persistent pointer ring**

For keyboard origins, call `focus({ preventScroll: true })` on the original Thing or reconciled active card. For pointer origins, restore logical stack position but do not programmatically focus the card. If the original Thing disappeared, keyboard restoration targets the nearest active card or lane heading. This removes the unwanted purple border while retaining keyboard accessibility.

- [ ] **Step 5: Preserve selection through live data changes**

Keep the existing identity-first reconciliation. If the selected Thing moves out of the lane, choose the nearest Thing by the previous numeric index. If the lane becomes empty, initiate `closing`. Never use array index as the selection identity.

- [ ] **Step 6: Run focused tests**

Run:

```bash
node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/court-transition-model.test.mjs scripts/court-stack-model.test.mjs scripts/court-stack-components.test.mjs scripts/court-dual-mode-workspace.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/court/CourtWorkspace.tsx src/features/court/CourtDesktop.tsx src/features/court/CourtFocusView.tsx scripts/court-dual-mode-workspace.test.mjs
git commit -m "feat: connect Court overview and focus motion"
```

---

### Task 7: Finish the state-driven Thing Detail surface

**Files:**
- Modify: `src/features/things/ThingDetailContent.tsx`
- Modify: `src/features/things/use-thing-comments.ts`
- Modify: `scripts/inline-thing-detail-workspace.test.mjs`
- Test: `scripts/court-dual-mode-workspace.test.mjs`

**Interfaces:**
- Consumes: `getThingCapabilities`, existing RPCs, comment/activity hooks, bucket hook, and identity resolver RPC.
- Produces: natural-height, capability-driven detail shared by Court, Lists, Buckets, and WITH OTHERS.

- [ ] **Step 1: Add failing state-detail assertions**

```js
assert.doesNotMatch(detail, />My Pace</);
assert.doesNotMatch(detail, /Owner Importance/);
assert.match(detail, />Pace</);
assert.match(detail, /thing\.dueAt \?/);
assert.match(detail, /Choose Buckets/);
assert.doesNotMatch(detail, /max-h-\[calc\(|overflow-y-auto/);
```

Add comment assertions that the hook calls the existing actor-identity resolver and does not hardcode `Member`.

- [ ] **Step 2: Run and confirm failure**

Run:

```bash
node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/inline-thing-detail-workspace.test.mjs scripts/court-dual-mode-workspace.test.mjs
```

Expected: FAIL on `My Pace`, form-like terminal controls, and unresolved comment authors.

- [ ] **Step 3: Derive a single lifecycle presentation mode**

```ts
const terminal = thing.workStatus === "sorted" || thing.workStatus === "cancelled";
const waiting = !terminal && thing.acknowledgement === "waiting_for_catch";
const activeCaught = !terminal && thing.acknowledgement === "caught";
```

Render actions only for the applicable mode and capability. Do not render disabled Pace/Work Status rows for terminal Things. Keep Due conditional on `thing.dueAt`.

- [ ] **Step 4: Build the compact facts/actions row**

Show assignment flow plus acknowledgement/status first. Render optional Due. Render state-specific actions. For `activeCaught`, render one row labeled `Pace` with `NOW | NEXT | LATER` right-aligned and the current personal pace selected. Keep `Choose Buckets…` immediately below the facts/actions area and outside collapsed Details.

- [ ] **Step 5: Keep secondary identity/history collapsed**

The `Details` disclosure contains Creator, Owner, Current Assignee, source List, created timestamp, and updated timestamp. Reassign remains primary only when `caps.canReassign` and the Thing is active.

- [ ] **Step 6: Resolve comment identities**

Collect unique comment actor IDs, call the existing `resolve_actor_identities` path once per query result, and map each comment to `{ name, avatarUrl }`. Render `Someone` only when an ID genuinely cannot be resolved. Preserve existing comment IDs, bodies, timestamps, post behavior, and cache invalidation.

- [ ] **Step 7: Run detail and RPC regressions**

Run:

```bash
node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/inline-thing-detail-workspace.test.mjs scripts/katalist-rpc-routing.test.mjs scripts/court-dual-mode-workspace.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/features/things/ThingDetailContent.tsx src/features/things/use-thing-comments.ts scripts/inline-thing-detail-workspace.test.mjs scripts/court-dual-mode-workspace.test.mjs
git commit -m "feat: make Thing detail state driven"
```

---

### Task 8: Verify preserved Court behavior and accessibility

**Files:**
- Modify only tests if a missing regression is discovered.

**Interfaces:**
- Consumes: completed dual-mode Court.
- Produces: evidence that filters, actions, focus, reduced motion, WITH OTHERS, Magic Box, and mobile boundaries remain intact.

- [ ] **Step 1: Run all targeted tests**

```bash
node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test \
  scripts/court-transition-model.test.mjs \
  scripts/court-stack-model.test.mjs \
  scripts/court-stack-components.test.mjs \
  scripts/court-dual-mode-workspace.test.mjs \
  scripts/court-view-model.test.mjs \
  scripts/inline-thing-detail-workspace.test.mjs
```

Expected: all PASS.

- [ ] **Step 2: Run the complete automated suite**

```bash
npm test
npm run typecheck
npm run lint
npm run build:dev
git diff --check
```

Expected: each command exits 0. Record pre-existing lint issues separately; do not hide new failures.

- [ ] **Step 3: Start local UAT mode only**

Use the repository's existing saved UAT environment and fixed-OTP middleware; do not paste credentials into tracked files.

```bash
npm run dev
```

Expected: `http://localhost:8080/auth` loads, static OTP `111111` authenticates, and Court displays real UAT Supabase data.

- [ ] **Step 4: Verify the overview state at 1440px and 1280px**

Confirm three equal lanes, lane-colored depth, two queued rows, no horizontal page scroll, one Magic Box, and WITH OTHERS below the row. Verify filter pills, avatars, search, sort, and detailed filters update the same lane arrays.

- [ ] **Step 5: Verify all three focused orderings**

Open a Thing from NOW, NEXT, and LATER. Confirm the selected lane becomes navigator, detail appears immediately after that lane, remaining lanes are compact/readable, and no sheet/overlay/internal scrollbar appears.

- [ ] **Step 6: Verify motion and input**

Use wheel, trackpad, pointer drag, touch emulation, arrow keys, Enter/Space, and Escape. Confirm only one stack advances per gesture, no card skips during a fling, no overlap/jump occurs, and repeated clicks during transitions are ignored.

- [ ] **Step 7: Verify focus restoration and reduced motion**

Pointer open/close must not leave a purple border. Keyboard open/Escape must restore a visible accessible ring. Emulate `prefers-reduced-motion: reduce`; confirm state changes are immediate with no travel or cross-fade delay.

- [ ] **Step 8: Verify canonical actions with real UAT Things**

Confirm Catch, Later, Sorted, Pace, Reassign, Cancel, bucket selection, comments, and activity use existing permissions and mutations. Verify Sorted/Cancelled detail hides irrelevant active controls. Do not mutate production Supabase.

- [ ] **Step 9: Commit verification-only test updates, if any**

```bash
git add scripts
git commit -m "test: cover Court dual-mode regressions"
```

Skip this commit when no test files changed.

---

### Task 9: Final review and delivery preparation

**Files:**
- No required source changes.

**Interfaces:**
- Consumes: verified implementation.
- Produces: reviewable forward-only commits on the existing integrated branch.

- [ ] **Step 1: Review only the intended diff**

```bash
git status --short
git diff -- src/features/court src/features/things scripts docs/superpowers
git diff --check
```

Confirm unrelated user changes are neither staged nor reverted.

- [ ] **Step 2: Run the final verification set again after review fixes**

```bash
npm test
npm run typecheck
npm run lint
npm run build:dev
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 3: Request code review**

Use `superpowers:requesting-code-review`. Require review against both approved reference images and this specification, with special attention to contextual lane order, capabilities, focus restoration, reduced motion, and forbidden sheets/overlays.

- [ ] **Step 4: Stop before external delivery**

Do not push, merge, deploy, or modify Netlify until the user manually approves the local result. After approval, push only forward commits to the user-designated integrated branch; never force-push or rewrite Lovable history.
