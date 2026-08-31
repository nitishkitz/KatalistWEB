# Magic Box v2 Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make commit `cfe69e7` safe and complete for UAT by fixing duplicate Toss, attachment integrity/recovery, Sarvam credit controls, voice cancellation, mention ranking, accessibility, test coverage, secrets, and deployment safety without changing the established Thing lifecycle.

**Architecture:** The local deterministic parser and reducer remain authoritative. Thing creation remains a single `create_thing` call guarded by a controller-owned submission state machine. Attachments use an authenticated, idempotent server orchestration: PostgreSQL authorizes/reserves metadata, the Supabase Storage API moves bytes, and PostgreSQL marks completion. Sarvam stays server-only, user-initiated, rate-limited, schema-validated, tightly budgeted, and permanently optional.

**Tech Stack:** React 19, TypeScript, TanStack Router/Start, TanStack Query, Supabase/Postgres/Private Storage, Zod, Node test runner, Playwright, Sonner, Netlify.

**Specs:**

- `/Users/nagasainathreddy/Downloads/Katalist_Magic_Box_v2_Complete_BRD_and_Behaviour_Contract.docx`
- `/Users/nagasainathreddy/Downloads/Katalist_Magic_Box_v2_Exact_Implementation_Plan.docx`
- `docs/superpowers/plans/2026-08-24-magic-box-v2-gap-implementation-plan.md`
- Reviewed implementation: `origin/codex/magic-box-v2` at `cfe69e741b560ee2ebcd34f8f299b13482d63c34`

## Global Constraints

- Work forward from `codex/magic-box-v2`; never rebase, amend, squash, force-push, or rewrite published Lovable history.
- Do not touch the user's dirty local `dev` checkout. Use a clean worktree for implementation.
- Do not replace `create_thing` or change Creator, Owner, Waiting for Catch, Not Started, null Personal Pace, assignment history, List UUID, or List context behavior.
- Local parsing, stable actor UUID bindings, and manual chip choices remain authoritative.
- Unresolved people block Toss. Ambiguous numeric dates show `Check date`, omit Due, and do not block Toss.
- Sarvam never selects actor IDs, List IDs, Due, Importance, context, or final payload fields.
- Never expose `SARVAM_API_KEY` or `SUPABASE_SERVICE_ROLE_KEY` through `VITE_`, client imports, logs, responses, Git, or generated static assets.
- Core Toss must work when Sarvam is disabled, unavailable, rate-limited, timed out, or out of credit.
- Attachment storage stays private; access follows `katalist_priv.can_view_thing(thing_id)`.
- Never write, rename, or delete `storage.objects` rows directly. Upload, move, and delete bytes only through the Supabase Storage API.
- Maximum attachments: 5 per Thing. Maximum size: 20 MiB per file, enforced in browser, bucket configuration, server, and database metadata validation.
- A create failure preserves the entire draft. An attachment-finalization failure preserves attachment recovery state but must never allow a second Thing creation.
- No task may apply a migration to production. Apply first to a disposable/local database, then UAT after explicit review.
- Every task ends with focused tests and a normal forward commit.

---

## Current Review Baseline

Verified at `cfe69e7`:

- `npm test`: 229/229 pass.
- `npm run typecheck`: pass.
- `npm run lint`: 0 errors and 12 existing warnings.
- `npm run build:dev`: pass.
- Sarvam key name is server-only and absent from the generated client bundle.
- The attachment migration has not been applied.

Known blockers covered by this plan:

1. SQL renames `storage.objects` metadata without moving the underlying object.
2. Sarvam correction fires after every 800 ms pause and abandoned requests continue consuming credits.
3. The Toss guard ends before attachment finalization, Coey, reset, and cache invalidation.
4. Partial attachment failures reset the draft and discard Retry/Remove state.
5. Voice Cancel can still trigger transcription.
6. One multi-file selection can exceed the five-file limit.
7. Staged files are not deleted when removed or abandoned.
8. File size is trusted from the client instead of verified from Storage metadata.
9. List and same-context ranking signals exist but are not passed to the ranker.
10. Sarvam output preservation and response schemas are not deterministically enforced.
11. Combobox/live-state accessibility and MB-018/MB-019 verification are incomplete.
12. Thing Detail has no attachment read/download UI.
13. `npm run build` also runs database migration, making ordinary Netlify builds unsafe.
14. An older `netlify.toml` contains a JWT-looking value and needs credential rotation/removal if it is privileged.

## Target File Map

### Create

- `src/features/court/magic-box/submission.ts` — pure submission state transitions and duplicate-create guard.
- `src/features/ai/ai-rate-limit.server.ts` — per-user operation budgets.
- `src/features/attachments/attachment-api.server.ts` — authenticated reserve/move/complete/delete/download orchestration.
- `src/features/attachments/queries.ts` — authorized attachment list and signed-download helpers.
- `src/features/attachments/ThingAttachments.tsx` — Thing Detail attachment UI.
- `src/routes/api/magic-box/attachments/finalize.ts` — finalize endpoint.
- `src/routes/api/magic-box/attachments/remove.ts` — staging/recovery removal endpoint.
- `src/routes/api/things/$thingId/attachments.ts` — attachment listing endpoint if direct Data API typing is unsuitable.
- `src/routes/api/things/$thingId/attachments/$attachmentId/download.ts` — authorized short-lived download redirect/response.
- `scripts/magic-box-controller.test.mjs` — orchestration and duplicate-Toss tests.
- `scripts/magic-box-voice.test.mjs` — recorder lifecycle tests.
- `scripts/magic-box-attachments.test.mjs` — client/server attachment tests with injected dependencies.
- `scripts/magic-box-ai-budget.test.mjs` — AI validation, timeout, cancellation, and rate-limit tests.
- `tests/e2e/magic-box.spec.ts` — keyboard, recovery, motion, and UI acceptance tests.
- `playwright.config.ts` — local E2E configuration.
- A new Supabase migration generated with `supabase migration new magic_box_attachment_saga`; do not invent the timestamp manually.

