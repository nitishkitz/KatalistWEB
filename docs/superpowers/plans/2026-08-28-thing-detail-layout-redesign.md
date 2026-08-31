# Thing Detail Layout Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the existing Thing Detail content into a compact, glanceable layout while preserving the current Court, stack cards, WITH OTHERS section, focus mechanism, permissions, actions, data model, and API behavior.

**Architecture:** Keep `ThingDetailContent` as the stateful controller for queries, mutations, capabilities, comments, buckets, and terminal-action callbacks. Move only presentational regions into small components that receive plain display data and callbacks. `ThingDetailSheet` and `CourtFocusView` remain the existing hosts; they do not gain a new drawer, route, or selection model.

**Tech Stack:** React 19, TypeScript, TanStack Query, Tailwind CSS, lucide-react/KatalistIcon, existing Supabase RPC wrappers, Node test runner with source-contract tests.

**Spec:** User-provided Court screenshots and the approved in-thread requirement: redesign Thing Detail only; do not change the present Court design, stack cards, or WITH OTHERS grouping.

## Global Constraints

- Preserve the current Court metrics, filters, avatar filters, lane sizing, stack-card visuals, stack navigation, and animations exactly.
- Preserve the current WITH OTHERS section exactly: its three state cards (`Waiting for Catch`, `Moving`, `Needs Attention`), position below the lanes, and existing row/card layout. Do not add NOW/NEXT/LATER controls to WITH OTHERS.
- Selecting a WITH OTHERS Thing must continue to use the existing selection path and render the same Thing Detail layout; do not move or duplicate the Thing into a personal NOW/NEXT/LATER lane.
- Do not change Supabase tables, RPCs, migrations, query shapes, permissions, notification behavior, or public APIs.
- Reuse the existing capability checks and RPC functions. A visual reorganization must not make a previously unavailable action available.
- Do not add dependencies, icon packages, animation packages, or a new design-token system.
- Do not invent a `createdAt` field: `Thing` currently exposes `updatedAt` only. Display the existing timestamp as `Updated` unless a future data-model change is separately approved.
- Do not display `Standalone` when `thing.listName` is null. Omit the list row instead.
- Due-date display is optional metadata: hide the read-only Due section when no due date exists; retain existing due-date editing in the More actions area when permitted.
- Keep mobile Court navigation and lane layout unchanged. The detail content may reflow responsively inside the existing mobile sheet.
- Do not deploy to Netlify, apply migrations, alter environment variables, or modify production/UAT data in this plan.

## Current Files and Responsibilities

- `src/features/things/ThingDetailContent.tsx` — stateful controller and current all-in-one detail markup; retains mutations and query invalidation.
- `src/features/things/ThingDetailSheet.tsx` — existing mobile/list/bucket/nudge host; remains a sheet host with only safe sizing/overflow adjustments.
- `src/features/court/CourtFocusView.tsx` — existing desktop Court focus host; selection, lane rails, Back behavior, and keyboard behavior remain unchanged.
- `src/features/court/CourtDesktop.tsx` — current Court and WITH OTHERS composition; must not be changed for this feature.
- `src/features/court/CourtLaneStack.tsx` and `src/features/court/CourtThingCard.tsx` — current stack and card visuals; must not be changed for this feature.
- `src/components/katalist/AcknowledgementBadge.tsx`, `WorkStatusBadge.tsx`, `PersonCell.tsx`, and `PersonAvatar.tsx` — existing visual primitives to reuse.
- `src/features/things/rpc.ts` — existing action wrappers; no changes.
- `scripts/*.test.mjs` — existing source-contract and domain tests; add focused detail-layout contracts here.

## Target Layout Contract

The detail content must render in this order, regardless of whether the Thing came from a personal lane, a list, a bucket, a nudge, or WITH OTHERS:

1. Compact header: Back/close action supplied by the host, Thing title, context (`Work` or `Home`), list name only when present, and the available `Updated` timestamp.
2. People row: Creator, Owner, and Current Assignee in a compact aligned block. When people differ, show a clear avatar/name flow; retain the current Reassign control and lock state.
3. Action and pace row: existing permitted actions and the existing NOW/NEXT/LATER personal-pace control. This is a layout change only; action semantics and capability checks remain unchanged.
4. Acknowledgement and work-status row: existing badges plus the existing status buttons, with distinct status colors and accessible labels.
5. Metadata grid: Due only when `dueAt` exists; List only when `listName` exists; current Add to Bucket control remains behaviorally identical.
6. More actions: existing outside assignment, due editing, Nudge, Sort, Cancel, Shred, and any other secondary controls stay behind the current More actions disclosure and retain all current disabled states.
7. Comments/Activity: current tabs, counts, comment form, activity rows, and sorted explanatory text remain at the bottom in a compact scrollable region.

