# Magic Box v2 Final UAT Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining review blockers on `codex/magic-box-v2` after `bb1c45b`, then safely enable and verify Magic Box v2 in UAT.

**Architecture:** Keep the existing deterministic parser, Toss guard, explicit Polish action, voice lifecycle, and Storage API saga. Connect production AI requests to the database limiter, make attachment recovery fully idempotent, gate attachments until their migration exists, and replace fixture-only browser tests with tests against the real application.

**Tech Stack:** React 19, TypeScript, TanStack Start, Supabase/Postgres/Private Storage, Sarvam server APIs, Node test runner, Playwright, Netlify.

**Spec:**

- `/Users/nagasainathreddy/Downloads/Katalist_Magic_Box_v2_Complete_BRD_and_Behaviour_Contract.docx`
- `/Users/nagasainathreddy/Downloads/Katalist_Magic_Box_v2_Exact_Implementation_Plan.docx`
- `docs/superpowers/plans/2026-08-24-magic-box-v2-review-remediation-implementation-plan.md`

## Global Constraints

- Start from `origin/codex/magic-box-v2` at `bb1c45b` or its forward descendant.
- Use forward commits only; no rebase, amend, squash, force-push, or history rewrite.
- Do not apply SQL while implementing Tasks 1-4.
- Do not change `create_thing`, Thing lifecycle defaults, deterministic parser authority, or manual override precedence.
- Do not expose Sarvam or Supabase privileged keys to browser code.
- Keep Coey AI disabled by default in UAT.
- Normal `npm run build` must remain migration-free.

---

## Task 1: Connect Real AI Budgets and Abort Timed-Out Provider Calls

**Files:**

- Modify: `src/features/ai/magic-box-api.server.ts`
- Modify: `src/features/ai/ai-rate-limit.server.ts`
- Modify: `src/features/ai/sarvam-client.server.ts`
- Modify: `scripts/magic-box-ai-budget.test.mjs`

**Required behavior:**

- [ ] Import `enforceAiBudget` into `magic-box-api.server.ts`.
- [ ] Replace `const defaultBudget = createMemoryAiBudget()` with the database-aware `enforceAiBudget` as the production default.
- [ ] Preserve `options.enforceBudget` injection for unit tests.
- [ ] When the SQL function is unavailable, allow the existing in-process fallback temporarily; after migration, every production request must call `consume_magic_box_ai_budget`.
- [ ] Replace timeout-only `Promise.race` with an `AbortController`; pass its `signal` to Sarvam `fetch` and call `abort()` at 8 seconds for chat and 35 seconds for STT.
- [ ] Keep correction user-initiated and Coey AI default-off.

**Tests:**

- [ ] Add a failing test proving the default handler invokes the database-aware budget function.
- [ ] Add a failing test proving timeout aborts the provider fetch signal.
- [ ] Confirm rate-limited, disabled, malformed, and missing-key paths make zero Sarvam calls.

```bash
npm test -- --test-name-pattern='AI budget|Sarvam|timeout|Coey'
npm run typecheck
git add src/features/ai scripts/magic-box-ai-budget.test.mjs
git commit -m "fix: enforce persistent magic box AI budgets"
```

**Done when:** Netlify cold starts cannot reset the applied database budget and provider requests are actually cancelled on timeout.

## Task 2: Make Attachment Recovery and Completion Tamper-Safe

**Files:**

- Modify: `supabase/migrations/20260824122123_magic_box_attachment_saga.sql`
- Modify: `src/features/attachments/attachment-api.server.ts`
- Modify: `src/features/court/magic-box/useMagicBoxAttachments.ts`
- Modify: `src/features/court/magic-box/useMagicBoxController.ts`
- Regenerate: `src/integrations/supabase/types.ts`
- Modify: `scripts/magic-box-attachments.test.mjs`

Because the migration is unapplied, correct it in place before UAT.

**Required behavior:**

- [ ] Change pending-abandonment to identify a reservation by authenticated actor plus `thingId`, `clientId`, and exact `stagingKey`; the browser must not require an `attachmentId` it never received.
- [ ] The Remove endpoint must delete the staging object through Storage API and delete the matching pending row.
- [ ] Removal must be idempotent: a repeated Remove returns success when both object and pending row are already absent.
- [ ] `complete_thing_attachment` must verify that `storage.objects` contains the exact final key in bucket `thing-attachments` before setting `status='ready'`.
- [ ] A direct authenticated RPC call before Storage move must fail and leave the row pending.
- [ ] If finalization throws unexpectedly, retain every unresolved attachment; never use a synthetic `unknown` client ID that can leave the controller stuck.
- [ ] After the final Retry/Remove, clear recovery, announce success, invalidate Thing/Court/List queries, and never call `create_thing` again.

