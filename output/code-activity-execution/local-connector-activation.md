# Local connector activation — 7 October 2026

User authorized using the presently working Supabase project and completing setup until Connect GitHub is enabled. No commit, push, deployment, unrelated fix, or production cohort was performed.

## Actual state

- App configuration and CLI linkage both identify `jrdsmmiggezrhiakncwc` (`Katalist_uat`). Existing Supabase settings and demo mode were preserved.
- Fixed the generated GitHub App name length and added a regression test. GitHub rejected the localhost webhook URL despite `active:false`; omitted the optional hook configuration for local manual-refresh setup. GitHub accepted the corrected manifest.
- User completed verification and created the private read-only App. Bootstrap wrote eight server-only settings into ignored `.env.local` with owner-only permissions. No secrets were printed or recorded.
- Running `npm run dev` loaded the settings automatically. Config-check reports eight valid values; the callback now answers 400 rather than 503 when no code/state is supplied.
- Applied connection, changes and webhook-storage migrations individually. Remote/local versions: `20261007180021`, `20261007180103`, `20261007180137`. After explicit broader user approval, applied processing as `20261007181309`. Candidate/draft files remain historical sources, not the current deployment status.
- Set `master=true`, `ai=false`, `sync=false`. Allowlisted ONLY WORKSHOP FRIDAY (`75bfe793-3891-4a65-9c15-a33b4865f447`). Codex did not create a repository connection.
- Live signed-in browser reached “Authorized on GitHub” and actual repository selection. This proves initial Connect, OAuth callback and selection-proof reads worked. Codex did not choose a repository or acknowledge sharing.

## Verification and limits

- Bootstrap tests: 9/9. In-memory SQL safety tests g03/g07/g12: 50/50.
- Read-only in-memory integration: 14 pass, 6 optional-AI/Thing tests skipped. This test harness includes g12; it does NOT represent the deployed three-migration database.
- Hosted SQL: owner enabled=true, other enabled Lists=0, outsider enabled=false.
- All seven new tables have RLS. Anon can execute none of the new functions.
- Existing shared function-definition hash and public policy-definition hash match their pre-change baseline.
- Security advisors flagged intentional private tables with RLS/no policy and authenticated SECURITY DEFINER endpoints. These have explicit role grants and internal authorization checks. Existing unrelated warnings were untouched. References: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy and https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable.
- Browser evidence: `/private/tmp/katalist-github-repository-picker.jpg`.

## Resolved final-connection blocker

Initially auto-review rejected g12 `code_activity_processing` because durable budgets, workers, reconciliation and lifecycle mutations exceeded enabling the button. No alternate execution path was used. The user subsequently explicitly approved that remaining migration. It applied successfully, individually, to the same Katalist_uat project with bounded lock/statement timeouts. The formerly missing budget RPC exists; service_role can execute it, authenticated cannot. The shared function/policy hashes still match the pre-change baseline. The current g12 safety suite passes 18/18 in PGlite; this does not prove real concurrent workers.

The user clicked Connect repository for `nitishkitz/KatalistWEB` with sharing acknowledged. Their browser reported Connected and Syncing now. Hosted SQL confirmed a successful live sync and 50 saved activity rows. The first connection was subsequently disconnected while verification was in progress; Codex did not disconnect it. The user then reconnected in the browser. Final hosted verification confirms an ACTIVE connection, `sync_status=ok`, `last_synced_at=2026-10-07 18:19:27.812608+05:30`, and 50 saved activity rows. The real browser shows Connected, Last synced just now, Up to date, and live push rows. This is real GitHub/PostgREST evidence, not fixtures. Codex did not select, acknowledge sharing, disconnect or reconnect on the user's behalf. AI and background sync remain false; only WORKSHOP FRIDAY remains allowlisted.

Final browser screenshot: `/private/tmp/katalist-github-connected.jpg`. Detail reads, all check-state rendering, cross-browser cookies and worker concurrency are not proved by this feed verification. In particular, one feed row renders “0 checks failing”; this display issue remains for a separate feature review.

Local migration records match all four hosted versions. No application code changed in this follow-up, and nothing was committed, pushed or deployed. Production readiness, full cross-browser coverage and real multi-connection concurrency are not claimed.

AI/Thing creation migrations, scheduler, webhook receiver, real concurrency drill, cross-browser cookies and production readiness remain outstanding. Rollback is non-destructive: set Code Activity master=false or remove ONLY this List's allowlist entry; preserve feature tables and shared objects.

## Assignee form follow-up — 7 October 2026

The user reported an empty Assignee dropdown. Hosted SQL confirms both `code_activity_assignee_candidates(uuid)` and `confirm_code_activity_draft` are absent; the read-only connection setup did not activate Thing creation. The UI hook previously erased request errors into an empty array. The feature-only correction distinguishes loading, missing setup, denied access, empty eligible results and transient failure. It disables the field/submission when unavailable, preserves the draft, and offers Retry for transient errors only. It does not substitute header people, guess an assignee or bypass database authorization.

Changed only `live/use-feed.ts`, `ActivityView.tsx`, `ChangeInspector.tsx`, `CoeyDraftReview.tsx` and feature UI tests. Focused tests: 46/46, including three new missing-setup/loading/retry regressions. Targeted ESLint and diff whitespace checks pass. Typecheck still reports only the same three baseline errors. Real signed-in browser shows the missing-setup explanation beside Assignee; screenshot `/private/tmp/katalist-assignee-setup-required.jpg`. No Thing was submitted or created, no additional migration was applied, no flags changed, and shared Thing files were untouched. Activating the confirmation/assignee schema on Katalist_uat requires separate approval and a dependency/security check; AI must remain off.
