# Katalist D–H Final Handoff (Z01)

Reconciles execution of `docs/superpowers/plans/KATALIST_D_TO_H_IMPLEMENTATION_EXECUTION_PLAN.md` against
`docs/superpowers/plans/KATALIST_D_TO_H_PROGRESS.md`. Read that ledger for the full per-item detail;
this document is the reconciled summary and the honest remaining-gap list.

## 1. Baseline and end state

- Branch: `katalist-plan/batch-a-baseline` (no new branch created, per standing instruction).
- Baseline SHA (start of D–H execution, i.e. end of Batch C): `0bbe479ec2557699314d1d7403d5412755ff2166`.
  Baseline verification at that point: 339/339 tests, 0 typecheck errors, 0 lint errors/81 warnings, clean build.
- End SHA (this handoff): `34716d45142686b5692aa08ccc916611c0025cca`.
- End verification (re-run fresh immediately before writing this document):
  - `npx tsc --noEmit`: 0 errors.
  - `npm test`: **447/447** passing.
  - `npm run lint`: 0 errors, **80 warnings** (one fewer than baseline — two real dead-code lint warnings
    were resolved as a side effect of G02/G03's fixes making previously-unused state actually used; not
    suppressed).
  - `npm run build:app`: clean, ~0.6s.
  - `npx playwright test` (new in H04): **15/15** passing across all 5 preview viewport projects.
- Working tree at handoff: clean except pre-existing untracked, non-project paths (`.agents/`, `output/`),
  which predate this session and were never touched.
- 24 commits landed across D01–H04, each with its own focused diff, commit message, and (where code
  changed) a matching test. Full list: `git log --oneline 0bbe479..34716d4`.

## 2. Completed visible behavior, by page/surface

**Court (`/`, `CourtDesktop`)**
- "With Others" sidebar now has a real accommodation for the 1024–1279px range (a named toggle button,
  `xl:` always-visible) instead of silently having no layout for that width band.
- Sort now has a capability-gated button on the Thing stack card, matching the pattern Catch already had
  (previously swipe-right/Thing-detail-only).
- Morning Brief (renamed from "Catch Up" in visible text only) is now owned end-to-end by `useMorningBrief()`:
  schedule/eligibility model, presentation receipts (adapter prepared, RPC not yet deployed), and
  Court's own open/dismiss/reopen wiring, including dismissal when a Thing is opened from inside the review.
- Multi-assignee Toss (MagicBox) no longer fails an entire batch when only one assignee's create fails;
  retry now only re-attempts the assignee(s) that actually failed.

**Thing detail (shared across Court modal/focus view, Bucket detail, List detail, Nudges)**
- One genuinely shared, byte-identical block (the view-only banner) extracted into its own component.
- The two `ThingDetailContent` variants (court vs. default) were read in full and found to be *substantively
  different UIs*, not just differently-styled versions of the same one — extracting the other named shared
  components would require changing one variant's real behavior to match the other. Decision made by the
  user: leave both as-is; revisit visual unification once D01's tokens actually roll out to pages (a G-phase
  concern, not attempted here).
- Cross-surface capability logic (`getThingCapabilities`) confirmed already unified — every surface already
  calls the same pure function; there was no separate logic to consolidate.
