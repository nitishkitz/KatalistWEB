# Katalist D–H Progress Ledger

Tracks `docs/superpowers/plans/KATALIST_D_TO_H_IMPLEMENTATION_EXECUTION_PLAN.md`. One row per work ID.

Statuses: `not-started`, `in-progress`, `implemented-local-pass`, `implemented-deployment-pending`, `live-acceptance-pending`, `blocked-external`.

Baseline at start of D–H execution: SHA `0bbe479ec2557699314d1d7403d5412755ff2166` on `katalist-plan/batch-a-baseline`. `npm test`: 339/339 pass. `npx tsc --noEmit`: 0 errors. `npm run lint`: 0 errors, 81 warnings. `npm run build:app`: clean. (The plan's own "328 tests / 80 warnings" reference was stale — re-verified at the actual current baseline above, per the plan's own instruction to do so.)

| Work ID | Status | Files | Commit | Verification | Remaining dependency |
|---|---|---|---|---|---|
| D01 | implemented-local-pass (foundational tokens only) | `src/styles.css` (elevation/control-density tokens, `katalist-heading`/`katalist-body`/`katalist-data-dense`/`katalist-meta` utilities), `src/components/ui/button.tsx` (`touch`/`icon-touch` size variants) | `4d43f67` | typecheck/build/lint/test clean | Overlay-consumer migration + global shadow-suppression removal not yet done (deliberately last in D01's own sequence); per-page token adoption is G-phase work |
| D02 | implemented-local-pass | **New:** `src/lib/motion-tokens.ts`, `src/hooks/use-motion-preference.ts`, `src/components/layout/MotionPreferenceApplier.tsx`. **Modified:** `src/routes/__root.tsx` (mounts the applier once), `src/routes/me.tsx` (settings toggle now uses `useStoredMotionPreference`), `src/features/court/use-stack-gesture.ts`, `CourtLaneStack.tsx` (x2 call sites + a new mid-animation snap-to-final-state subscription), `CourtFocusView.tsx`, `src/styles.css` (`.reduce-motion` class rules mirroring the existing OS-media-query ones). **Test:** `scripts/use-motion-preference.test.mjs` (new, 5 tests); `scripts/court-stack-components.test.mjs` (1 stale source-string assertion replaced with a behavioral one, per the plan's own instruction for an intentional extraction) | (pending) | 344/344 tests, 0 typecheck errors, 0 lint errors/81 warnings, clean build | GSAP animation *durations* in CourtLaneStack/CourtFocusView (280-360ms) were not retuned to D02's exact 180-240ms "local" band -- retiming a hand-tuned easing curve without visual QA capability in this environment was judged higher-risk than the actual defect (the OS-only, Me-toggle-was-inert detection gap), so only the detection/contract was unified, not existing animation timing. Named here, not silently done. |
| D03 | implemented-local-pass | **New:** `src/features/drafts/session-drafts.ts` (identity/epoch-scoped in-memory draft store, keyed by composer kind + entity id), `src/components/katalist/InteractionBlockerProvider.tsx` + `use-interaction-blocker.ts` (registered-reason blocker registry + `useBlockWhile` convenience hook), mounted once in `__root.tsx`. **Fixed:** `CourtDetailModal.tsx` and `CourtFocusView.tsx`'s window-level Escape listeners didn't check `e.defaultPrevented` (unlike `InlineThingDetailWorkspace.tsx`, which already did) -- a nested Radix layer (popover/dialog/file preview) consuming Escape via its own capture-phase listener would still let these two also close in the same keystroke; now both check `!e.defaultPrevented` and call `e.preventDefault()` themselves. **Test:** `scripts/session-drafts.test.mjs` (8 tests), `scripts/interaction-blocker-provider.test.mjs` (6 tests), a new behavioral assertion in `scripts/court-stack-components.test.mjs` for the Escape fix (rendering the real components in the Node test runner hit an infra limitation combining `mock.module` + the custom `.tsx` transpile loader hook -- see commit for detail; source-based assertion follows this file's own established convention for DOM-behavior contracts) | (pending) | 359/359 tests, 0 typecheck errors, 0 lint errors/81 warnings, clean build | Session drafts/InteractionBlockerProvider have no real consumer yet -- wiring composers (MagicBox, chat, notes) to session-drafts and calls/dialogs to InteractionBlockerProvider is E02/E04/G04/H02 work, per the plan's own dependency ordering. |
| E01 | in-progress (responsive With Others fix landed; remaining sub-items below) | `src/features/court/CourtDesktop.tsx` (`withOthersOpenNarrow` toggle state + button, sidebar wrapper now `cn(open ? "block" : "hidden", "xl:block")` instead of always-rendered) | (pending) | 360/360 tests (1 new), 0 typecheck errors, 0 lint errors/81 warnings, clean build | Confirmed via source inspection: at 1024-1279px (Tailwind `lg` but not `xl`) the 3-lane grid plus the always-visible With Others sidebar had NO responsive accommodation at all (single `hidden lg:block` breakpoint switch straight from a totally different mobile layout to this desktop one) -- now behind a named toggle in that band, always visible at `xl` (>=1280px) as before. **Not yet done in E01**: capability-based buttons alongside existing gestures (Catch/pace/Sort) -- needs verification of what CourtLaneStack/ThingStackCard already expose vs. plan's ask; replacing nonsemantic clickable containers with real buttons/links; the "no matches" vs "truly empty" state distinction; keyboard capture->Catch->pace->open->close->Sort test; 200%-zoom/long-title/0-30-300-Things browser checks (need a live browser). |
| E02 | not-started | | | | |
| E03 | not-started | | | | |
| E04 | not-started | | | | |
| F01 | not-started | | | | |
| F02 | not-started | | | | |
| F03 | not-started | | | | |
| F04 | not-started | | | | |
| G01 | not-started | | | | |
| G02 | not-started | | | | |
| G03 | not-started | | | | |
| G04 | not-started | | | | |
| G05 | not-started | | | | |
| G06 | not-started | | | | |
| H01 | not-started | | | | |
| H02 | not-started | | | | |
| H03 | not-started | | | | |
| H04 | not-started | | | | |
| Z01 | not-started | | | | |

## Notes / corrections found against the plan's own file references

- `use-stack-gesture.ts` is at `src/features/court/use-stack-gesture.ts`, not `src/features/things/use-stack-gesture.ts` as D02 states. Will use the real path.
- `src/routes/index.tsx` confirmed as the actual Court route (renders `CourtDesktop` for desktop, an inline mobile lane layout with `InlineThingDetailWorkspace` for mobile) — matches the plan's E01 assumption.
