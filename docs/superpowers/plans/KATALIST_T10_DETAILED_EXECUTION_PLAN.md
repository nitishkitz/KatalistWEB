# Katalist T10 — Morning Brief implementation and closure plan

Prepared 2026-09-25 against `3d310f6` on `katalist-plan/batch-a-baseline`.
Purpose: give an implementation agent a bounded, executable handoff covering every T10 requirement, including its unfinished T03 dependencies.
This document is a plan, not a claim that these changes or tests have already been made.

## 1. Assignment and stopping condition

Implement the remaining Morning Brief feature end to end: correct Work/Home data, reliable daily presentation, recoverable loading/errors, safe actions and receipt retry, current permissions, and the desktop/mobile review interface.

Finish all local code, local SQL fixtures, component tests, and browser checks in this plan. Do not stop after each work package to request permission. Routine API names, component extraction, and test fixture choices are implementation decisions. Stop only for an actual missing authority, inaccessible required service, or incompatible concurrent edit that cannot be worked around.

Local closure and release closure are separate evidence states. Missing production credentials do not prevent completing local implementation. Keep automatic opening disabled by default; deployed SQL/RLS, real concurrent devices, and rollout remain RELEASE-02/03. Do not claim those checks passed from mocks or PGlite.

The existing independent baseline was 688/688 tests, typecheck passing, lint 0 errors/69 warnings, and `build:app` passing. Re-establish only if HEAD or dependencies changed. The two T09 Magic Box review findings are separate work; do not silently absorb them into T10.

## 2. Read these files first

All paths below are repository-relative.

| File | Why it matters / intended change |
| --- | --- |
| `docs/superpowers/plans/KATALIST_A_TO_H_FINAL_COMPLETION_PLAN.md`, T03 and T10 | Authoritative acceptance and cross-package scope. |
| `docs/superpowers/plans/KATALIST_A_TO_H_AUDIT_PROGRESS.md`, T03 and historical F/R findings | Preserve accepted fixes; T03 action coordination is explicitly incomplete. |
| `src/features/catchup/use-catchup.ts` | Context-filter live and preview data; expose readiness and awaitable surface receipt. |
| `src/features/catchup/use-morning-brief.ts` | Replace independent booleans with scoped presentation/attempt ownership. |
| `src/features/catchup/morning-brief-schedule.ts` | Timezone resolution, date boundaries, DST-safe timers. |
| `src/features/catchup/morning-brief-receipts.ts` | Normalize server outcomes, preview fallback, exact receipt dismissal. |
| `src/features/catchup/morning-brief-flag.ts` | Preserve off-by-default automatic opening. |
| `src/features/catchup/catchup-logic.ts` | Dedupe, supported categories/reasons, capability-derived actions. |
| `src/features/catchup/CatchUpOverlay.tsx` | Responsive dialog, states, heading, focus behavior. |
| `src/features/catchup/CatchUpStack.tsx` | Replace frozen objects; action outcome and receipt retry orchestration. |
| `src/features/catchup/CatchUpStackCard.tsx` | Current detail/actions, honest metadata, sticky mobile action area. |
| `src/features/catchup/CatchUpBanner.tsx` | Manual entry including failed/empty states; real category counts. |
| `src/features/court/CourtDesktop.tsx` | Own one controller; wire data, errors, scope and safe navigation. |
| `src/routes/index.tsx` | Check responsive tree: CSS hiding is not unmounting. |
| `src/features/things/query-updates.ts` | Existing token claims, optimistic patches, rollback and retirement. |
| `src/features/things/rpc.ts`, `personal-snooze.ts` | Existing domain actions; preserve personal versus shared mutation semantics. |
| `src/features/realtime/identity-cache-policy.ts` | Capture epoch before await; reject retiring callbacks. |
| `src/features/me/use-profile.ts` | Determine actual profile success/no-data/error/paused contract. |
| `src/components/katalist/InteractionBlockerProvider.tsx`, `use-interaction-blocker.ts` | Reuse blocker ownership; no new parallel registry. |
| `src/features/lists/ListChatPanel.tsx` | Verify unfinished T03 chat blocker; add only if still missing. |
| `src/routes/api/jobs/daily-maintenance.ts`, `src/features/notifications/NotificationPanel.tsx` | Trace producers/consumers for compatibility; edit only for a demonstrated T10 need. |
| `supabase/migrations/20260918120000_catchup.sql` | Moment production and receipt semantics. |
| `supabase/migrations/20260922140000_catchup_excludes_active_snooze.sql` | Preserve active-snooze exclusion. |
| `supabase/migrations/20260923100000_morning_brief_receipts.sql` | Preserve timezone, threshold, authorization and collision fixes. |
| `scripts/*morning-brief*.test.mjs`, `scripts/*catchup*.test.mjs` | Extend actual regression suites, retaining prior behavior unless explicitly corrected below. |
| `scripts/dom-test-setup.mjs`, `scripts/alias-loader.mjs`, `playwright.config.ts` | Existing React/jsdom, TypeScript loader and five-viewport browser infrastructure. |