### Modify

- `src/features/court/magic-box/types.ts`
- `src/features/court/magic-box/reducer.ts`
- `src/features/court/magic-box/useMagicBoxController.ts`
- `src/features/court/magic-box/useMagicBoxAttachments.ts`
- `src/features/court/magic-box/AttachmentTray.tsx`
- `src/features/court/magic-box/useMagicBoxVoice.ts`
- `src/features/court/magic-box/useSarvamAssist.ts`
- `src/features/court/magic-box/MagicBoxComposer.tsx`
- `src/features/court/magic-box/MentionAutocomplete.tsx`
- `src/features/court/magic-box/history.ts`
- `src/features/ai/schemas.ts`
- `src/features/ai/sarvam-client.server.ts`
- `src/features/ai/magic-box-api.server.ts`
- `src/features/things/ThingDetailSheet.tsx`
- `src/integrations/supabase/rpcs.ts`
- `src/integrations/supabase/types.ts` using the project's normal generated-type workflow.
- `scripts/magic-box-contract.test.mjs`
- `scripts/magic-box-ranking.test.mjs`
- `package.json`
- `netlify.toml`
- `.env.example`

### Delete before migration is ever applied

- `supabase/migrations/20260824114500_thing_attachments.sql`

Because that migration is unapplied, replace it with the new generated migration instead of adding a compensating production migration.

---

## Task 0: Protect the Branch, Rotate Privileged Secrets, and Make Builds Non-Mutating

**Files:**

- Modify: `netlify.toml`
- Modify: `.env.example`
- Modify: `package.json`
- Test: `scripts/magic-box-contract.test.mjs`

**Interfaces:**

- Produces: a clean worktree at `codex/magic-box-v2`, no tracked privileged values, and a build command that never applies migrations.

- [ ] **Step 1: Create a clean implementation worktree**

```bash
git fetch origin
git worktree add ../KatalistWeb_magic_box_v2 codex/magic-box-v2
cd ../KatalistWeb_magic_box_v2
git status --short --branch
git rev-parse HEAD
```

Expected: clean status and HEAD at or descended from `cfe69e7`. If the local branch does not exist, create it from `origin/codex/magic-box-v2`; do not change `dev`.

- [ ] **Step 2: Rotate the previously exposed Supabase privileged credential**

In Supabase Dashboard, rotate any legacy `service_role` JWT that matches the JWT-looking value in `netlify.toml` or was shared in chat. Store the replacement only as Netlify's server-side `SUPABASE_SERVICE_ROLE_KEY`. Keep `SUPABASE_PUBLISHABLE_KEY` available to the browser. Do not paste either secret into the plan, commit, test fixture, terminal output, or issue.

Expected: the old service-role credential is invalid and Netlify has the replacement value.

- [ ] **Step 3: Remove literal secrets from tracked configuration**

`netlify.toml` may name environment variables but must not contain their values. `.env.example` must contain placeholders only:

```dotenv
SARVAM_API_KEY=
SARVAM_CHAT_MODEL=sarvam-105b
SARVAM_STT_MODEL=saaras:v3
MAGIC_BOX_AI_CORRECTION_ENABLED=true
MAGIC_BOX_AI_COEY_ENABLED=false
MAGIC_BOX_AI_STT_ENABLED=true
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

- [ ] **Step 4: Separate build from migration**

Set these scripts exactly:

```json
{
  "build": "vite build",
  "build:dev": "vite build --mode development",
  "db:migrate": "node scripts/migrate.mjs",
  "release:verify": "npm test && npm run typecheck && npm run lint && npm run build"
}
```

Netlify must run `npm run build`, never `npm run db:migrate`.

- [ ] **Step 5: Add and run secret/build contract assertions**

Assert that `build` does not contain `db:migrate`, no tracked file contains `VITE_SARVAM`, and client feature files never reference server keys.

```bash
npm test -- --test-name-pattern='secret|build'
npm run build
rg -n -I 'SARVAM_API_KEY|SUPABASE_SERVICE_ROLE_KEY|VITE_SARVAM' .vercel/output/static
```

Expected: tests pass and `rg` returns no matches.

- [ ] **Step 6: Commit**

```bash
git add netlify.toml .env.example package.json scripts/magic-box-contract.test.mjs
git commit -m "security: isolate magic box secrets and builds"
```

**Done when:** old privileged credentials are rotated, tracked literals are removed, static output contains no server secrets, and ordinary builds cannot mutate the database.

## Task 1: Add a Controller-Owned Toss State Machine

**Files:**

- Create: `src/features/court/magic-box/submission.ts`
- Modify: `src/features/court/magic-box/types.ts`
- Modify: `src/features/court/magic-box/reducer.ts`
- Modify: `src/features/court/magic-box/useMagicBoxController.ts`
- Create: `scripts/magic-box-controller.test.mjs`

**Interfaces:**

- Produces:

```ts
export type TossPhase =
  | "idle"
  | "creating-thing"
  | "finalizing-attachments"
  | "attachment-recovery";

export type TossSubmission = {
  phase: TossPhase;
  createdThingId: string | null;
  snapshot: MagicBoxDraft | null;
};

