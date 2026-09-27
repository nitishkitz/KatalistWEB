# Katalist A–H Final Acceptance and Audit Reconciliation

**Prepared:** 2026-09-27
**Tested tree:** working tree on `katalist-plan/batch-a-baseline`, HEAD `c70a62a` plus the uncommitted changes present at acceptance time. This is not a clean-commit or hosted-build claim.
**Scope:** final local integration acceptance for T00–T15. No push, deployment, Supabase migration, or production-data operation was performed.
**Viewport instruction:** user specified desktop and tablet only. Browser checks covered 768×1024 tablet portrait, 1024×768 tablet landscape, 1440×900 desktop, and 1920×1080 full HD. The 390×844 phone project was not run or captured.

## Outcome

T15 local integration acceptance passed within the authorized viewport scope. The local suite reported **881/881 tests passing**, TypeScript typecheck passed, lint reported **0 errors** (existing warnings remain), and `build:app` passed. `git diff --check` passed. The default Playwright run completed **60 passed, 4 skipped, 0 failed** across the four authorized projects; the skips were the opposite breakpoint's Court test in each project. A separate browser measurement pass covered 20 route/viewport combinations and accessibility/responsive checks.

This means the locally testable implementation and authorized desktop/tablet screen coverage are reconciled; it does **not** mean all A–H release conditions are met. Phone-size behavior is outside the requested scope; external staging/hosted/live/assistive-technology gates remain open; and several audit clauses are explicitly partial below. Do not describe this as complete production release.

## Evidence

### Automated checks

| Check | Result | Scope/qualification |
|---|---|---|
| Full unit/integration suite | 881/881 passed | Current working tree at acceptance time. |
| TypeScript | Passed, 0 errors | `npm run typecheck`. |
| ESLint | 0 errors | Existing warning baseline remains; warning count is not represented as zero. |
| Production app build | Passed | `npm run build:app`; local fake Supabase fixture and demo mode; no migration runs. |
| Playwright | 60 passed, 4 skipped, 0 failed | Default run: `preview-tablet-portrait`, `preview-tablet-landscape`, `preview-desktop`, `preview-full-hd`; one opposite-breakpoint Court test skipped per project. Phone project requires explicit opt-in. |
| Diff whitespace check | Passed | `git diff --check`. |

### Browser route and visual checks

Local production-mode demo preview used deliberately unreachable fake Supabase settings (`ci-fixture.supabase.co`); it was not connected to live customer data. All five reviewed routes returned HTTP 200 at each of the four allowed viewports: Court, Lists index, Buckets index, Team Hub, and Me (20 route/viewport checks).

- Browser console errors: **0**. Fake-fixture Realtime DNS failures were captured separately as expected fixture-connection errors; they are not presented as a working realtime test.
- Visible text below 12px: **0** in the measured routes.
- Actionable targets below 32px: **0** in the measured routes.
- 200% zoom: Court had no horizontal overflow; the Lists screen's member card was constrained with `min-w-0` after the zoom check exposed overflow.
- Reduced motion + keyboard focus: reduced-motion pass completed; focus-visible styling was present (inset 2px accent ring).
- Warm SPA navigation: 20 samples, **p75 47ms**, target 300ms. This is a local demo-preview measurement, not real-network or reference-device performance evidence.
- Largest Contentful Paint observations ranged from approximately **0.63s to 2.03s** in this unthrottled local preview. The highest sample was Court at 768×1024; these values are environment observations, not release SLO certification.

Screenshots and machine-readable output are in [`output/t15-desktop-tablet-20260927`](../../../output/t15-desktop-tablet-20260927). The output metadata explicitly records the tested and excluded viewport sets. No phone-sized screenshot was produced. The run measured 20 route/viewport entries plus warm navigation, zoom and reduced-motion/focus cases.

### Changes exercised by integrated acceptance

The final acceptance pass fixed issues found in the integrated browser run rather than recording false green results:

- Court, Lists, Buckets and Hub controls used for navigation/filtering were below the chosen desktop hit-target floor; the affected controls were widened and verified at 32px minimum.
- At tablet portrait, the compact Magic Box input had zero rendered height and lacked a visible Toss button. Giving the composer a definite height and a submit button made the capture journey pass. Eight smaller Court controls found in the tablet portrait measurement were raised to the 32px floor and remeasured.
- The tablet portrait screenshot exposed a top-navigation collision: the Me link overlapped the Work/Home control by about 50px. The header now shares available width at tablet sizes and keeps viewport-centered links at desktop sizes; a bounding-box regression test passes at all four supported viewports.
- A Court Lists-members card overflowed horizontally at 200% zoom; its flex child now has `min-w-0`.
- Desktop and compact Court trees could both render an open Morning Brief dialog through Radix portals. The route now makes the desktop and compact overlays mutually exclusive at the 1024px breakpoint; a real dialog-count assertion covers the regression. This does not constitute a mobile screen test.
- `playwright.config.ts` only activates staging projects when the explicit isolated-staging opt-in and required settings are present.
- Default Playwright and browser-measurement runs select desktop and tablet sizes; the phone project requires explicit opt-in.
- Telemetry route scopes use a bounded route-family allowlist; private identifiers and path segments are not forwarded as raw route labels.

Files for those areas include `src/routes/index.tsx`, `src/components/katalist/ThingRow.tsx`, `src/components/layout/TopNav.tsx`, `src/features/court/CourtDesktop.tsx`, `src/features/court/CourtWithOthersSidebar.tsx`, `src/features/court/MagicBox.tsx`, `src/features/lists/components/ListMembersSection.tsx`, `src/features/hub/components/HubSidebar.tsx`, `src/features/hub/components/ConversationWorkspace.tsx`, `playwright.config.ts`, `scripts/t08-browser-verification.mjs`, and the related `tests/e2e/preview/` and `scripts/` regression coverage. The current uncommitted tree also contains the T13/T14/T15 changes recorded in the audit ledger; this report does not claim that every changed file originated in T15.

## Viewport boundary

Tested:

- 768×1024 tablet-portrait
- 1024×768 tablet-landscape
- 1440×900 desktop
- 1920×1080 full HD
- Court at 200% browser zoom without changing the viewport dimensions
- Court under reduced-motion preference and keyboard focus

Explicitly not tested, per user instruction:

- 390×844 mobile
- Any other phone-size browser/screenshot run

The earlier T10 handoff named a narrow-screen Morning Brief entry-point gap; the later T10 gap-closure entry in the progress ledger records its fix. Tablet portrait now exercises that compact entry point, dialog and Escape path. Phone screens were not retested in this pass. Automated accessibility checks are not a substitute for manual desktop VoiceOver or physical tablet touch evaluation.

## Reconciliation of all 62 audit IDs

“Local pass” means the owning task's implementation/tests are recorded in the task ledger and survived the final local suite. “Partial” means a named clause remains unresolved or deliberately unmeasured. “Release pending” means code-level work is present but requires hosted, staging, live-backend, another-device, or production-owner evidence. These labels do not promote a local test into production verification.

