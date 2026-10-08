# Code Activity — Task Ledger

Latest live setup: see `local-connector-activation.md` (7 October 2026). The user authorized the existing Katalist_uat project and then explicitly approved the remaining processing migration after its initial auto-review rejection. Four Code Activity migrations are now applied and locally recorded, the real GitHub App is configured, and user-confirmed repository connect successfully synced 50 real activity rows. After a user-side disconnect/reconnect during verification, the final hosted state is ACTIVE/ok and the browser shows Connected, Up to date, and real activity. Codex did not disconnect or reconnect it. AI/background sync remain off, with only WORKSHOP FRIDAY allowlisted. Earlier “nothing applied / not authorized” entries below are historical, not the current activation state. Production readiness and real multi-connection concurrency remain unverified.

Status values: TODO / DOING / VERIFIED / BLOCKED. Application implementation is not authorized. Only T01 to T03 planning work is in scope.
Last updated: 7 October 2026.

## Review status

| Review | Reviewer | Status |
|---|---|---|
| Architecture | Codex chat | CHANGES REQUESTED. **Re-review requested 7 Oct 2026 via `rereview-request.md`; not held** |
| Authorization and sharing | Codex chat | CHANGES REQUESTED. **Re-review requested 7 Oct 2026 via `rereview-request.md`; not held** |
| Atomic confirmation | Codex chat | CHANGES REQUESTED (transaction approach reasonable; retention, replay, and direct-RPC enforcement addressed in v3, not re-reviewed) |
| Product choices | Product owner | Retained |
| Production enablement | Product owner | Retained |

Reviews are recorded as changes requested, not completed. Reviewer appointment does not block documentation research or design drafts. Unresolved findings block freezing the contracts and the dependent implementation tasks.

## Tasks

| Task | Status | Changed files | Verification | Unresolved issues | Next |
|---|---|---|---|---|---|
| T01 Inventory and baseline | VERIFIED (planning). **Baseline is not green.** | `baseline.md` | Base `71be5b6fa273374d0e8802cfc100d86e7c8e577b`, clean detached worktree. `npm ci` exit 0. `npm test` exit 1 (907 pass, 25 fail). `npm run typecheck` exit 2 (3 errors). `npm run lint` exit 0 (36 warnings). `npm run build` exit 0. | The 25 test failures and 3 type errors are preserved as known findings, not fixed, and no document may claim all release gates pass. Baseline excludes the uncommitted push, profile, and route-tree edits. Playwright not run. | none |
| T02 Freeze contracts | DRAFT v3 — reviews CHANGES REQUESTED; v3 not re-reviewed | `contracts.md`, `provider-evidence.md`, `corrections.md` | GitHub and Vercel claims researched 7 Oct 2026 and graded in `provider-evidence.md`. v3 addresses review findings F1 to F6. Nothing applied or executed. | D13 and D14 decided (View Only excluded from assignees; Contents read included, tokens narrowed). Still open: D9 (preview migrations), D10 and Sarvam, D12 (route tree), D17 (hosting provider, plan, scheduler capacity; the repository holds both `vercel.json` and `netlify.toml`). Push-only reconciliation endpoint unresearched. `GET /installation/repositories` permission closed on the reviewer's citation, to be re-confirmed by a mocked call. Callback `installation_id` and `setup_action` are SECONDARY evidence only. Field-level schemas deferred. New defects found and fixed in the draft: `app_config` is readable by all signed-in users; the Vercel 4.5 MB request cap exceeded the v2 webhook limit. | Re-review of v3 by the Codex chat |
| T03 Visual specification | DRAFT — NOT APPROVED | `design-contract.md`, `design/frames.html`, `design/png/*` | 12 frames plus a role matrix rendered and visually checked in headless Chromium. Not reviewed. | Design review approval not held. Gaps listed in `design-contract.md` section 9 (consent settings, Manage and disconnect dialog, loading skeleton, forbidden state, 1024px and 200% zoom drawings). Contrast unmeasured. | Design review |
| T04 to T11 (Gate B) | IMPLEMENTED IN A FEATURE WORKTREE — see "Gate B implementation" below. Authorized by the product owner on 7 Oct 2026 for local preview only | Worktree `/Users/nagasainathreddy/Documents/ChatGPT/KatalistWeb_codeactivity`, branch `katalist-feature/code-activity-ui`, from `71be5b6`. Uncommitted | See below | Contracts remain DRAFT; designs remain NOT APPROVED. Live GitHub, database, and AI work is not started | Design review; contract re-review |
| T12 to T18 (Gate C) | TODO — NOT AUTHORIZED | none | none | Requires T02 review. | none |
| T19 to T25 (Gate D) | TODO — NOT AUTHORIZED | none | none | | none |
| T26 to T32 (Gate E) | TODO — NOT AUTHORIZED | none | none | T31 requires the pending confirmation review. | none |
| T33 to T35 (Gate F) | TODO — NOT AUTHORIZED | none | none | | none |