export function submissionBlocksCreate(state: TossSubmission): boolean;
```

- [ ] **Step 1: Write failing state-machine tests**

Test these exact transitions:

```ts
idle -> creating-thing -> finalizing-attachments -> idle
idle -> creating-thing -> idle                    // create failure
creating-thing -> creating-thing                  // second Toss ignored
finalizing-attachments -> attachment-recovery     // partial failure
attachment-recovery -> idle                       // all failed files retried or removed
```

Also test two immediate `toss()` calls against a deferred `rpcCreateThing` and assert the RPC call count is exactly one.

- [ ] **Step 2: Run the focused test and confirm failure**

```bash
node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/magic-box-controller.test.mjs
```

Expected: failure because `submission.ts` and the full-pipeline guard do not exist.

- [ ] **Step 3: Implement the minimal pure transition helpers**

Keep this logic independent of React. Reject every `BEGIN_CREATE` unless phase is `idle`. Preserve the immutable draft snapshot through attachment recovery.

- [ ] **Step 4: Wire the state machine across the entire Toss pipeline**

In `useMagicBoxController.ts`:

- Replace `mutation.isPending` as the sole guard with `submission.phase !== "idle"`.
- Set `creating-thing` synchronously before awaiting `mutateAsync`.
- Set `finalizing-attachments` before attachment work.
- Never re-run `create_thing` from `attachment-recovery`.
- Move Coey and analytics after draft reset; do not await either before unlocking the input.
- Treat Coey, analytics, animation, and query invalidation failures as non-fatal after Thing creation.
- On create failure, return to `idle` without changing draft state.
- On partial attachment failure, enter `attachment-recovery` with `createdThingId` and the original snapshot.

- [ ] **Step 5: Verify exact behavior**

```bash
npm test -- --test-name-pattern='Double Toss|controller|MB-016'
npm run typecheck
```

Expected: one Thing for rapid Enter/click combinations; a create failure retains raw text, chips, mention binding, and attachments.

- [ ] **Step 6: Commit**

```bash
git add src/features/court/magic-box/submission.ts src/features/court/magic-box/types.ts src/features/court/magic-box/reducer.ts src/features/court/magic-box/useMagicBoxController.ts scripts/magic-box-controller.test.mjs
git commit -m "fix: guard the complete magic box toss pipeline"
```

**Done when:** no point between create, attachments, notifications, reset, and cache invalidation can create a second Thing.

## Task 2: Replace the Unsafe Attachment Migration with an Idempotent Storage Saga

**Files:**

- Delete: `supabase/migrations/20260824114500_thing_attachments.sql`
- Create: migration generated by `supabase migration new magic_box_attachment_saga`
- Create: `src/features/attachments/attachment-api.server.ts`
- Create: `src/routes/api/magic-box/attachments/finalize.ts`
- Create: `src/routes/api/magic-box/attachments/remove.ts`
- Modify: `src/integrations/supabase/rpcs.ts`
- Regenerate: `src/integrations/supabase/types.ts`
- Create: `scripts/magic-box-attachments.test.mjs`

**Interfaces:**

```ts
export type FinalizeAttachmentRequest = {
  thingId: string;
  clientId: string;
  stagingKey: string;
  fileName: string;
  mimeType: string;
};

export type FinalizeAttachmentResult = {
  attachmentId: string;
  status: "ready";
  storageKey: string;
};

export function createFinalizeAttachmentHandler(deps: AttachmentApiDeps):
  (request: Request) => Promise<Response>;