| ID | Disposition at final local acceptance | Remaining clause / evidence boundary |
|---|---|---|
| A-01 | Local pass | Behavioral tests preserved; source-string checks were corrected earlier rather than used as a substitute for behavior. Hosted workflow evidence remains RELEASE-01. |
| A-02 | Local pass | Nullable Thing detail and dependent UI behavior owned by T09 and covered by local tests. |
| A-03 | Partial / RELEASE-01 | Migration-free `build:app` and local lint/typecheck are green. Hosted CI at an authorized pushed commit and actual hosting build-command confirmation remain open. |
| B-01 | Local pass | Nudges query scoping/readiness/error states recorded in T01/T13; local suite passes. |
| B-02 | Local pass | Timeout/cancel/retry and route-away behavior have local coverage; real slow-network verification remains RELEASE-05. |
| B-03 | Local pass / RELEASE-03 | Confirmed access-loss classification and mounted-consumer behavior are locally implemented. Deployed membership-revocation delivery and two-account verification remain external. |
| B-04 | Local pass | Loading/error/empty/offline distinctions and retry surfaces have local coverage in the owning data tasks. |
| B-05 | Local pass | Shared action claims and scope-owned continuations are implemented/tested; live multi-device contention is not part of local evidence. |
| C-01 | Partial / RELEASE-05 | Waterfall serialization improvements have deterministic event-order tests. Live request volume, representative-data scaling and network timing have not been measured. |
| C-02 | Partial | RPC/count work exists, but the full summary/detail split, on-demand attachment/activity loading and pagination are not claimed complete. |
| C-03 | Local pass | Bounded feeds/search/cursor work is recorded under T04; hosted-scale latency remains external. |
| C-04 | Local pass | Auxiliary errors/count unknowns are represented distinctly from zero/empty, with tests under T05/T06. |
| C-05 | Local pass / RELEASE-03 | Payload-scoped invalidation and move/fallback behavior are locally covered. Real publication payload behavior remains external. |
| C-06 | Local pass / RELEASE-03 | Access-loss invalidation reaches mounted local observers. Live RLS/revocation delivery is not established by fake-fixture runs. |
| C-07 | Local pass / RELEASE-03 | Root ownership, cleanup, reconnect and identity handling are locally tested. Deployed realtime timing/reconnect remains open. |
| C-08 | Local pass | Read state is identity/preview scoped and cross-tab synchronized in local behavior tests. |
| D-01 | Local pass within tested scope | Typography floor checked on five routes at all four authorized desktop/tablet viewports. Phone-size layouts are excluded by instruction. |
| D-02 | Local pass | Overlay elevation tokens and suppression-resistant styles are locally tested. |
| D-03 | Local pass within tested scope | Contrast fixes, controls, focus and 32px target checks passed at the authorized viewports. Physical tablet touch-target acceptance remains RELEASE-05. |
| D-04 | Local pass within tested scope | Motion preferences and transition bounds have unit/browser evidence; reduced-motion browser check completed on Court. Manual frame profiling on reference hardware remains RELEASE-05. |
| E-01 | Local pass | Court keyboard/native navigation and gesture command parity are covered by T09 implementation/tests. |
| E-02 | Local pass within tested scope | Court empty/filtered/media/zoom checks passed locally at desktop and both tablet orientations. Phone-size layout is excluded. |
| E-03 | Partial | Comment/file drafts and late completion protections are implemented. The due-field draft residual named in the progress ledger is not silently marked closed. |
| E-04 | Local pass | Shared Thing detail sections and controlled variants are implemented; Bucket integration remains tracked by the T11 ledger where applicable. |
| E-05 | Local pass | Magic Box draft, upload, retry and destination paths are covered locally; live storage policy behavior remains release validation. |
| F-01 | Local pass / RELEASE-02 | SQL ambiguity regression was reproduced/fixed with local Postgres-compatible testing. Deployed function/role behavior remains unverified here. |
| F-02 | Local pass / RELEASE-02 | Timezone, server threshold and exact-dismiss semantics are locally covered. Deployed timezone/RPC contract remains open. |
| F-03 | Local pass | Post-await eligibility revalidation and identity/blocker changes are covered locally. |
| F-04 | Local pass | Shared interaction blockers for dirty/modal/upload/call states are implemented/tested. |
| F-05 | Local pass | Required Catch Up lookup failures remain distinguishable from no-moments and expose retry/error state. |
| F-06 | Local pass within tested scope | Morning Brief entry, dialog and Escape flow pass on tablet portrait and the three wider viewports. Phone-size layout remains outside the requested test scope. |
| F-07 | Local pass | Action/navigation/receipt-only retry outcomes use shared action-outcome behavior and have local coverage. |
| F-08 | Local pass / RELEASE-02 | Daily cases, preview fallback and local concurrency logic are covered. Cross-device atomicity, deployed RLS and rollout remain open. |
| F-09 | Local pass | Work/Home filtering for Brief moments is covered by the T10 implementation tests. |
| G-01 | Local pass | Three-step identity-scoped onboarding, skip/resume and auth return behavior are covered locally. |
| G-02 | Local pass / RELEASE-02 | Truthful discovery and OTP behavior are implemented; deployed auth-provider behavior still requires release verification. Static OTP is intentionally retained per the user's later instruction and must remain deployment-restricted as configured. |
| G-03 | Local pass within tested scope | List index states and both tablet orientations passed; phone-size visual coverage is excluded. |
| G-04 | Local pass | Per-List filter hydration and selected-Thing stability are covered by T11. |
| G-05 | Local pass | List sections and shared chat consumers are covered by T11 local verification. |
| G-06 | Partial | Per-note drafts, save/discard safety and read errors are implemented. The `window.confirm` polish residual named in the ledger remains; it is not represented as a polished custom confirmation. |
| G-07 | Local pass | Bucket references, counts and command paths have local T11 coverage; live authorization remains subject to deployed-policy checks. |
| G-08 | Local pass | Shared scoped chat drafts/scroll/continuations are locally covered by T02/T04. |
| G-09 | Local pass / RELEASE-02 | Stable optimistic IDs and local idempotency coverage exist. Any schema-dependent server idempotency path still requires migration/deployment compatibility verification. |
| G-10 | Local pass | Actually-viewed read boundary and consistent unread state are covered by T05. |
| G-11 | Local pass | Hub header, landing, tabs, actions and dock behavior are covered by T05. |
| G-12 | Local pass | Nudges semantics/history/cooldown implementation and local states are recorded under T13. |
| G-13 | Local pass within tested scope | Profile/preferences/push/privacy local checks and desktop Me route visual checks passed; device notification delivery remains external. |
| H-01 | Partial | Overview/count RPC implementation exists. Full query-count/scaling evidence and any remaining summary-vs-detail clauses are not inferred from local demo measurements. |
| H-02 | Local pass | PDF document/page/task ownership and stale-result protection have regression coverage under T14. |
| H-03 | Local pass | Preview/signed-URL/download recovery and controls have local tests. Live storage policy remains external. |
| H-04 | Partial / RELEASE-05 | Owned object URL and private-file-policy behavior have local tests. Thirty-cycle heap trend is unmeasured, and comment-composer successful-submit URL release remains an explicitly documented conservative gap. |
| H-05 | Local pass | Superseded join/callback and unmount continuation behavior are tested locally. |
| H-06 | Local pass | Call lifecycle/recovery and blocker integration are locally covered; real media devices are RELEASE-04. |
| H-07 | Local pass / RELEASE-04 | Timezone/DST reminder behavior passes local tests. Two-device real call/media verification remains external. |
| H-08 | Partial / RELEASE-02/04 | Bridge authorization matrix and idempotency are locally tested with PGlite. New Bridge comment idempotency migration is not applied; live Supabase service-role/RLS E2E remains open. |
| V-01 | Local pass / RELEASE-01 | Preview journey suite runs locally with controlled demo fixture. Isolated staging execution and actual CI artifacts remain open. |
| V-02 | Partial / RELEASE-01 | Browser projects and safety configuration exist. Hosted CI run at the final tree has not been produced. |
| V-03 | Partial / RELEASE-05 | Local warm navigation and route metrics are recorded. Representative data, real network, reference-device and heap-cycle measurements remain open. |
| V-04 | Local pass within scope / RELEASE-05 | Four authorized desktop/tablet viewport sizes plus zoom/reduced-motion/focus passed. Phone-size coverage is excluded; manual desktop VoiceOver and physical tablet touch checks remain open. |
| V-05 | Local pass | Privacy-safe bounded telemetry and route redaction have regression coverage. No production telemetry was emitted by this local run. |
| V-06 | Partial / RELEASE-01–06 | Local source/test/build gates pass. Migration deployment, hosted CI, live compatibility, two-user/device verification and rollout are not complete. |
| V-07 | Local pass | This report and the progress ledger reconcile every ID with explicit residual clauses and external gates. |