Read actual helpers before reuse. A documented shared action runner does not currently exist in the inspected tree. Do not invent imports for it.

## 3. Source-confirmed gaps to close

1. `fetchCatchupMoments(profileId, signal)` has no context argument; the query key contains context but the returned Things are not context-filtered. Preview nudge/snooze resolution also lacks a final context/access filter.
2. `useCatchup` exposes `isLoading` and error without explicit successful readiness. `surfaceMoment` uses fire-and-forget `mutate`, so the UI cannot distinguish receipt failure.
3. `useMorningBrief` uses `profileQuery.isLoading` as readiness; failed/no-data or paused initial queries can slip through to fallback timezone.
4. `open` and `alreadyPresentedToday` are unscoped booleans. A receipt for a retired day/context can affect current presentation.
5. Premature-claim handling tests `err instanceof Error`, although the adapter throws the raw RPC error. Clearing a single attempt ref is not ownership-safe. The existing next-threshold timer can schedule tomorrow when the server says today's claim is premature.
6. Post-await eligibility reads the clock twice. Dismissal uses current context/date rather than an explicitly held presented receipt.
7. Preview storage failure loses the receipt; remount may claim again. No same-session fallback currently exists.
8. `CatchUpStack` freezes complete moment objects using `useState(() => moments)`, retaining old status and permission data.
9. Stack actions call RPCs directly, use React `busy` as their guard, fire a receipt without awaiting it, then advance. There is no typed outcome or receipt-only retry.
10. Banner and Court entry disappear at zero moments, including initial error. Overlay is a narrow `max-w-xl` stack with no full error/queue/mobile specification.
11. Scheduling contains an explicitly approximate wall-clock conversion; tomorrow is derived by converting a UTC-noon guess into the target zone. Extreme zones and DST need behavioral tests and correction where necessary.

## 4. Fixed product decisions

- Auto-open at or after 07:00 in the resolved timezone, once per authenticated profile/demo actor, Work/Home context and local calendar date. A late first eligible visit still qualifies; no noon cutoff.
- Escape, X, backdrop and Finish close the review. A recorded daily claim continues suppressing automatic opening that day. Manual Review remains available and never creates or resets a presentation claim.
- Tomorrow gets its own claim after its threshold. Receipt state must not leak from yesterday.
- Auto-open requires resolved identity, confirmed timezone, successful usable moments, visible tab, no active blocker and feature flag enabled.
- Profile fetch failure/never-fetched/paused is unresolved. A successfully loaded profile with an unset/invalid timezone may use validated browser timezone, then UTC under the existing server-compatible fallback contract. Valid stored UTC is a real preference.
- Close the open Brief when identity, context, effective zone or local date retires. Do not silently substitute a new context inside the existing review.
- Preserve a successful claim even if a post-await blocker prevents showing it. Manual review remains the recovery path.
- Navigation is not completion. Previous/Next/select/Open/close do not mark a Thing sorted/caught or write a moment receipt. Successful explicit domain actions may write a moment receipt.
- A presentation receipt and a surfaced-moment receipt are different records with different purposes. Keep them separate in types, tests and UI language.
- A successful domain action followed by failed moment receipt shows “Action saved. Review acknowledgement could not be saved.” Offer “Retry acknowledgement”; never execute the domain action again for that retry.
- No new AI summaries, inferred productivity scores, subscriptions, pricing, locked features or unsupported “hours saved” claims.