```

- [ ] **Step 1: Generate, do not hand-name, the replacement migration**

```bash
supabase --version
supabase migration new magic_box_attachment_saga
```

Expected: one new timestamped migration file. Delete the unapplied unsafe migration in the same commit.

- [ ] **Step 2: Define attachment metadata and idempotency**

The migration must create `public.thing_attachments` with:

```sql
id uuid primary key default gen_random_uuid(),
thing_id uuid not null references public.things(id) on delete cascade,
uploaded_by_actor_id uuid not null references public.actors(id),
client_id uuid not null,
staging_key text not null,
storage_key text,
file_name text not null,
mime_type text not null,
byte_size bigint not null check (byte_size between 1 and 20971520),
status text not null check (status in ('pending','ready')),
created_at timestamptz not null default now(),
finalized_at timestamptz,
unique (uploaded_by_actor_id, client_id),
unique (storage_key)
```

Enable RLS. Grant authenticated users `SELECT` only. The SELECT policy must use `katalist_priv.can_view_thing(thing_id)`. Do not grant direct INSERT/UPDATE/DELETE on this table to `authenticated`.

- [ ] **Step 3: Enforce bucket limits and staging ownership**

Create/update private bucket `thing-attachments` with `file_size_limit = 20971520`. Storage policies must permit authenticated users to upload/read/update/delete only `staging/<auth.uid()>/<clientId>/<safeName>`. Ready objects under `things/<thingId>/...` are selectable only when `can_view_thing(<thingId>)` is true.

- [ ] **Step 4: Add authenticated reservation/completion functions**

Create `reserve_thing_attachment(...)` and `complete_thing_attachment(...)`. Both must:

- reject unauthenticated calls;
- resolve the actor using `katalist_priv.current_actor_id()`;
- verify `katalist_priv.can_view_thing(p_thing_id)`;
- validate staging ownership from `auth.uid()`;
- read actual object size and MIME metadata from `storage.objects` and reject missing/invalid metadata;
- enforce five total pending/ready rows per Thing;
- return the same reservation for the same `(uploaded_by_actor_id, client_id)`;
- reject an idempotency collision whose Thing, staging key, or filename differs;
- set `search_path` explicitly;
- revoke EXECUTE from `PUBLIC` and `anon`, granting only `authenticated` and `service_role`.

These functions may read Storage metadata but must never `INSERT`, `UPDATE`, or `DELETE` `storage.objects`.

- [ ] **Step 5: Write failing server saga tests using injected dependencies**

Cover:

```text
authenticated reserve -> Storage move -> complete -> 200 ready
duplicate identical request -> 200 same attachment ID
source missing + destination present -> complete pending row -> 200 ready
source present + move failure -> 503 retryable and row remains pending
unauthorized Thing -> 404/403 without admin Storage call
spoofed user prefix -> 400 without admin Storage call
sixth attachment -> 409
actual 21 MiB object with claimed 1 byte -> rejected
```

- [ ] **Step 6: Implement server-only Storage orchestration**

The finalize handler must:

1. Verify bearer session using `requireSupabaseUser`.
2. Use a user-scoped Supabase client/RPC for authorization and reservation.
3. Receive the server-generated final path `things/<thingId>/<attachmentId>/<safeName>`.
4. Use `supabaseAdmin.storage.from("thing-attachments").move(stagingKey, finalKey)`.
5. If move reports missing source, check whether the exact destination exists; if yes, continue as an idempotent retry.
6. Call `complete_thing_attachment` only after the Storage API confirms the destination.
7. Return a sanitized retryable error; never return Supabase keys or raw provider responses.

- [ ] **Step 7: Implement removal/cleanup semantics**

The removal handler must authenticate, verify reservation ownership, remove the object through Storage API, then delete the pending metadata row. Ready attachments are not removable from the composer recovery endpoint after completion; later Thing-level deletion is a separate authorized action.

- [ ] **Step 8: Verify migration locally**

```bash
supabase migration list --local
supabase db reset
supabase db advisors
npm test -- --test-name-pattern='attachment saga|storage'
```

Expected: migration applies on a disposable database, advisors contain no new security errors, tests pass, and SQL contains no write to `storage.objects`.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations src/features/attachments src/routes/api/magic-box/attachments src/integrations/supabase/rpcs.ts src/integrations/supabase/types.ts scripts/magic-box-attachments.test.mjs
git commit -m "fix: finalize attachments through Supabase Storage API"
```

**Done when:** retries are idempotent, bytes and metadata agree, no direct Storage-table mutation exists, and unauthorized users cannot reserve, move, read, or delete an attachment.

## Task 3: Complete Client Attachment Validation, Recovery, Cleanup, and Reading

**Files:**

- Modify: `src/features/court/magic-box/types.ts`
- Modify: `src/features/court/magic-box/reducer.ts`
- Modify: `src/features/court/magic-box/useMagicBoxAttachments.ts`
- Modify: `src/features/court/magic-box/useMagicBoxController.ts`
- Modify: `src/features/court/magic-box/AttachmentTray.tsx`
- Create: `src/features/attachments/queries.ts`
- Create: `src/features/attachments/ThingAttachments.tsx`
- Modify: `src/features/things/ThingDetailSheet.tsx`
- Test: `scripts/magic-box-attachments.test.mjs`

**Interfaces:**

```ts
export type DraftAttachmentStatus =
  | "uploading"
  | "ready"
  | "finalizing"
  | "recovery-failed"
  | "failed";

export function validateAttachmentBatch(
  files: readonly File[],
  existingCount: number,
): { accepted: File[]; rejected: Array<{ file: File; reason: string }> };
```

- [ ] **Step 1: Write failing batch-limit tests**

Test 0 existing + 6 selected accepts exactly 5; 4 existing + 3 selected accepts exactly 1; any file above 20 MiB is rejected; accepted order matches user selection.

- [ ] **Step 2: Implement batch validation before any upload begins**

Use a local `remaining = 5 - existingCount`; do not call single-file validation repeatedly with a stale count. Display one clear rejection message per rejected file without uploading it.

- [ ] **Step 3: Delete staged bytes on Remove and unmount abandonment**

Replace reducer-only removal with an async controller method. For a staged file, call the removal endpoint/Storage remove first, then remove UI state. On route unmount, attempt best-effort cleanup only for files that have not been attached to a created Thing. Never delete ready Thing attachments from cleanup.

- [ ] **Step 4: Preserve recovery state after partial finalization**

After Thing creation:

- mark each file `finalizing`;
- mark successful files complete and remove them from recovery UI;
- mark failed files `recovery-failed` and retain their `clientId`, `file`, `stagingKey`, error, and `createdThingId`;
- disable Toss while recovery exists;
- label the state `Thing created. Retry or remove the remaining attachment.`;
- Retry calls finalize with the existing Thing ID and never calls `create_thing`;
- Remove abandons only that attachment;
- reset the composer when no recovery files remain.

- [ ] **Step 5: Add authorized Thing Detail reading**

`ThingAttachments.tsx` must query only `status = 'ready'` rows for the selected Thing. Clicking a file requests a 60-second signed URL from the authenticated server endpoint. Show filename, formatted size, MIME category, and upload time. Unauthorized, expired, shredded, or inaccessible Things return no metadata and no URL.

- [ ] **Step 6: Add retention cleanup**

Document and implement a scheduled server cleanup for staging objects/pending rows older than 24 hours. Cleanup must use the Storage API for bytes, delete only the authenticated staging prefix pattern, and record counts without logging filenames or user IDs.

- [ ] **Step 7: Run focused tests**

```bash
npm test -- --test-name-pattern='attachment|MB-014|MB-015'
npm run typecheck
```

