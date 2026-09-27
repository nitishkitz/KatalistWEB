# Katalist A–H independent code audit — current working tree

**Date:** 2026-09-27
**Branch / base commit:** `katalist-plan/batch-a-baseline` / `c70a62a`
**Actual audit target:** the current, substantially uncommitted working tree, not just `c70a62a`.
**Screen scope:** desktop and tablet (768×1024, 1024×768, 1440×900, 1920×1080). Phone-size visual testing is excluded by the owner's instruction.
**Mutation scope:** read-only source/test audit. This document is the only intended edit. No application fix, migration, push, deployment, or customer-data operation was performed.

> **Historical audit snapshot:** this document records findings at the start of 2026-09-27. A later implementation turn changed some of the cited files and applied the two named migrations. Read its remediation/deployment handoff before treating a finding below as still open; this audit's evidence and original risk assessment are preserved rather than rewritten after the fact.

## Executive finding

**A–H is not fully closed.** Much of the functionality has been implemented and locally tested, but the current tree still has concrete desktop/tablet defects, an incomplete CI browser gate, a Bridge code/schema deployment dependency, and several explicitly partial data/resource/release clauses. A passing typecheck/test/build does not erase those findings. The older 2026-09-24 audit is a historical defect inventory, not a statement that every old defect remains today. The 2026-09-27 final-acceptance document is useful local evidence, not independent production sign-off.

The highest-value next actions are: (1) make CI actually run and require the demo-authenticated journeys, (2) repair the visible inert Court/Magic Box actions, (3) route Court table mutations through the shared mutation/cache contract, and (4) reconcile and deploy the Bridge schema change in the correct order. Do those before calling A–H code-complete.

### Evidence and limitations

- Inspected the original 55 A–H findings in `KATALIST_A_TO_H_CODE_AUDIT_AND_COMPLETION_REPORT.md`, the T00–T15 plan, progress ledger, final-acceptance report, current source, migrations, and browser specs. File:line references below point to this working tree.
- Current check run: `npm run typecheck` **passed**, `npm test` **881/881 passed**, `npm run lint` **passed with 0 errors / 36 warnings**, and `npm run build:app` **passed**. A narrow 768×1024 Playwright probe with CI-like fake Supabase settings and demo mode off exited 0 with **3 skipped / 0 executed** Morning Brief tests, directly confirming the CI gate defect below. The acceptance report's 60 passed/4 skipped browser result applies to its recorded earlier run of this dirty tree; this audit did not independently rerun a live/staging browser journey.
- The worktree already had many modified/untracked files before this audit. Do not stage or discard them as part of these recommendations. Generated `.vercel/output` from `build:app` is build output, not evidence of a deployed Vercel configuration.
- A source-level flaw is called **confirmed** only where a code path itself proves it. Deployment/RLS, two-account behavior, real devices, and representative-scale performance remain **unverified**, not assumed broken or working.

## Confirmed current defects and exact fixes

### P1 — CI can go green while skipping authenticated Court/Morning Brief browser journeys (A-03, V-01, V-02)

**Where:** `.github/workflows/quality.yml:66-77` runs `npx playwright test` with fake Supabase settings but no `VITE_KATALIST_DEMO_MODE=true`. `.env.example:7` defaults that flag to false. `tests/e2e/preview/morning-brief.spec.ts:37-69` and `tests/e2e/preview/court-golden-path.spec.ts:33-51` return false when the Demo tab is absent, then `test.skip`. The workflow's comments still describe *all* preview tests as unauthenticated/read-only and refer to only three specs, which no longer describes the suite. This is a real gate defect even if simpler unauthenticated specs pass.

**Direct reproduction:** with `VITE_KATALIST_DEMO_MODE=false`, fake Supabase settings, and only the tablet-portrait Morning Brief spec selected, Playwright reported `3 skipped` and exited **0**. This was a read-only local fixture run; no customer backend was used.

**User impact:** CI cannot establish that capture, Morning Brief, navigation, or layout work in the authenticated preview state. A green badge can be misread as browser acceptance.