## 5. Ordered execution checklist

### T10-01 — Context and readiness contract

**Change:** `use-catchup.ts`; optionally extract `fetch-catchup-moments.ts` only when needed for test imports.

- [ ] Pass context explicitly into the fetch function and filter on the resolved authorized Thing's actual context before forming moments/counts.
- [ ] In preview, build the authorized IDs from the existing context-aware accessibility helper; apply this final gate to every category, including notifications and ended snoozes. Do not assume a resolvable local Thing is accessible.
- [ ] Inspect server limiting/deduplication. If post-filtering can starve one context because a global server limit runs first, add a backward-compatible context-filtered RPC path. Otherwise prefer client filtering without a migration.
- [ ] Never infer context from a notification label or rely on query-key scoping alone. Preserve cancelled/snoozed/access filtering.
- [ ] Retain throws from required actor/Thing lookups. Decorative metadata failures must remain distinguishable from successful zero counts.
- [ ] Expose at least initial pending/paused, successful empty, successful nonempty, initial failure, background failure, confirmed access loss, and retry. Use existing AsyncState/read-policy helpers where compatible; do not fabricate success from `!isLoading`.
- [ ] Change `surfaceMoment` to an awaitable operation returning a real success/failure. Update its consumers. Preview resolves after the local surface operation; live rejects on RPC failure.
- [ ] Guard post-await invalidation by captured identity and presentation context. Preserve read deadline and cancellation.

**Tests:** both contexts mixed in one live result; each of four preview categories across contexts; inaccessible/cancelled data excluded; required lookup failure; empty success; paused initial observer; cached background error; receipt rejects. Assert rendered counts and eligibility use filtered data.

### T10-02 — Receipt adapter and preview reliability

**Change:** `morning-brief-receipts.ts`, relevant SQL fixture tests; additive migration only when the current RPC cannot express exact targeting.

- [ ] Normalize claim rejection into a discriminated result/error, including `before-threshold`, unavailable and authorization failure. Inspect structured Supabase `{message, code, details, hint}` as well as Error. Match the actual threshold contract narrowly.
- [ ] Validate returned row fields before trusting a receipt; reject malformed date/timezone/result shapes as unavailable.
- [ ] Store a typed presented-receipt reference containing identity/epoch, context, localDate, timezone and presentedAt. Dismiss the receipt this review actually owns.
- [ ] Inspect current live dismissal, which targets the latest undismissed context row. If another tab/day can make that target differ from the presented receipt, add an optional exact-date parameter or distinctly named RPC with compatibility preserved. Filter by authenticated profile and supplied receipt identity; never accept another user's profile ID.
- [ ] Never modify a previously applied migration. Add a new timestamped migration and exercise historical migrations plus new migration in fixtures.
- [ ] Add a bounded same-session preview receipt store used even when localStorage reads/writes fail. Validate parsed storage; malformed JSON/shape is not a trusted claim.
- [ ] Use Web Locks when present. Same-realm simultaneous calls without Web Locks must return one successful claim. Document that storage-only fallback cannot prove cross-tab atomicity and never proves cross-device atomicity.
- [ ] Dismissal updates an existing receipt; manual review without an owned claim must not manufacture one.