## Notes

- No secrets, private patches, raw webhook bodies, or credentials appear in any record.
- Original plan documents and images are preserved unedited. Corrections are recorded in `corrections.md`.
- `KatalistWeb_prod` (`a20226c`) was not touched. No migration, deployment, provider configuration, or external write occurred.

## Gate B implementation (7 October 2026)

Scope authorized: the isolated UI (T04 to T11) in an isolated worktree, enabled only in explicit local preview, production off. Nothing was committed, pushed, deployed, or migrated. `KatalistWeb_dev` and `KatalistWeb_prod` were not touched.

| Task | Result | Evidence and limits |
|---|---|---|
| T04 Types | Delivered, verified | `types.ts` with runtime guards and draft validation. 13 tests, including malformed-input rejection and nullable counts |
| T05 Preview fixtures | Delivered, verified | `fixtures.ts`, `preview-adapter.ts`. A test traps `fetch`, `XMLHttpRequest`, `WebSocket`, and `EventSource` and runs every adapter method. A source scan forbids network, database, and raw-HTML APIs in the feature |
| T06 Failure container | Delivered, partly verified | `CodeActivityBoundary.tsx`, `CodeActivityRoot.tsx`. Boundary logic and fallback are unit-tested, and a failing feed is shown to stay local in the browser. **A real render exception was not injected in the browser** |
| T07 Feed | Delivered, **visual match not approved** | Matches the draft frames and was checked at 1440, 1024, 768, and 390. No approved frames exist to compare against |
| T08 Inspector | Delivered, **visual match not approved** | Overview, Files, Checks, diff, binary, truncated, unavailable. Inert text rendering tested. Keyboard tabs and Back-to-row focus restoration tested in the browser |
| T09 Draft review | Delivered, fixture-only | Required unselected assignee (Owner and Collaborators only), due date unset, Waiting for Catch stated, in-app notification copy only. Result screen is labeled Preview and links to nothing |
| T10 Feature gate | **Partial** | A client-side gate only: local preview and `VITE_CODE_ACTIVITY_PREVIEW`. The server capability endpoint and server-side flags in contracts section 5 are not built |
| T11 List entry | Delivered, verified | One conditional tab and a lazy import in `src/routes/lists.$listId.tsx`. Flag off: only two tiny gate modules load. Things stays the default tab |

### Checks against the recorded baseline (commit `71be5b6`)

| Check | Baseline | Now |
|---|---|---|
| `npm test` | 932 tests, 907 pass, 25 fail | 1,003 tests, 978 pass, **the same 25 fail** (names compared one by one; none new, none fixed) |
| `npm run typecheck` | 3 errors | The same 3 errors |
| `npm run lint` | 0 errors, 36 warnings | 0 errors, 36 warnings. New files are lint-clean |
| `npm run build` | exit 0 | exit 0. Sample data appears only in the lazy chunk `CodeActivityRoot-*.js` |
| Repo guard tests (shadow, 12px text) | Fail | Still fail on pre-existing code. New files add none. The route's 8 pre-existing small-text hits are unchanged |

New automated tests: 71 Node tests (`scripts/code-activity-*.test.mjs`) and 6 Playwright cases in `tests/e2e/preview/code-activity.spec.ts` (5 run with the flag on and passed; the flag-off case passed separately).

### Not verified

- The existing `tests/e2e/preview/lists-buckets.spec.ts` skips locally because its sign-in helper expects a "Demo" tab this setup does not show, so it did not run. Things, Chat, Members, and the Call button were checked by the new spec. **A live call was not started.**
- No real render exception was injected into the browser.
- Contrast of the proposed check colors is unmeasured. The 200% zoom layout was checked only for horizontal overflow at the e2e level, not drawn or reviewed.
- Nothing about GitHub, the database, or AI was exercised, because none of it exists yet.

