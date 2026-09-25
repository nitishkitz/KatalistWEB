# Katalist T10 — Morning Brief final handoff

Tested tree: `katalist-plan/batch-a-baseline` at commit `e95de507bf60a1166b44adeeaa24b9fd174e6e0f`.

This document reconciles every checkbox in
`docs/superpowers/plans/KATALIST_T10_DETAILED_EXECUTION_PLAN.md` against
actual evidence produced in this repository. It is a record of what was
built and verified, not a promise that zero bugs remain, and it does not
claim production release from local/demo-mode evidence.

## 1. Before/after summary

**Before this batch:** T10-01 and T10-02 were done (context/readiness
contract, receipt adapter). `use-morning-brief.ts` still used independent
`open`/`alreadyPresentedToday` booleans with a single `attemptedKeyRef`,
and had a known-wrong test asserting a stale receipt marked a new day
already-presented. `CatchUpStack.tsx` froze its moment deck for the whole
review and called RPCs directly with no typed outcome or receipt-only
retry. `CatchUpOverlay.tsx` was a narrow `max-w-xl` single-card dialog that
rendered nothing (not even an error) whenever `moments.length === 0`,
including on an initial load failure. `CatchUpBanner`/the Court-level entry
point both disappeared whenever `count === 0`, hiding manual Review on
error or genuine emptiness. No shared Thing-action-outcome module existed.

**After this batch:** all seven T10-01..07 packages are implemented,
unit/component-tested, and browser-verified (five viewports, real demo
data). `use-morning-brief.ts` is rebuilt around an explicit `BriefScope` +
per-scope attempt tokens; `morning-brief-schedule.ts`'s tomorrow-date
arithmetic bug (UTC+14 overshoot) is fixed with new tests. A shared
`run-thing-action.ts` gives every Catch Up action a typed outcome
(`performed`/`already-in-flight`/`retired`/`failed`) built on the same
claim/patch/rollback primitives Court already uses. `CatchUpStack.tsx` uses
a stable append-only keyed queue with a real desktop queue+detail layout
and a mobile compact strip. `CatchUpOverlay`/`CatchUpBanner` use the
shared `AsyncState` component and are reachable on every settled branch
(loading/error/empty/ready), not gated on a non-zero count. A real
Playwright run (Demo Persona sign-in, zero real backend calls) exercised
this across five viewports, found and fixed one real bug (preview
`isEmpty` hardcoded `true`), and precisely documented one real pre-existing
gap it did not fix (no Morning Brief entry point below the 1024px `lg`
breakpoint).

## 2. Per-checkbox reconciliation

Checkbox text below is paraphrased from
`KATALIST_T10_DETAILED_EXECUTION_PLAN.md` section 5 for readability; see
that file for exact wording.