**Tests:**

- [ ] Reproduce: reserve succeeds, move fails, client has no attachment ID, Remove clears object and row.
- [ ] Reproduce: direct completion without destination object is rejected.
- [ ] Test repeated Retry and repeated Remove.
- [ ] Test unexpected finalizer exception retains actionable Retry/Remove entries.
- [ ] Test five-file capacity is restored immediately after Remove.

```bash
npm test -- --test-name-pattern='attachment|recovery|MB-014|MB-015|MB-016'
npm run typecheck
git add supabase/migrations/20260824122123_magic_box_attachment_saga.sql src/features/attachments src/features/court/magic-box src/integrations/supabase scripts/magic-box-attachments.test.mjs
git commit -m "fix: make attachment recovery fully idempotent"
```

**Done when:** failed attachment recovery cannot leak a pending row, corrupt a ready row, duplicate a Thing, or leave the composer stuck.

## Task 3: Wire Attachment Feature Flags and Stale Cleanup

**Files:**

- Modify: `.env.example`
- Modify: `src/features/court/magic-box/MagicBoxComposer.tsx`
- Modify: `src/features/attachments/attachment-api.server.ts`
- Modify: `src/routes/api/magic-box/attachments/finalize.ts`
- Modify: `src/routes/api/magic-box/attachments/remove.ts`
- Create: `src/routes/api/cron/magic-box-attachment-cleanup.ts`
- Create: `netlify/functions/magic-box-attachment-cleanup.mts`
- Modify: `netlify.toml`
- Modify: `scripts/magic-box-attachments.test.mjs`

**Required behavior:**

- [ ] Use `VITE_MAGIC_BOX_ATTACHMENTS_ENABLED=false` as the deliberately public UI flag.
- [ ] Use `MAGIC_BOX_ATTACHMENTS_ENABLED=false` as the server enforcement flag.
- [ ] Hide the attachment button and skip Thing Detail attachment queries unless the public flag is true.
- [ ] Return 404 without Storage/database work when the server flag is false.
- [ ] Set both flags to false before migration and true only after both UAT migrations succeed.
- [ ] Wire `cleanupStalePendingAttachments` to an authenticated scheduled job that runs hourly and removes pending staging objects older than 24 hours.
- [ ] Protect the cleanup job with `MAGIC_BOX_CLEANUP_SECRET`; do not log user IDs, filenames, keys, or file contents.
- [ ] A failed cleanup item must not stop later items; return only aggregate processed/removed/failed counts.

The Netlify scheduled function must call the protected application route and expose no user data:

```ts
export default async function () {
  const baseUrl = process.env.URL;
  const secret = process.env.MAGIC_BOX_CLEANUP_SECRET;
  if (!baseUrl || !secret) return new Response("disabled", { status: 503 });
  return fetch(`${baseUrl}/api/cron/magic-box-attachment-cleanup`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  });
}

export const config = { schedule: "0 * * * *" };
```

**Tests:**

- [ ] Flags false: no attachment button, no attachment API work.
- [ ] Flags true: normal staging/finalization path available.
- [ ] Cleanup authentication failure: zero database/Storage calls.
- [ ] One cleanup failure does not stop remaining stale rows.

```bash
npm test -- --test-name-pattern='attachment flag|cleanup'
npm run typecheck
git add .env.example netlify.toml src/features scripts/magic-box-attachments.test.mjs
git commit -m "fix: gate and clean up magic box attachments"
```

**Done when:** attachments are invisible and unreachable before migration/after rollback, and abandoned staging data has an operational cleanup path.

## Task 4: Replace Fixture Playwright Tests with Real-App Tests

**Files:**

- Modify: `playwright.config.ts`
- Rewrite: `tests/e2e/magic-box.spec.ts`
- Modify demo/test fixtures only if deterministic people or RPC capture is required

**Required behavior:**

- [ ] Configure Playwright `webServer` to start the actual Katalist app in safe demo/test mode.
- [ ] Remove the hand-written `FIXTURE` and every `page.setContent()` call.
- [ ] Navigate to the actual Court/List composer.
- [ ] MB-018 must emulate reduced motion and inspect the real Toss confirmation.
- [ ] MB-019 must use the real input, mention popup, arrows, Tab/Enter/Escape, chips, Polish, mic controls, attachments, and Toss button.
- [ ] Assert Enter with the real mention menu open creates zero Things.
- [ ] Assert rapid Enter/click against the real controller creates exactly one Thing.
- [ ] Exercise real recovery UI with a deterministic failed-finalize test hook and confirm Retry/Remove without a second Thing.

