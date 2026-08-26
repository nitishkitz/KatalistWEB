# Court Card Stacks and In-Place Focus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the desktop Court's flat NOW/NEXT/LATER rows with independent, capability-aware card stacks and an inline Thing focus workspace while preserving the current Court shell and backend contracts.

**Architecture:** Keep `CourtDesktop` responsible for filtering, sorting, the three lane arrays, Magic Box, loading/error state, and With Others. Add pure stack-state helpers, a focused gesture hook, lane/card components, and an inline focus composition; extract the existing Thing detail body so both the current Sheet and Court focus mode use one implementation.

**Tech Stack:** React 19, TypeScript, TanStack Router/Query, Tailwind CSS 4, browser Pointer/Wheel Events, Node test runner, existing Supabase RPC wrappers.

**Spec:** `docs/superpowers/specs/2026-08-26-court-card-stacks-focus-design.md`

## Global Constraints

- Modify only the desktop NOW/NEXT/LATER Court interaction plus the minimum shared Thing-detail extraction and tests.
- Preserve Sidebar, Court header/subtitle, filters, search, sorting, Magic Box, responsive entry point, routes, typography, colors, icons, spacing, and With Others.
- Keep the existing mobile Court markup and behavior unchanged.
- Do not change Thing models, capabilities, queries, API contracts, RPCs, migrations, enums, lifecycle states, or realtime integration.
- Right action means Sorted through `rpcSortThing`.
- Left action is labeled Later and calls `rpcSetPersonalPace(thing.id, "later")`.
- Never import or call `snooze_breakthrough` from Court code.
- Waiting-for-Catch exposes Catch as primary and has no horizontal mutation action until caught.
- LATER exposes no Later button; left drag resists and snaps back.
- Focus selection is keyed by `thingId`; stack removal reconciles to the nearest valid index.
- Use 180–280ms restrained transitions and honor `prefers-reduced-motion`.
- Preserve unrelated dirty-worktree changes and commit only files belonging to each task.

## File Structure

### Create

- `src/features/court/court-stack-model.ts` — pure stack reconciliation, stepping, gesture-axis, action, and resistance decisions.
- `src/features/court/use-stack-gesture.ts` — Pointer/Wheel Event orchestration built on `court-stack-model.ts`.
- `src/features/court/ThingStackCard.tsx` — active card content and visible Catch/Later/Sorted buttons.
- `src/features/court/CourtLaneStack.tsx` — one lane's header, depth layers, active index, actions, counter, and ref registration.
- `src/features/court/ThingNavigator.tsx` — narrow selected-lane list keyed by Thing ID.
- `src/features/court/CourtFocusView.tsx` — selected-lane navigator, inline detail, and contextual rails.
- `src/features/things/ThingDetailContent.tsx` — shared Thing detail data/actions/content without Sheet ownership.
- `scripts/court-stack-model.test.mjs` — pure stack/gesture decision tests.
- `scripts/court-stack-components.test.mjs` — source-contract tests for component wiring and prohibited backend behavior.

### Modify

- `src/features/things/ThingDetailSheet.tsx` — retain only Sheet container behavior and delegate to `ThingDetailContent`.
- `scripts/katalist-rpc-routing.test.mjs` — inspect shared detail content for Sort/Cancel routing.
- `scripts/katalist-freeze.test.mjs` — inspect shared detail content for Shred behavior.
- `scripts/katalist-foundation.test.mjs` — inspect shared detail content for personal-shred and Bridge contracts.
- `src/features/court/CourtDesktop.tsx` — replace lane row/focus expansion with stack and focus compositions; leave controls and With Others intact.
- `src/routes/index.tsx` — pass `myActorId` into desktop Court while preserving the mobile sheet flow.

---

### Task 1: Pure Stack and Gesture Decisions

**Files:**
- Create: `src/features/court/court-stack-model.ts`
- Create: `scripts/court-stack-model.test.mjs`