| # | Checkbox (paraphrased) | Implementation path | Test evidence |
|---|---|---|---|
| T10-01.1 | Pass context into live fetch, filter by authorized Thing's own context | `src/features/catchup/use-catchup.ts` (`fetchCatchupMoments`) | `scripts/catchup-context.test.mjs` D01/D01b |
| T10-01.2 | Preview: gate every category through the context+access set | `use-catchup.ts` `derivePreviewMoments` | `scripts/catchup-context-preview.test.mjs` D02 (×3) |
| T10-01.3 | Server-limit/dedup inspection | Inspected; client-side filtering judged sufficient (no server limit precedes context filtering) | n/a (design note in use-catchup.ts) |
| T10-01.4 | Never infer context from label; preserve cancelled/snoozed/access filtering | `use-catchup.ts` | `catchup-context.test.mjs`, `catchup-context-preview.test.mjs` |
| T10-01.5 | Retain throws from required lookups; distinguish from zero counts | `use-catchup.ts` | `catchup-context.test.mjs` D03-equivalent (actor/Thing lookup failure) |
| T10-01.6 | Expose pending/paused/empty/nonempty/failure/access-loss/retry via AsyncBranch | `use-catchup.ts` (`branch`, `isEmpty`, `confirmedAccessLoss`, now also `hasFetchedOnce`) | `catchup-context.test.mjs` D04/D05, confirmedAccessLoss case |
| T10-01.7 | `surfaceMoment` awaitable, real success/failure | `use-catchup.ts` | covered by `catchup-stack.test.mjs` A03/A04 (consumer side) |
| T10-01.8 | Guard post-await invalidation by captured identity/context | `use-catchup.ts` (`onSuccess` epoch check) | existing T10-01 tests (unchanged this batch) |
| T10-02.1-6 | Receipt adapter normalization/validation/dismissal/preview fallback/locks | `src/features/catchup/morning-brief-receipts.ts` | `morning-brief-receipts-{live,preview,sql}.test.mjs` (unchanged this batch, still green) |
| T10-03: explicit `BriefScope` + attempt tokens (all sub-bullets) | `use-morning-brief.ts` full rewrite | `use-morning-brief.test.mjs` 15/15 (2 corrected: delayed-across-midnight, F-03 context-switch) |
| T10-03: wall-clock/DST tomorrow-arithmetic fix | `morning-brief-schedule.ts` (`addCalendarDays`, `nextLocalInstant`, `nextLocalMidnight`) | `morning-brief-schedule.test.mjs` +5 (UTC+14, UTC-12, half-hour zone, 2 midnight cases) |
| T10-03: required test correction (delayed-across-midnight) | `scripts/use-morning-brief.test.mjs` | corrected assertion + inline explanation, green |
| T10-04: `ActionOutcome`, shared claim/patch/rollback, argument validation | `src/features/things/run-thing-action.ts` (new) | `run-thing-action.test.mjs` 14/14 |
| T10-04: `ListChatPanel` blocker prerequisite | Verified already present (`useBlockWhile(... , "list-chat-draft")`) | direct source inspection, no change needed |
| T10-05: stable keyed queue, current capability recompute, safe navigation | `CatchUpStack.tsx` full rewrite | `catchup-stack.test.mjs` 12/12 (Q01-Q04, A01-A04, Finish/Previous/Next, viewed/action counts, direct queue-item selection) |
| T10-06: desktop ~960px queue+detail layout, mobile full-height dialog | `CatchUpOverlay.tsx`, `CatchUpStack.tsx` (queue sidebar/strip) | `catchup-stack.test.mjs` (queue jump case), Playwright screenshots (desktop/full-hd/tablet-landscape) |
| T10-06: loading/error/empty/background-failure states, banner reachable on error/empty | `CatchUpOverlay.tsx` (shared `AsyncState`), `CatchUpBanner.tsx`, `CourtDesktop.tsx` (gate removed) | `morning-brief-label.test.mjs`, Court-desktop/stack-component suite (43/43), Playwright | 
| T10-07: consumer sweep, single-controller check, SQL/notification compatibility | See "T10-07" ledger entry | `rg` sweep results recorded in ledger; no code change needed (already compliant) |
| T10-07: five-viewport Playwright pass | `tests/e2e/preview/morning-brief.spec.ts` (new) | 10 passed / 5 skipped (documented gap) / 0 failed across all five projects; screenshots inspected |

## 3. Local gate results (this session, final run)