## Remaining release gates (not local coding tasks)

No local task should be left open merely because these require a separate environment, but none is claimed complete:

1. **RELEASE-01 — hosted CI/deployment configuration:** push/PR authorization, successful hosted quality/E2E workflow, and confirmation that hosting invokes the migration-free app build.
2. **RELEASE-02 — schema/RPC deployment:** review and apply still-pending feature migrations only in the authorized target; verify Morning Brief and Bridge functions, grants, RLS, old/new client compatibility and rollback. No migration was run during T15.
3. **RELEASE-03 — live identity/realtime/access:** two isolated accounts, account switching, membership revocation while protected surfaces are mounted, publication/payload/reconnect behavior and fallback when a DELETE event is absent.
4. **RELEASE-04 — calls/meetings/Bridge:** two real test users/devices, media permission/reconnect/track-stop behavior, and authorized live Bridge positive/negative E2E with scoped disposable data.
5. **RELEASE-05 — performance/accessibility:** representative network/data and reference-device traces, heap-cycle measurement, manual desktop VoiceOver and physical tablet touch checks. Phone-size screen testing is outside the user's requested scope.
6. **RELEASE-06 — pilot/operations:** approved rollout, monitoring, rollback preserving user work/receipts, and owner sign-off.

## Migration/API inventory and status