**Interfaces:**
- Consumes: `CourtLaneId` from `court-view-model.ts` and arrays containing `{ id: string }`.
- Produces:
  - `reconcileStackIndex(previousIndex: number, previousThingId: string | null, things: readonly { id: string }[]): number`
  - `stepStackIndex(index: number, count: number, direction: 1 | -1): number`
  - `lockGestureAxis(current: GestureAxis, deltaX: number, deltaY: number, threshold?: number): GestureAxis`
  - `resolveHorizontalAction(input: HorizontalActionInput): "sort" | "later" | null`
  - `resistedDragOffset(deltaX: number, canSort: boolean, canMoveLater: boolean): number`

- [ ] **Step 1: Write failing pure behavior tests**

Create `scripts/court-stack-model.test.mjs` with a local `items(...ids)` helper and tests equivalent to:

```js
test("reconciliation preserves identity through reorder and clamps removal", () => {
  assert.equal(reconcileStackIndex(1, "b", items("c", "b", "a")), 1);
  assert.equal(reconcileStackIndex(2, "c", items("a", "b")), 1);
  assert.equal(reconcileStackIndex(3, "missing", []), 0);
});

test("stepping wraps only non-empty multi-item stacks", () => {
  assert.equal(stepStackIndex(2, 3, 1), 0);
  assert.equal(stepStackIndex(0, 3, -1), 2);
  assert.equal(stepStackIndex(0, 0, 1), 0);
});

test("gesture intent locks to the first dominant axis after ten pixels", () => {
  assert.equal(lockGestureAxis(null, 6, 5), null);
  assert.equal(lockGestureAxis(null, 12, 7), "horizontal");
  assert.equal(lockGestureAxis("horizontal", 13, 40), "horizontal");
  assert.equal(lockGestureAxis(null, 8, -14), "vertical");
});

test("actions honor capability, direction, threshold, and LATER resistance", () => {
  assert.equal(resolveHorizontalAction({ deltaX: 80, threshold: 72, canSort: true, canMoveLater: true }), "sort");
  assert.equal(resolveHorizontalAction({ deltaX: -80, threshold: 72, canSort: true, canMoveLater: true }), "later");
  assert.equal(resolveHorizontalAction({ deltaX: -80, threshold: 72, canSort: true, canMoveLater: false }), null);
  assert.equal(resolveHorizontalAction({ deltaX: 50, threshold: 72, canSort: true, canMoveLater: true }), null);
  assert.equal(resistedDragOffset(-100, true, false), -18);
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```bash
node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/court-stack-model.test.mjs
```

Expected: FAIL because `court-stack-model.ts` does not exist.

- [ ] **Step 3: Implement the pure helpers**

Use explicit exported types:

```ts
export type GestureAxis = "horizontal" | "vertical" | null;

export type HorizontalActionInput = {
  deltaX: number;
  threshold: number;
  canSort: boolean;
  canMoveLater: boolean;
};
```

Implementation rules:

- `reconcileStackIndex` searches by `previousThingId` first; otherwise it clamps `previousIndex` to `0..things.length - 1`; empty arrays return zero.
- `stepStackIndex` returns zero for count zero or one and uses modulo wrapping for larger counts.
- `lockGestureAxis` returns `current` unchanged once non-null, waits while `max(absX, absY) < threshold`, then chooses the dominant axis.
- `resolveHorizontalAction` requires `deltaX >= threshold && canSort` for Sort and `deltaX <= -threshold && canMoveLater` for Later.
- `resistedDragOffset` returns the full delta in permitted directions and multiplies blocked-direction movement by `0.18`.

- [ ] **Step 4: Run the focused and existing Court tests**

Run:

```bash
node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/court-stack-model.test.mjs scripts/court-view-model.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add scripts/court-stack-model.test.mjs src/features/court/court-stack-model.ts
git commit -m "test: define Court stack interaction model"
```

---

### Task 2: Shared Thing Detail Content

**Files:**
- Create: `src/features/things/ThingDetailContent.tsx`
- Modify: `src/features/things/ThingDetailSheet.tsx`
- Modify: `scripts/katalist-rpc-routing.test.mjs`
- Modify: `scripts/katalist-freeze.test.mjs`
- Modify: `scripts/katalist-foundation.test.mjs`
- Create: `scripts/court-stack-components.test.mjs`

**Interfaces:**
- Consumes: existing `Thing`, `useThing`, `useThingComments`, `useCourt`, capability checks, Bucket/People hooks, RPC wrappers, and query invalidation.
- Produces:

```ts
export type ThingDetailContentProps = {
  initialThing: Thing | null;
  headerAction?: React.ReactNode;
  onAfterTerminalAction?: () => void;
};

