# Existing backend reset — implementation and operation record

Recorded 12 October 2026, Asia/Kolkata. The user superseded project provisioning with: “dont create new rest existing man”. Create no new hosted projects. Preserve existing schema, migrations and necessary system configuration.

## Current result — 13 October 2026

The user explicitly approved database fencing and permanent deletion with no additional backup. Execution on existing project `jrdsmmiggezrhiakncwc` completed. An independent count-only inventory confirms **zero across all 80 reviewed user/application/Auth/session/Storage-object table counts**. All 9 Auth accounts, 69 Things and 14 stored files from the refreshed pre-reset inventory were removed. All 75 application user tables are empty.

Production remains paused and HTTP 503; both deployed Vercel cron triggers are disabled. Supabase signup is closed. Temporary signup/storage triggers and application-schema access fences remain active, including the service_role block. Direct service API access returned HTTP 403; signup/storage insert probes were rejected. Local maintenance flags are set; already-running dev processes require a restart to read them.

The 198 foreign keys, 94 policies, 9 empty Storage buckets, existing schema/functions and migration history remain. System app_config has 10 records (9 original plus the reset maintenance flag); all 3 Code Activity system switches remain present and disabled. The privilege repair was applied and recorded using the supported CLI migration repair command. No new project, additional user backup, code deployment, Git push or credential rotation was performed. Provider-managed backups are not evidence of permanent erasure.

Evidence: `output/fresh-reset/approved-pre-reset-inventory.json`, `fence-verification.json`, `reset-operation.json`, `post-reset-inventory.json` and `completion.json`. The operation report records successful rollback rehearsal, supported Storage removal, application cleanup, supported Auth hard deletion and zero verification. The three cleanup transaction tests passed again after fixing the CLI-only entrypoint guard for imports from stdin.

This completes the approved existing-backend cleanup and maintenance phase. Signup/phone OTP, explicit connection consent, Google Contacts removal, cache/session versioning and the replacement Coey scheduler remain release prerequisites. Production has not been reopened. The historical preparation record and recovery procedure follow; their pre-approval/pending statements describe the state before this completed execution.

## Initial pre-approval state (historical)

- Supabase: `jrdsmmiggezrhiakncwc`, `Katalist_uat`, organization `ownnicbjagddxnsujcnz`, Sydney (`ap-southeast-2`). No other Supabase project is a reset target.
- Local client and server, Vercel Preview and Vercel Production all target that project. These are **not isolated** environments. No `DATABASE_URL` is configured in the inspected local/Preview/Production configuration.
- Vercel: `katalist-web`, project `prj_5YQ9x4FuPcuEmwJhEiCP0iHjD7Pq`, team `team_Ws7POyOe9QuJDVyHcO355b4a`.
- Production deployment: `dpl_ChvxyTdY6t3u1C7D4bShqgmnFMsS`, alias `https://katalist-web-nitheshs-projects-d9732806.vercel.app`. No separate custom production domain was identified.
- Vercel cron triggers are disabled (verified through the project API). Production is paused; the alias returns HTTP 503. This platform pause is independent of the source maintenance flag.
- Supabase signup is still open. Phone provider is disabled. No real phone OTP verification was performed. Auth site URL is `http://localhost:3000` and its redirect allow-list is empty; these need release configuration.
- Database fences and the forward privilege repair are **prepared, not applied**. Automatic approval review rejected adding Auth/Storage triggers, revoking schema access including service_role, and recording a migration, citing live outage and recovery risk beyond clearly authorized scope. No workaround was executed.
- No user account, application row or Storage object was deleted. No new project, credential rotation, deployment or Git push was performed. Provider backups remain outside this count inventory.

## Counts and cleanup scope

The count-only live inventory recorded 9 Auth users, 9 profiles, 69 Things, 96 notifications, 9 device tokens, 6 Auth sessions, 15 refresh tokens and 14 Storage objects. All application tables and 198 foreign-key constraints were inventoried without exporting personal contents.