**Tests:** raw object threshold rejection; ordinary network error stays ordinary; first/duplicate claim; malformed row; throwing storage; remount with same-session fallback; two same-realm contenders; lock path; exact old-date dismissal with newer row present; unauthenticated/other-user fixture isolation.

### T10-03 — Scope-owned presentation controller and clock

**Change:** `use-morning-brief.ts`, `morning-brief-schedule.ts`; add a small `morning-brief-state.ts` if it simplifies pure transitions.

Use explicit concepts, not a collection of unrelated booleans:

```ts
type BriefScope = {
  epoch: number;
  identityKind: 'live' | 'preview';
  identityId: string;
  context: 'work' | 'home';
  timezone: string;
  localDate: string;
};
// Presentation scope includes timezone. Database uniqueness remains the
// existing profile/context/localDate contract; do not add timezone to it.
```

- [ ] Derive scope only from resolved identity/timezone state. A successful no-profile result must be explicitly classified; undefined data is not a resolved unset timezone.
- [ ] Track attempts by scope plus an opaque attempt token/generation. Only the owner may complete, clear or retry an attempt. A stale rejection cannot erase a newer attempt.
- [ ] Use one `now` snapshot per decision, and one fresh snapshot after each asynchronous boundary. Compute all date/threshold comparisons from that snapshot.
- [ ] Derive `alreadyPresentedToday` from a matching receipt and current scope. An old claim may be retained, but cannot mark a newer scope as already presented.
- [ ] Gate visible `open` by the matching scope in render so stale content cannot paint while an effect waits to close it.
- [ ] Close/retire on context, identity, zone or local-date change. Capture dismissal ownership before clearing presentation state.
- [ ] After claim resolves, recheck epoch, attempt ownership, mounted state, current scope, readiness, moments, visibility and blockers before opening.
- [ ] Recheck blocked/loading inputs when they clear; do not consume an attempt before eligibility is established.
- [ ] For before-threshold rejection, refresh authoritative profile information, then schedule a bounded retry even if the local clock thinks it is already past 07:00. Recommended fallback: at most two retries, 30 seconds then 120 seconds per scope, with no retry after scope retirement. Prefer a server-provided retry instant if the actual adapter contract has one.
- [ ] Ordinary service errors do not create an infinite auto loop; keep manual entry and expose a useful error/retry path.
- [ ] Schedule local midnight retirement and the next 07:00 eligibility check. On focus/visibility return, recompute from the current clock; do not replay an expired timer's scope.
- [ ] Correct wall-clock conversion and tomorrow calendar arithmetic. Test UTC+14, UTC-12, a half-hour zone and spring/fall DST dates. Validate resulting local hour/date; do not use a fixed 24-hour increment.
- [ ] Clear all timers/listeners on unmount/scope change; tolerate Strict Mode effect replay without double claims.
- [ ] Trace responsive Court mounting and ensure one automatic controller owns a visible Court surface. Sharing a React Query fetch does not deduplicate two claim controllers.

**Important test correction:** the existing delayed-across-midnight test expects `alreadyPresentedToday === true` for an old receipt. Change that expectation to false for the current day, and explain why: the old receipt is retained for its original scope. This is a required behavior correction, not a weakened test.

### T10-04 — Finish the required T03 action contract

**Change:** add `src/features/things/run-thing-action.ts` or an equivalent small module beside `query-updates.ts`; integrate `CatchUpStack.tsx` and `use-catchup.ts`.

```ts
type ActionOutcome =
  | { status: 'performed' }
  | { status: 'already-in-flight' }
  | { status: 'retired' }
  | { status: 'failed'; error: unknown };
```

