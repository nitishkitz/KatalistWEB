# Court Card Stacks and In-Place Focus Design

**Status:** Approved product design; ready for implementation planning after specification review

**Date:** 2026-08-26

**Target implementation baseline:** `dev` at `9ff8ec4`

**Primary viewport:** Existing desktop Court at the `lg` breakpoint and above

## Objective

Redesign only the desktop presentation and interaction of the existing NOW, NEXT, and LATER Court lanes. Replace each lane's flat Thing rows with an independent, compact card stack and replace the Court's modal Thing-detail interaction with an in-place focus workspace.

The work is a compositional UI refactor. It must reuse the existing Thing model, capability checks, mutations, Court view model, data queries, detail behavior, visual tokens, and surrounding Court shell. It must not introduce or reinterpret domain state.

## Approved Scope

- Preserve `CourtDesktop` as the owner of Court filters, search, sorting, filtered lane arrays, loading/error states, responsive entry point, Magic Box, and the unchanged **With Others** section.
- Replace only the desktop NOW/NEXT/LATER lane bodies and their current lane-focus/view-all behavior.
- Render one visually dominant Thing per lane with two or three restrained card edges beneath it when more Things exist.
- Give each lane an independent stack position and vertical navigation.
- Support capability-aware horizontal gestures and equivalent visible buttons.
- Open a selected Thing as an inline Court workspace without changing route.
- Reuse one shared Thing-detail implementation in both the existing sheet and the new inline Court focus view.
- Preserve the current mobile Court implementation in this delivery. Desktop is the requested and acceptance-test target.

## Explicit Non-Goals

Do not change or redesign:

- Sidebar, Court page header, or subtitle.
- Quick filters, detailed filters, people/avatar filtering, search, or sorting.
- Magic Box placement, content, or behavior.
- **With Others** presentation or behavior.
- Existing typography, colors, icon system, spacing language, routes, or page shell.
- Thing domain types, capability semantics, API contracts, RPCs, migrations, enums, lifecycle states, queries, or real-time integration.
- Other List, Bucket, Nudge, Doorman, profile, or navigation surfaces.

Do not add a generic Snooze capability, `snoozed_until`, timers, new lanes, statistics, navigation, mock data, gradients, mascots, glass effects, or decorative dashboard elements.

## Current-State Foundation

The implementation must reuse these existing boundaries:

- `src/routes/index.tsx` owns page-level data selection and the existing mobile Court/detail sheet.
- `src/features/court/CourtDesktop.tsx` owns the desktop Court controls, applies `applyCourtView`, and renders NOW/NEXT/LATER plus **With Others**.
- `src/features/court/court-view-model.ts` defines filter, sorting, due-formatting, and Court view behavior.
- `src/features/court/CourtThingCard.tsx` already expresses the desktop card's current metadata and visual semantics.
- `src/domain/thing.ts` defines `Thing`, lane membership, active-state rules, and Court partitioning.
- `src/domain/capabilities.ts` is the source of truth for Catch, pace, status, Sort, and other permissions.
- `src/features/things/rpc.ts` already provides `rpcCatchThing`, `rpcSetPersonalPace`, and `rpcSortThing` for both live and preview sessions.
- `src/features/things/ThingDetailSheet.tsx` already implements the valid Thing fields, mutations, comments, activity, bucket relationships, and destructive actions.
- `useCourt` and the existing local/realtime/query mechanisms remain the source of post-mutation reconciliation.

The existing `snooze_breakthrough` operation belongs exclusively to Doorman state. Court must never call or reuse it.

## Component Architecture

### `CourtDesktop`

`CourtDesktop` remains the stable shell. It continues to own filters, query text, sorting, filtered lane arrays, loading/error handling, Magic Box, and **With Others**. Its former lane-focus and view-all state is replaced by a single optional Court focus selection:

```ts
type CourtFocusSelection = {
  lane: CourtLaneId;
  thingId: string;
} | null;
```

Selection is keyed by `thingId`, never by array index. This prevents re-sorting, filtering, mutation responses, or realtime updates from displaying a different Thing accidentally.

### `CourtLaneStack`