### Backend work that remains (unchanged)

GitHub authorization and callback; repository verification; webhook intake, processing, and reconciliation; additive schema, row-level security, and the confirmation function; server capability endpoint and flags; the AI adapter and consent storage; a live adapter replacing the preview adapter. All stay blocked on the contract re-review.

## G00 to G02 execution (7 October 2026)

Scope authorized by the product owner: G00, G01, G02 only, on `katalist-plan/batch-a-baseline`. Nothing was committed, pushed, deployed, or migrated. No contract was marked approved. Stopped before G03.

### G00 Baseline refresh (read-only inventory and tests)

- Branch `katalist-plan/batch-a-baseline`, HEAD `71be5b6` (unchanged). The working tree already held 27 modified and many untracked paths before this work (Catch Up, push, Thing detail, auth CSS, `vite.config.ts`, `.env.example`, `routeTree.gen.ts`, `supabase/.temp/*`, the whole `src/features/code-activity/` feature, and others). They are the user's edits and were preserved.
- Today's results are on the dirty tree **after** the G02 edits, because the first baseline test run was interrupted and overlapped with the file moves. A pristine pre-change run does not exist. Treat the numbers as "current tree", not as a clean baseline.
- `npm test`: 1,018 tests, 991 pass, **27 fail**. The historical baseline at `71be5b6` was 25 failures. None of the 27 names mention Code Activity. They concern auth autofill CSS, Court/Morning Brief, composer drafts, Thing detail, `me-preferences`, `assignable-people-gating`, and the shadow and 12px guard tests. **The two extra failures are not attributed to a cause**; a clean-tree comparison was not run.
- `npm run typecheck`: the same 3 errors as the historical baseline (`server/lib/find-phone-user.ts`, `src/lib/error-component.tsx`, `src/routes/__root.tsx`). None in Code Activity.
- `npm run lint` (feature and List route only): 0 errors, 0 warnings after one fix in `ConnectionPanels.tsx`. Full-repo lint was not re-run.
- `npm run build`: exit 0. The built Code Activity chunk contains no `example-org` sample data.
- Playwright was not run. The e2e spec was rewritten but needs a demo sign-in this setup does not provide.

### G01 Contract delta

`contract-delta.md` written. Status DRAFT, no reviewer recorded, nothing frozen. Eight review blockers are listed there.

### G02 Safe live shell

| Change | Files |
|---|---|
| Mock activity removed from the runtime. Fixtures, preview adapter, and preview bar moved to `scripts/fixtures/code-activity/` (tests only). The old preview root is kept there as `PreviewRoot.tsx` for later reuse | `scripts/fixtures/code-activity/*`, deleted from `src/features/code-activity/` |
| Adapter interface split into its own types file | `adapter.ts`, imports in `ChangeInspector.tsx`, `CoeyDraftReview.tsx`, `use-code-activity.ts` |
| Honest shell: "GitHub connection is not configured yet". No connected indicator, no sample data, no request | `CodeActivityRoot.tsx`, `shell-state.ts`, `ConnectionPanels.tsx` |
| Error boundary moved outside the lazy root so a rejected chunk is contained | `src/routes/lists.$listId.tsx` (one import, one wrapper), `CodeActivityRoot.tsx` |
| Tests | new `scripts/code-activity-shell.test.mjs` (6); existing `code-activity-*.test.mjs` re-pointed; e2e spec rewritten |
| Comment and docs | `.env.example` (comment only), `README.md` |

Feature tests: 77 of 77 pass (71 existing plus 6 new). Not verified: a real render exception or chunk rejection in a browser, a live List in a real session, the rewritten e2e spec.

### Follow-up (7 October 2026): extra failures, gaps, browser check

**The two extra test failures (27 vs 25), investigated, nothing fixed.** No pre-change snapshot of the dirty tree exists, so a clean-HEAD comparison alone cannot attribute them. Method: export HEAD with `git archive` into the scratch area, confirm HEAD results, then copy **one** dirty file at a time over the export and rerun the single failing test. This shows each file's isolated effect. It does not test interactions between several dirty files, and it is not a true snapshot of the tree before G02.

