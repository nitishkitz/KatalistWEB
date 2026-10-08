# Code Activity — T01 Inventory and Baseline

Status: T01 complete for committed code. Planning record only. No application code was changed.
Recorded: 7 October 2026.

## 1. Base and isolation

| Item | Value |
|---|---|
| Source repository | `/Users/nagasainathreddy/Documents/ChatGPT/KatalistWeb_dev` |
| Base commit (full SHA) | `71be5b6fa273374d0e8802cfc100d86e7c8e577b` ("fix: preserve auth styling during autofill", 6 Oct 2026) |
| Source branch | `katalist-plan/batch-a-baseline` |
| Verification worktree | Detached HEAD at the base commit, created with `git worktree add --detach <path> 71be5b6`. Path: `/private/tmp/claude-501/-Users-nagasainathreddy/581826f2-39f4-40ec-a2bb-bc1b3b484f78/scratchpad/t01-baseline`. This is a session scratch location and may be removed; recreate it with the same command. |
| `KatalistWeb_prod` worktree | Detached at `a20226c`. Not touched. |
| Worktree status before and after all commands | Clean (0 changed files). `package-lock.json` unchanged. |

### Exclusions (uncommitted work in the development workspace, not part of this baseline)

- `src/features/push/push-registration.ts`, `src/lib/fcm.server.ts`, `src/routes/api/push/` (untracked), `.env.example` (push registration work)
- `src/routes/me.tsx` (profile UI)
- `src/routeTree.gen.ts` (generated routes, modified)
- `supabase/.temp/*` (local Supabase metadata, including untracked `cli-latest`)
- Untracked: `.agents/`, `output/`, `outputs/`, `public/coey-preproduction/`, `reports/`

This baseline covers committed code only. Results may differ once these edits are included. The modified `src/routeTree.gen.ts` in particular must be reconciled before any route is added.

## 2. Environment

| Item | Value |
|---|---|
| Node | v22.19.0 |
| npm | 11.6.1 |
| OS | macOS 26.5.1, arm64 |
| Install | `npm ci --no-audit --no-fund` from `package-lock.json` (also present: `bun.lock`, unused) |
| Credentials | No `.env` file exists in the worktree. No Supabase, FCM, GitHub, Sarvam, or service-role variables were set in the shell. `DATABASE_URL` was unset, so `scripts/migrate.mjs` would skip. |
| Lifecycle scripts | The root `package.json` defines no `preinstall`, `install`, `postinstall`, `prepare`, `pretest`, or `prebuild` hooks. Dependency-level install scripts ran as part of `npm ci`. |
| Test side effects reviewed | Only `scripts/supabase-proxy.test.mjs` references Supabase configuration. Only `scripts/fetch-court-read-deadline.test.mjs` calls `fetch(`. No test was observed to contact a live service, but I did not instrument network traffic. |

## 3. Command results

| Command | Exit | Outcome |
|---|---|---|
| `npm ci --no-audit --no-fund` | 0 | 867 packages added in about 13 s. Deprecation warnings only. |
| `npm test` | **1** | 932 tests: 907 pass, **25 fail**, 0 skipped. About 146 s. |
| `npm run typecheck` | **2** | **3 errors** in 3 files (listed below). |
| `npm run lint` | 0 | 0 errors, 36 warnings (unused variables). |
| `npm run build` | 0 | Built in under 1 s of Vite time. Output went to `.vercel/output/` (Git-ignored). No tracked file changed. |

The build script is `vite build` only. A comment in `scripts/migrate.mjs` says the migrator runs during `npm run build`, but `package.json` does not wire it. Treat that comment as stale until confirmed.

### 3.1 Typecheck failures (existing)

1. `server/lib/find-phone-user.ts(2,38)` TS5097: import path ends in `.ts` without `allowImportingTsExtensions`.
2. `src/lib/error-component.tsx(17,10)` TS18046: `error` is of type `unknown`.
3. `src/routes/__root.tsx(124,3)` TS2322: error component props do not match `ErrorComponentProps` (`error` is `unknown`, not `Error`).

### 3.2 Test failures (existing)

File-level failures (the test file did not load):

| File | First error |
|---|---|
| `scripts/assignable-people-gating.test.mjs` | `./local-state` does not export `subscribeLocal` |
| `scripts/thing-detail-mark-read-boundary.test.mjs` | `./local-state` does not export `getSnoozedUntil` |
| `scripts/thing-detail-comment-draft-failure.test.mjs` | `./attachments` does not export `signThingAttachmentPaths` |
| `scripts/thing-detail-comment-file-unmount.test.mjs` | `./attachments` does not export `signThingAttachmentPaths` |
| `scripts/thing-detail-comment-draft.test.mjs` | `@/lib/session-mode` does not export `isPreviewSession` |
| `scripts/me-preferences-and-avatar.test.mjs` | `ERR_UNKNOWN_FILE_EXTENSION` for `src/assets/profile/cover.png` (the custom loader cannot import images) |