One instance renders each filtered lane. It receives the ordered Things, lane identity, selection callback, mutation callbacks, and a ref-registration callback for focus restoration.

It owns only stack-local presentation state: the active index, gesture/animation state, and the active card element. NOW, NEXT, and LATER do not share navigation state.

On a lane-array change:

1. If the previously active Thing still exists, keep that Thing active at its new index.
2. If it no longer exists, clamp the previous numeric index to the nearest valid index.
3. If the lane becomes empty, use index zero as the inert empty state.
4. Do not reset another lane's position.

The lane header retains the existing label, count, descriptor, icon, accent color, and surrounding visual language. Current lane-expansion and `View all` controls are removed from these three lanes because stack navigation represents the whole filtered lane.

### `ThingStackCard`

The active card reuses only existing Thing information:

- Title.
- Assignee avatar/name or the current self-assigned treatment.
- Acknowledgement/work-status semantics.
- Due date and urgency treatment.
- Existing List/Standalone relationship.
- Existing owner importance, personal pace, and starred indication only where the current card already supports them.

The lane already communicates pace, so the card should avoid redundant, visually heavy metadata. No descriptions, notes, priorities, tags, or invented fields are added.

Two or three non-interactive layers appear behind the active card. They are derived only from remaining stack depth and do not render duplicate text or accept focus. Surfaces remain white with a thin lane accent, restrained border/shadow, and controlled offsets that fit the existing viewport.

### `StackGestureController`

Gesture logic is isolated from card content and mutations. It supports Pointer Events for mouse/touch dragging and wheel input for trackpads.

Intent rules:

- Ignore movement until an approximately 10px intent threshold is crossed.
- Lock once to horizontal or vertical based on the dominant axis; do not change axes during that gesture.
- Horizontal pointer drag moves the active card visually.
- Vertical touch/pointer swipe advances or reverses within only that stack.
- Vertical wheel input accumulates a small threshold, advances one card, then uses a short cooldown to prevent a trackpad fling from skipping many Things.
- Do not intercept page scrolling when the stack cannot consume the direction or when the gesture started outside the active card.
- Suppress the following click only after an actual drag/navigation gesture.

Mutation thresholds should combine distance with restrained velocity tolerance. Below threshold, the card returns to rest. Animation duration is 180–280ms with ease-out or a very-low-bounce spring equivalent. `prefers-reduced-motion` removes travel animation while preserving state changes.

The implementation uses existing React and browser primitives. It does not add a gesture or animation dependency unless implementation evidence proves the platform primitives inadequate.

### `CourtFocusView`

Focus mode replaces the three-stack region in place:

```text
| Selected lane navigator | Inline Thing detail workspace | Other lane rail | Other lane rail |
```

The selected lane becomes a narrow `ThingNavigator`. The other lanes become thin contextual rails on the right, retaining their label and filtered count, for example `NEXT 4` and `LATER 5`. The order preserves Court spatial context: the selected lane's navigator stays at the left of the workspace, while both non-selected lanes remain visible as rails at the right in their natural NOW/NEXT/LATER order with the selected lane omitted.

The focus workspace is part of normal Court layout, not a modal, sheet, overlay, or route. Filters/search/sort and Magic Box remain accessible. **With Others** remains below the main Court area unchanged.

### `ThingNavigator`

The navigator receives the selected lane's current filtered and sorted Things. Each item is a real button and exposes title plus the minimum status/due cue needed to distinguish Things. The selected `thingId` is visibly and accessibly active.

Selecting another item changes only `thingId`; it does not close focus mode. Detail replacement uses a subtle fade plus 4–8px movement. If filtering or mutation removes the selected Thing, select the nearest valid item using the same reconciliation rule as the originating stack. If the selected lane becomes empty, close focus mode and restore the three-stack Court.

### Shared Thing Detail

Extract the non-container content of `ThingDetailSheet` into a reusable component, such as `ThingDetailContent`. It must remain the single implementation for:

- Current Thing lookup/refresh behavior.
- Existing fields and labels.
- Capability-driven actions and disabled states.
- Assignment, due date, importance, pace, status, list/bucket relationships, comments, activity, and existing destructive actions.
- Current toast and domain-error handling.