| Extra failure | HEAD | Cause (isolated) | Evidence |
|---|---|---|---|
| `auth-gate-no-timeline`: "browser autofill keeps the auth input visually consistent with its field" | passes | Uncommitted edit to `src/features/auth/gate/auth-gate.css` changed the selector from `.kg-well input:-webkit-autofill` to `.kg-well :is(input, select):-webkit-autofill`. The test regex expects the old selector. Test is ahead of or behind the user's CSS, not a defect found in the CSS behavior | HEAD CSS: pass. HEAD plus the dirty CSS only: fail |
| `court-mobile-morning-brief` test 1: "exactly one useMorningBrief()/useCatchup() instance is shared..." | passes (6 other tests in the file fail at HEAD, matching the old baseline) | Uncommitted edit to `src/features/catchup/CatchUpOverlay.tsx` adds `useProfile`, `useBriefGenie`, `briefGreeting` imports. `useProfile` reaches the Supabase client, which reads `import.meta.env`, undefined under Node, so every test in the file now fails with `Cannot read properties of undefined (reading 'VITE_SUPABASE_URL')` | HEAD plus each of the 13 dirty source files alone: only `CatchUpOverlay.tsx` flips it to fail |

- Neither involves Code Activity files or the List route. The List route passed the isolated check. Both are the user's in-progress work (auth autofill and Morning Brief). **Residual uncertainty:** the isolation test cannot rule out an interaction between files, and "the two extra failures" were matched by test name and count, not by a run before G02.
- A process note: the `court-mobile-morning-brief` file does not exit by itself on the dirty tree (it hung until killed), which is probably why my first full run stalled. That hang was not investigated further.

**G01 gaps (three), addressed in `contract-delta.md` v4.1.** I took the three as the open decisions that could be settled without an external action: (1) E1 disclosure, (2) `repository_full_name` storage, (3) local cookie behavior. They are proposals for review, not approvals. Hosting, push backfill and App registration need the operator or a provider and stay open. **If you meant a different three, say so.**
- Gap 3 evidence: Chromium 153 accepted and returned a `Secure; HttpOnly; SameSite=Lax` cookie on `http://localhost`. Firefox and WebKit could not launch. Real GitHub redirect untested.

**Re-review:** `rereview-request.md` prepared. It has not been sent to anyone; no reviewer response exists.

**G02 in the real-login browser: NOT VERIFIED.** The Claude in Chrome tools were not available in this session (a tool search found none). No substitute check was run.

### Correction round (7 October 2026): the three gaps as the product owner defined them

The product owner clarified the three gaps and said the earlier v4.1 text left them unresolved. Corrected in `contract-delta.md` v4.2 (with a pointer added to `contracts.md`) and `rereview-request.md`:
1. Cookie path covers callback, repository selection and final connect (one table, one path `/api/code-activity`, lifetime corrected to outlive the proof). Earlier, "callback family" was undefined and the 10 minute lifetime was shorter than the 15 minute proof.
2. Per-table grants and RLS replace the blanket authenticated `SELECT` wording. Private tables and proof access are defined separately.
3. Exact environment variable names listed (`CODE_ACTIVITY_GITHUB_APP_ID` and eight others). Names only; no values, no config files changed.

Still draft and unreviewed. Re-review is requested, not held. G03 not started. The unrelated failing tests were left untouched. The two-extra-failure explanations rest on single-file HEAD experiments and do not establish a complete pre-change baseline. **Browser verification of G02 is still outstanding.**

### Review round 3 (7 October 2026): two contract inconsistencies, G03 draft

Reviewer outcome on v4.2: changes requested (two inconsistencies). Corrected in `contract-delta.md` v4.3:
1. Final connect now has a complete signature including `p_nonce_hash`, a mandatory comparison, and the reasons a client-supplied hash is acceptable (and the residual logging risk).
2. Server reads are defined as server-only functions with no direct `service_role` table privilege. RLS bypass is stated not to replace SQL privileges.

**G03 drafted for review, not completed.** `g03/DRAFT_code_activity_connection_schema.sql` and `g03/g03-security.test.mjs` (15 tests, all pass in PGlite; 8 deliberate breakages all caught). Written only in the planning folder: nothing in `supabase/migrations/`, nothing applied, no real database touched, no commit. G03 stays open: review, a disposable-database run on real Supabase conditions, and explicit approval remain. **I read the reviewer's instruction as permission to draft the schema; the earlier "do not start G03" instruction was the product owner's.** The owner should confirm that drafting was intended.

Unchanged: unrelated test failures untouched; G02 browser verification still outstanding (Chrome tools unavailable); View Only consent decision pending with the product owner; hosting, App setup and the cookie checks in Firefox and Safari remain for G05 or the operator.

