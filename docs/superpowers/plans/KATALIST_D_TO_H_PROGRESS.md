# Katalist D–H Progress Ledger

Tracks `docs/superpowers/plans/KATALIST_D_TO_H_IMPLEMENTATION_EXECUTION_PLAN.md`. One row per work ID.

Statuses: `not-started`, `in-progress`, `implemented-local-pass`, `implemented-deployment-pending`, `live-acceptance-pending`, `blocked-external`.

Baseline at start of D–H execution: SHA `0bbe479ec2557699314d1d7403d5412755ff2166` on `katalist-plan/batch-a-baseline`. `npm test`: 339/339 pass. `npx tsc --noEmit`: 0 errors. `npm run lint`: 0 errors, 81 warnings. `npm run build:app`: clean. (The plan's own "328 tests / 80 warnings" reference was stale — re-verified at the actual current baseline above, per the plan's own instruction to do so.)

| Work ID | Status | Files | Commit | Verification | Remaining dependency |
|---|---|---|---|---|---|
| D01 | implemented-local-pass (foundational tokens only) | `src/styles.css` (elevation/control-density tokens, `katalist-heading`/`katalist-body`/`katalist-data-dense`/`katalist-meta` utilities), `src/components/ui/button.tsx` (`touch`/`icon-touch` size variants) | `4d43f67` | typecheck/build/lint/test clean | Overlay-consumer migration + global shadow-suppression removal not yet done (deliberately last in D01's own sequence); per-page token adoption is G-phase work |
| D02 | implemented-local-pass | **New:** `src/lib/motion-tokens.ts`, `src/hooks/use-motion-preference.ts`, `src/components/layout/MotionPreferenceApplier.tsx`. **Modified:** `src/routes/__root.tsx` (mounts the applier once), `src/routes/me.tsx` (settings toggle now uses `useStoredMotionPreference`), `src/features/court/use-stack-gesture.ts`, `CourtLaneStack.tsx` (x2 call sites + a new mid-animation snap-to-final-state subscription), `CourtFocusView.tsx`, `src/styles.css` (`.reduce-motion` class rules mirroring the existing OS-media-query ones). **Test:** `scripts/use-motion-preference.test.mjs` (new, 5 tests); `scripts/court-stack-components.test.mjs` (1 stale source-string assertion replaced with a behavioral one, per the plan's own instruction for an intentional extraction) | (pending) | 344/344 tests, 0 typecheck errors, 0 lint errors/81 warnings, clean build | GSAP animation *durations* in CourtLaneStack/CourtFocusView (280-360ms) were not retuned to D02's exact 180-240ms "local" band -- retiming a hand-tuned easing curve without visual QA capability in this environment was judged higher-risk than the actual defect (the OS-only, Me-toggle-was-inert detection gap), so only the detection/contract was unified, not existing animation timing. Named here, not silently done. |
| D03 | not-started | | | | |
| E01 | not-started | | | | |
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