T06/T07's previously recorded production closure remains as documented in the T06/T07 reconciliation and ledger; T15 did not alter production. Later feature migrations still require checking the actual target's migration history and applying only with explicit release authorization. In particular, this tree contains:

- `20260923100000_morning_brief_receipts.sql` and the follow-on `20260925110000_morning_brief_exact_dismiss.sql` for claim/dismiss receipts and exact-date dismissal behavior. Local SQL behavior is covered; deployed execution/grants are RELEASE-02.
- `20260925100000_realtime_publication_coverage.sql` for the realtime publication table set. Historical production closure is recorded under T07; any new environment still needs its own RELEASE-03 verification.
- `20260926120000_bridge_comment_idempotency.sql`: adds nullable `thing_comments.client_token`, a partial unique index on `(thing_id, author_actor_id, client_token)` when non-null, and replaces the two-argument `public.bridge_comment` with a three-argument `(p_session_token text, p_body text, p_client_token uuid default null)` service-role function. Caller: `src/routes/api/public/bridge/comment.ts`, with one UUID retained across a compose retry. The migration is locally tested, **not applied**; validate signature compatibility and deployed grants under RELEASE-02.

The exact feature-migration list and legacy migration reconciliation are available in the repository migration directory and [`2026-09-25-t06-t07-migration-reconciliation.md`](2026-09-25-t06-t07-migration-reconciliation.md). Never infer production migration status from a local migration file.

## Changed-file groupings and review note

The working tree contains the cumulative T13–T15 and earlier local acceptance changes. The final review areas are:

- **Cross-cutting acceptance/telemetry/E2E:** `src/lib/telemetry.ts`, `src/routes/__root.tsx`, `playwright.config.ts`, `scripts/t08-browser-verification.mjs`, `tests/e2e/preview/`, `tests/e2e/staging/README.md`.
- **Court, targets, header, zoom and Morning Brief overlay:** `src/routes/index.tsx`, `src/components/katalist/ThingRow.tsx`, `src/components/layout/TopNav.tsx`, `src/features/court/CourtDesktop.tsx`, `src/features/court/CourtWithOthersSidebar.tsx`, `src/features/court/MagicBox.tsx`, `src/features/lists/components/ListMembersSection.tsx`, `src/features/hub/components/HubSidebar.tsx`, `src/features/hub/components/ConversationWorkspace.tsx`.
- **T13/T14 integrated regressions:** Nudge/profile preferences, meeting reminder, call recovery, PDF races/private file policy, owned blob resources, Bridge route authorization/idempotency and their tests under `scripts/` and `tests/e2e/preview/`.

Before committing or pushing, inspect the complete current diff and preserve the pre-existing user changes. This report records the tested working tree; it does not authorize commit, push, deploy or migration application.
