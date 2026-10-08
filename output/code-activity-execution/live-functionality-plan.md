# Git Activity — live functionality implementation plan

Date: 7 October 2026. Target branch: `katalist-plan/batch-a-baseline`.
Status: planning deliverable, not authorization to implement or deploy. No application code or migration changed by this document.
Implementer: Sonnet 5.5, working one task at a time. Existing contracts v3 remain draft and require re-review; this document does not freeze them.

## Outcome

The List owner connects GitHub **inside Katalist**. No repository URL, personal access token, or private key is requested in chat. Each List connects one repository. No connection means an honest connection screen, not sample activity. Connection persists across page reloads. Activity, diffs, and checks come from GitHub; errors never switch to fixtures.

Use `npm run dev`, existing real sign-in, and `VITE_KATALIST_DEMO_MODE=false`. Do not alter authentication, demo settings, Supabase configuration, push, calls, Morning Brief/genie, or shared Thing behavior.

First live milestone: connect/select/disconnect + current and recent pull requests + available push activity + files + checks + manual Refresh. Automatic sync follows in a separate gate. Optional Coey/Thing creation follows separately, rather than blocking the read-only milestone. This staging does not remove them from the overall scope.

## User experience and exact state rules

`Code Activity → Connect GitHub → GitHub authorization/install if needed → return to same List → select a verified repository → acknowledge List sharing → Connect → first sync → real feed → click a row → detail overlay`

- Owner sees Connect. Collaborator and View Only see “Ask the List owner to connect a repository.”
- GitHub authorization links an account to this connection flow; it must NOT replace the Katalist login session.
- Owner chooses among repositories verified by the server, not arbitrary typed URLs. Search filters the verified list. If no repositories are available, show Install/manage GitHub access and Continue/retry authorization.
- Before connecting: “Everyone in this List, including View Only members, can read this repository’s activity, checks, and available diffs.” Require an unchecked acknowledgement. Explain the broader audience before importing private content.
- AI consent is a different setting, off by default. Connecting GitHub never enables AI.
- No connection: no fake repository, authors, counts, timestamps, or “Connected” indicator. Missing operator configuration: “GitHub connection is not configured yet,” not a broken login or disabled whole app.
- First sync: loading state. Empty repository: honest empty state. Provider failure after a successful load: retain last good feed and show stale/error + Retry. Authorization failure: clear protected cached content immediately.
- Keep the current List header and existing tabs. Use the newer wide feed and click-open inspector overlay, not the rejected permanent 35/65 split. Close button, Escape, focus trapping, and focus return are required; mobile uses a full-screen detail view.
- Disconnect removes access to imported activity, cancels pending work, and leaves GitHub and existing Things unchanged. Reconnect requires fresh verification. Revoked/suspended access is shown truthfully.

## Operator setup is different from connecting a List

Katalist's operator configures a GitHub App once per environment. End users then connect entirely in the UI. Users do not each create an App or paste tokens.

Proposed server-only configuration: App ID, App slug, client ID, client secret, private key, webhook secret, authorization-state secret, exact callback URL. No secrets use a `VITE_` prefix. Document environment-variable names in task G01 before implementation. Missing values disable only Code Activity. Use an explicit server origin allowlist; never derive trusted redirects from an arbitrary Host header.

Request read-only Metadata, Pull requests, Checks, Commit statuses, and Contents permissions. Ask for selected-repository installation. Runtime installation tokens MUST be narrowed to the connected repository ID and required permissions, even if the user installed the App on many repositories. No write permission, PR comments, merges, code pushes, or automatic changes on GitHub.

Local development: verify the registered callback and nonce-cookie behavior on the exact localhost origin. Production uses HTTPS and Secure cookies; any loopback-only development exception must be explicit and tested, not a general insecure fallback. Incoming webhooks need a reachable HTTPS endpoint or an operator-approved development tunnel. Manual reads/Refresh must work without a tunnel. Do not silently create a tunnel or change production App settings.

## Containment and authorization contract