```bash
npx playwright test tests/e2e/magic-box.spec.ts --project=chromium
npm test
npm run typecheck
npm run lint
npm run build
git diff --check
```

Expected: real-app Playwright tests pass; lint has no new warnings; build performs no migration; `git diff --check` is clean.

```bash
git add playwright.config.ts tests/e2e/magic-box.spec.ts
git commit -m "test: verify magic box against the real application"
```

**Done when:** MB-018/MB-019 evidence comes from Katalist components and controller behavior, not a duplicate HTML/JavaScript fixture.

## Task 5: Review and Push the Final Forward Fixes

- [ ] Confirm the branch contains only forward commits after `bb1c45b`.
- [ ] Confirm the unsafe `20260824114500_thing_attachments.sql` remains deleted.
- [ ] Scan tracked files and built client assets for privileged values.
- [ ] Run the complete verification gate from Task 4.
- [ ] Push normally to `origin/codex/magic-box-v2`.
- [ ] Record the final SHA. Do not apply SQL in this task.

## Task 6: Apply Migrations to UAT Only

Apply in this order after code review:

1. `supabase/migrations/20260824122123_magic_box_attachment_saga.sql`
2. `supabase/migrations/20260824124500_magic_box_ai_rate_limits.sql`

- [ ] Back up/record current UAT migration state.
- [ ] Apply each migration once using the explicit database migration command, never Netlify build.
- [ ] Run Supabase security/performance advisors.
- [ ] Confirm `thing_attachments`, bucket limits, RLS policies, RPC grants, and AI budget function exist.
- [ ] Verify a stranger cannot list rows, download bytes, reserve, complete, abandon, or mint a signed URL.
- [ ] Verify owner, assignee, and authorized List viewers can list/download ready files.
- [ ] Keep production untouched.

## Task 7: Configure Netlify UAT and Run the Final Smoke Test

**Server-only variables:**

```text
SARVAM_API_KEY
SUPABASE_SERVICE_ROLE_KEY
KATALIST_UAT_AUTH_PEPPER
MAGIC_BOX_AI_COEY_ENABLED=false
MAGIC_BOX_AI_CORRECTION_ENABLED=true
MAGIC_BOX_AI_STT_ENABLED=true
MAGIC_BOX_ATTACHMENTS_ENABLED=true
MAGIC_BOX_CLEANUP_SECRET
```

**Public non-secret variables:**

```text
VITE_KATALIST_ENV=uat
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_MAGIC_BOX_ATTACHMENTS_ENABLED=true
```

- [ ] Deploy the exact final SHA.
- [ ] Confirm Netlify build log contains no migration command.
- [ ] Confirm static assets contain no Sarvam or service-role key.
- [ ] Login with fixed OTP `111111`; verify new and returning profile flows.
- [ ] Verify plain Toss, mention selection, manual chips, `3/5`, List context, and double-Toss.
- [ ] Verify normal typing creates zero correction requests; one Polish click creates one.
- [ ] Verify Coey default-off creates zero AI chat request on Toss.
- [ ] Verify Stop creates one STT request; Cancel creates zero.
- [ ] Verify five attachments, oversize/sixth rejection, failure recovery, authorized download, and stranger denial.
- [ ] Verify notifications, Catch, Reassign/history, Waiting for Catch, Not Started, and null Pace remain unchanged.

## Final UAT-Ready Gate

Magic Box v2 is completely UAT-ready only when:

- [ ] Tasks 1-5 are pushed in normal forward commits.
- [ ] Both migrations are applied to UAT and nowhere else.
- [ ] Database AI limiting is observed in UAT, not merely in-process.
- [ ] Provider timeout aborts the actual request.
- [ ] Attachment recovery Remove clears Storage and pending metadata.
- [ ] Ready status cannot exist without the final Storage object.
- [ ] Attachment flags work before enablement and during rollback.
- [ ] Hourly stale cleanup is authenticated and operational.
- [ ] Real Katalist Playwright tests pass.
- [ ] Full automated suite, typecheck, lint, build, and secret scan pass.
- [ ] Manual multi-user UAT authorization and regression smoke tests pass.