- [ ] Capture exact Thing ID, moment key, context, epoch and presentation generation before dispatch. Read current capabilities at dispatch time; validate pace/snooze arguments against supported values.
- [ ] Reuse QueryClient-scoped token claims so rapid clicks and simultaneous Court/detail/Brief actions cannot duplicate work. React `busy` alone is not a synchronous guard.
- [ ] Catch/pace/Move Now use the existing cancel/patch/rollback mechanism and the same field semantics as current Court/detail handlers. Do not double-acquire a claim by wrapping an already-claiming helper.
- [ ] If extending `withOptimisticPatch` to return outcomes, preserve or explicitly adapt all existing callers and tests; its current deduplicated no-op must not be interpreted as performed.
- [ ] Timed Snooze follows its personal visibility mechanism. Nudge and ghost dismissal use their actual existing domains, with duplicate prevention and retirement checks.
- [ ] Release only the acquired token in finally; stale completion cannot release a new owner's claim.
- [ ] Failed/already-in-flight/retired outcomes never advance, increment resolved progress or write a surfaced receipt.
- [ ] After performed, reconcile affected caches and await surface receipt separately. Recheck epoch/scope after each await before toast, refresh, advance or focus.
- [ ] Persist receipt-pending state in an identity-scoped controller/store above the dialog body so closing/reopening cannot turn a completed action into another dispatch. Store identifiers/outcomes, not stale Thing objects.
- [ ] Retry acknowledgement calls only `surfaceMoment(momentKey)`. The operation remains idempotent; do not rerun Catch/Nudge/Snooze.
- [ ] Verify `ListChatPanel` dirty/upload blocker and one-controller ownership, resolving the named T03 prerequisites if still absent. Do not reopen unrelated T03 work.

**Tests:** duplicate synchronous clicks; cross-surface preclaimed Thing; two independent Things; rollback; stale epoch/context; domain failure; domain success/receipt failure; receipt retry after dialog remount; successful receipt retry makes zero additional domain calls.

### T10-05 — Stable IDs, current data, honest progress

**Change:** `CatchUpStack.tsx`; optionally add `morning-brief-queue.ts` and `MorningBriefQueue.tsx`.

- [ ] Replace frozen `CatchUpMoment[]` state with stable ordered moment keys for this review session and a live keyed map from current data.
- [ ] Keep selected key stable through reordering/refetch. Append new moment keys at the end without jumping selection. Never reuse array index as ownership.
- [ ] When selected data disappears, use an unavailable/resolved placeholder with safe navigation or deliberate selection movement. Never leave a retained snapshot actionable.
- [ ] Distinguish a known successful local action from a missing server result. Missing data does not prove the user completed work.
- [ ] Current permission/status changes immediately recompute available commands. Confirmed denial clears protected content; transient refresh failure may retain readable cached data with warning while disabling actions requiring freshness.
- [ ] Surface receipt-pending rows even when the successful action removes their moment from the latest response. Their retry state contains no stale protected detail.
- [ ] Separate selected position, viewed count and successful-action count. Suggested labels: “3 of 8”, “Viewed 3 of 8”, “2 actions completed”. Never call navigation “tasks completed”.
- [ ] Finish is explicit on the last item and closes; Previous/Next have names and correct disabled states. Avoid parent close calls inside React state-updater functions.
- [ ] Open Thing closes review and transfers focus/navigation to an ID-based current detail path. It writes no domain mutation or surfaced receipt. If the Thing is outside currently filtered Court rows, open by ID or explain unavailability; never silently no-op.

### T10-06 — Build the actual desktop/mobile interface

**Change:** `CatchUpOverlay.tsx`, `CatchUpBanner.tsx`, `CatchUpStackCard.tsx`, queue component, Court wiring. Preserve internal CatchUp names where useful.

Desktop layout at roughly 960px maximum dialog width:

```text
Morning Brief                                      Close
Greeting · actual local date · Work/Home
Only categories present: Nudges 3 | Snoozes ended 2
--------------------------------------------------------
Bounded queue (~280px) | Selected moment (~remaining width)
Reason / title / time | Actual actor, reason, title, due
Selected row         | Available file/comment metadata
Other rows           | Current capabilities and actions
--------------------------------------------------------
Viewed x of y · n actions completed      Previous / Next
```

- [ ] Greeting uses the real available name, otherwise a neutral greeting. Date and context come from presentation scope, not an unrelated render-time clock.
- [ ] Render only supported category counts. Empty states do not imply work is complete.
- [ ] Queue items are native buttons with accessible selected state and visible focus. Keep titles readable/wrapping and bound long lists inside a scroll region.
- [ ] Render actor, reason, due and known files/comment metadata from existing data. Omit unsupported counts rather than show false zeros. Do not add unbounded attachment/activity fetches per queue row.
- [ ] At narrow widths, use a full-height viewport-safe dialog, one-column detail with compact queue selector, sticky actions and scrollable content. Use dynamic viewport/safe-area support compatible with current CSS.
- [ ] At tablet widths choose single/two columns by available content width; do not squeeze a fixed desktop queue into mobile.
- [ ] Reuse T08 typography, elevation, focus, motion and hit-target contracts. Minimum text 12px; hit targets at least the project's 24px floor, with 40–44px primary touch controls. Respect reduced motion.
- [ ] Build initial loading, paused/offline, initial failure+Retry, successful empty, background failure banner, selected unavailable and receipt-retry states.
- [ ] Manual Review entry stays reachable on error and successful empty; avoid the current `count > 0` gate at both banner and Court level. Review loading can display its own loading state.
- [ ] Preserve Radix accessible title/description, focus trap and close semantics. Automatic entry without a trigger restores to the element captured before opening if still connected and appropriate.
- [ ] Escape/X/backdrop/Finish restore focus. Open Thing explicitly transfers focus to detail; closing must not steal it back. Do not schedule unguarded focus callbacks after scope retirement.
- [ ] Keep empty/error states within the same dialog; do not leave an open blank surface when moments disappear.

### T10-07 — Integration and SQL compatibility

- [ ] Update all `useCatchup`, `CatchUpOverlay`, `CatchUpStack`, `surfaceMoment` consumers found by `rg`; compile catches signature changes but not stale semantics.
- [ ] Have Court pass one coherent data/controller contract. Avoid two independently derived readiness snapshots governing presentation and rendering.
- [ ] Inspect notification/daily-maintenance callers if RPC signatures change. Preserve zero-argument compatibility when required and explicit grants/search_path/auth checks.
- [ ] Read actual deployed-history evidence already in the repository before describing any migration as “not deployed”. Old source comments may be stale.
- [ ] Additive SQL only when context-before-limit or exact dismissal requires it; no speculative schema rewrite.
- [ ] Keep `VITE_KATALIST_MORNING_BRIEF_AUTO_OPEN` default false. Use a test-local override for automatic-open tests, never a production environment change.

## 6. Required test matrix

Use the real React controller and QueryClient where ownership matters. Pure tests cover calendar/queue transitions; PGlite covers SQL execution. Test module mocks may replace network edges but must not replace the logic under test.