Assertion failures inside loaded files (19 tests):

| File | Failing tests |
|---|---|
| `scripts/court-dual-mode-workspace.test.mjs` | "overview is composed as three equal layered stacks"; "Court detail uses the approved compact state-driven surface" |
| `scripts/court-mobile-morning-brief.test.mjs` | 6 tests on the mobile Morning Brief banner, overlay, Escape dismissal, opening a Thing, and Review reachability (numbers 186 to 191) |
| `scripts/court-stack-components.test.mjs` | "F04/T10-mobile-entry: Court desktop's Morning Brief is owned by useMorningBrief()…" |
| `scripts/inline-thing-detail-workspace.test.mjs` | "Lists keep Thing detail inline…"; "route-level Thing detail never falls back to the legacy sheet" |
| `scripts/magic-box-destination-race.test.mjs` and `scripts/magic-box-draft-and-destination.test.mjs` | 6 tests on composer destination and draft behavior (numbers 506 to 511) |
| `scripts/t08-shadow-suppression.test.mjs` | "no unclassified Tailwind shadow-* utility exists…" |
| `scripts/t08-typography-floor.test.mjs` | "no .tsx source file contains an arbitrary Tailwind text size below the 12px metadata floor" |

Several failures point to modules that the tests expect but the committed code lacks (for example `subscribeLocal`, `signThingAttachmentPaths`, `isPreviewSession`). This suggests either tests that are ahead of the code or code that is behind the tests. Cause not investigated.

These failures are findings. None was fixed. Any later "no new regression" claim must compare against this exact list.

The Court, Thing detail, and composer failures sit near surfaces that Code Activity does not plan to touch. The List Detail route is the exception that needs attention: `inline-thing-detail-workspace.test.mjs` covers List behavior, so T11 must not worsen it.

## 4. Integration-point map (committed code at 71be5b6)

| Plan item | File or location | Observation |
|---|---|---|
| List Detail route | `src/routes/lists.$listId.tsx` (1,038 lines) | Tab bar is a hard-coded array of `things`, `chat`, `members` (about lines 678 to 684). Each tab renders through `tab === "…"` blocks. The same file owns call and meeting behavior. A conditional fourth tab is a small insertion. |
| Roles and capabilities | `src/domain/capabilities.ts` | `getListCapabilities` derives owner, collaborator, and view-only abilities. `ListRole` is imported from `src/features/lists/fixtures`. |
| Database role gate | `katalist_priv.can_create_thing_in_list` (latest definition: `supabase/migrations/20260818144945_…sql`, line 115) | Allows a `NULL` List, or an unarchived List where the caller is owner or collaborator. View-only is denied. |
| Thing creation (effective) | `public.create_thing`, replaced in `supabase/migrations/20260820133000_create_thing_waiting_owner_nudge.sql` | Only two definitions exist (the original in `20260818143455_…sql` and this one). See contracts.md section 8. |
| Client creation path | `src/features/things/rpc.ts` (`rpcCreateThing`, about line 400) and `src/integrations/supabase/rpcs.ts:47` | The browser calls `supabase.rpc("create_thing", …)` directly with the user session. A preview branch creates the Thing locally. |
| Server auth helper | `server/lib/require-user.ts` | Bearer token, verified through `auth.getUser`, returns `{ userId, client }` with a user-scoped client. |
| API conventions | `server/api/**` (10 handlers, 9 use `requireUser`) and `src/routes/api/**` (TanStack server routes) | Two styles coexist. See contracts.md section 1. |
| Preview and local data | `src/lib/db.ts`, `src/lib/auth/server.ts`, `src/lib/auth/pglite-dialect.ts` | PGlite fallback for local and preview use. |
| Migrations | `supabase/migrations/` (91 files, latest `20261006160000_device_session_limit.sql`) and `migrations/` (1 file, `0001_auth.sql`) | Two directories with different purposes. `scripts/migrate.mjs` applies only `migrations/`. |
| Scheduled work | `vercel.json` | Two daily crons (`/api/jobs/daily-maintenance`, `/api/jobs/escalate-nudges`). No queue or worker infrastructure was found. |
| Sarvam | No client file under `src` or `server` | Mentioned only in `docs/superpowers/` plans. Confirmed absent in committed code. Whether it exists on another branch was not checked. |
| Test harness | `npm test`: Node built-in runner over `scripts/**/*.test.mjs` (173 files) with `scripts/alias-loader.mjs`. Browser tests: Playwright (`playwright.config.ts`, `tests/e2e/`). | No vitest or jest. New tests must follow this harness. |
| `release:verify` | Not present in `package.json` | Matches the architecture plan. |

## 5. Items not yet confirmed

- Whether Sarvam work exists on any other branch.
- Whether `KatalistWeb_prod` at `a20226c` differs materially from `71be5b6` (not compared).
- Playwright suites were not run, because the plan lists only four commands for T01 and some specs target staging.
- Whether the 25 failures also occur on the development workspace with its uncommitted edits.