**Change:** set `VITE_KATALIST_DEMO_MODE: "true"` on this CI job's Playwright step/web server. Retain fake/unreachable Supabase credentials. Make unexpected skips in the demo-authenticated specs a CI failure; reserve explicit breakpoint skips for the opposite-layout case only. Update the workflow and `tests/e2e/preview/README.md` contracts to describe synthetic preview writes and the actual test set. A demo fixture should assert that no real Supabase endpoint is contacted. Do not enable demo mode in production as a consequence.

**Proof to require:** one hosted CI run with test names and pass/skip counts, artifacts, and an assertion that both demo-authenticated specs executed on the authorized desktop/tablet projects. No phone project is needed.

### P1 — Bridge comment API requires a schema migration that is not yet deployed (H-08, V-06)

**Where:** `src/routes/api/public/bridge/comment.ts:42-46` always passes `p_client_token` to `bridge_comment`. The pre-existing function is the **two-argument** form in `supabase/migrations/20260818161732_7098b9bf-e9ae-4c98-8fd1-515ee9ca6cec.sql:488-521`. The new three-argument form and old-function drop are only in the currently untracked `supabase/migrations/20260926120000_bridge_comment_idempotency.sql:10-69`. The final-acceptance report explicitly records this migration as not applied.

**User impact:** deploying this API against a database that still has only the two-argument function makes Bridge comment POST fail. Deploying the migration first while an old API version still calls two arguments is also risky because the migration drops that signature.

**Change:** make the migration tracked/reviewed, verify the target's actual migration history, and design a compatible rollout. Safest sequence: add the three-argument function while retaining the two-argument wrapper for the overlap window, deploy the new API, verify positive/negative Bridge calls with an authorized disposable grant, then retire the wrapper in a later reviewed migration. Alternatively use an explicit maintenance/cutover window. Do not infer production state from the local file, and do not apply this audit's advice directly to a customer database without a deploy plan.

**Proof:** old-client/new-schema and new-client/new-schema compatibility tests, deployed `pg_proc` signature/grant check, authorized live POST/duplicate/revoked-grant tests. The current PGlite tests prove local SQL behavior only.

### P2 — Court's visible filter controls are inert on tablet portrait (E-02, D-03)

**Where:** `src/routes/index.tsx:318` renders the compact Court branch below 1024px. Its `More filters` button at `:399-405` and `Filter` button at `:442-448` have no handler, link, disabled state, or menu trigger. At the authorized 768px tablet width, they appear actionable but do nothing.

**Change:** give both a real, shared filter popover/sheet driven by the same `filter` state and clear action; if these actions are not part of the product, remove them instead of leaving an interactive-looking placeholder. Ensure opening it does not cover the capture input or trap keyboard focus. Keep the existing chip/search/sort behaviors intact.

**Proof:** at 768×1024, keyboard and pointer activation open controls; selecting/clearing a filter changes the visible Thing set and count; Escape closes and restores focus; a true-empty Court remains distinguishable from a filtered-empty result.

### P2 — Magic Box advertises voice input but the button does nothing (E-05, D-03)

**Where:** `src/features/court/MagicBox.tsx:1028-1035` and `:1073-1079`. Both rendered microphone buttons have accessible name `Voice input` but no `onClick`, command, or disabled/explanatory state. The first is in the desktop composer; the second is in the compact/tablet composer.

**Change:** either implement a permission-aware voice capture path with explicit unsupported/denied/busy feedback and cleanup of microphone tracks, or remove the buttons until that exists. Do not leave a decorative button in the keyboard tab order.

**Proof:** browser interaction on desktop and tablet produces a meaningful supported/unsupported outcome; denied permission leaves typed text intact; no track remains live on close/unmount.

### P2 — Court table actions bypass the shared mutation/cache coordination (B-05, E-01)

**Where:** `src/components/katalist/ThingRow.tsx:89-130` invokes `rpcCatchThing`, `rpcNudgeThing`, and `rpcSortThing` directly and only shows a toast on resolution. `src/features/things/rpc.ts:101-144` and `:273-286` implement transport/domain behavior, not React Query invalidation. This row appears in the compact Court table via `src/routes/index.tsx:532-535`. Unlike the detail/swipe paths, the row has no `claimThingMutation`, optimistic patch, or explicit invalidation. The buttons are not synchronously disabled while a request is in flight.