- [ ] **Step 8: Commit**

```bash
git add src/features/court/magic-box src/features/attachments src/features/things/ThingDetailSheet.tsx scripts/magic-box-attachments.test.mjs
git commit -m "feat: add recoverable private thing attachments"
```

**Done when:** the five-file rule cannot be bypassed, removed/abandoned staging bytes are cleaned, partial failure cannot duplicate a Thing, and authorized viewers can open ready attachments from Thing Detail.

## Task 4: Put Hard Credit, Timeout, and Validation Limits Around Sarvam

**Files:**

- Create: `src/features/ai/ai-rate-limit.server.ts`
- Modify: `src/features/ai/schemas.ts`
- Modify: `src/features/ai/sarvam-client.server.ts`
- Modify: `src/features/ai/magic-box-api.server.ts`
- Create: a migration generated with `supabase migration new magic_box_ai_rate_limits`
- Create: `scripts/magic-box-ai-budget.test.mjs`

**Interfaces:**

```ts
export type MagicBoxAiOperation = "correct" | "coey" | "transcribe";

export interface AiBudgetDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function enforceAiBudget(input: {
  userId: string;
  operation: MagicBoxAiOperation;
}): Promise<AiBudgetDecision>;
```

- [ ] **Step 1: Write failing tests for budgets and degradation**

Use injected fetch/clock/rate-limit dependencies. Test unauthorized requests make zero Sarvam calls; limit exhaustion returns 429 with `Retry-After`; timeout returns deterministic degraded output; malformed Sarvam JSON is rejected; no response or error includes the API key.

- [ ] **Step 2: Create service-role-only rate-limit storage**

Create `katalist_priv.magic_box_ai_rate_limits` and a service-role-only atomic consume function. Enforce both one-minute and one-day limits:

| Operation | Per minute | Per user/day | Trigger |
|---|---:|---:|---|
| correction | 6 | 40 | explicit user click only |
| Coey AI | 4 | 20 | feature flag; never blocks success |
| transcription | 4 | 30 | explicit recording only |

Store a one-way hash of user ID plus operation, not raw prompt/audio content. Revoke table/function access from `PUBLIC`, `anon`, and `authenticated`; server service role consumes limits only after bearer verification.

- [ ] **Step 3: Cap every provider request**

For chat requests send:

```ts
{
  model,
  messages,
  temperature: 0.1,
  max_tokens: operation === "coey" ? 48 : 160,
  reasoning_effort: null,
  response_format: { type: "json_object" }
}
```

Use an 8-second server timeout for correction/Coey and 35 seconds for STT. Reject correction input above 2,000 characters and audio above 8 MiB/30 seconds before provider calls.

- [ ] **Step 4: Validate provider responses with Zod**

Add separate provider schemas. `extractJson()` must feed `safeParse`; it must never use a TypeScript cast as validation. Invalid response means `degraded: true` and deterministic fallback/null.

- [ ] **Step 5: Enforce correction preservation deterministically**

Before returning `correctedText`, compare protected tokens from source and correction:

- every exact `@mention` token;
- every URL;
- every number/date/time token;
- every quoted substring;
- filename-like tokens with extensions.

If any protected token differs, return `correctedText: null`, `degraded: true`, and never expose the rejected output. Add tests where Sarvam changes `@Rahul`, `3/5`, `4 PM`, a URL, and `brief.pdf`.

- [ ] **Step 6: Make feature flags server-authoritative**

- `MAGIC_BOX_AI_CORRECTION_ENABLED=true`: endpoint available, still explicit-click only.
- `MAGIC_BOX_AI_COEY_ENABLED=false`: UAT uses deterministic Coey fallback and spends zero chat credits on Toss.
- `MAGIC_BOX_AI_STT_ENABLED=true`: only explicit mic recordings call STT.

Disabled operations return a normal degraded response, not a 500.

- [ ] **Step 7: Run tests and commit**

```bash
npm test -- --test-name-pattern='Sarvam|AI budget|correction|Coey|transcrib'
npm run typecheck
git add src/features/ai supabase/migrations scripts/magic-box-ai-budget.test.mjs .env.example
git commit -m "fix: enforce magic box AI credit budgets"
```

**Done when:** passive typing spends zero credits, limits are atomic, provider calls have strict token/time budgets, malformed output is harmless, and core Toss never waits for Sarvam.

## Task 5: Replace Passive Correction with an Explicit User Action

**Files:**

- Modify: `src/features/court/magic-box/useSarvamAssist.ts`
- Modify: `src/features/court/magic-box/useMagicBoxController.ts`
- Modify: `src/features/court/magic-box/MagicBoxComposer.tsx`
- Test: `scripts/magic-box-ai-budget.test.mjs`

**Interfaces:**

```ts
export type SarvamAssist = {
  requestCorrection(): Promise<void>;
  cancel(): void;
  busy: boolean;
  offered: string | null;
};
```

- [ ] **Step 1: Write failing request-count tests**

Typing, pausing, editing, opening chips, and Tossing must produce zero `/correct` calls. One `Polish text` click produces exactly one call. A second click cancels the first request before starting another. Unmount aborts the active request.

- [ ] **Step 2: Remove the debounce side effect**

Delete automatic fetch-on-text-change. Keep an `AbortController` in a ref so cleanup calls `abort()`. Capture the raw-text snapshot and ignore a response if current text no longer equals that snapshot.

- [ ] **Step 3: Add explicit UI**

Show `Polish text` only when authenticated, enabled, not recording/submitting, and trimmed text is at least eight characters. Disable it while busy. Preserve the existing `Use corrected text` and `Dismiss` choices; never auto-apply.