- `npx tsc --noEmit`: 0 errors.
- `npm run lint`: 0 errors, 69 warnings (unchanged baseline — confirmed identical warning set to pre-T10-03 baseline).
- `npm test` (full suite, `node --test scripts/**/*.test.mjs`): **745/745 passing**, 0 failures. (Baseline before this session's work: 713/713 after T10-02; net +32 tests across T10-03..07 plus the T08-floor and isEmpty regression fixes.)
- `npm run build:app`: succeeds (client + SSR + Nitro/Vercel function build), confirmed after every package and again at the end.
- Playwright: `VITE_KATALIST_DEMO_MODE=true npx playwright test tests/e2e/preview/morning-brief.spec.ts --project=preview-desktop --project=preview-mobile --project=preview-tablet-portrait --project=preview-tablet-landscape --project=preview-full-hd` → **10 passed, 5 skipped, 0 failed**. Skips are the `<1024px` "full Morning Brief flow" test variant, which correctly does not apply given the documented mobile-entry-point gap (a *different* test in the same file positively asserts that gap at those same viewports, and those assertions passed).
  - Screenshots: `test-results/morning-brief-*-preview-{desktop,full-hd,tablet-landscape}/{court,morning-brief-open}.png`, `test-results/morning-brief-*-preview-{mobile,tablet-portrait}/mobile-court.png` (paths are Playwright's own generated per-test directories under `test-results/`, regenerated each run).

## 4. Migrations added, and why

No new migration was added in this session (T10-03 through T10-07). The one
Morning Brief migration used by this work,
`supabase/migrations/20260925110000_morning_brief_exact_dismiss.sql`
(additive `dismiss_morning_brief(text, text, date)` overload), was added in
the prior T10-02 pass and is unchanged here; `use-morning-brief.ts`'s
`dismiss()` now actually calls it with an exact `localDate` (previously it
was written but not yet consumed by any caller). **Deployment status:**
per T10-02's own record, this migration has not been confirmed deployed to
any live database — deployment and live-RLS acceptance remain RELEASE-02/03.

## 5. Remaining RELEASE-02/03 items, named precisely

1. **A real live-backend/staging Playwright run.** `tests/e2e/staging/`
   only runs when `KATALIST_STAGING_BASE_URL`, `KATALIST_TEST_ACCOUNT_EMAIL`,
   and `KATALIST_TEST_ACCOUNT_PASSWORD` are all set (`playwright.config.ts`);
   none are configured in this environment, and no
   `tests/e2e/staging/morning-brief.spec.ts` exists yet. This session's
   `tests/e2e/preview/morning-brief.spec.ts` exercises the same UI/
   interaction code paths via a Demo Persona (zero real backend calls) and
   is a real, passing local substitute for interaction coverage, but cannot
   and does not claim to cover real Supabase RLS, a real signed-in account,
   or genuine concurrent-device/cross-tab claim behavior. **Exact next
   step:** write `tests/e2e/staging/morning-brief.spec.ts` (real sign-in,
   open Review, exercise queue/detail/receipt-retry, assert layout/focus
   across the same five viewport projects) and run it once staging
   credentials are available.
2. **Live deployment of `20260925110000_morning_brief_exact_dismiss.sql`**
   (and confirmation the earlier `20260923100000_morning_brief_receipts.sql`
   is actually deployed) to a real database, with role/grant/RLS
   verification against live Postgres, not just PGlite fixtures.
3. **Two-real-device/cross-tab claim atomicity.** The preview adapter's
   same-realm race protection (Web Locks / in-process serialization) is
   unit-tested; only a real Postgres `ON CONFLICT` constraint under actual
   concurrent connections proves cross-device atomicity, which local/PGlite
   fixtures cannot establish (documented already in `morning-brief-receipts.ts`'s own comments).
4. **Real fake-`setTimeout` timer-firing coverage for S02/S04/S10/S11**
   (auto-open at exactly 07:00, duplicate/Strict-Mode controller mounts,
   midnight-while-open, tomorrow's-07:00-with-tab-open). This repo's
   `mock.timers` usage fakes `Date` only, not `setTimeout`; the underlying
   pure logic those timers call (`nextMorningThreshold`, `nextLocalMidnight`,
   `isEligibleToAutoOpen`) is fully unit-tested, and the controller's own
   race-handling (context/blocker/error appearing mid-claim) is tested via
   F-03/F-05/R-04, but no test in this repo actually advances a real
   `setTimeout` to observe the scheduled timer callback fire. Building that
   harness was judged disproportionate to this batch's scope. Not a
   RELEASE-blocker in the same sense as items 1-3 (it's a local test-
   infrastructure gap, not a live-environment dependency), listed here for
   completeness since it's an explicit test-matrix line the plan named.

## 6. Reproducible unresolved defect (found this session, not fixed)

**Trigger:** Load the Court route (`/`) at any viewport narrower than the
`lg` breakpoint (1024px) — e.g. a real phone, or the `preview-mobile`
(390×844) / `preview-tablet-portrait` (768×1024) Playwright projects.

**Impact:** Morning Brief (both the `CatchUpBanner` entry point and the
`CatchUpOverlay` dialog) is completely unreachable. There is no visible
"Review" affordance anywhere on the page at these widths, regardless of how
many Catch Up moments actually exist for the signed-in profile.

**Root cause / source location:** `src/routes/index.tsx`'s `CourtPage`
component renders `<CourtDesktop ... />` (the only component in the tree
that calls `useMorningBrief()`/`useCatchup()` and renders
`CatchUpBanner`/`CatchUpOverlay`) followed by a **separate**,
`lg:hidden`-wrapped block (`src/routes/index.tsx`, the mobile lane-list
markup using `Lane`/`ThingRow`/`ThingCard`) with no Catch Up wiring of its
own. `CourtDesktop.tsx` hides its own rendered output via CSS below the
`lg` breakpoint (confirmed by the Playwright run's screenshots: at 390px
and 768px widths the visible page is the separate mobile lane list, and
`getByRole("button", { name: /^Review$/ })` / `getByRole("dialog", { name:
/Morning Brief/i })` both resolve to zero elements there).

**Why not fixed in this pass:** giving Morning Brief a real mobile entry
point requires an architecture decision (does the mobile lane-list block
get its own `CatchUpBanner`, does the `catchup`/`morningBrief` hook state
get lifted out of `CourtDesktop` into `CourtPage` and passed to both
branches, or does `CourtDesktop` render unconditionally and only its
*internal* lane content switch by breakpoint) plus non-trivial testing of a
real product surface (the mobile lane list) that this pass did not
otherwise touch. Attempting it under this session's remaining time budget
risked a rushed, under-tested change to code this plan did not ask this
pass to modify. This is pre-existing (not introduced by T10-01 through
T10-07); T10-06's mobile full-height dialog CSS is itself correct and
ready, but currently has no way to be triggered on a real narrow device.

## 7. Commits (this session, in order)

```
56ed7c0 fix(catchup): T10-03 -- correct wall-clock tomorrow arithmetic in morning-brief-schedule
d7471dd feat(catchup): T10-03 -- scope-owned presentation controller with attempt tokens
2ed1cc8 feat(things): T10-04 -- shared run-thing-action outcome/claim module
83a9498 feat(catchup): T10-05 -- stable keyed queue and action-outcome wiring in CatchUpStack
af39cdf feat(catchup): T10-06 -- responsive overlay states and reachable banner
2be7de9 feat(catchup): T10-06 -- responsive queue + detail layout in CatchUpStack
fd03bd2 fix(catchup): T10-06 -- meet the T08 12px typography floor in the queue sidebar
e95de50 fix(catchup): T10-07 -- preview isEmpty hardcoded true, found via real Playwright run
```

(Plus this document and the corresponding `KATALIST_A_TO_H_AUDIT_PROGRESS.md`
ledger update as a following commit.)

## 8. Local completion statement

All applicable local steps and matrix cases for T10-01 through T10-07 pass:
`tsc --noEmit` clean, lint at the unchanged 69-warning baseline, the full
745-test local suite green, `build:app` clean, and a real five-viewport
Playwright pass (demo-mode) exercising the actual UI. This does not promise
zero future bugs, and it explicitly does not claim production release —
section 5 above names exactly what remains before that claim would be
honest, and section 6 names one real defect found and left unfixed with its
exact trigger, impact, and location.