## Implementation Tasks

### Task 1: Add regression contracts before changing markup

**Files:**
- Create: `scripts/thing-detail-layout.test.mjs`
- Read-only reference: `src/features/court/CourtDesktop.tsx`, `src/features/court/CourtLaneStack.tsx`, `src/features/court/CourtThingCard.tsx`

**Interfaces:**
- Produces a test guard that later tasks must keep passing.

- [ ] **Step 1: Write failing source-contract tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const detail = fs.readFileSync("src/features/things/ThingDetailContent.tsx", "utf8");
const court = fs.readFileSync("src/features/court/CourtDesktop.tsx", "utf8");
const stack = fs.readFileSync("src/features/court/CourtLaneStack.tsx", "utf8");

test("detail layout owns the organized regions", () => {
  assert.match(detail, /ThingDetailHeader|detail-header/);
  assert.match(detail, /ThingDetailPeople|detail-people/);
  assert.match(detail, /ThingDetailConversation|detail-conversation/);
});

test("Court and stack files are not coupled to the detail layout", () => {
  assert.doesNotMatch(court, /ThingDetailHeader|ThingDetailPeople|ThingDetailConversation/);
  assert.doesNotMatch(stack, /ThingDetailHeader|ThingDetailPeople|ThingDetailConversation/);
});