- Feature client code stays under `src/features/code-activity/`. Server code stays in a feature-specific server module and TanStack routes under `src/routes/api/code-activity/**`, plus the namespaced public webhook/job routes. These routes must run under both `npm run dev` and the deployed runtime.
- Put the local React error boundary OUTSIDE the lazy-loaded root; Suspense alone cannot catch a rejected chunk. Missing chunk, render failure, and provider timeout must leave Things/Chat/Members/Call usable.
- Use a Request-based Bearer helper matching the current user-scoped Supabase behavior. Do not change existing auth helpers to fit this feature. Never trust a user/profile/role supplied by the client.
- Additive `code_activity_*` tables/functions only. Do not modify `lists`, `list_members`, `things`, `create_thing`, shared notification triggers, or their policies. RLS enforces membership and live connection state on every read. Owner mutations are enforced inside database functions, not only HTTP handlers. Test direct RPC/table access.
- The callback is browser navigation without the Katalist Bearer header. Bind a single-use, expiring state to the initiating profile and List; require a browser nonce and PKCE S256. Recheck ownership on callback and selection. Installation IDs or setup query parameters never prove identity/access.
- Prove BOTH the authorizing GitHub user and the installation can access the exact repository. Store short-lived server-written selection proofs; final connect consumes a proof atomically with the owner's fresh authenticated request and acknowledgement. Validate the browser binding server-side; client-supplied proof/nonce hashes are not authority.
- Database design must enforce one live connection per List, lifecycle generations, and direct-write denial. Service-role proof/worker writes are narrowly scoped and not general user mutation routes.
- Read the authorized connection before making any GitHub request. Scope cached data by List + connection + generation + revision; reset it on List changes, membership loss, disconnect, or disabled capability. Recheck connection generation before publishing provider results.
- Introduce private master/read-sync/AI gates and a small List allowlist. Fail closed on absent/unreadable gates. The current DEV gate is only a UI preview gate, not sufficient authorization for live access. Production remains disabled until explicitly enabled after review.
- Provider faults use capped deadlines, bounded pagination, budget/backoff, and feature-local errors. No unbounded retries or global timers. Kill switch stops new work; already-running work stops at a checkpoint, not magically instantly. Shared database/runtime contention is still possible: load-test and monitor it rather than claim perfect isolation.

## Small executable tasks for Sonnet

Do not start all tasks together. Each task must have a narrowly scoped patch, tests, recorded evidence, and a review before its dependants. If one task is too large, split it before coding; do not refactor shared modules opportunistically.

