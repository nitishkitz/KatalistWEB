# Court Desktop Visual Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** Refine only the desktop Court presentation so it feels spatial, lightweight, and movement-oriented while preserving all existing Court semantics and interactions.

**Architecture:** Keep `CourtDesktop` as the desktop composition and `CourtThingCard` as the row renderer. Replace nested card styling with a single Court canvas, lane dividers, compact ticket rows, and restrained status accents; keep the existing view-model, detail selection callback, lane focus state, filters, sorting, and THEIRS grouping unchanged.

**Tech Stack:** React, TypeScript, Tailwind utility classes, existing Katalist icon primitives, Node test runner.

**Spec:** User-provided “KATALIST — DESKTOP COURT VISUAL REFINEMENT PASS”.

## Global Constraints

- Desktop-only presentation changes at `lg` and above.
- Do not change domain semantics, Supabase schema, RPC behavior, RLS, permissions, or Thing population logic.
- Use white surfaces only; no shadows, gradients, pastel fills, or heavy card borders.
- Preserve lane focus, View all, Escape, filters, sorting, detail-sheet selection, and THEIRS behavior.
- Do not redesign mobile Court or other routes.

### Task 1: Convert Court Things to movement rows

**Files:**

- Modify: `src/features/court/CourtThingCard.tsx`
- Modify: `src/features/court/CourtDesktop.tsx`
- Test: `scripts/court-view-model.test.mjs` (run existing behavioral coverage)

- [ ] Remove High/Medium/Low and Fast/Medium/Slow labels from desktop rows.
- [ ] Render title, person/state, due/source, timestamp, and overflow as a compact ticket row with a small state accent.
- [ ] Show `Owner · NOW/NEXT/LATER` only when it differs from the lane’s personal pace, with focused-state detail retained.
- [ ] Derive relative movement text from existing timestamps and acknowledgement/state fields only.
- [ ] Preserve row click, overflow click, star indicator, detail callback, and peek/focused density behavior.

### Task 2: Flatten lane composition and toolbar

**Files:**

- Modify: `src/features/court/CourtDesktop.tsx`
- Modify: `src/features/court/MagicBox.tsx`

- [ ] Remove rounded bordered containers around every lane and Thing; retain subtle lane boundaries and row dividers.
- [ ] Keep equal lanes in overview and 7/1.5/1.5 focus proportions with the existing 220ms transition.
- [ ] Remove the permanent Coey announcement line from desktop Court.
- [ ] Keep Magic Box prominent but lightweight, with existing toss parsing and actions intact.
- [ ] Reduce toolbar container weight while preserving all quick filters, search, sort, detailed filters, clear behavior, and keyboard focus.

### Task 3: Refine lane summaries and With Others

**Files:**

- Modify: `src/features/court/CourtDesktop.tsx`

- [ ] Make lane headers concise and derive meaningful due/waiting/moving summaries from the filtered lane data.
- [ ] Quiet LATER styling, restrained NOW/NEXT accents, and no tinted lane backgrounds.
- [ ] Present THEIRS as “With Others” with the existing three groups and stable placement below lanes.
- [ ] Keep group selection swap/collapse, empty states, and Thing detail selection unchanged.

### Task 4: Verify

- [ ] Run Court view-model and icon tests.
- [ ] Run lint, build, typecheck, and `git diff --check`.
- [ ] Record any pre-existing server type-check failure without expanding scope.
- [ ] Do not open a browser; hand off the running desktop URL for manual visual QA at the requested sizes.