**User impact:** successful live actions may remain visually stale until Realtime/refetch, and rapid repeat clicks or a concurrent detail action can dispatch duplicate commands. Preview local state may mask the live-cache defect; do not use preview alone to close it.

**Change:** add a reusable row action adapter using the existing QueryClient-scoped claim/epoch and appropriate `withOptimisticPatch`/`invalidatePersonalSurfaces` patterns. Catch/Sort should update every affected Court/List/Bucket/Nudges key; Nudge should use its own domain state/invalidation, not invent a Thing-field patch. Capture Thing ID and epoch before dispatch, disable the relevant action synchronously, release on both success and failure, and avoid a stale toast after identity change. Do not duplicate the swipe/detail implementation under a third contract.

**Proof:** real `QueryClient` tests for success, error/rollback, double click, concurrent row+detail action, two independent Things, and account retirement; a visible tablet Court browser test confirming immediate list transition after Catch/Sort without waiting for a Realtime event.

### P2 — Bridge idempotency handles sequential retries but not simultaneous retries cleanly (H-08)

**Where:** `supabase/migrations/20260926120000_bridge_comment_idempotency.sql:41-56` performs `SELECT` then `INSERT` against the partial unique index. `scripts/bridge-authorization-sql.test.mjs:635-695` exercises sequential duplicate calls, explicitly not concurrent requests. Under ordinary concurrent transactions, both requests can miss the SELECT; one INSERT wins and the other can raise a unique violation. The index prevents a duplicate row, but the second request is not guaranteed to return the original comment ID as the API promises.

**Change:** make the insert conflict-tolerant for the exact `(thing_id, author_actor_id, client_token)` predicate, then select/return the existing authorized row after a conflict; or catch only that unique-violation path and re-read. Preserve grant/assignee/terminal checks and reject reuse of one token with a different body if that is the intended API contract. Add a simultaneous two-request test against a real isolated Postgres transaction setup; a single PGlite connection is not sufficient to prove interleaving.

**Proof:** two concurrent POSTs with one token both return the same ID, exactly one row exists, and an unrelated actor/Thing cannot exploit the token. This is a code improvement to prepare before deployment, not evidence that deployed production currently has this bug.

### P2 — The named “Court golden path” browser spec does not execute its named full path (A-01, V-01)

**Where:** `tests/e2e/preview/court-golden-path.spec.ts:4-31` names Capture → Catch → pace → comment/file → Sort, but expressly limits browser coverage to capture feedback; `:64-98` performs only one Toss click, despite the final comment saying “interacted with twice.” Unit/component tests cover some state transitions, but this is not a browser proof of the whole user journey.

**Change:** either rename the spec to `court-capture` and report the remaining journey as unexecuted browser coverage, or add a deterministic small-stack fixture so the created Thing can be opened and Catch/pace/comment/file/Sort driven end to end. Add a genuine rapid-double-dispatch test at the command owner rather than counting one toast after one click. Keep the fixture isolated from customer data.

**Proof:** the report lists each actual transition/assertion, and a deliberately broken Catch or Sort path fails the browser test.

## Partial work and specific remaining clauses