- Escape-key dismissal in `CourtDetailModal`/`CourtFocusView` now correctly defers to a nested Radix layer
  that already consumed the keystroke (matching `InlineThingDetailWorkspace`'s pre-existing correct pattern).

**Lists (`/lists`, `/lists/$listId`)**
- A real Active/All/Completed filter control now exists and is wired to logic that already existed but had
  no UI path to reach it (a pre-existing dead-code lint warning confirmed this before the fix).
- List chat no longer yanks a reading user back to the bottom on every new message; shows a "New messages"
  pill instead when the user has scrolled away.
- Calls: an explicit `idle/joining/connected/reconnecting/ended/error` lifecycle now exists (previously only
  `joined`/`connecting` booleans), a real leave-race media/channel leak is fixed, and an active call now
  registers a D03 interaction blocker so Morning Brief cannot auto-open over it.

**Buckets (`/buckets`, `/buckets/$bucketId`)**
- Progress (`X of Y done`) no longer double-counts a Thing that is both a direct bucket item and a member of
  a referenced List.
- Bucket detail keeps `CourtDetailModal` for Thing detail (decision made by the user, after confirming the
  narrow-column `InlineThingDetailWorkspace` cannot fit Bucket's full data table without dropping columns).

**Team/Hub (`/team`, `/team/$conversationId`)**
- A background-tab conversation no longer marks itself read for content the user never actually saw
  (gated on `document.visibilityState`).

**Nudges (`/nudges`)**
- "All lists" (previously had no `onClick` at all), "Nudge settings" (also inert, replaced with a real
  "How nudges work" explainer sourced from the actual escalation rules), the search placeholder (previously
  described matching that never happened), and "See all" (previously a plain, non-interactive `<span>`) are
  all now real, working controls.

**Me / Notifications (`/me`)**
- Push permission is now only ever requested from an explicit "Enable" click, never an unsolicited prompt
  on every sign-in. The panel shows the real permission state instead of a static, false claim.
- "This week" (a label implying a calendar-week reset) corrected to "Last 7 days" (what the stat actually is).
- A synthetic placeholder email for phone-based sign-in is no longer shown as if it were a real contact email.

**Onboarding / Auth (`/onboarding`, `/auth`, `/welcome`)**
- "Connect" now actually opens Contacts (or routes to `/auth` first if signed out) instead of doing exactly
  what "Maybe Later" already did.
- The onboarding "product preview" is now a real illustrative card built from the app's own badge
  components, explicitly labeled as illustrative — not a blank placeholder box.

**Files / attachments**
- Thing attachments (Magic Box, comment composer) now enforce the same 50MB cap Hub Files and List chat
  attachments already had; one call site that silently swallowed upload errors now surfaces them.

**Bridge (`/bridge/$token`, public API)**
- Read in full given this is the app's only public, unauthenticated-token surface. One real client-side
  defect fixed: the guest page offered a "not started" status button that the server would always reject
  once work had moved past that state (forward-only enforcement); it is now hidden once no longer valid.
  Everything else in the flow — hashed-token-only lookups, RLS with no anon/authenticated policy, proactive
  grant revocation from every code path that would make a grant stale, defensive re-checks of
  assignment/actor identity on every guest RPC, bounded input validation, one fixed neutral error message
  per failure path, `HttpOnly/Secure/SameSite=Lax` cookie — was verified already correct, not changed.

**Cross-cutting**
- One unified reduced-motion contract (OS preference OR app setting) now drives Court's animations and the
  Me settings toggle, which was previously inert.
- Session drafts (identity/epoch-scoped in-memory store) and an interaction-blocker registry now exist as
  shared primitives, consumed by Morning Brief (F04) and Calls (H02); not yet consumed by every composer
  named in the plan (MagicBox/chat/notes drafts) — named as a remaining gap below.
- A real, previously-nonexistent unauthenticated-401 defect (`useProfileDirectoryQuery` firing on every
  anonymous page view) was found and fixed by H04's own new Playwright smoke spec — direct evidence the new
  E2E scaffolding does real work, not just exists.

## 3. Actual check commands and results

```
npx tsc --noEmit -p tsconfig.json      # 0 errors
npm test                                # 447/447 passing
npm run lint                            # 0 errors, 80 warnings (baseline was 81)
npm run build:app                       # clean, ~0.6s
npx playwright test                     # 15/15 passing (5 preview-* projects)
```

Unresolved warnings (80, unchanged in kind from baseline apart from the two resolved above): all
pre-existing `@typescript-eslint/no-unused-vars` warnings on unused imports/locals unrelated to this
session's work; none newly introduced.

## 4. New schema/RPC artifacts, rollout order, feature flags

- `supabase/migrations/20260923100000_morning_brief_receipts.sql` — **prepared, NOT applied.**
  Adds `morning_brief_presentations` (owner-only RLS, no direct write policy) and two `SECURITY DEFINER`
  RPCs, `claim_morning_brief`/`dismiss_morning_brief`. Identity from `auth.uid()`; local date computed
  server-side from real `now()`; `profiles.timezone` wins unless still at its column default, in which case
  a server-validated client-supplied IANA zone is used instead (never the client's raw date).
  - **Rollout order:** apply this migration, then verify the RPCs live (a real claim, a real duplicate-claim
    rejection, cross-profile RLS denial) before flipping the flag below.
  - **Feature flag:** `VITE_KATALIST_MORNING_BRIEF_AUTO_OPEN` (added to `.env.example`), **off by default.**
    Gates only Morning Brief's automatic daily opening; manual reopening is unaffected either way. Do not
    enable before this migration is deployed and live-verified — the client-side preview adapter it falls
    back to has different (localStorage-only, single-device) semantics.
- No other new database objects were introduced. Every other D–H fix was client-side only or used
  already-existing RPCs/tables as-is.

## 5. Local browser evidence

- `npx playwright test` was actually run against the real local dev server (`npm run dev`, port 8080)
  pointed at whatever Supabase project `.env.local` already configures — not a mock. 15/15 passing across
  desktop (1440×900), mobile (390×844), tablet portrait (768×1024), tablet landscape (1024×768), and full HD
  (1920×1080).
- Every spec run this way was deliberately read-only/no-side-effect (page loads, static content assertions,
  a malformed Bridge token's safe failure state) — safe to run against a real, shared Supabase project with
  no risk of mutating real data. This is also why the golden-path authenticated flow
  (Capture→Catch→pace→comment/file→eligible Nudge→Sorted) named in H04 was **not** attempted here: it
  requires a real sign-in and would create real data in the only Supabase project this session has
  credentials for.
- Environment: macOS (Darwin 25.5.0), Node v22.19.0, Chromium via Playwright 1.62 (`@playwright/test` newly
  added as a devDependency). No other browser engine (WebKit/Firefox) or real mobile device was exercised.
- Limits: no live database fixture, no staging deployment, no second real test account, and no controlled
  performance/network-throttling environment were available in this session — every check that needs one of
  those is named as remaining below rather than claimed complete.

## 6. Exact live checks remaining, and what they need

All of the following are genuinely **not done** — not documented-as-done, not silently assumed:

1. **Deploy and live-verify `20260923100000_morning_brief_receipts.sql`** — needs a Supabase migration
   push with write access to the target project, then a real claim/duplicate-claim/RLS-denial check before
   `VITE_KATALIST_MORNING_BRIEF_AUTO_OPEN` can safely go on anywhere.
2. **Run `tests/run-bridge-e2e.ts`** — this script already implements almost the entire H03 RPC-level test
   matrix (valid/anonymous/expired/revoked/malformed/wrong-session/unrelated-Thing-id/completed-cancelled)
   against a real service-role client and the existing `test_bridge_fixture()` RPC. It needs
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and a running server at `BRIDGE_TEST_BASE_URL`
   (default `http://localhost:8080`) — none configured in this session, so it was not run here to confirm
   it still passes against current source.
3. **H04's live checklist** — two genuine accounts switching, real RLS/revoked-membership behavior,
   duplicate daily claim across devices, actual realtime disconnect/reconnect, real media calls (mic/camera/
   screen share across two real browsers), staging migrations, old/new client compatibility. Needs a
   deployed staging environment and at least two disposable test accounts — see
   `tests/e2e/staging/README.md` for the exact env vars a `staging` Playwright project needs
   (`KATALIST_STAGING_BASE_URL`, `KATALIST_TEST_ACCOUNT_EMAIL`, `KATALIST_TEST_ACCOUNT_PASSWORD`); none are
   configured, so the `staging` project does not currently register at all.
4. **Authenticated golden-path E2E** (Capture→Catch→pace→comment/file→eligible Nudge→Sorted, keyboard-only,
   200% zoom, long names, 0/30/300 Things) — needs the same disposable test account as (3), specifically so
   it can write real data safely.
5. **Performance targets** (feedback ≤100ms, warm p75 ≤300ms, cold p75 ≤2.5s, CLS ≤0.1, 60Hz frame budget)
   and **accessibility-scanner coverage** — need a fixed reference dataset (0/30/300 Things, 0/10/100 Lists,
   1000-message history) and a controlled device/network profile this session cannot fabricate honestly;
   attempting to report numbers without that setup would be a fabricated claim, not a measurement.
6. **CI wiring for a `playwright` job** — `.github/workflows/quality.yml` was inspected, not modified. Adding
   an E2E job needs a decision about which environment it targets (preview-only vs. staging) and how
   `KATALIST_TEST_ACCOUNT_*` secrets would be provisioned in GitHub Actions — a decision this session
   should not make unilaterally.
7. **CodeReview-scale D01 token rollout** — D01's own tokens (elevation/control-density/type-scale utilities)
   were added but not yet applied page-by-page; several items across E02/G02/G03/G05 explicitly named
   "visual/G01-style-token polish" as deferred to that later pass, consistent with D01's own sequencing.
8. Smaller named-not-fixed items, each already called out in its own progress-ledger row rather than
   repeated here in full: GSAP animation *durations* not retuned to D02's exact band (E02); the
   Snooze-picker button-equivalent (E01); per-file async upload states (E04); `dueFilter`/`sortOption`'s
   own dead controls, matching G02's fixed `thingsFilter` (G02); private-collection/reference-permission
   messaging (G03); scroll-into-view-on-read beyond tab-visibility gating, `HubSidebar` populated-landing
   copy, optimistic-message identity/retry, `@mention` resolution (G04); eligibility/loading/error-state
   separation on Nudges (G05); private-phone-visibility rules, avatar-upload progress (G06); expiring
   cached signed-URL refresh-and-retry (H01); an in-UI recoverable fallback for call permission denial
   beyond the existing toast (H02); session-drafts/interaction-blocker not yet consumed by every composer
   named in the plan (D03/cross-cutting).

## 7. Unsatisfied acceptance criteria, with cause

- **D01 "shadow suppression removed, overlays migrated to elevation tokens"** — not done. Cause: deliberately
  sequenced last within D01 itself per the plan's own ordering; doing it correctly needs the page-by-page
  token adoption named in item 7 above, not a mechanical find-and-replace.
- **D02 "animation durations retuned to the 180–240ms local band"** — not done. Cause: the actual defect
  (OS-only detection, ignoring the app-level override) was fixed; retiming a hand-tuned GSAP easing curve
  without any visual QA capability in this environment was judged a higher-risk change than the value of
  matching an exact millisecond band, so only the detection/contract was unified.
- **E02 "shared ThingIdentityHeader/StatusControls/Attachments/Discussion components"** — not done. Cause: a
  real product decision, made explicitly by the user after the two variants were found to be substantively
  different UIs (not just differently styled) — extracting a shared component for any of them would require
  changing one variant's actual behavior, which this batch's own instruction forbade. Deferred to a G-phase
  visual-unification pass once D01's tokens actually roll out.
- **F02/F04 "Morning Brief receipts live and RLS-verified"** — not done. Cause: no live Postgres/staging
  access in this session; the migration is prepared and the flag defaults off specifically so nothing ships
  half-verified.
- **H03/H04 "RPC-level Bridge test matrix run and confirmed passing"** — not run this session. Cause: the
  matrix already exists as real code (`tests/run-bridge-e2e.ts`), but requires a live Supabase service-role
  key and running server this session does not have; it was not silently assumed passing.
- **H04 "live checklist, performance targets, accessibility-scanner coverage"** — not done. Cause: each
  needs a live staging deployment, a disposable test account, or a controlled performance/device profile
  this session does not have; fabricating numbers or results without that infrastructure would violate this
  project's own evidence standard, so they are named here as missing rather than estimated.

## 8. What "code completion" means here, precisely

Per the plan's own definition: every locally executable requirement above (D01–H04's client-side logic,
tests, typecheck, lint, build) is implemented, tested, and passing. Database-dependent source
(`20260923100000_morning_brief_receipts.sql`) is prepared with a compatible, additive rollout and an
off-by-default flag gating its only user-facing effect. No unresolved local correctness defect found during
this pass was knowingly left unfixed without being named in the ledger above.

**This is not release completion.** Release completion additionally requires: applying and live-verifying
the pending migration, running the existing Bridge E2E script against a real environment, executing the
live checklist and golden-path E2E against a real staging deployment with disposable test accounts, and
capturing real performance/accessibility numbers against a controlled dataset. None of that has happened in
this session, and this document does not claim it has.