`ThingDetailSheet` retains its existing Sheet wrapper for Lists and other callers. `CourtFocusView` renders the same content inline with a Court-specific close/back control. Extraction must not change behavior outside Court.

## Action and Capability Contract

All actions are gated by `getThingCapabilities(thing, myActorId)`.

### Waiting for Catch

When `canCatch` is true:

- Catch is the primary visible action.
- Call existing `rpcCatchThing`.
- Do not expose or execute horizontal Sort or Later gestures/actions before Catch.
- Vertical stack browsing remains available because it changes only presentation, not Thing state.

### Sorted

When `canSort` is true:

- Right swipe/drag reveals and executes **Sorted**.
- A visible, keyboard-accessible Sorted button provides the same action.
- Call existing `rpcSortThing`.
- On success, existing Court data reconciliation removes the now-terminal Thing and the stack chooses the nearest remaining index.
- On failure, return the card to rest, preserve selection, and show the existing safe error toast.

### Later

When `canSetPace` is true and the Thing is not already in LATER:

- Left swipe/drag reveals and executes **Later**.
- A visible, keyboard-accessible Later button provides the same action.
- Call `rpcSetPersonalPace(thing.id, "later")`.
- Never call `snooze_breakthrough`.
- On success, the Thing moves according to existing Court partitioning and realtime/local reconciliation.
- On failure, return the card to rest, preserve selection, and show the existing safe error toast.

For a Thing already in LATER, the Later button is omitted and left drag provides subtle resistance before snapping back. Unauthorized actions are absent rather than simulated.

Prevent duplicate mutations while an action is pending. A successful visible-button action and gesture action use the same callback and feedback path.

## Stack Navigation and Position Preservation

- Each stack displays a minimal `current / total` indicator using one-based numbering.
- Forward navigation wraps from the last Thing to the first only when the lane has more than one Thing; reverse navigation follows the same circular rule.
- Stack navigation does not change domain state or another lane's position.
- Opening focus mode records the originating lane, `thingId`, card element, and the three stack positions.
- Closing through the X/back control or Escape restores the three stacks at their preserved positions.
- If filters, sorting, or mutations changed a lane while focus mode was open, position reconciliation follows Thing identity first and nearest valid index second.

## Keyboard and Focus Accessibility

- The active card is a keyboard-openable button or equivalent native interactive element.
- Catch, Later, and Sorted are actual buttons with clear accessible names.
- Nested action buttons must not trigger card opening.
- Navigator items and collapsed rails are keyboard reachable when they perform an action.
- Escape exits focus mode unless a nested menu/dialog already owns Escape.
- Closing focus mode returns focus to the originating Thing card when it still exists. If it does not, focus the nearest active card in that lane; if the lane is empty, focus its lane heading.
- Focus rings reuse existing Court ring styles.
- Status and action meaning cannot depend on color or gesture alone.
- Live announcements cover successful stack mutations and selection changes without duplicating toast output excessively.

## Responsive and Layout Behavior

- At normal desktop widths, NOW/NEXT/LATER remain equal side-by-side lanes within the current Court content width.
- At smaller desktop widths, reduce inter-lane gaps and internal horizontal padding before reducing readable card width.
- The stack region must not produce horizontal page overflow.
- Card height and stack-edge offsets must keep all three lanes comfortably inside the normal Court viewport without excessive blank space.
- Focus mode uses bounded `minmax()` columns: a narrow readable navigator, a flexible detail workspace, and two thin rails. Rails never force the detail content beyond the viewport.
- Existing mobile markup and behavior remain unchanged in this delivery.

## Data, Realtime, and Error Handling

- Filtered/sorted Things continue to come from `applyCourtView` inside `CourtDesktop`.
- No mock or duplicated data source is introduced.
- Existing RPC functions remain the only mutation boundary.
- Existing preview-mode local mutations remain supported through those RPC wrappers.
- Existing query, local-version, and realtime behavior remains responsible for canonical reconciliation.
- Gesture animation may provide immediate visual feedback, but the implementation must not permanently remove or move a Thing before the canonical Court arrays update.
- Failed mutations snap back and report `domainErrorMessage` through the current toast system.
- If the selected Thing disappears due to another client or terminal mutation, reconcile to the nearest current item or close focus mode if none remain.
- Loading and Court-load error behavior remains unchanged.