| Task | Deliverable / allowed surface | Acceptance gate |
|---|---|---|
| G00 Baseline refresh | Read-only current branch/dirty-file inventory and tests; execution ledger only | Identify user changes, record current failures, no cleanup or unrelated fixes. Old baseline is historical, not today's result |
| G01 Contract delta | Docs: resolve connection schemas, repository-selection endpoint, flags, local callback/cookies, token handling, source mapping, limits, hosting | Architecture and authorization re-review completed before auth/schema/live-access work. Record reviewer and evidence, not “reviewed” without review |
| G02 Safe live shell | Feature UI + minimal List integration; boundary outside lazy root | Normal dev/login unchanged; no mock feed in runtime; no connection/config states truthful; failed chunk/render contained. Keep test fixtures in tests only |
| G03 Additive connection schema | One reviewed migration for connection, state/proof, settings/allowlist; feature-owned functions/RLS | Owner/collaborator/view_only/outsider matrix, direct RPC denial, replay/expiry, archived List, one-live-connection concurrency. Test in disposable database; do not apply to shared/prod without explicit approval |
| G04 Provider/auth primitives | Feature server modules; Request helper, GitHub client, state/nonce/PKCE, response validators | No client secret exposure; exact origin; token narrowing; timeout, bad JSON, rate-limit tests. No eager secret validation at app startup |
| G05 Start + callback | Auth start/callback routes, operator setup guide | OAuth denial/replay/wrong browser/expired state/owner loss reject safely; fresh Katalist login preserved; user+installation repository proofs created only from verified provider replies |
| G06 Selection + lifecycle | Selection listing, status, connect/disconnect routes and UI | Selection returns only caller/List-bound proofs; arbitrary repo ID rejected; acknowledgement mandatory; concurrent connect/revocation safe; reload remembers connection |
| G07 Feed store/normalizers | Separate additive activity/check schema + bounded initial sync and Refresh service | PR and push separate types; unknown counts stay null; stable keys; commits/activity pagination; immutable revision evidence; no invented push history |
| G08 Live adapter/feed | Server feed/capability/Refresh routes + separate live client adapter | Replaces preview adapter entirely in app; refresh survives provider failure with last good data; member loss clears data; requests cancel on List change; no sample fallback |
| G09 Files and checks | Feature-only file/check endpoints, inspectors and cache | Checks bound to head SHA; passed/failing/pending/missing/unavailable honest; available/binary/truncated/missing patches honest; escaped text; authorization precedes provider access; bounded output |
| G10 Live connection acceptance | Tests + manual owner-controlled test-repository session | Complete real flow in normal dev; reload; private-repo sharing; member/outsider denial; revoke/disconnect; no mock feed. Record what was actually tested. First live milestone gate |
| G11 Webhook intake | Separate reviewed delivery schema + namespaced public handler | Verify HMAC against bounded RAW bytes before JSON; delivery-ID deduplication; no raw body/patch storage; return promptly; no heavy processing in intake |
| G12 Durable sync/recovery | Namespaced job + leased processor + reconciliation | Global concurrency bound, fencing also guards data writes, duplicate/out-of-order events safe, budgets/backoff/dead-letter visible; disconnect during sync cannot resurrect data; cron readiness confirmed |
| G13 Visual/containment acceptance | Scoped feed/overlay polish and feature regression tests | Latest feed/detail design, keyboard/mobile/reduced-motion; provider unavailable, lazy chunk rejection, render exception, missing secrets, disabled gates; Things/Chat/Members/Call regression checks |
| G14 Optional Coey | Verified Sarvam server adapter, separate consent/RLS and UI | Explicit user trigger + current owner consent; no automatic AI calls; revoke consent cancels/block new calls; bounded evidence, redacted logs; failure leaves Git Activity usable |
| G15 Confirmed Thing creation | Separate reviewed confirmation migration/endpoint + real candidate picker | Atomic receipt+existing create_thing, durable idempotent replay, owner/current collaborator candidates, explicit assignee, optional unset date, source-change review, Waiting for Catch for ALL creations, no auto-create |
| G16 Limited release | Operator runbook, reviewed config deployment, one List then small cohort | No new baseline failures; direct-access security suite green; kill-switch and restore measured; no shared-resource regression; production enablement explicitly approved |

G03/G07/G11/G15 are separately reviewed additive migrations; timestamps must follow the actual current migration list at implementation time. Avoid one giant migration coupling AI to the read-only release. Existing generated route-tree edits must be preserved: inspect/regenerate/diff deliberately, never overwrite them from another worktree.

## Freeze the API shapes before G04

Retain the existing draft route family, adding the missing selection-list and status/Refresh contracts. Proposed route intent (field-level schemas finalized in G01):

- `GET capabilities?listId` — neutral enabled/configuration status for authorized caller; no secret/allowlist disclosure to outsiders.
- `GET connection?listId` — connection status and repository display identity, never tokens.
- `POST github/authorize/start` — List ID; returns authorization URL and sets nonce cookie.
- `GET github/authorize/callback` — validates flow, redirects only to fixed List context; never places access tokens in URL/storage.
- `GET github/repositories?listId` — paginated, caller-bound unexpired verified selections, not global installations.
- `POST connection` — proof ID and explicit sharing acknowledgement; server derives repository identity from proof.
- `DELETE connection` — explicit confirmation; generation fences in-flight work.
- `GET feed?listId&cursor` — stable cursor pagination and actual freshness.
- `POST refresh` — List-scoped bounded reconciliation, rate-limited; idempotent active-job reuse.
- `GET changes/{id}/checks` and `GET changes/{id}/patch?revision&path` — authorize the owning connection first, verify requested revision/path belong to it.

All authenticated replies containing private data use `Cache-Control: private, no-store` at HTTP layer; internal feature caches remain scoped. Shared error codes include disabled, not_allowed, not_configured, source_unavailable, rate_limited, and timed_out with neutral messages. Freeze status codes, payloads, pagination, bounds, and cancellation behavior in G01. Do not invent an endpoint while wiring UI.