| Area | Current source/evidence | What remains; exact next location |
|---|---|
| A-03 build separation | `package.json:11-13` still defines `build = vite build && npm run db:migrate`; CI deliberately uses migration-free `build:app`. `vercel.json` has crons only, no build-command override. | Confirm the *actual* hosting build command in Vercel/Lovable settings. If it invokes `npm run build`, migrations run during a build; change hosting to `build:app` or split the package command in an approved deployment change. Keep `db:migrate` operator-only. This is a configuration risk, not proof of a production migration run. |
| B-02 read coverage | `src/lib/read-request.ts` provides cancellation/deadline, but `src/features/buckets/use-bucket-notes.ts:20-39` has a query function with no signal, `.abortSignal`, or deadline. The comment at `read-request.ts:81-84` saying “every read” uses the wrapper is therefore false. | Thread signal/deadline through Bucket-note read and audit remaining `useQuery`/Supabase reads with the T01 consumer matrix. Provide slow/hung read and route-away tests. The note editor already exposes `error/refetch`; preserve that. |
| C-01/C-02/H-01 scale | Fetch parallelization, overview projection and summary/count RPCs exist, but final acceptance itself marks C-01/C-02/H-01 partial. | Measure cold/warm Court, Lists, Buckets, Hub request count, bytes, latency and long-list behavior with representative authorized data. Check actual overview payloads do not hydrate full comments/files/activity. Avoid declaring a local demo p75 as real-network proof. |
| E-03 due edit | `src/features/things/ThingDetailContent.tsx:239,417,788-810` keeps the due edit in component-local state, resets it on Thing switch, and does not retain a per-Thing dirty draft. This prevents cross-Thing leakage but can discard an unsaved intentional edit when navigating away. | Decide whether the due field is an intentionally ephemeral edit or a true draft. If the product expects draft preservation, store by `(identity, thingId)` with dirty revision and safe restoration; test A→B→A and failure/retirement. Do not call the existing reset a preserved draft. |
| G-06 note confirmation | `src/features/buckets/use-bucket-note-editor.ts:100-110` uses `window.confirm`. | The correctness guard exists; replace with the shared accessible dialog only if G-06 visual/interaction polish is in scope. Test Escape/cancel/save and focus restoration. This is polish, not the earlier data-loss bug. |
| H-04 file-resource lifecycle | `src/lib/owned-file-resources.ts` has refcounted object-URL ownership; the final acceptance report explicitly leaves successful comment-submit release and 30-cycle heap trend open. | Trace `ThingDetailContent.tsx:489-633` submit/draft ownership through successful persistence; release only after neither live composer nor retained draft/viewer owns the URL. Add owner-count/revoke tests and 30 open/close/retry heap sampling. Do not revoke while an optimistic attachment still renders. |
| F/G/H live behavior | Local Postgres-compatible SQL, jsdom, demo preview and build coverage are substantial but not equivalent to deployed RLS, real two-account access, real Realtime publication, devices or provider callbacks. | Use the existing RELEASE-02–05 checklist in `KATALIST_A_TO_H_FINAL_ACCEPTANCE.md:147-152` with isolated authorized accounts and exact migration history. No production fixture writes are authorized by this audit. |

## A–H ID-by-ID reconciliation

Legend: **L** = implementation has recorded local evidence, not independently re-proved in every path here; **P** = remaining source/coverage clause; **D** = confirmed current defect above; **X** = deployed/live validation required. Multiple labels can apply. This is deliberately more conservative than calling a whole batch “complete” because its tests are green.