## Implementation Boundaries

Expected new or extracted responsibilities may use project-conventional names:

- `CourtLaneStack`
- `ThingStackCard`
- `StackGestureController` or a focused gesture hook
- `CourtFocusView`
- `ThingNavigator`
- `ThingDetailContent`

`CourtDesktop.tsx` should compose these pieces rather than absorb their internals. Pure stack reconciliation and gesture-intent decisions should live in testable functions. Avoid unrelated refactors and preserve existing user changes in the worktree.

## Testing Strategy

### Pure behavior tests

- Active Thing identity survives re-sorting.
- Removed active Thing reconciles to the nearest valid index.
- Empty lane produces a stable inert index.
- One lane's navigation never changes another lane.
- Gesture intent locks once after the threshold.
- Diagonal movement chooses the dominant axis.
- Sub-threshold drag snaps back without action.
- Right action resolves only when `canSort` is true.
- Left action resolves only when `canSetPace` is true and lane is not LATER.
- LATER left drag resolves to resistance/snap-back.
- Waiting-for-Catch disables horizontal mutation actions.
- Focus selection remains keyed by `thingId` through reordering.

### Component and integration behavior

- Three lane stacks render using the already filtered and sorted arrays.
- Wheel/touch navigation changes only the targeted stack and shows the correct counter.
- Catch calls the existing Catch action and then exposes normal movement actions after canonical data updates.
- Sorted calls the existing Sort action.
- Later calls existing personal-pace `later` and never calls Doorman snooze.
- Clicking or keyboard-opening a card enters focus mode without navigation or a sheet.
- Selecting another navigator Thing swaps inline detail without closing focus mode.
- X/back and Escape restore stacks and focus.
- Magic Box remains present in both normal and focus modes.
- **With Others**, filters, search, sort, and detailed filter behavior remain unchanged.
- Existing sheet-based detail callers still render the extracted shared detail correctly.

### Verification commands and visual QA

- Add focused Node tests alongside `scripts/court-view-model.test.mjs` or a dedicated Court-stack test file.
- Run `npm test`.
- Run `npm run typecheck`.
- Run `npm run lint` and separate pre-existing failures from changes introduced by this work.
- Run `npm run build:dev`.
- Use the existing browser smoke setup for a desktop interaction pass covering the full acceptance flow.
- Check normal desktop and narrower desktop widths for overflow, card readability, stack depth, focus columns, and Magic Box placement.
- Check keyboard-only behavior and reduced-motion behavior.

## Acceptance Flow

1. Open desktop Court and see the unchanged shell, controls, Magic Box, and three NOW/NEXT/LATER positions.
2. See one dominant card and restrained stack depth in each non-empty lane.
3. Navigate NOW vertically without changing NEXT or LATER.
4. Right-drag or activate Sorted on an eligible Thing and observe existing Sort behavior.
5. Left-drag or activate Later on an eligible NOW/NEXT Thing and observe existing pace-to-LATER behavior.
6. Observe resistance/snap-back with no Later action on an already-LATER Thing.
7. See Catch as the primary action on a Waiting-for-Catch Thing, with mutation gestures unavailable until caught.
8. Open a Thing and see the selected lane navigator, inline detail workspace, and two contextual rails.
9. Select another Thing in the navigator and see detail replace in place.
10. Use existing valid detail fields and actions without backend or route changes.
11. Press X/back or Escape and return to preserved stack positions with focus restored.
12. Continue using Magic Box throughout.
13. Confirm **With Others** and all surrounding Court behavior remain unchanged.

## Completion Criteria

The result must unmistakably remain the current Katalist Court. Completion requires all acceptance behavior, automated verification, desktop visual QA, keyboard accessibility, reduced-motion support, no horizontal overflow, and a diff limited to the focused Court interaction plus the minimum shared-detail extraction and tests.