## Sync, history and provisional limits

Start with manual Refresh/initial sync so today's local work does not depend on cron or public webhooks. Add durable background sync only after hosting capacity is confirmed. This is NOT “real-time” until measured.

Provisional starting bounds: one repo/List; 50 rows/feed page; 8-second provider-call deadline; 30-second sync slice; 100 KiB or 2,000 diff lines/file; two retries for safe read failures with jitter and Retry-After respected; no inline retries for authorization failure. G01 must validate aggregate call/time limits, database leases, and pagination resumability before these become contracts. A partial slice returns a cursor/partial freshness rather than pretending completion.

For initial/backfill pushes, verify `GET /repos/{owner}/{repo}/activity` with the documented push filter, token type, and pagination in G07. It can provide available activity, not a guarantee of complete history. Keep push identifiers from webhooks and refetch available commits/compare data; missing/rewritten objects become unavailable patches or explicit history gaps. Commit lists alone are not proof of a push event.

The GitHub receiver persists compact identifiers and queues work; a durable scheduled drain performs fetches. Never rely on an unawaited Promise after returning a serverless response. GitHub does not automatically retry failed deliveries; recovery needs explicit redelivery/reconciliation. Scheduled frequency is an operator decision based on the actual host/plan. Daily-only capacity means a clearly stale/manual-refresh experience, not an invented minute-by-minute guarantee.

## Verification and stop rules

Run focused Node tests and relevant Playwright cases per task; use the repository's real runner, not a newly introduced framework. Run full tests/typecheck/lint/build at milestone gates and compare failures with G00. Existing historical baseline has 25 test failures and three type errors; this is not a waiver for new failures.

Security matrix: owner connects/disconnects; collaborators and View Only can read; outsider and removed member cannot read; neither collaborator nor View Only can mutate connection; direct RPC calls cannot bypass checks. Test two Lists/two users/two repositories to catch cross-List leakage.

Failure drills: GitHub timeout/403/429/404; revoked installation; missing secrets; bad callback; oversized/bad-signature webhook; duplicate/out-of-order delivery; expired worker lease; disabled master/sync/AI; disconnect while fetch runs; route chunk failure; refresh error preserving saved feed. Recheck existing List functions; screenshot evidence alone is not proof.

Stop the current task if it requires unrelated file changes, unsafe schema assumptions, credentials you do not have, or unresolved security decisions. Stop rollout for unauthorized data visibility, duplicate creation, shared-runtime contention, or a new regression. Disable the feature/affected connection first; do not undo unrelated work. Prefer disabling additive structures over dropping tables. No forced pushes or rewritten published history.

## Handoff prompt

“Work on `katalist-plan/batch-a-baseline`. Execute only the explicitly authorized G-task range from live-functionality-plan.md. Do G00 before implementation. Preserve every existing unrelated change. Do not change demo mode, auth UI, push, calls, Morning Brief/genie, or shared Thing behavior. Do not use fixtures in the app runtime or silently fall back to them. For each task report touched files, tests, unresolved choices, and the exact next gate. No shared/prod migration, external App configuration, commit, push, deployment, or production enablement without explicit authorization. Stop at the first unresolved authorization/security contract; do not mark draft contracts frozen yourself.”

## Provider evidence checked for this plan

- [GitHub user-token web flow and PKCE](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app): basis for OAuth state and S256 flow; current documentation supports PKCE.
- [Installation tokens and repository narrowing](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app): leaving repository/permission restrictions out creates broader tokens.
- [Repository activity endpoint](https://docs.github.com/en/rest/repos/repos#list-repository-activities): candidate for bounded push backfill; application behavior still needs tests.
- [Failed webhook redelivery](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/redelivering-webhooks): no automatic retry; past-three-day redelivery window.
- [Vercel cron capacity](https://vercel.com/docs/cron-jobs/usage-and-pricing): Hobby daily vs Pro/Enterprise minute minimum; actual Katalist hosting/plan is still unknown.

This plan separates platform facts from proposed architecture. It does not claim the existing draft contract, provider integration, scheduler, or Sarvam adapter has passed review.
