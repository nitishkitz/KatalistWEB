# Katalist D–H Progress Ledger

Tracks `docs/superpowers/plans/KATALIST_D_TO_H_IMPLEMENTATION_EXECUTION_PLAN.md`. One row per work ID.

Statuses: `not-started`, `in-progress`, `implemented-local-pass`, `implemented-deployment-pending`, `live-acceptance-pending`, `blocked-external`.

Baseline at start of D–H execution: SHA `0bbe479ec2557699314d1d7403d5412755ff2166` on `katalist-plan/batch-a-baseline`. `npm test`: 339/339 pass. `npx tsc --noEmit`: 0 errors. `npm run lint`: 0 errors, 81 warnings. `npm run build:app`: clean. (The plan's own "328 tests / 80 warnings" reference was stale — re-verified at the actual current baseline above, per the plan's own instruction to do so.)

| Work ID | Status | Files | Commit | Verification | Remaining dependency |
|---|---|---|---|---|---|
| D01 | in-progress | `src/styles.css` (elevation/control-density tokens, `katalist-heading`/`katalist-body`/`katalist-data-dense`/`katalist-meta` utilities), `src/components/ui/button.tsx` (`touch`/`icon-touch` size variants) | (pending) | typecheck/build/lint/test clean | Overlay-consumer migration + global shadow-suppression removal not yet done (deliberately last in D01's own sequence); per-page token adoption is G-phase work |
| D02 | not-started | | | | |
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