| ID | Status | Current conclusion / exact open issue |
|---|---|---|
| A-01 | P | Behavioral suite exists; the purported browser golden path only covers capture. |
| A-02 | L | Nullable Thing transitions have local component evidence; no new contradiction found in sampled source. |
| A-03 | D/P/X | CI demo specs skip; build/migration command and hosted configuration need reconciliation. |
| B-01 | L | Nudges readiness and error separation recorded; no regression identified here. |
| B-02 | P/X | Shared timeout/cancel exists, Bucket-note read is unbounded; slow network still unmeasured. |
| B-03 | L/X | Access-loss logic locally tested; live membership revocation with mounted panels not verified. |
| B-04 | L | Async-state distinctions locally covered; retain consumer-by-consumer checks. |
| B-05 | D | Court `ThingRow` actions bypass shared claim/cache coordination. |
| C-01 | P/X | Parallel scheduling proven locally; real request/latency scaling missing. |
| C-02 | P | Overview/detail separation and deferred sections are not fully reconciled. |
| C-03 | L/X | Bounded feeds have local tests; representative hosted scale missing. |
| C-04 | L | Core auxiliary errors represented; spot-check secondary reads with real RLS. |
| C-05 | L/X | Payload routing locally tested; deployed payload completeness unknown. |
| C-06 | L/X | Mounted access-loss logic locally tested; live publication/RLS delivery unknown. |
| C-07 | L/X | Root ownership/reconnect locally tested; real reconnect timing unknown. |
| C-08 | L | Identity-scoped read state/cross-tab tests recorded. |
| D-01 | L | Typography floor measured on authorized desktop/tablet routes. |
| D-02 | L | Elevation tokens tested locally. |
| D-03 | D/X | Measured targets/contrast passed; inert Court/Magic Box controls remain; physical tablet review open. |
| D-04 | L/X | Reduced motion checked locally; reference-device frame profiling open. |
| E-01 | D | Main Court gestures have alternatives; table mutation path is inconsistent. |
| E-02 | D | Layout locally measured; compact-tablet filter affordances are inert. |
| E-03 | P | Comment/file drafts fixed; due-date edit is not a retained per-Thing draft. |
| E-04 | L | Shared detail sections and variants exist; Bucket variant should remain in integration review. |
| E-05 | D | Magic Box core capture tested; voice affordance is inert. |
| F-01 | L/X | SQL ambiguity locally fixed; deployed function not verified. |
| F-02 | L/X | Timezone/threshold/exact-dismiss local tests; deployed RPC contract open. |
| F-03 | L | Post-claim scope recheck has local tests. |
| F-04 | L | Interaction blockers have local tests; call/device behavior still external. |
| F-05 | L | Required moment-load errors distinguished locally. |
| F-06 | L/X | Brief shown at authorized tablet/desktop widths; CI currently skips authenticated proof. |
| F-07 | L | Action/receipt outcomes covered locally. |
| F-08 | L/X | Daily logic locally covered; cross-device claim atomicity and rollout open. |
| F-09 | L | Work/Home filtering locally tested. |
| G-01 | L | Three-step identity-scoped onboarding locally covered. |
| G-02 | L/X | Auth/OTP local coverage; keep configured static OTP as owner requested, verify production restriction. |
| G-03 | L | Lists index semantics and tablet layouts have local acceptance evidence; no new G-03-specific defect identified here. |
| G-04 | L | List filter/selection local tests recorded. |
| G-05 | L | Shared List workspace/chat local evidence recorded. |
| G-06 | P | Note correctness safeguards present; confirmation remains native `window.confirm`. |
| G-07 | L/X | Bucket reference/count tests local; live permissions still need RLS check. |
| G-08 | L | Shared chat draft/scroll ownership locally covered. |
| G-09 | L/X | Optimistic IDs local; deployed schema-dependent idempotency needs compatibility check. |
| G-10 | L | Actually-viewed read boundary local tests recorded. |
| G-11 | L | Hub landing/header/action tests recorded. |
| G-12 | L | Nudges cooldown/history and presentation local tests recorded. |
| G-13 | L/X | Me/preferences local tests; device notification delivery external. |
| H-01 | P/X | Overview/count implementation exists; query/heap scaling evidence missing. |
| H-02 | L | PDF race/cancel tests recorded. |
| H-03 | L/X | Private-file preview/download local tests; live storage policy external. |
| H-04 | P/X | Owned blob URLs exist; successful comment-submit release and heap trend open. |
| H-05 | L | Stale call join/callback local tests recorded. |
| H-06 | L/X | Call recovery UI local; real devices/reconnect external. |
| H-07 | L/X | Reminder timezone tests local; two-device call/meeting proof external. |
| H-08 | D/P/X | New Bridge API requires unapplied migration; concurrent idempotency proof/fix and live authorization remain. |

## Finish order and closure rule

1. **Code correctness:** fix Court table action coordination, the two inert filter controls, and voice-button truthfulness. Add regression tests that fail on today's code.
2. **Coverage truth:** repair CI demo-mode configuration and skipped-test gate; rename/complete the Court golden-path spec. Run authorized desktop/tablet projects only.
3. **Schema safety:** resolve Bridge concurrent retry and compatible old/new function rollout; track/review the migration. Verify exact deployed migration history before any deployment.
4. **Remaining partial clauses:** finish Bucket-note cancellation, decide/implement due-field draft semantics, release comment blob URLs on safe success, and measure overview/query/heap behavior with representative data. Native note confirmation is lower-risk polish.
5. **Release evidence:** hosted CI, deployment build command, actual Supabase/RLS/realtime with two disposable accounts, Bridge, real call devices, and desktop/tablet accessibility/performance on reference hardware. Record failures, owner, and rollback. Phone-size testing stays excluded unless the owner changes that instruction.

An ID is **closed locally** only when its required behavior has source changes plus a regression test and the current check suite passes. It is **closed for release** only when its stated external gate passes on the exact deployed build/schema. Do not roll a partial item into “complete” merely because T15 or the full unit suite is green.