- [ ] **Step 4: Keep deterministic reparsing authoritative**

On acceptance, dispatch `AI_CORRECTION_ACCEPTED`, re-run the local parser, and invalidate a mention binding if its protected range changed. Ignore Sarvam hints when they conflict with manual/parser fields.

- [ ] **Step 5: Verify and commit**

```bash
npm test -- --test-name-pattern='explicit correction|MB-010|MB-011'
git add src/features/court/magic-box/useSarvamAssist.ts src/features/court/magic-box/useMagicBoxController.ts src/features/court/magic-box/MagicBoxComposer.tsx scripts/magic-box-ai-budget.test.mjs
git commit -m "fix: make magic box correction user initiated"
```

**Done when:** normal typing and Toss spend no correction credits, stale requests are aborted, and correction remains visibly optional.

## Task 6: Make Voice Stop, Cancel, Timeout, and Unmount Deterministic

**Files:**

- Modify: `src/features/court/magic-box/useMagicBoxVoice.ts`
- Modify: `src/features/court/magic-box/MagicBoxComposer.tsx`
- Create: `scripts/magic-box-voice.test.mjs`

**Interfaces:** preserve `start()`, `stop()`, `cancel()`, `state`, and `supported`.

- [ ] **Step 1: Create a fake MediaRecorder test harness**

Test Stop transcribes once; Cancel transcribes zero times even when `onstop` fires asynchronously; 30-second auto-stop transcribes once; permission denial retains draft and reports one error; unmount stops every media track and makes zero later callbacks.

- [ ] **Step 2: Implement cancellation identity**

Add `cancelledRef` and `recordingIdRef`. `start()` creates a new ID and sets cancelled false. `cancel()` sets cancelled true before `stop()`. `onstop` captures the recording ID and returns without transcription when cancelled, stale, empty, or unmounted.

- [ ] **Step 3: Prevent invalid transitions**

Ignore Start unless idle/error, ignore Stop unless recording, and make Cancel work during permission, recording, and transcription. Abort in-flight transcription with an `AbortController`.

- [ ] **Step 4: Preserve draft behavior**

Successful transcript appends text and reruns local parsing but never Tosses. Failure, Cancel, and timeout/network error retain all existing text, chips, mentions, and attachments.

- [ ] **Step 5: Verify and commit**

```bash
npm test -- --test-name-pattern='voice|MB-012|MB-013'
npm run typecheck
git add src/features/court/magic-box/useMagicBoxVoice.ts src/features/court/magic-box/MagicBoxComposer.tsx scripts/magic-box-voice.test.mjs
git commit -m "fix: make magic box voice cancellation deterministic"
```

**Done when:** Cancel and unmount can never transcribe, while Stop and the 30-second cap transcribe exactly once.

## Task 7: Wire List and Context Ranking Signals Without Changing Authority

**Files:**

- Modify: `src/features/court/magic-box/history.ts`
- Modify: `src/features/court/magic-box/useMagicBoxController.ts`
- Modify: `scripts/magic-box-ranking.test.mjs`

**Interfaces:**

```ts
export function recordPersonToss(actorId: string, context: "work" | "home"): void;
export function readPersonHistory(context: "work" | "home"): {
  recentActorIds: string[];
  frequencyByActorId: Record<string, number>;
  sameContextActorIds: Set<string>;
};
```

- [ ] **Step 1: Write failing controller-input tests**

Verify that a List member receives the existing `BOOST_LIST`, a person previously used in the current context receives `BOOST_CONTEXT`, text match still dominates all boosts, and ties remain name/UUID deterministic.

- [ ] **Step 2: Version and migrate local history safely**

Read old history without context as global recency/frequency. Write new bounded events `{ actorId, context, at }`, retaining at most 100 events and no names, emails, or phone numbers.

- [ ] **Step 3: Pass actual signals**

Use `useList(options.listId)` and pass `new Set(list?.members.flatMap(m => m.actorId ? [m.actorId] : []))` as `currentListMemberIds`. Pass history's `sameContextActorIds`. Record successful Toss with the final draft context.

- [ ] **Step 4: Verify and commit**

```bash
npm test -- --test-name-pattern='ranking|list membership|context'
git add src/features/court/magic-box/history.ts src/features/court/magic-box/useMagicBoxController.ts scripts/magic-box-ranking.test.mjs
git commit -m "fix: wire magic box mention ranking signals"
```

**Done when:** the already-defined bounded ranking boosts receive real data, while the selected actor remains an explicit stable UUID.

## Task 8: Complete Accessibility, Status Announcements, and Reduced Motion

**Files:**

- Modify: `src/features/court/magic-box/MagicBoxComposer.tsx`
- Modify: `src/features/court/magic-box/MentionAutocomplete.tsx`
- Modify: `src/features/court/magic-box/AttachmentTray.tsx`
- Modify: confirmation chip editor components
- Modify: `src/features/court/magic-box/toss-motion.ts`
- Create/Modify: `tests/e2e/magic-box.spec.ts`

- [ ] **Step 1: Write failing Playwright keyboard/accessibility checks**

Verify input has `role="combobox"`; `aria-expanded` changes; `aria-activedescendant` points to the highlighted option; Arrow keys move it; Enter/Tab select; Escape closes; Enter never Tosses with menu open; all chips, Retry, Remove, mic, Stop, Cancel, Polish, and Toss are reachable by keyboard.

- [ ] **Step 2: Wire the combobox relationship**