export function ThingDetailContent(props: ThingDetailContentProps): React.ReactNode;
```

- [ ] **Step 1: Write the failing shared-detail contract**

Create `scripts/court-stack-components.test.mjs`. Read `ThingDetailSheet.tsx` and the future `ThingDetailContent.tsx`; assert:

```js
test("Thing detail sheet delegates to one shared content implementation", () => {
  assert.match(sheet, /<ThingDetailContent/);
  assert.match(sheet, /initialThing=\{thing\}/);
  assert.equal(sheet.includes("rpcSortThing"), false);
  assert.match(content, /await rpcSortThing\(thing\.id\)/);
  assert.match(content, /await rpcCancelThing\(thing\.id\)/);
  assert.match(content, /await rpcShred\(thing\.id\)/);
});
```

Update the three existing source-contract tests to concatenate or directly inspect `ThingDetailContent.tsx` for detail actions. Do not weaken their assertions.

- [ ] **Step 2: Run the relevant tests and verify failure**

Run:

```bash
node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/court-stack-components.test.mjs scripts/katalist-rpc-routing.test.mjs scripts/katalist-freeze.test.mjs scripts/katalist-foundation.test.mjs
```

Expected: FAIL because `ThingDetailContent.tsx` does not exist and the sheet has not delegated.

- [ ] **Step 3: Extract the detail body without behavior changes**

Move the detail-only imports, constants, helpers, `AssignOutsideBlock`, hook/state setup, invalidation, and rendered content from `ThingDetailSheet.tsx` into `ThingDetailContent.tsx`.

Make these exact container substitutions:

- Rename incoming `thing: initial` to `initialThing`.
- Change `useThing(initial?.id ?? null)` to `useThing(initialThing?.id ?? null)`.
- Change `const thing = live.thing ?? initial` to `const thing = live.thing ?? initialThing`.
- Change the `moreOpen` reset dependency from `[open, thing?.id]` to `[thing?.id]`.
- Replace each `onOpenChange(false)` after Sort, Cancel, or Shred with `onAfterTerminalAction?.()`.
- Render `headerAction` beside the title in the existing header flex row.
- Use normal `div`/heading elements inside shared content; keep `SheetHeader` and `SheetTitle` in the wrapper or replace them with semantically equivalent `header`/`h2` styles in shared content so inline rendering has no Sheet dependency.

Keep every existing field, mutation, toast, capability gate, comment/activity behavior, and Bucket/Bridge behavior unchanged.

Reduce `ThingDetailSheet.tsx` to the Sheet wrapper:

```tsx
export function ThingDetailSheet({ thing, open, onOpenChange }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto border-l border-border bg-white p-0 shadow-none sm:max-w-[440px]">
        <ThingDetailContent
          initialThing={thing}
          onAfterTerminalAction={() => onOpenChange(false)}
        />
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 4: Verify shared-detail contracts and compilation**

Run:

```bash
node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/court-stack-components.test.mjs scripts/katalist-rpc-routing.test.mjs scripts/katalist-freeze.test.mjs scripts/katalist-foundation.test.mjs
npm run typecheck
```

Expected: tests PASS and TypeScript reports no errors.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/features/things/ThingDetailContent.tsx src/features/things/ThingDetailSheet.tsx scripts/court-stack-components.test.mjs scripts/katalist-rpc-routing.test.mjs scripts/katalist-freeze.test.mjs scripts/katalist-foundation.test.mjs
git commit -m "refactor: share Thing detail content"
```

---

### Task 3: Stack Gesture Hook

**Files:**
- Create: `src/features/court/use-stack-gesture.ts`
- Modify: `scripts/court-stack-components.test.mjs`

**Interfaces:**
- Consumes: `lockGestureAxis`, `resolveHorizontalAction`, and `resistedDragOffset` from `court-stack-model.ts`.
- Produces:

```ts
export type StackGestureOptions = {
  canSort: boolean;
  canMoveLater: boolean;
  horizontalDisabled?: boolean;
  interactionDisabled?: boolean;
  onSort: () => void;
  onLater: () => void;
  onStep: (direction: 1 | -1) => void;
};

export function useStackGesture(options: StackGestureOptions): {
  offset: { x: number; y: number };
  dragging: boolean;
  suppressClickRef: React.MutableRefObject<boolean>;
  gestureProps: Pick<React.HTMLAttributes<HTMLElement>, "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel" | "onWheel">;
};
```

- [ ] **Step 1: Add a failing source contract for event support**

Extend `scripts/court-stack-components.test.mjs` to read the hook and assert it uses Pointer capture, the pure axis lock, wheel accumulation, a wheel cooldown, `preventDefault()` only after consuming a gesture, and reduced-motion-compatible state rather than a new dependency. Assert `package.json` does not contain Framer Motion or another gesture library.

- [ ] **Step 2: Run the contract test and verify failure**

Run the Court component contract test. Expected: FAIL because the hook file does not exist.

- [ ] **Step 3: Implement Pointer and wheel orchestration**

Use refs for pointer start position, axis, accumulated wheel delta, last wheel time, and drag start time. Use these constants:

```ts
const INTENT_THRESHOLD = 10;
const ACTION_THRESHOLD = 72;
const VERTICAL_SWIPE_THRESHOLD = 44;
const WHEEL_THRESHOLD = 36;
const WHEEL_COOLDOWN_MS = 260;
```

Behavior:

- Capture the initiating pointer.
- Lock axis once through `lockGestureAxis`.
- Horizontal movement updates resisted X offset and prevents browser selection/drag.
- Vertical pointer movement updates a restrained Y preview; release past threshold calls `onStep(deltaY < 0 ? 1 : -1)`.
- Horizontal release calls one resolved action or snaps to zero.
- Wheel consumes only dominant vertical input over the active stack, calls one step per cooldown, and leaves ordinary page scrolling available at sub-threshold input.
- Set `suppressClickRef.current = true` only after a resolved stack step or horizontal action, then clear it on the next task/frame.
- Reset all offsets on cancel, interaction-disable changes, and completed release. `horizontalDisabled` blocks only horizontal mutation resolution; vertical pointer and wheel stack navigation remain available.

- [ ] **Step 4: Run tests and TypeScript**

Run the pure stack test, Court component contract test, and `npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/features/court/use-stack-gesture.ts scripts/court-stack-components.test.mjs
git commit -m "feat: add restrained Court stack gestures"
```

---

### Task 4: Active Stack Card and Independent Lane Stack

**Files:**
- Create: `src/features/court/ThingStackCard.tsx`
- Create: `src/features/court/CourtLaneStack.tsx`
- Modify: `scripts/court-stack-components.test.mjs`

**Interfaces:**
- Consumes: `Thing`, `CourtLaneId`, `getThingCapabilities`, existing RPC wrappers, `formatCourtDue`, `KatalistIcon`, avatar primitives, pure stack helpers, and `useStackGesture`.
- Produces:

```ts
export type CourtLaneStackHandle = {
  getPosition: () => { activeIndex: number; activeThingId: string | null };
  focusThing: (thingId: string | null) => void;
};

export type CourtLaneStackProps = {
  lane: CourtLaneId;
  things: Thing[];
  myActorId: string | null;
  initialPosition?: { activeIndex: number; activeThingId: string | null };
  onOpen: (thing: Thing, origin: HTMLElement) => void;
  onRefresh: () => unknown;
};
```

- [ ] **Step 1: Add failing card/lane contracts**

Extend the component contract test to assert:

- Exactly one active Thing is passed to `ThingStackCard`.
- Depth layers are `aria-hidden` and capped at three.
- The counter uses one-based active index and total.
- `getThingCapabilities` gates Catch, Later, and Sorted.
- Catch calls `rpcCatchThing`.
- Later calls `rpcSetPersonalPace(thing.id, "later")`.
- Sorted calls `rpcSortThing`.
- No Court stack file contains `snooze_breakthrough` or `snoozed_until`.
- Later is absent when `lane === "later"`.

- [ ] **Step 2: Run the component contract and verify failure**

Run the Court component contract test. Expected: FAIL because both component files are absent.

- [ ] **Step 3: Implement `ThingStackCard`**

Render one white, compact card with the current title, assignee, acknowledgement/work status, due date, List/Standalone source, and restrained existing owner importance/star semantics. Preserve lane accent classes from the current `CourtThingCard`.

Use one card-opening button region plus sibling action buttons to avoid nested interactive controls. The opening region must call `onOpen` only when `suppressClickRef.current` is false. Actions call `stopPropagation()`.

Action order:

- `canCatch`: show one primary **Caught It** button and no Later/Sorted buttons.
- Otherwise show **Later** when `canSetPace && lane !== "later"` and **Sorted** when `canSort`.
- Use `KatalistIcon` names `catch`, `later-lob`, and `sorted`.
- Disable all action buttons while the lane mutation is pending.

- [ ] **Step 4: Implement `CourtLaneStack`**

Use `forwardRef`/`useImperativeHandle` for `CourtLaneStackHandle`. Initialize from `initialPosition`, then track `activeIndex`, the last active Thing ID in a ref, pending action, and action error recovery.

On `things` changes, call `reconcileStackIndex` using the previous index and Thing ID. Use `stepStackIndex` for vertical navigation. Render:

- The existing lane icon, label, descriptor, accent tone, and filtered count.
- An empty state matching the current Court copy when no Thing matches.
- Up to three `aria-hidden` deck layers using restrained 4–8px vertical offsets.
- One active `ThingStackCard`.
- A minimal `${activeIndex + 1} / ${things.length}` indicator.
- One visually hidden `aria-live="polite"` region that announces the newly active Thing after keyboard/gesture navigation and successful Catch/Later/Sorted outcomes without repeating the full toast message.

Track the last navigation direction so an index change gives the outgoing card a restrained translate/fade and brings the next card forward over 220ms. Reset the animation phase after `transitionend`; under `motion-reduce`, swap the active Thing without travel. Do not animate or focus the decorative depth layers.

For action callbacks, use one guarded async runner:

```ts
async function runAction(action: "catch" | "later" | "sort") {
  if (!activeThing || pendingAction) return;
  setPendingAction(action);
  try {
    if (action === "catch") await rpcCatchThing(activeThing.id);
    if (action === "later") await rpcSetPersonalPace(activeThing.id, "later");
    if (action === "sort") await rpcSortThing(activeThing.id);
    toast.success(action === "catch" ? "Caught." : action === "later" ? "Moved to Later." : "Nicely sorted.");
    await onRefresh();
  } catch (error) {
    toast.error(domainErrorMessage(error));
  } finally {
    setPendingAction(null);
  }
}
```

The gesture hook receives `canSort`, `canMoveLater`, `horizontalDisabled: canCatch`, and `interactionDisabled: pendingAction !== null`. This prevents Catch from competing with horizontal mutation gestures while preserving vertical browsing; a pending mutation temporarily freezes the card until canonical reconciliation.

- [ ] **Step 5: Verify Task 4**

Run the pure stack test, component contract test, `npm run typecheck`, and `npm run lint -- --quiet` if the script accepts forwarded flags; otherwise run `npm run lint` and record only newly introduced failures.

Expected: new files pass their tests, typecheck, and lint.

- [ ] **Step 6: Commit Task 4**

```bash
git add src/features/court/ThingStackCard.tsx src/features/court/CourtLaneStack.tsx scripts/court-stack-components.test.mjs
git commit -m "feat: render independent Court card stacks"
```

---

### Task 5: Inline Focus Composition and Thing Navigator

**Files:**
- Create: `src/features/court/ThingNavigator.tsx`
- Create: `src/features/court/CourtFocusView.tsx`
- Modify: `scripts/court-stack-components.test.mjs`

**Interfaces:**
- Consumes: `CourtFocusSelection`, current filtered lane arrays, `ThingDetailContent`, `formatCourtDue`, and existing lane content metadata.
- Produces:

```ts
export type CourtFocusSelection = {
  lane: CourtLaneId;
  thingId: string;
};

export type CourtFocusViewProps = {
  selection: CourtFocusSelection;
  lanes: Record<CourtLaneId, Thing[]>;
  onSelectThing: (thingId: string) => void;
  onClose: () => void;
};
```

- [ ] **Step 1: Add failing focus-view contracts**

Extend the source contract test to assert:

- `ThingNavigator` uses `thing.id` for key and selection.
- Navigator items are buttons with `aria-current` or `aria-selected`.
- `CourtFocusView` renders `ThingDetailContent`, not `ThingDetailSheet`.
- It renders two non-selected lane rails with label and filtered count.
- It exposes a real close/back button.
- The center detail subtree is keyed by selected `thingId` and uses the restrained transition classes plus `motion-reduce` handling.

- [ ] **Step 2: Run the contract and verify failure**

Run the Court component contract test. Expected: FAIL because focus components are absent.

- [ ] **Step 3: Implement `ThingNavigator`**

Render the selected lane label/count and a bounded vertical list. Each button displays the existing title plus compact status/due text, uses `aria-current={selected}`, and calls `onSelect(thing.id)`. Keep the selected row highlighted with the lane accent and existing focus ring. Add a visually hidden polite announcement containing the selected Thing title when selection changes.

- [ ] **Step 4: Implement `CourtFocusView`**

Resolve the selected Thing strictly with:

```ts
const selectedThing = lanes[selection.lane].find((thing) => thing.id === selection.thingId) ?? null;
const rails = laneOrder.filter((lane) => lane !== selection.lane);
```

Render a no-overflow grid using a navigator column around `minmax(176px, 224px)`, a flexible `minmax(0, 1fr)` detail column, and two 52–64px rails. Render `ThingDetailContent` with `initialThing={selectedThing}` and no `onAfterTerminalAction`, allowing Court identity reconciliation to select the nearest Thing after Sort/Cancel/Shred. Pass a header close button that calls `onClose` through `headerAction`.

Rail buttons show vertical or compact horizontal label/count based on available width. Clicking a rail is not required to change focus mode; keep them inert labeled context unless implementation gives them an accessible, deterministic lane-switch behavior.

- [ ] **Step 5: Verify Task 5**

Run the Court pure/component tests and `npm run typecheck`. Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add src/features/court/ThingNavigator.tsx src/features/court/CourtFocusView.tsx scripts/court-stack-components.test.mjs
git commit -m "feat: add in-place Court focus workspace"
```

---

### Task 6: Integrate Stacks and Focus Mode into CourtDesktop

**Files:**
- Modify: `src/features/court/CourtDesktop.tsx`
- Modify: `src/routes/index.tsx`
- Modify: `scripts/court-stack-components.test.mjs`

**Interfaces:**
- Consumes: `CourtLaneStack`, `CourtLaneStackHandle`, `CourtFocusView`, `CourtFocusSelection`, filtered `view.now/next/later`, `myActorId`, and existing `refetch`.
- Produces: desktop Court default/focus modes while retaining `onSelect` for unchanged With Others cards.

- [ ] **Step 1: Add failing integration contracts**

Extend the component contract test to assert:

- `CourtDesktop` renders `CourtLaneStack` for NOW/NEXT/LATER in default mode.
- `CourtDesktop` renders `CourtFocusView` when selection is non-null.
- Focus state contains `lane` and `thingId`, not an index.
- `CourtDesktop` still renders `MagicBox`, all four quick-filter labels, search, sort, detailed filter controls, and With Others.
- The route passes `myActorId` into `CourtDesktop` and still renders `ThingDetailSheet` for the existing mobile/With Others selection flow.
- No route navigation is introduced for Thing focus.

- [ ] **Step 2: Run the contract and verify failure**

Run the Court component contract test. Expected: FAIL against the current row-based `CourtDesktop`.

- [ ] **Step 3: Add desktop focus and origin state**

Add to `CourtDesktopProps`:

```ts
myActorId: string | null;
```

Replace `laneFocus`, `showAllLane`, and their button refs with:

```ts
const [focusSelection, setFocusSelection] = useState<CourtFocusSelection | null>(null);
const laneRefs = useRef<Partial<Record<CourtLaneId, CourtLaneStackHandle | null>>>({});
const originRef = useRef<{ lane: CourtLaneId; thingId: string; element: HTMLElement } | null>(null);
const savedPositionsRef = useRef<Partial<Record<CourtLaneId, { activeIndex: number; activeThingId: string | null }>>>({});
const focusIndexRef = useRef(0);
```

Opening reads `getPosition()` from all three lane handles into `savedPositionsRef`, stores the exact originating element and `{ lane, thingId }`, and records the selected Thing's current index in `focusIndexRef`. The selected lane arrays always come from `view`, so filters and sort remain composed. When the three stacks remount, pass each saved entry through `initialPosition`; each lane then performs identity-first reconciliation against its current array.

- [ ] **Step 4: Reconcile focus selection by Thing ID**

Add an effect keyed by the selected lane array. If the selected ID remains, update `focusIndexRef` to that ID's current index and do nothing else. If it disappears, clamp `focusIndexRef.current` and select the nearest current Thing. If the lane becomes empty, close focus mode.

Do not derive the new selection from the same numeric index after a reorder when the selected ID still exists.

- [ ] **Step 5: Render default and focus compositions**

Replace only the current three-lane grid block:

- Default: equal three-column grid of `CourtLaneStack` instances.
- Focus: one `CourtFocusView` using the current filtered lane record.
- Default stacks receive their saved `initialPosition` so focus-mode mounting does not reset any lane.
- Keep controls above and With Others below byte-for-byte where practical.
- Keep `onSelect` for With Others so it continues opening the existing detail sheet.

Pass `myActorId` from `CourtPage` by adding it to the `useCourt()` destructure and the `CourtDesktop` call.

- [ ] **Step 6: Implement Escape and focus restoration**

The window key handler closes only when focus mode is active and the event has not already been prevented by a nested dialog/menu. Closing:

1. Clears focus selection.
2. Requests the originating lane handle to restore/focus `thingId`.
3. On the next animation frame, focuses the original element when connected, otherwise the lane's reconciled active card or heading.

Because the default stacks remount after state clears, schedule restoration after the next paint and let `focusThing` reconcile a missing origin ID to the nearest active card.

The explicit close control uses the same function.

- [ ] **Step 7: Verify integration**

Run:

```bash
node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/court-stack-model.test.mjs scripts/court-stack-components.test.mjs scripts/court-view-model.test.mjs
npm run typecheck
npm run lint
```

Expected: Court tests and typecheck PASS. Lint has no new errors in the touched Court/detail files.

- [ ] **Step 8: Commit Task 6**

```bash
git add src/features/court/CourtDesktop.tsx src/routes/index.tsx scripts/court-stack-components.test.mjs
git commit -m "feat: integrate Court stacks and focus mode"
```

---

### Task 7: Full Verification and Desktop Visual QA

**Files:**
- Modify only files from Tasks 1–6 when verification identifies a scoped defect.

**Interfaces:**
- Consumes: completed implementation.
- Produces: verified acceptance evidence with no backend/schema diff.

- [ ] **Step 1: Run the full automated suite**

```bash
npm test
npm run typecheck
npm run lint
npm run build:dev
git diff --check
```

Expected: tests, typecheck, and development build PASS; lint contains no errors introduced by this work; diff check is clean.

- [ ] **Step 2: Audit the diff for scope and backend safety**

Run:

```bash
git diff 9ff8ec4..HEAD -- src supabase migrations package.json package-lock.json
git diff 9ff8ec4..HEAD --name-only
rg -n "snooze_breakthrough|snoozed_until" src/features/court
```

Expected:

- No Supabase, migration, domain-model, RPC, package, route-path, Sidebar, Magic Box, or With Others behavior changes.
- The Court search for Doorman snooze symbols returns no matches.
- Existing unrelated worktree changes remain unstaged and unmodified.

- [ ] **Step 3: Start the existing development server**

Run `npm run dev` in a persistent terminal session and wait for the local URL. Use the existing preview/demo authentication path; do not alter auth or seed backend data.

- [ ] **Step 4: Perform desktop acceptance QA at 1280×800 or larger**

Verify in order:

1. Existing shell, Court header/subtitle, Magic Box, filters, search, sort, filter menu, and With Others are unchanged.
2. NOW/NEXT/LATER show one dominant card and restrained depth edges.
3. Wheel or vertical drag in NOW changes only NOW and updates its counter.
4. Catch is primary for Waiting-for-Catch and horizontal mutation gestures do not fire.
5. Eligible right drag and Sorted button call Sort once.
6. Eligible left drag and Later button move to LATER once.
7. LATER left drag resists and returns without mutation.
8. Card click and keyboard activation open inline focus mode without URL change or Sheet overlay.
9. Navigator selection swaps detail by Thing ID in place.
10. Both rails retain label/count and the center does not overflow.
11. X and Escape restore stack positions and focus.
12. Magic Box remains usable in both layouts.

- [ ] **Step 5: Perform narrow-desktop, keyboard, and motion QA**

At widths near the existing `lg` breakpoint, verify no horizontal page overflow and readable card/detail content. Complete the open, action, navigator, close, and filter flow using only keyboard. Emulate reduced motion and verify state changes occur without travel animation. Treat any horizontal overflow in either default stacks or focus mode as a release-blocking defect.

- [ ] **Step 6: Fix scoped defects test-first**

For each defect, add or strengthen the smallest failing pure/source-contract test, reproduce the failure, implement the focused fix, rerun that test, then rerun the full verification commands from Step 1.

- [ ] **Step 7: Commit final verification fixes**

If scoped fixes were required:

```bash
git add scripts/court-stack-model.test.mjs scripts/court-stack-components.test.mjs src/features/court/court-stack-model.ts src/features/court/use-stack-gesture.ts src/features/court/ThingStackCard.tsx src/features/court/CourtLaneStack.tsx src/features/court/ThingNavigator.tsx src/features/court/CourtFocusView.tsx src/features/court/CourtDesktop.tsx src/features/things/ThingDetailContent.tsx src/features/things/ThingDetailSheet.tsx src/routes/index.tsx
git commit -m "fix: harden Court stack interactions"
```

If no files changed during QA, do not create an empty commit.

## Final Completion Checklist

- [ ] All acceptance steps in the design spec have passed.
- [ ] Each lane retains an independent position.
- [ ] Identity-first and nearest-index reconciliation are verified.
- [ ] Catch, Sorted, and Later use only existing capability/RPC contracts.
- [ ] Focus mode is inline, selection is keyed by `thingId`, and focus restores accessibly.
- [ ] Existing Sheet callers use the shared detail content without behavior change.
- [ ] Magic Box, Court controls, mobile Court, and With Others are unchanged.
- [ ] No backend, schema, model, package, or route changes exist.
- [ ] Automated verification, visual QA, keyboard QA, and reduced-motion QA are recorded in the final handoff.