| ID | Scenario | Required observation |
| --- | --- | --- |
| D01 | Mixed live Work/Home | Only selected-context authorized moments/counts/actions. |
| D02 | Four preview categories | Each respects accessibility and context. |
| D03 | Required actor/Thing child error | Visible error; no claim; Retry works. |
| D04 | Pending/paused initial data | No false confirmed-empty or claim. |
| D05 | Background error with cached moments | Warning; current policy prevents unsafe automatic interruption. |
| S01 | Flag off | Manual works; no automatic claim. |
| S02 | 06:59 → 07:00 | Timer itself invokes claim exactly once without unrelated rerender. |
| S03 | First visit 16:00 | Eligible if no daily receipt. |
| S04 | Duplicate/Strict Mode/controller mounts | No duplicate presentation ownership. |
| S05 | Hidden/blocker then clears | Claim only when eligible; no catch-up interruption while blocked. |
| S06 | Profile loading/error/no-data/paused | No guessed confirmed timezone. |
| S07 | Valid UTC / unset zone | Server-compatible resolution; UTC preserved. |
| S08 | Pending claim + identity/context/zone switch | No stale open, toast, state overwrite or attempt clearing. |
| S09 | Pending claim + blocker/error/empty | Successful receipt retained; opening suppressed. |
| S10 | Midnight while open/pending | Old UI retires; today's flag false until today's receipt. |
| S11 | Tomorrow 07:00 with tab open | New eligible claim actually occurs. |
| S12 | Structured premature rejection | Owned bounded timer retries; a newer scope is untouched. |
| S13 | Ordinary network failure | No retry storm; manual recovery remains. |
| S14 | DST spring/fall, UTC+14/-12, half-hour | Exact next local date/hour; no fixed-24h drift. |
| R01 | Preview storage throws + remount | Same-session claim remains consumed. |
| R02 | Two preview contenders | One same-realm claim; test locks separately. |
| R03 | Manual open/close without claim | No new presentation receipt. |
| R04 | Dismiss old receipt after new one exists | Exact original receipt only. |
| A01 | Action fails | No surface receipt or advance; retry domain action remains possible. |
| A02 | Claim already owned elsewhere | No RPC/receipt/advance. |
| A03 | Domain succeeds, receipt fails | Show acknowledgement retry; don't repeat action. |
| A04 | Close/reopen then retry acknowledgement | Domain invocation count still one. |
| A05 | Async action retires | No late UI/cache/focus side effects for new scope. |
| Q01 | Refetch changes status/capability | Stable selection; current permitted actions. |
| Q02 | Revocation/removal | Old detail/actions unavailable immediately. |
| Q03 | Reorder/add moments | Stable key selection, append without jump. |
| Q04 | Navigate/Open/Finish | No fabricated resolution or mutation. |
| U01 | Loading/error/empty/background/receipt error | Each has readable named recovery state. |
| U02 | Escape/X/backdrop/Finish | Close and restore expected focus. |
| U03 | Open Thing | Close, navigate by ID, detail focus preserved. |
| U04 | Five viewports + zoom/reduced motion | No horizontal overflow, clipped actions or lost focus. |
| SQL01 | Actual migration execution | First/duplicate claims, threshold, exact dismissal, authorized role checks. |

Suggested test files: extend existing `use-morning-brief.test.mjs`, `morning-brief-schedule.test.mjs`, `morning-brief-receipts-{live,preview,sql}.test.mjs`; add focused `catchup-context.test.mjs`, `catchup-action-outcomes.test.mjs`, `catchup-queue.test.mjs`, `catchup-overlay.test.mjs`, and `tests/e2e/preview/morning-brief.spec.ts` as needed. File count is not an acceptance criterion.

For each demonstrated bug add a failing behavioral reproduction before the fix. Do not repeatedly replace working files to prove every test after implementation; use targeted pre-fix verification only when safe and useful. Never delete assertions just to make the suite pass.

## 7. Browser fixture and verification commands

Use the existing local preview persona flow and deterministic fixture moments. If it cannot reach all states, add test-only injected network/clock fixtures using existing patterns; do not seed production/customer records. Prevent demo actions from hitting live mutation endpoints and assert that isolation.

Run the five configured preview projects: 390×844, 768×1024, 1024×768, 1440×900 and 1920×1080. Also verify a 200% equivalent reflow viewport, keyboard-only traversal, reduced motion, long titles and a large bounded queue. Save screenshots for selected detail plus error/receipt-retry/mobile states. Screenshots supplement assertions; inspect clipping and sticky-action reachability.