test("the detail omits the standalone label", () => {
  assert.doesNotMatch(detail, /thing\.listName \?\? ["']Standalone["']/);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test scripts/thing-detail-layout.test.mjs`

Expected: FAIL because the current all-in-one component does not yet expose the named detail regions and still renders the `Standalone` fallback.

- [ ] **Step 3: Do not modify Court files to satisfy this test**

The only allowed implementation targets are the detail component and new detail presentational files listed in later tasks.

- [ ] **Step 4: Re-run after Task 6 and require PASS**

Run: `node --test scripts/thing-detail-layout.test.mjs`

- [ ] **Step 5: Commit the test guard**

```bash
git add scripts/thing-detail-layout.test.mjs
git commit -m "test: lock Thing Detail scope"
```

### Task 2: Create the pure Thing Detail display model

**Files:**
- Create: `src/features/things/detail/thing-detail-view-model.ts`
- Create: `scripts/thing-detail-view-model.test.mjs`

**Interfaces:**
- Consumes: `Thing` from `src/domain/thing.ts`.
- Produces: `buildThingDetailView(thing: Thing): ThingDetailView`.

Use these exact types:

```ts
import type { Thing } from "@/domain/thing";

export type ThingDetailView = {
  title: string;
  contextLabel: string;
  listLabel: string | null;
  updatedLabel: string;
  dueLabel: string | null;
  assignment: {
    creator: Thing["creator"];
    owner: Thing["owner"];
    assignee: Thing["assignee"];
  };
};

export function buildThingDetailView(thing: Thing): ThingDetailView;
```

- [ ] **Step 1: Write failing model tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { buildThingDetailView } from "@/features/things/detail/thing-detail-view-model";

const person = (id, name) => ({ id, name, initials: name.slice(0, 1) });
const base = {
  id: "t1", title: "Plan the launch", creator: person("p1", "Nithesh"),
  owner: person("p1", "Nithesh"), assignee: person("p2", "Rohit"),
  acknowledgement: "caught", workStatus: "under_progress", ownerImportance: "next",
  personalPace: "next", dueAt: null, dueHasTime: false, context: "work",
  listId: null, listName: null, starred: false, cancelledAt: null,
  sortedAt: null, caughtAt: null, updatedAt: "2026-08-25T10:00:00.000Z",
};

test("omits list metadata when no list exists", () => {
  const view = buildThingDetailView(base);
  assert.equal(view.listLabel, null);
});

test("formats a due date only when one exists", () => {
  const view = buildThingDetailView({ ...base, dueAt: "2026-08-25T10:30:00.000Z", dueHasTime: true });
  assert.match(view.dueLabel, /Aug 25/);
});

test("keeps assigner and assignee identities available for avatar flow", () => {
  const view = buildThingDetailView(base);
  assert.equal(view.assignment.assignee.id, "p2");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/thing-detail-view-model.test.mjs`

Expected: FAIL with the module/function missing.

- [ ] **Step 3: Implement the model without changing `Thing`**

Use `date-fns/format` for the existing `updatedAt` and due date. Set `listLabel` to `thing.listName` or `null`; never return `Standalone`. Set `dueLabel` to `null` when `thing.dueAt` is null. Set `contextLabel` to `Work` or `Home` from `thing.context`.

- [ ] **Step 4: Run to verify pass**

Run: `node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/thing-detail-view-model.test.mjs`

Expected: PASS for all model tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/things/detail/thing-detail-view-model.ts scripts/thing-detail-view-model.test.mjs
git commit -m "refactor: add Thing Detail display model"
```

### Task 3: Build the compact header and people region

**Files:**
- Create: `src/features/things/detail/ThingDetailHeader.tsx`
- Create: `src/features/things/detail/ThingDetailPeople.tsx`
- Create: `scripts/thing-detail-people.test.mjs`

**Interfaces:**
- Consumes: `ThingDetailView`, `headerAction`, `busy`, `caps`, `people`, and the existing `onReassign` callback.
- Produces: presentational components with no Supabase calls and no query hooks.

Use these props:

```ts
type ThingDetailHeaderProps = {
  view: ThingDetailView;
  headerAction?: React.ReactNode;
};

type ThingDetailPeopleProps = {
  view: ThingDetailView;
  people: Person[];
  busy: boolean;
  canReassign: boolean;
  onReassign: (assigneeId: string) => void;
};
```

- [ ] **Step 1: Write failing source tests**

Assert that the new components contain `Creator`, `Owner`, `Current Assignee`, an avatar-flow affordance, and `aria-label="Reassign Thing"`; assert that no component contains `Standalone` or a mutation/RPC import.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test scripts/thing-detail-people.test.mjs`

Expected: FAIL because the files do not exist.

- [ ] **Step 3: Implement `ThingDetailHeader`**

Render a compact header with a two-line title row. Put `headerAction` at the far end. Render context and list only when available, for example:

```tsx
<p className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
  <span>{view.contextLabel}</span>
  {view.listLabel ? <><span aria-hidden="true">·</span><span>{view.listLabel}</span></> : null}
  <span aria-hidden="true">·</span>
  <span>{view.updatedLabel}</span>
</p>
```

- [ ] **Step 4: Implement `ThingDetailPeople`**

Use a compact grid where each person has a stable label and `PersonCell`. Add an explicit visual flow for the current assignment (`Owner → Current Assignee`) without changing ownership semantics. Keep the existing reassign `<select>` and disable it when `busy || !canReassign`; expose `aria-label="Reassign Thing"`.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `node --test scripts/thing-detail-people.test.mjs` and `npm run typecheck`.

Expected: PASS and no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/features/things/detail/ThingDetailHeader.tsx src/features/things/detail/ThingDetailPeople.tsx scripts/thing-detail-people.test.mjs
git commit -m "refactor: compact Thing Detail header and people"
```

### Task 4: Build the actions, pace, status, and metadata regions

**Files:**
- Create: `src/features/things/detail/ThingDetailControls.tsx`
- Create: `src/features/things/detail/ThingDetailMetadata.tsx`
- Create: `scripts/thing-detail-controls.test.mjs`

**Interfaces:**
- Consumes: existing `Thing`, `caps`, `busy`, `activePace`, `run` callbacks, buckets, and current bucket information.
- Produces: presentational controls that call callbacks supplied by `ThingDetailContent`.

Define callbacks explicitly:

```ts
type ThingDetailControlCallbacks = {
  setPace: (pace: Pace) => void;
  setWorkStatus: (status: WorkStatus) => void;
  catchThing: () => void;
  sortThing: () => void;
  moveLater: () => void;
};
```

- [ ] **Step 1: Write failing tests**

Test source contracts for visible `Catch`, `Later`, `Sorted`, `NOW`, `NEXT`, `LATER`, `Not Started`, `Under Progress`, optional Due rendering, and the existing bucket control. Assert the controls accept disabled/capability inputs.

- [ ] **Step 2: Run to verify failure**

Run: `node --test scripts/thing-detail-controls.test.mjs`

Expected: FAIL because the new components do not exist.

- [ ] **Step 3: Implement `ThingDetailControls`**

Use a compact two-column layout: action buttons on the left and the existing personal pace selector on the right. Keep `caps.canCatch`, `caps.canSort`, and `caps.canSetPace` checks. Preserve terminal behavior and lock indicators. Use existing `AcknowledgementBadge` and `WorkStatusBadge`; add no new status values.

- [ ] **Step 4: Implement `ThingDetailMetadata`**

Render a two-column metadata grid. Render the Due column only if `view.dueLabel` is non-null. Render the List column only if `view.listLabel` is non-null. Keep Add to Bucket’s current `currentBucket` detection, remove-then-add behavior, query invalidation, and success/error toasts in the controller; the child receives callbacks and options rather than calling RPCs.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `node --test scripts/thing-detail-controls.test.mjs` and `npm run typecheck`.

Expected: PASS and no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/features/things/detail/ThingDetailControls.tsx src/features/things/detail/ThingDetailMetadata.tsx scripts/thing-detail-controls.test.mjs
git commit -m "refactor: organize Thing Detail controls and metadata"
```

### Task 5: Build the compact comments and activity region

**Files:**
- Create: `src/features/things/detail/ThingDetailConversation.tsx`
- Create: `scripts/thing-detail-conversation.test.mjs`

**Interfaces:**
- Consumes: comments, activity, selected tab, `canComment`, comment value, and existing submit/change callbacks.
- Produces: `ThingDetailConversation` with no data fetching and no RPC imports.

- [ ] **Step 1: Write failing tests**

Assert that the component contains Comments and Activity tabs, comment count rendering, an accessible comment input, an activity timestamp, and the sorted explanatory note. Assert that it does not import `supabase` or `rpc`.

- [ ] **Step 2: Run to verify failure**

Run: `node --test scripts/thing-detail-conversation.test.mjs`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the component**

Keep the current tab semantics and `thread.post.mutateAsync` callback contract. Use compact rows with avatar, author, body/event, and timestamp. Preserve the disabled comment state and “Comments stay open. They don’t reopen Sorted.” copy.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `node --test scripts/thing-detail-conversation.test.mjs` and `npm run typecheck`.

Expected: PASS and no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/features/things/detail/ThingDetailConversation.tsx scripts/thing-detail-conversation.test.mjs
git commit -m "refactor: compact Thing Detail conversation"
```

### Task 6: Integrate the regions without changing behavior

**Files:**
- Modify: `src/features/things/ThingDetailContent.tsx`
- Modify: `src/features/things/ThingDetailSheet.tsx` only if required for overflow sizing
- Test: `scripts/thing-detail-layout.test.mjs`

**Interfaces:**
- Consumes: the new display model and presentational components from Tasks 2–5.
- Produces: the same `ThingDetailContentProps` API and the same callbacks used by Court focus, lists, buckets, nudges, and mobile sheets.

- [ ] **Step 1: Replace only the JSX regions**

Keep these controller lines and semantics unchanged: `useCourt`, `useThing`, `useThingComments`, `useAssignablePeople`, `useBuckets`, `getThingCapabilities`, `invalidate`, `useMutation`, `onAfterTerminalAction`, and every existing RPC call. Build `const view = buildThingDetailView(thing)` after the null guard and pass callbacks into the new regions.

- [ ] **Step 2: Apply the compact shell**

Use a shell equivalent to:

```tsx
<div className="flex min-h-full min-w-0 flex-col bg-white">
  <ThingDetailHeader view={view} headerAction={headerAction} />
  <div className="min-w-0 flex-1 space-y-3 px-5 py-4">
    <ThingDetailPeople ... />
    <ThingDetailControls ... />
    <ThingDetailMetadata ... />
    {hasMoreActions ? <ThingDetailMoreActions ... /> : null}
  </div>
  <ThingDetailConversation ... />
</div>
```

Do not alter the parent Court grid, lane navigator, With Others state cards, or selected-Thing source.

- [ ] **Step 3: Keep secondary actions in More actions**

Move only their markup location. Preserve Assign outside Katalist, due editor, Nudge, Sort, Cancel, Shred, locks, terminal checks, success messages, and `onAfterTerminalAction` calls exactly.

- [ ] **Step 4: Add stable accessibility hooks**

Give the shell `aria-label="Thing details"`, sections unique headings, the selected Thing title an `h2`, the pace control an accessible group label, and all disabled actions a reason via `aria-disabled` or an adjacent lock label. Keep focus on the existing host-provided Back/close action.

- [ ] **Step 5: Run focused contracts and typecheck**

Run: `node --test scripts/thing-detail-layout.test.mjs` and `npm run typecheck`.

Expected: PASS; Court and stack source files remain unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/features/things/ThingDetailContent.tsx src/features/things/ThingDetailSheet.tsx scripts/thing-detail-layout.test.mjs
git commit -m "feat: reorganize Thing Detail layout"
```

### Task 7: Verify all existing hosts and the WITH OTHERS path

**Files:**
- Create: `scripts/thing-detail-hosts.test.mjs`
- Read-only references: `src/features/court/CourtFocusView.tsx`, `src/features/court/CourtDesktop.tsx`, `src/routes/index.tsx`, `src/routes/lists.$listId.tsx`, `src/routes/buckets.$bucketId.tsx`, `src/routes/nudges.tsx`

**Interfaces:**
- Consumes: existing host props and selection callbacks.
- Produces: source-contract evidence that each host still uses the same Thing Detail component.

- [ ] **Step 1: Write host tests**

Assert that `CourtFocusView` still imports and renders `ThingDetailContent`, that `CourtDesktop` still owns `CourtFocusView` selection, and that the Court source still renders the existing WITH OTHERS cards/state groups. Assert that no `now`, `next`, or `later` grouping logic is added to the WITH OTHERS path.

- [ ] **Step 2: Run to verify pass**

Run: `node --test scripts/thing-detail-hosts.test.mjs`

Expected: PASS without any Court source modifications.

- [ ] **Step 3: Manual local verification**

At desktop width:

1. Open a personal NOW, NEXT, and LATER card; confirm the existing focus container, left navigator, right lane rails, Back button, previous/next keyboard behavior, and lane-colored selection remain unchanged.
2. Open a WITH OTHERS state card and select a Thing; confirm the existing WITH OTHERS section remains below the lanes, no NOW/NEXT/LATER controls are added there, and the same reorganized detail content appears through the existing host.
3. Verify a self-assigned Thing, delegated Thing, waiting-for-catch Thing, sorted Thing, and cancelled Thing. Confirm action visibility still follows `getThingCapabilities`.
4. Verify a Thing with a list and a Thing without a list. The latter must not display `Standalone`.
5. Verify a Thing with a due date and one without. The latter must not show an empty Due row.

At mobile width:

1. Open the existing detail sheet from Court/List/Bucket/Nudge surfaces.
2. Confirm the sheet remains the host, the new content scrolls internally, and no horizontal overflow occurs.

- [ ] **Step 4: Commit**

```bash
git add scripts/thing-detail-hosts.test.mjs
git commit -m "test: verify Thing Detail hosts"
```

### Task 8: Full verification and handoff

**Files:**
- No product files; only test output and review notes.

- [ ] **Step 1: Run focused tests**

Run:

```bash
node --test scripts/thing-detail-layout.test.mjs
node --test scripts/thing-detail-view-model.test.mjs
node --test scripts/thing-detail-people.test.mjs
node --test scripts/thing-detail-controls.test.mjs
node --test scripts/thing-detail-conversation.test.mjs
node --test scripts/thing-detail-hosts.test.mjs
```

Expected: all focused tests pass.

- [ ] **Step 2: Run the complete suite and static checks**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run build:dev
git diff --check
```

Expected: tests, typecheck, development build, and whitespace checks pass. Existing lint warnings may remain, but no new lint errors are allowed in changed files.

- [ ] **Step 3: Review the diff scope**

Run: `git diff --name-only <base-sha>...HEAD`

The diff may contain only Thing Detail components, Thing Detail tests, and this plan. It must not contain Court lane, stack-card, WITH OTHERS, Supabase, migration, environment, or deployment changes.

- [ ] **Step 4: Commit and push only after user approval**

Use forward-only commits. Do not rebase, amend, squash, force-push, apply migrations, or deploy Netlify as part of this detail-layout batch.

## Acceptance Checklist

- [ ] Existing Court layout is pixel/behaviorally unchanged outside the selected Thing Detail content.
- [ ] Existing stack cards are unchanged.
- [ ] WITH OTHERS remains the current three-state section below the lanes; it has no NOW/NEXT/LATER controls.
- [ ] Personal and WITH OTHERS selections both render the same compact detail regions.
- [ ] Header, People, Actions/Pace, Status, Metadata, More actions, and Comments/Activity are visually grouped and scannable.
- [ ] Assignment flow is understandable at a glance and Reassign retains its current permission behavior.
- [ ] Catch, Later, Sorted, Nudge, Cancel, Shred, due editing, bucket actions, and outside assignment retain existing RPCs and capability checks.
- [ ] List metadata is omitted when absent; `Standalone` is never rendered.
- [ ] Due metadata is omitted when absent.
- [ ] No new database fields, migrations, APIs, dependencies, or environment variables are introduced.
- [ ] Desktop focus navigation, keyboard Escape, focus restoration, reduced motion, and mobile sheet behavior still pass.
- [ ] No Netlify deployment or Supabase mutation is performed in this batch.