Use a stable composer instance ID via `useId()`. Give each listbox and option a matching unique ID. Set `aria-activedescendant` only while a real option is highlighted. Add `aria-haspopup="listbox"` and preserve `aria-autocomplete="list"`.

- [ ] **Step 3: Add one polite live region**

Announce only state changes, including:

```text
Recording started.
Recording stopped. Transcribing.
Recording cancelled.
Uploading <filename>.
<filename> uploaded.
<filename> failed. Retry or remove it.
Thing created. Retry or remove the remaining attachment.
Thing tossed.
```

Do not announce ghost text or every keystroke.

- [ ] **Step 4: Honor reduced motion**

Under `prefers-reduced-motion: reduce`, remove flight/translation and use a short non-moving opacity/border confirmation. Success feedback must remain visible and announced.

- [ ] **Step 5: Add Playwright configuration and run**

```bash
npx playwright test tests/e2e/magic-box.spec.ts --project=chromium
```

Expected: MB-018 and MB-019 pass with keyboard only and reduced-motion emulation.

- [ ] **Step 6: Commit**

```bash
git add src/features/court/magic-box tests/e2e/magic-box.spec.ts playwright.config.ts
git commit -m "fix: complete magic box accessibility feedback"
```

**Done when:** the full composer is operable and understandable without a mouse or motion, and the highlighted mention is programmatically exposed.

## Task 9: Complete the MB-001–MB-020 Acceptance Matrix

**Files:**

- Modify: `scripts/magic-box-parser.test.mjs`
- Modify: `scripts/magic-box-ranking.test.mjs`
- Modify: `scripts/magic-box-contract.test.mjs`
- Modify: `scripts/magic-box-controller.test.mjs`
- Modify: `scripts/magic-box-voice.test.mjs`
- Modify: `scripts/magic-box-attachments.test.mjs`
- Modify: `tests/e2e/magic-box.spec.ts`

- [ ] **Step 1: Map every contract case to an executable test**

| Case | Required executable evidence |
|---|---|
| MB-001 | Plain title => Self, NEXT, no Due |
| MB-002 | Ambiguous `@ra`, arrows/Tab => stable actor UUID |
| MB-003 | Enter with menu open selects and creates zero Things |
| MB-004 | Unknown person blocks until resolved/removed |
| MB-005 | `tomorrow 4 PM NOW` => local ISO, timed Due, NOW |
| MB-006 | `3/5` => Check date, null Due, Toss allowed |
| MB-007 | Manual Due overrides parser without rewriting raw text |
| MB-008 | Manual LATER overrides parser |
| MB-009 | List UUID and List context override global context |
| MB-010 | Sarvam unavailable/disabled => core Toss succeeds |
| MB-011 | Accepted correction reruns deterministic parser |
| MB-012 | Voice transcript parses and never auto-Tosses |
| MB-013 | Voice failure/cancel retains complete draft |
| MB-014 | Owner/assignee/List viewer can read; stranger cannot |
| MB-015 | Attachment failure shows Retry/Remove and no false success |
| MB-016 | rapid Enter/click creates exactly one Thing |
| MB-017 | create failure retains raw text and manual chips |
| MB-018 | reduced motion removes flight but retains feedback |
| MB-019 | complete flow works keyboard-only |
| MB-020 | existing Reassign corrects assignee and preserves history |

- [ ] **Step 2: Replace source-text assertions with behavior where practical**

Static assertions may supplement tests but cannot be the only evidence for MB-012, MB-014, MB-015, MB-016, MB-018, MB-019, or MB-020. Use injected handlers, deferred promises, database authorization tests, or Playwright.

- [ ] **Step 3: Add the lifecycle invariants**

For both Self and delegated Toss, assert Creator=current actor, Owner=current actor, `acknowledgement='waiting_for_catch'`, `work_status='not_started'`, `assignee_personal_pace IS NULL`, correct assignment history, and unchanged `create_thing` routing.

- [ ] **Step 4: Add adverse concurrency/security cases**

Test duplicate finalize requests, sixth-file race, oversize spoof, unauthorized Thing ID, mismatched staging user, stale Sarvam response, two Toss calls, query invalidation failure, analytics failure, and Coey timeout.

- [ ] **Step 5: Run the complete automated gate**

```bash
npm test
npm run typecheck
npm run lint
npm run build
npx playwright test tests/e2e/magic-box.spec.ts --project=chromium
git diff --check
```

Expected: all commands pass; lint has no new warnings; build performs no migration.

- [ ] **Step 6: Commit**

```bash
git add scripts tests playwright.config.ts
git commit -m "test: complete magic box v2 acceptance coverage"
```

**Done when:** every MB-001–MB-020 row points to a passing behavioral test or an explicitly recorded manual device/database test where automation is impossible.

## Task 10: Apply Database Changes Safely and Verify Real Supabase Authorization

**Files:** migration and generated types from Tasks 2 and 4 only.

- [ ] **Step 1: Review the exact migration diff**

Confirm there is no `UPDATE storage.objects`, no public bucket, no `TO authenticated` policy without an ownership/visibility predicate, and no `SECURITY DEFINER` function executable by `PUBLIC`.

- [ ] **Step 2: Test on a disposable/local project**

Upload five files, reject a sixth, reject 21 MiB, finalize, retry finalize, remove staging, and check Storage contains the final bytes. Delete the test Thing and verify attachment rows cascade; explicitly remove the corresponding Storage bytes through the cleanup path.

- [ ] **Step 3: Run a four-person authorization matrix in UAT**

Use separate sessions for:

1. Owner/creator — can list and download.
2. Current assignee — can list and download.
3. List member who can view the Thing — can list and download.
4. Stranger/non-member — receives no row, signed URL, or byte access.