[`scripts/reset/scope.json`](../scripts/reset/scope.json) is the exact table/bucket allow-list. Every inventoried `public` and `katalist_priv` table is user scope except `public.app_config` and `public.code_activity_settings`. This includes QA projects/resources, design records, Code Activity connections/cache/budgets, private rate-limit records and notification queues. Preserve the two system tables; disable Code Activity settings. Preserve all migration records, functions, policies, indexes, enum types and grants except the reviewed privilege repair and temporary maintenance fence.

All nine Storage buckets are application-owned buckets: `AVATARS`, `avatars`, `thing-attachments`, `list-covers`, `list-chat`, `hub-files`, `bucket-note-files`, `design-covers`, `qa-evidence`. Clear their objects through the Storage API, retaining bucket configuration. Static product assets under `public/` and deployment assets are separate and remain intact.

Evidence files under `output/fresh-reset/`:

- `pre-reset-inventory.json`: tables/counts, foreign keys, policies, extensions, realtime tables, triggers and sensitive function privileges.
- `provider-inventory.json`: bucket identities/counts, schemas, active writer count and database webhook count.
- `fence-preflight.json`: six effective schema-role grants, zero vault secrets, zero foreign keys from outside application schemas into user tables.
- `vercel-maintenance.json`: deployed schedule disablement, pause state and deployment identity.
- `reset-operation.json`: successful count-only dry-run. This is not an execution or zero-user report.

## Writers and schedulers

| Writer or trigger | Inventory / state |
| --- | --- |
| Daily maintenance, `/api/jobs/daily-maintenance` | Deployed schedule `15 3 * * *` UTC; Vercel scheduling disabled |
| Nudge escalation, `/api/jobs/escalate-nudges` | Deployed schedule `30 3 * * *` UTC; Vercel scheduling disabled |
| Code Activity drain, `/api/jobs/code-activity-drain` | Manual/external endpoint; no Vercel schedule found |
| QA evidence cleanup, `/api/qa/evidence/cleanup` | Manual/external endpoint; no repository schedule |
| GitHub webhook intake / OAuth callbacks | Source maintenance and worker gates prepared; database fences needed for older deployments |
| FCM sends from call, chat, mention, nudge and push-test routes | Shared sender now defaults to disabled in the prepared build; deployed Firebase credential still exists |
| Browser SDK, realtime, direct REST/RPC and Storage upload/download | Target existing Supabase; not stopped by a production-domain pause alone |
| Supabase Auth and profile bootstrap trigger | Signup remains open; database/provider fence pending |
| Nitro APIs, TanStack server functions, same-origin Supabase proxy, Vite dev APIs | Prepared maintenance gates; existing releases still require backend isolation |
| Better Auth / Grok broker / embedded PGlite | Separate code path exists; DATABASE_URL unset, so fallback is in-memory PGlite. Hosted provider/session activity was not behaviorally verified |
| Demo scripts and privileged SQL test helpers | Operator-only writers; never execute them as cleanup or bootstrap fixtures |
| Database cron / queues / webhooks / Edge functions | No pg_cron, pg_net or pgmq extension/schema; zero DB webhook triggers and no deployed Edge functions |
| External schedulers outside inspected accounts | Not independently enumerated; database fencing is required even if no external schedule is identified |

Live grant drift was found: ordinary API roles have execute privilege on scheduled worker RPCs and public test wrappers. Public test wrappers are invoker functions whose private implementations already restrict ordinary roles; they are not proof of a working anonymous seed bypass. The prepared forward migration removes unnecessary ordinary-role execution without rewriting history.

## Implementation and verification