### G04 to G06 build (7 October 2026)

Executable connection code added; schema still unapplied; nothing committed. Server: `src/features/code-activity/server/` (config, crypto/PKCE, GitHub client, service, HTTP helpers) and five routes under `src/routes/api/code-activity/`. Client: `live/` (API, parsers, hook), `CodeActivityRoot.tsx` now drives the real flow. G03 draft gained `code_activity_is_enabled` (16 PGlite tests pass). Tests: `code-activity-server.test.mjs` (26), `code-activity-live.test.mjs` (6), 109 Code Activity tests in total; full suite 27 failures, identical set to the previous run. `operator-setup-guide.md` written. Live GitHub flow not exercised: blocked on GitHub App and an approved, applied schema.

### Review fixes and G07 to G09 build (7 October 2026)

Fixed: bytea hashes are now `\x` hex strings at the RPC boundary (tested against the request the Supabase client actually sends); repository selection pages with "Load more"; the callback and connect flows have overall deadlines (25 s and 15 s). Built: G07 feed storage draft (`g07/`, 14 PGlite tests, 6 mutations caught), manual Refresh, feed, detail (files, patches, checks), live UI with click-open overlay. Routes: feed, refresh, changes/detail (E8 and E9 combined into one read). Nothing applied, committed or deployed. Full suite: the same 27 known failures.

### G10 to G16 build (7 October 2026)

Built without commits, pushes, external configuration, migrations or deployment: webhook intake (G11), durable processing, recovery, budget and reconcile (G12), UI containment and acceptance tests (G13), optional Coey with consent and rate limits (G14), atomic idempotent Thing creation (G15), runbook and live acceptance checklist (G10 manual part, G16). SQL drafts: g11, g12, g14, g15 (unapplied). Production stays dark: the UI gate is still development-only and every database flag defaults to off. See `runbook.md` for evidence and, equally, for what was never run.

### Consolidated-review fix batch (7 October 2026)

Five batches fixed with regression tests: consent enforcement bound to the connection generation and enforced in confirmation SQL; worker leases claimed per delivery and required on every data write; structured idempotency hashing with separate replay and creation paths; every provider request metered, locked rate-limit admission, UTF-8 byte truncation; complete repository-removal handling with a fail-closed overflow. SQL drafts g03, g11, g12, g14, g15 changed (still unapplied). See `runbook.md` section 12 for evidence and the remaining unproven items (notably real concurrency).

### Second review round (7 October 2026)

Fixed and covered by regression tests: AI checks and provider reads bound to connection id plus generation (a replacement connection restarts at generation 1); persistent `needs_reverification` after an overflow (no reads, no confirmations, no unsuspend revival, owner reconnects to clear); jsdom UI waits made load-tolerant. SQL drafts g03, g12, g14, g15 and g07 changed, still unapplied. See `runbook.md` section 13.

### Connector completion plan C01 to C06 (7 October 2026)

Reported in three separate states, as the plan requires.

**Code built.** C02 done: the connector card separates "unavailable for this List", "operator setup unfinished", loading and network error; the owner always sees Connect GitHub (disabled with the reason attached unless ready); members get no action; "Opening GitHub…" blocks a double click. C03 tooling done: `scripts/code-activity-bootstrap.mjs` (manifest-flow App registration, writes `.env.local`, prints no secret; its guards were smoke-tested, the GitHub exchange was not) and `scripts/code-activity-config-check.mjs`. C04 preparation done: `migration-candidates/` (four read-only migrations, outside `supabase/migrations/`), and the connector passes its integration suite against only those four. 203 feature tests pass serially; the full suite has the same 27 known failures; SQL suites and both integration modes pass.

**Test backend configured: no.** All eight `CODE_ACTIVITY_*` connection variables are absent from `.env.local`; no GitHub App exists; no test database has the candidate migrations; no migration was applied; the running server answers 503 on the callback (no settings loaded).

**Live flow passed: no, not run.** C05 needs the App, an approved test database and a person in a browser. Run sheet: `runbook.md` section 14. The connector is NOT complete until that run is recorded as passed.

Unresolved external gates: operator creates the App (one command, one confirmation on GitHub); approval of an exact test database target and of the four candidate migrations; a two-connection concurrency drill; Firefox and Safari cookie checks; hosting and scheduler; the two product decisions (View Only consent boolean, disconnect while the feature is off).