```sh
# From the repository root. Use the installed Node version supporting module mocks.
npm run typecheck
npm run lint
npm test
npm run build:app
npx playwright test tests/e2e/preview/morning-brief.spec.ts --project=preview-desktop --project=preview-mobile --project=preview-tablet-portrait --project=preview-tablet-landscape --project=preview-full-hd
git diff --check
git status --short
```

Use `build:app`: `npm run build` also runs migrations. Ensure the Playwright preview configuration actually starts its isolated local server; staging environment variables currently alter that configuration. Do not accidentally target production through ambient variables. Use a free isolated port without stopping the user's existing server.

During development run only affected suites, then run the full required gates once the integrated change is ready. Repeat gates affected by any subsequent correction. No broad formatting or unrelated warning cleanup.

## 8. Closure evidence and commit sequence

Suggested reviewable sequence:

1. Context/readiness and awaitable receipt adapter.
2. Presentation scope, authoritative timezone and timer ownership.
3. Shared action outcomes and durable receipt-only retry.
4. Live queue, current capability reconciliation and safe navigation.
5. Responsive overlay/banner/detail and browser tests.
6. Final ledger and requirement reconciliation.

At the end update `KATALIST_A_TO_H_AUDIT_PROGRESS.md` with each T10-01…07 outcome, files, tests and limitations. Update T10 checkboxes in `KATALIST_A_TO_H_FINAL_COMPLETION_PLAN.md` only when corresponding evidence exists. Update only the T03 prerequisites completed here; do not mark the entire package complete without checking its remaining clauses.

Create `docs/superpowers/plans/KATALIST_T10_FINAL_HANDOFF.md` containing:

- Tested commit/tree and a concise before/after behavior summary.
- One row for every original T10 checkbox, its implementation path and test evidence.
- Local gate results and exact browser projects/artifact paths.
- Migrations added, why required, and deployment status based on evidence.
- Remaining RELEASE-02/03 checks, named precisely; no generic “needs testing”.
- Any reproducible unresolved defect with trigger, impact and source location.

Commit focused changes if consistent with the user's ongoing branch workflow. Do not push/deploy or run production migrations as part of this planning handoff's local execution. Preserve unrelated work and Lovable history.

Local completion means all applicable steps and matrix cases pass, no known T10 correctness gap remains, and the final handoff reconciles every original clause. It does not promise zero future bugs or claim production release from local evidence.

## 9. Copy-paste prompt for the implementation model

```text
Implement Katalist T10 to local completion using:
docs/superpowers/plans/KATALIST_T10_DETAILED_EXECUTION_PLAN.md

Read it fully, then check HEAD, git status, AGENTS.md and the listed source
contracts. Proceed through T10-01 to T10-07 without pausing between packages.
Finish the named T03 action-outcome/receipt-retry/controller dependencies
within this scope, because they are currently incomplete and T10 needs them.

Preserve accepted Morning Brief SQL/timezone/post-await/error fixes. Correct
the explicitly identified stale-day test expectation. Use exact scope/token
ownership across awaits; separate presentation claims from moment receipts.
Keep current data/capabilities in an ID-based queue. Deliver the specified
desktop/mobile UI with manual loading/error/empty recovery and focus behavior.

Add meaningful deterministic regression tests, execute the local SQL fixtures,
run all required local gates and the five-viewport preview browser checks.
Inspect the resulting screenshots. Use build:app; do not run deployment or
production migrations. Keep automatic opening disabled by default.

Make routine implementation choices yourself. Avoid unrelated refactors,
T09 Magic Box fixes, new features, pricing or subscription changes. Preserve
concurrent/unrelated work. If an external check is unavailable, complete all
independent local work and record the exact release check still needed.

Update the audit ledger and master checklist based on evidence, and produce
KATALIST_T10_FINAL_HANDOFF.md. Report commits, gate results and any remaining
release-only requirements. Do not stop at a plan, partial code, or a status
update while authorized local T10 work remains.
```