Also confirm personally shredded/inaccessible Things cannot mint new signed URLs.

- [ ] **Step 4: Apply only to UAT after the matrix passes locally**

```bash
npm run db:migrate
```

Run this manually once with UAT environment variables. Do not place it in Netlify's build command.

- [ ] **Step 5: Run advisors and migration history checks**

```bash
supabase db advisors
supabase migration list
```

Expected: new migrations appear once and no new security/performance error remains.

- [ ] **Step 6: Record rollback behavior**

If UAT fails, disable attachment UI with `MAGIC_BOX_ATTACHMENTS_ENABLED=false`; do not delete the table/bucket during active testing. Core Toss continues without attachments while the forward fix is prepared.

**Done when:** real UAT Storage bytes, metadata, RLS, idempotent retry, and cleanup behavior match the automated model.

## Task 11: Final UAT, Netlify, and Forward-Only Handoff

**Files:** no new product files unless verification finds a defect.

- [ ] **Step 1: Set Netlify server environment**

Required server variables:

```text
KATALIST_ENV=uat
KATALIST_UAT_FIXED_OTP=111111
KATALIST_UAT_AUTH_PEPPER=<rotated long random value>
SUPABASE_URL=<project URL>
SUPABASE_PUBLISHABLE_KEY=<publishable key>
SUPABASE_SERVICE_ROLE_KEY=<rotated server-only key>
SARVAM_API_KEY=<server-only key>
MAGIC_BOX_AI_CORRECTION_ENABLED=true
MAGIC_BOX_AI_COEY_ENABLED=false
MAGIC_BOX_AI_STT_ENABLED=true
MAGIC_BOX_ATTACHMENTS_ENABLED=true
```

Only `VITE_KATALIST_ENV` or deliberately public configuration may be exposed to browser code. Never create `VITE_SARVAM_API_KEY` or `VITE_SUPABASE_SERVICE_ROLE_KEY`.

- [ ] **Step 2: Deploy a branch preview first**

Deploy the exact reviewed branch HEAD. Confirm Netlify reports the new commit SHA and the build log contains no `db:migrate` invocation.

- [ ] **Step 3: Run the UAT smoke sequence**

1. New phone + fixed OTP `111111` creates profile once.
2. Returning phone signs in without recreating profile.
3. Notifications permission/subscription path still works.
4. Plain Toss works with Sarvam flags off.
5. Mention menu, chips, ambiguous date, List context, and double-Toss behave correctly.
6. Explicit correction offers but never auto-applies.
7. Stop transcribes; Cancel does not.
8. Five attachments finalize; sixth/oversize reject; failed finalize recovers without another Thing.
9. Authorized Thing Detail downloads; stranger cannot.
10. Catch still changes Waiting for Catch; Reassign preserves history; Personal Pace remains null until Catch.

- [ ] **Step 4: Verify credit behavior**

Open the browser network panel. Type continuously and pause: zero `/correct` calls. One Polish click: one call. One Toss with Coey AI disabled: zero chat calls. One voice Stop: one STT call. Cancel: zero STT calls.

- [ ] **Step 5: Verify production-like build artifact**

```bash
npm run release:verify
rg -n -I 'SARVAM_API_KEY|SUPABASE_SERVICE_ROLE_KEY|VITE_SARVAM' .vercel/output/static
git status --short --branch
git log -5 --oneline --decorate
```

Expected: verification passes, secret scan is empty, and only intended forward commits appear.

- [ ] **Step 6: Push normally**

```bash
git push origin codex/magic-box-v2
```

Do not force-push. Record the final commit SHA in the handoff.

**Done when:** the deployed preview matches the final SHA, all smoke cases pass, no passive AI credits are consumed, notifications/auth are unchanged, and the branch is ready for a normal merge.

---

## Mandatory Release Gate

Do not declare Magic Box v2 complete unless every item below is true:

- [ ] No direct writes to `storage.objects`.
- [ ] Unsafe unapplied attachment migration removed/replaced.
- [ ] Service-role and Sarvam keys absent from Git and static assets.
- [ ] Previously exposed privileged key rotated.
- [ ] Normal build does not migrate the database.
- [ ] Two concurrent Toss attempts create one Thing.
- [ ] Attachment recovery never calls `create_thing` again.
- [ ] Five-file and 20 MiB limits enforced on every layer.
- [ ] Removed/abandoned staging files have a cleanup path.
- [ ] Authorized readers can access ready attachments; strangers cannot.
- [ ] Typing and Tossing make zero correction calls.
- [ ] Coey AI disabled by default for UAT; deterministic fallback remains.
- [ ] Sarvam rate limits, timeouts, token caps, and Zod validation pass.
- [ ] Protected tokens survive correction exactly.
- [ ] Voice Cancel/unmount transcribes zero times.
- [ ] List/context ranking signals are actually passed.
- [ ] Combobox active option and live states are accessible.
- [ ] MB-001 through MB-020 have complete evidence.
- [ ] `npm test`, typecheck, lint, build, Playwright, and `git diff --check` pass.
- [ ] UAT auth, profile creation, notifications, Court, Lists, Bridge, Catch, Reassign, and lifecycle regressions pass.
- [ ] Final branch is pushed normally with its SHA recorded.

## Explicitly Out of Scope

- Replacing deterministic parsing with AI.
- Auto-selecting people, dates, Importance, Lists, or contexts.
- Replacing `create_thing`.
- Adding public attachments.
- Rewriting old Lovable/Git history.
- Production rollout before UAT attachment authorization and credit checks pass.
