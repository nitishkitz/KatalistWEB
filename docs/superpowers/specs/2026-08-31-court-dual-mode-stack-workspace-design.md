# Court Dual-Mode Stack Workspace Design

**Status:** Approved visual contract

**Date:** 2026-08-31

**Target:** Desktop Court only (`lg` and above)

## Objective

Court has two fixed visual states that must feel like one continuous workspace:

1. **Overview:** three equal-width NOW, NEXT, and LATER layered card stacks.
2. **Focused:** the selected lane becomes a one-column navigator, the selected Thing opens immediately after that lane, and the two remaining lanes stay visible as compact lane previews.

Closing the Thing returns to the same overview stack positions. The transition must preserve the user's spatial context, never open a drawer or overlay, and never alter Thing data or lane rules.

## Approved Visual References

- Overview: `codex-clipboard-61580174-647e-485b-a45c-46d26b35ad30.png`
- Focused: `codex-clipboard-e812ac6a-a777-41f4-8efc-9ca1ac3e53a8.png`

The references lock composition and interaction, not their sample content. Production renders real Supabase Things and existing capabilities.

## Overview Contract

- NOW, NEXT, and LATER occupy one equal three-column row without horizontal page scrolling.
- Each lane has a 48px header with icon, label, count, descriptor, and `View all` cue.
- The active Thing is a 190–205px card with two line title, assignment/avatar treatment, optional due, one status treatment, optional List, and capability-gated actions.
- Two lane-colored decorative layers sit behind the active card. They are coral for NOW, blue for NEXT, and violet for LATER; never generic gray.
- Exactly two queued rows appear below the active card when available.
- `Scroll for more` appears when more Things remain. `+ N more` is never shown.
- `Standalone`, `No due date`, `WORK`, Owner Importance, Owner Pace, generic descriptions, and invented metadata are never shown on stack cards.
- The visible acknowledgement action is `Catch`, never `Caught It`.

## Focused Contract

Selecting a Thing preserves lane order and inserts detail immediately after its source lane:

```text
NOW selected:   NOW navigator | Thing detail | NEXT compact | LATER compact
NEXT selected:  NOW compact | NEXT navigator | Thing detail | LATER compact
LATER selected: NOW compact | NEXT compact | LATER navigator | Thing detail
```

- The selected lane morphs from stack to one-column navigator.
- The selected row uses its lane color, a 3px left accent, a light tinted background, and `aria-current="true"`; it never shows a `Selected` chip.
- Non-selected lanes remain understandable compact card lanes with label, count, and real Thing rows. They never collapse to vertical writing-mode rails.
- Thing Detail is part of normal page flow, not a sheet, modal, drawer, dimmed overlay, or independently scrolling panel.
- Detail height follows its content; the page owns vertical scrolling.
- Back, close, and Escape return to overview and restore the originating lane positions.
- Pointer-opened detail returns focus without a persistent purple ring. Keyboard-opened detail restores an accessible `focus-visible` ring.

## Motion Contract

- Overview to focused: 240ms.
- Focused Thing replacement: 180ms.
- Stack next/previous: 240ms.
- Close to overview: 220ms.
- Easing: `cubic-bezier(0.2, 0.8, 0.2, 1)`.
- The outgoing stack card moves back 12px and fades while the selected lane navigator and detail settle from 8px; no rotation, slope, spring overshoot, or perspective.
- Interaction is locked during the short structural transition so repeated clicks cannot create duplicate detail surfaces.
- `prefers-reduced-motion: reduce` removes travel, scaling, and cross-fade delay while preserving the same state and focus behavior.

## Thing Detail Contract

- Header: Back/close, Thing title, context/List when present, updated timestamp.
- Primary identity: assignment flow and acknowledgement/work status.
- Due is rendered only when present.
- Actions are derived exclusively from `getThingCapabilities` and lifecycle state.
- Waiting for Catch: Catch, Nudge/Reassign/Cancel only when permitted.
- Active caught Thing: Mark Sorted, Reassign/Cancel when permitted, and one `Pace` selector aligned right.
- Sorted: comments, activity, bucket access, and collapsed details only; no Nudge, Reassign, Pace, or active work-status controls.
- Cancelled: comments/activity/history only.
- `Choose Buckets…` remains outside collapsed Details for quick access.
- Owner Importance and `My Pace` are absent from the primary surface; the visible label is `Pace`.
- Comments use resolved actor avatar, display name, and timestamp; `Member` is not a normal fallback label.

## Preserved Court Areas

- Sidebar, header, slim metrics, filters, avatar filters, search, sort, detailed filters, and desktop responsive entry point.
- WITH OTHERS remains below the entire personal-lane workspace with Waiting for Catch, Moving, and Needs Attention.
- Exactly one global AppShell Magic Box remains at the bottom.
- Existing mobile Court remains unchanged.

## Data and Safety Boundaries

- No Supabase schema, migration, query, RPC, permission, lifecycle, or capability changes.
- No drag-and-drop and no new gesture/animation dependency.
- Stack navigation is presentation-only.
- Canonical mutations remain `rpcCatchThing`, `rpcSetPersonalPace`, `rpcSetWorkStatus`, `rpcSortThing`, `rpcNudgeThing`, `rpcCancelThing`, and existing bucket/comment operations.
- Realtime/filter/sort changes reconcile by Thing ID first and nearest valid index second.

## Acceptance Criteria

- Initial load matches the approved overview composition.
- Any lane selection produces the contextual focused ordering shown above.
- Closing restores the same active Things and scroll position without a lingering selection border.
- Stack wheel, pointer, touch, and keyboard navigation are smooth and isolated per lane.
- No duplicate Magic Box, drawer, overlay, internal detail scroll, `+ N more`, or fabricated metadata appears.
- All capability, mutation, focus, reduced-motion, and existing Court data tests pass.