- `KATALIST_MAINTENANCE=true` blocks new-build Nitro and TanStack traffic and Vite development traffic before request handlers/proxying.
- Background jobs and GitHub webhook intake default to disabled unless `KATALIST_BACKGROUND_JOBS_ENABLED=true`; maintenance always overrides enablement.
- The shared FCM sender defaults to disabled unless `KATALIST_OUTBOUND_DELIVERY_ENABLED=true`; maintenance always overrides enablement.
- `vercel.json` now has no cron definitions. This source change has not been deployed; live schedules were disabled separately through Vercel's API.
- `scripts/migrate.mjs` documentation is corrected: `npm run db:migrate` applies only `migrations/`; `npm run build` does not invoke it. Embedded PGlite also applies `migrations/`, not Supabase migrations.
- Historical Supabase auth-user seed references inspected are function definitions; no top-level `SELECT test_*` invocation was found. Do not run helper functions during bootstrap. Google Contacts and reciprocal-send auto-accept remain in repository code and must be replaced before reopening connections.
- Seven focused tests passed: worker default-off behavior, maintenance override, request short-circuiting, scheduled/manual entrypoint fencing, no attempted Firebase delivery, rolled-back cleanup preserving data, preservation of system settings and refusal of unreviewed foreign-key dependencies.
- Typecheck and production build passed. PGlite tests validate cleanup transactions/dependency behavior; they do **not** verify managed Supabase Auth/Storage or a full empty Supabase bootstrap.

## Reviewed execution procedure (completed after explicit approval)

1. Keep production paused and schedules disabled. Close signup with the supported Supabase Auth configuration interface. Review newer Preview/old deployment URLs separately; platform pause only confirms production traffic is blocked.
2. Apply `supabase/migrations/20261012230000_reset_job_privileges.sql` to the exact verified project. Record only this applied version with the supported CLI migration repair interface; do not push unrelated pending migrations or manually synthesize migration history.
3. Apply `scripts/reset/fence.sql` through the privileged management connection. It records maintenance in app_config, adds temporary signup/storage-write rejection triggers and revokes application-schema access from PUBLIC/anon/authenticated/service_role. It does not clear data. Review effective grants against `fence-preflight.json` first.
4. Verify direct old-token/API RPC and upload attempts fail; verify no in-flight writer or delivery remains. Audit old signed-upload behavior and any external workers before proceeding. Do not assume platform pause invalidates cached tokens or signed URLs.
5. Supply server-only credentials to `scripts/reset-existing.mjs`. Run `--project-ref jrdsmmiggezrhiakncwc` first for dry-run. Explicit `--execute` additionally requires VERCEL_TOKEN and verifies live Vercel pause/cron disablement, Supabase signup closure, DB role fences, provider triggers, zero vault secrets and idle application DB roles. It stops if table or bucket inventories changed.
6. Rehearse the exact table cleanup in a rolled-back transaction on the fenced backend. No CASCADE. Remove Storage objects through supported APIs before clearing ownership records, then clear the reviewed application tables in one transaction and delete Auth accounts through the supported Admin API. Record checkpoints for retry; do not call this cross-provider procedure atomic.
7. Repeat inventory and require all user/application/Auth/Storage-object/queue counts to be zero. Keep schema, bucket configurations, system settings and maintenance intact.

This preserves the existing schema, so no fresh managed-schema bootstrap is required by the user's revised approach. No full migration replay or separate development backend has been created. Development verification must use a disposable local backend; do not create test identities on this shared live target while preserving zero users.

## Recovery and reopening

Before data deletion, maintenance can be reversed without restoring user data. `scripts/reset/unfence.sql` restores the recorded effective schema access and removes temporary triggers. It does not restore anonymous execution of worker/test functions. Re-enable signup and unpause Vercel deliberately only after verifying the release and credentials. Keep job/delivery switches off until the replacement scheduler is validated.

After deletion, code rollback or unfencing cannot recover deleted accounts/files. This operation creates no additional user-data backup; provider-managed backups may still retain old data. Do not describe zero live counts as permanent provider-wide erasure.

Before reopening: replace Google Contacts eligibility and reciprocal auto-accept with explicit recipient acceptance, enforce pending-user API permissions, verify real signup/phone OTP and private resources, retire old credentials/tokens/callbacks, version browser sessions/query caches, deploy the verified release, remove temporary test identities and verify zero again. Phone OTP currently cannot be claimed working because the provider is disabled and no real OTP flow completed.

References: [Vercel cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs), [Vercel project pause](https://vercel.com/docs/rest-api/projects/pause-a-project), [Supabase Auth configuration API](https://supabase.com/docs/reference/api/v1-update-auth-service-config).
