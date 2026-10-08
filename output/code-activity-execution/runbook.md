# Code Activity: release runbook and live acceptance (G10 manual part, G16)

**Status: prepared, not executed.** Nothing here has been run against a real database, GitHub App, Sarvam key, scheduler or production. Every "verified" below names the evidence; anything else is **UNVERIFIED**.

## 0. What exists

| Layer | State |
|---|---|
| Database | Eight **unapplied drafts** in `g03`, `g07`, `g11`, `g12`, `g14`, `g15` (not in `supabase/migrations/`). Order: g03, g07, g11, g12, g14, g15. Each file's header repeats that it is a draft |
| Server | `src/features/code-activity/server/`: connection, refresh, feed, detail, webhook intake, drain and reconcile, consent, drafts, summaries, confirmed creation |
| Routes | 13 under `/api/code-activity/**`, plus `/api/public/code-activity/github/webhook` and `/api/jobs/code-activity-drain` |
| UI | Connection flow, feed, click-open overlay, manual and Coey Thing creation, owner consent. Tab visible in `npm run dev` only (see section 3) |
| Gates | All off by default. See section 2 |

## 1. Automated evidence (re-run these before any release step)

| Command | Covers |
|---|---|
| `npm test` | 191 Code Activity unit, component and flow tests among the existing suite (27 pre-existing, unrelated failures remain) |
| `node --test output/code-activity-execution/g03/g03-security.test.mjs` | G03 schema: privileges, RLS predicate, proofs, connect, disconnect |
| `node --test output/code-activity-execution/g07/g07-security.test.mjs` | Feed storage, refresh lease, retention |
| `node --test output/code-activity-execution/g12/g12-security.test.mjs` | Webhook queue, leases, backoff, budget, lifecycle, reconcile |
| `node --test output/code-activity-execution/g14/g14-security.test.mjs` | Consent, gating, rate limits |
| `node --test output/code-activity-execution/g15/g15-security.test.mjs` | Atomic idempotent creation |
| `node --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./scripts/alias-loader.mjs --test output/code-activity-execution/g10/integration.test.mjs` | The real TypeScript services against the real SQL, end to end |

All SQL runs in an in-memory PGlite database with **stubbed** Supabase roles, `auth.uid()` and `create_thing`. They do not prove hosted Supabase, PostgREST column privileges, real concurrency across connections, or the real `create_thing`.

## 2. Gates and the kill switch

| Gate | Where | Default | Effect when off |
|---|---|---|---|
| `master` | `code_activity_settings` | absent = off | Every function refuses; routes answer neutral errors |
| `sync` | `code_activity_settings` | absent = off | Webhook intake answers 503 without storing; claiming and reconcile stop |
| `ai` | `code_activity_settings` | absent = off | Coey hidden and refused, consent cannot change |
| Allowlist | `code_activity_list_allowlist` | empty | Only listed Lists work at all |
| Owner consent | `code_activity_consents` | off | No AI call even with the flag on |
| Environment | `CODE_ACTIVITY_*` | unset | Code Activity reports "not configured". Nothing else is affected |

Enable (operator, SQL console, after approval): `insert into public.code_activity_settings values ('master','true'::jsonb);` then add one List id to the allowlist. Disable: set the row to `'false'::jsonb` or delete it. **No product UI can change a flag.**

Kill-switch latency is **UNMEASURED**. By design a new request sees the change on its next read; an in-flight refresh stops at its next checkpoint (one provider deadline of 8 s plus database time); an in-flight AI call is discarded when consent is rechecked.

## 3. The remaining code gate before ANY production exposure

`resolveCodeActivityPreview` still returns `false` in production builds, so the tab does not render there whatever the database says. A release needs a reviewed change that shows the tab from the server capability (`enabled`) instead. That change was deliberately **not** made: production stays dark pending final review.

## 4. Environment variables (names only; values are never written down here)

| Name | Needed for | Secret |
|---|---|---|
| `CODE_ACTIVITY_GITHUB_APP_ID`, `_APP_SLUG`, `_CLIENT_ID`, `_CLIENT_SECRET`, `_PRIVATE_KEY` | Connection, reads | secret: client secret, private key |
| `CODE_ACTIVITY_STATE_SECRET` | PKCE derivation | secret |
| `CODE_ACTIVITY_GITHUB_CALLBACK_URL`, `CODE_ACTIVITY_ALLOWED_ORIGINS` | Connection | no |
| `CODE_ACTIVITY_GITHUB_WEBHOOK_SECRET` | Webhook intake (20+ characters) | secret |
| `CODE_ACTIVITY_SARVAM_API_KEY`, optional `CODE_ACTIVITY_SARVAM_MODEL` (default `sarvam-105b`) | Coey | secret |
| `CRON_SECRET` (existing) | `/api/jobs/code-activity-drain` | secret |
| `SUPABASE_SERVICE_ROLE_KEY` (existing) | server-only database functions | secret |

## 5. GitHub App additions for the webhook (operator)

Webhook URL: `https://<deployed origin>/api/public/code-activity/github/webhook`. Content type JSON. Secret = `CODE_ACTIVITY_GITHUB_WEBHOOK_SECRET`. Events: Push, Pull request, Check run, Status (the Installation and Installation repositories events arrive by default). Locally, intake needs a public HTTPS tunnel chosen by the operator; **manual Refresh works without one**.

## 6. Scheduler (operator decision, not made)

Registering `/api/jobs/code-activity-drain` is a deployment configuration change (`vercel.json` or the host's scheduler) and was **not done**. Hosting is **UNKNOWN**: the repository holds both `vercel.json` and `netlify.toml`. Vercel Hobby crons run once a day, so on Hobby the drain gives "stale until the daily run or a manual Refresh", not near-real-time. Without any scheduler, webhooks are stored but not processed until something calls the drain; manual Refresh keeps working.

## 7. Live acceptance checklist (G10, to be run by a person)

Prerequisites: sections 1 to 5 done on a **disposable or approved** database, one test repository you own, three test accounts (owner, collaborator, View Only) and one outsider.

1. Owner: open the allowlisted List, Code Activity, Connect GitHub, authorize, pick the repository, tick the acknowledgement, Connect. Reload: the connection persists.
2. Owner, collaborator, View Only: all see the repository. Only the owner sees Manage. View Only sees no Refresh.
3. Refresh as the collaborator: pull requests, pushes, a failing and a passing check appear. Open a change: description, files, patches, checks. Patch text containing HTML shows as text.
4. Outsider: opens the same URL. Sees nothing about the repository.
5. Private repository: confirm the acknowledgement text names View Only members before connecting.
6. Disconnect as the owner: saved activity disappears for everyone; reconnect needs a new authorization.
7. Remove the GitHub App installation on GitHub: the List shows the revoked state and the feed is gone (needs webhook or a Refresh).
8. Create a Thing by hand from a change: assignee required, no date invented, it starts Waiting for Catch, a second click does not duplicate it.
9. Coey (only after the `ai` flag, a model key, and owner consent): Draft shows a review form; nothing is created until Create Thing; turning consent off blocks the next draft.
10. Record what was actually done, with dates, in `ledger.md`. A step not run is written as not run.

## 8. Failure drills (record the result of each)

| Drill | Automated evidence | Manual evidence |
|---|---|---|
| GitHub 403, 404, 429, timeout during Refresh | `code-activity-activity.test.mjs`, g10 integration | not run |
| Revoked or suspended installation | g12 tests, g10 integration | not run |
| Missing secrets | `code-activity-server.test.mjs` (config), jsdom flow test (not configured panel) | not run |
| Bad or oversize webhook, wrong signature | `code-activity-webhook.test.mjs` | not run |
| Duplicate and out-of-order delivery | g10 integration, g12 tests | not run |
| Worker crash, lease expiry | g12 tests, g10 integration | not run |
| Disconnect during Refresh or processing | g07, g12, g10 integration | not run |
| Chunk load failure, render exception | `code-activity-flow-ui.test.mjs` (jsdom) | not run in a browser |
| Kill switch (each flag) | g03, g12, g14 tests | latency **unmeasured** |
| Model timeout, invalid output, consent withdrawn mid-call | `code-activity-ai.test.mjs`, g10 integration | not run against Sarvam |

## 9. Monitoring and recovery

Queue health (service role): `select * from public.code_activity_server_queue_health();` returns counts and the age of the oldest waiting delivery per status. Alert candidates: any `dead` rows, `received` older than the schedule interval, a connection stuck in `syncing` (its 60 s lease expires on its own). To re-run a dead delivery: set its status to `received` and `next_attempt_at` to now. To stop all processing: set `sync` off. To remove a List: delete its allowlist row, or disconnect it. Prefer disabling over dropping tables.

## 10. Limited release plan (not started)

One allowlisted internal List first, then a small cohort. Entry criteria: reviews approved; sections 1, 3, 5 and 7 done; no new baseline test failures; security suites green; kill switch exercised and its latency written down; production enablement approved in writing. Measurements still owed before the cohort: provider request volume per refresh, drain duration, database load while a refresh runs, and webhook delivery latency. None has been taken.

## 11. Known gaps (read before trusting the above)

- Real GitHub, PostgREST, Supabase, Sarvam, a browser and a scheduler have **never** been exercised. Provider shapes come from documentation retrieved on 7 Oct 2026 through a summarizing tool, not from live calls.
- The activity endpoint's completeness for push history is unverified; history GitHub does not return is simply absent.
- `create_thing` is a stand-in in the SQL tests. The atomicity claim covers the confirmation function's own writes plus whatever `create_thing` does in the same transaction.
- jsdom could not verify focus return to the row after the overlay closes; `tests/e2e/preview/code-activity-live.spec.ts` is written to check it and has never run.
- Webhook processing and the reconcile run only when something calls the drain route.
- View Only visibility of the consent boolean is a **product decision still pending**; the drafts implement the reviewer's recommendation (boolean only).


## 12. Corrections after the consolidated review (five batches)

| Batch | Fix | Evidence |
|---|---|---|
| 1. Consent | Consent and the connection generation are rechecked **immediately before** anything is sent to the model, and again after the reply. `ai_begin` returns the generation; `ai_still_allowed(list, generation)` requires an active connection at that generation. Confirmation SQL refuses AI-written text (`CA001`) unless the `ai` flag and the owner's consent are on | g14 and g15 SQL tests, unit tests, g10 integration (consent withdrawn while GitHub loads: the model is never called; disconnect during the call: draft discarded) |
| 2. Worker safety | The drain claims **one** delivery at a time, just before working on it. `apply_items`, `set_check_state` and `apply_installation_event` take the delivery id and lease token and refuse (`40001`) unless that lease is live | g12 SQL tests (expired worker cannot write any kind of data, old token stays dead after reclaim), drain unit tests |
| 3. Confirmation | Hash is a structured JSON array (sha-256), includes the acknowledgement and AI flag. Replay and creation are separate paths: replay needs only List access and returns the Thing id only if the caller can still see it, and works after the feature is switched off | g15 SQL tests |
| 4. Limits | Every provider request is metered (reserved 5 at a time from the shared hourly budget; none is made when the budget says no), including detail reads, AI reads and the connect check. AI and authorization rate limits take advisory locks. Evidence is cut by UTF-8 bytes | unit tests with the reviewer's Unicode probe, g10 integration against the real budget table |
| 5. Revocation | Removal events keep **every** id: the database splits them into rows of 200 in one transaction. More than 5,000 (or an unreadable entry) is recorded as an overflow, which processing treats **fail closed**: every live connection of that installation is suspended and marked stale. A chunk larger than 200 is an error, never a quiet no-op | g12 SQL tests, g10 integration (450 removals revoke 450 connections) |

Mutation check: 21 deliberate breakages of these fixes. All were caught except two that are redundant by design (cutting evidence by string length is also corrected by the final byte cap, and the reverse); with both layers removed together the test fails.

Still unproven, stated plainly:
- **Real concurrency.** The advisory locks, the `FOR UPDATE` and `FOR SHARE` row locks and the claim cap need two real database connections racing. No multi-connection Postgres was available (PGlite is single-connection), so those tests pin the mechanism (lock calls precede the count and insert) and prove sequential behavior only. Run a concurrent drill on the disposable database before any cohort.
- **Metering granularity.** Up to four reserved credits per operation may go unused; this is conservative. The hourly figures (700 and 300) remain provisional.
- **Overflow handling** does not revoke, because the provider reply that would settle which repositories remain was not assumed. It marks every live connection of the installation `needs_reverification`: nothing is READ (feed, detail, status rows, table policy), nothing new is CONFIRMED, refresh and AI are refused, and no unsuspend event brings it back. The owner clears it only by disconnecting and connecting again (a new connection that is verified against GitHub). Members see an explanation, not an empty feed.
- A full-suite run once showed 15 extra `brand-check` failures that did not repeat on rerun and pass in isolation; the cause was not found.


## 13. Second review round: reconnect and post-overflow access

| Gap | Fix | Evidence |
|---|---|---|
| A new connection restarts at generation 1, so an AI request that began on the OLD connection passed its checks against the replacement, and an old-generation provider lookup returned the replacement repository | AI checks (`ai_begin` returns the connection id, `ai_still_allowed(list, connection, generation)`) and provider reads (`connection_for_provider(list, generation, connection_id)`) are bound to the connection id AND generation. Refresh, detail and AI pass the id they were authorized against | g03, g14 SQL tests; unit tests; g10 integration (a draft cannot complete after another repository replaced the connection) |
| After an overflow the saved feed stayed readable and confirmable, and a normal unsuspend could revive it | New persistent `needs_reverification` flag, set by overflow (also on already-suspended rows). Feed, change read, table policy and confirmation refuse it; unsuspend skips it; the status function still reports it so the screen can explain | g12 SQL tests, UI test, g10 integration (View Only cannot read; unsuspend does not revive; disconnect then reconnect restores access, and the old connection's rows stay hidden) |
| Three jsdom UI tests failed under parallel load | Their waits are now load-tolerant (8 s instead of the 1 s default). The behavior was not wrong; a real failure still fails at once | Full parallel suite |

Mutation check of these two fixes: 12 deliberate breakages, all caught.

Ordinary suspension (GitHub suspended the App) is unchanged: saved activity stays readable and can still be used to create Things, as the contract says. Only access-uncertain connections are blocked.


## 14. Connector completion plan (C01 to C06): status and run sheet

| Task | Status |
|---|---|
| C01 verify the two corrections | **Done.** Connection id plus generation binding and the persistent re-verification block pass their regression suites (g03, g12, g14 SQL; unit; g10 integration, including a draft that cannot complete after another repository replaces the connection, and an overflow after which the saved feed, change reads and confirmations are refused and unsuspend does not revive the connection). Schemas are **not** approved by this |
| C02 discoverable connect action | **Done in code and component tests.** `ConnectorCard`: loading, "unavailable for this List", "operator setup unfinished" and network error are different states; the owner always sees Connect GitHub, disabled with the reason attached unless ready; members never get an action; "Opening GitHub…" blocks a double click; the revoked state reads "GitHub access needs verification." Not seen in a real browser |
| C03 operator bootstrap | **Tooling done, App NOT created.** `scripts/code-activity-bootstrap.mjs` and `code-activity-config-check.mjs`. Current state, by name only: all eight `CODE_ACTIVITY_*` connection variables are **absent** from `.env.local`; the service-role and Supabase variables are present; demo mode is `false`; the running server answers 503 on the callback, i.e. it has no settings. Creating the App needs a person to confirm it on GitHub |
| C04 isolated database | **Candidates prepared, nothing applied.** `migration-candidates/` holds the four read-only migrations (g03, g07, g11, g12) with timestamps after the latest existing migration, outside `supabase/migrations/` on purpose (a push may sync to Lovable). The whole connector runs against only those four in PGlite (`readonly-subset.test.mjs` and the integration file with `CODE_ACTIVITY_SUBSET=readonly`), and the optional AI and Thing-creation functions answer "unavailable". **Needs: an approved target database, real PostgREST, and a two-connection concurrency drill** |
| C05 real browser run | **Not run.** Needs C03 and C04 |
| C06 handoff | This section and the ledger |

### C05 run sheet (a person runs this; record each line as passed, failed or not run, never inferred)

Setup: App from C03 installed on one test repository; the four candidate migrations applied to an **approved test database**; a separate dev process pointed at it; `master` on and ONE new test List allowlisted (`ai` and `sync` off).

1. Owner: Code Activity shows the connector card with Connect GitHub enabled. A collaborator and a View Only member see "Only the List owner can connect GitHub." and no button. An outsider sees "unavailable".
2. Click Connect GitHub once: "Opening GitHub…". Double-clicking starts only one authorization. Authorize on GitHub (install or approve repository access if asked, which may take more than one GitHub screen); you return to the same List on Code Activity.
3. Choose one verified repository, tick the sharing acknowledgement (it names View Only members), Connect. Reload: still connected. Katalist stayed signed in throughout.
4. Initial sync or Refresh: real pull requests, pushes and check results. Open a row: real description, files, patches, checks.
5. Failure cases: cancel on GitHub; deny repository access; repeat or expire the callback URL; empty repository; an account with no accessible repository; a failed Refresh keeps the last good rows.
6. Roles: collaborator refreshes; View Only reads only; an outsider cannot read or probe.
7. Disconnect; connect a **different** repository; the old rows and any in-flight result do not appear.
8. Cookie behavior through the real redirect in Chrome (passed or failed), and Firefox and Safari (passed, failed or **untested**; do not infer from Chrome).
9. Break the feature on purpose (provider error, chunk failure): Things, Chat, Members and Call still work.

Never record authorization codes, state, nonce cookies, tokens or secrets in the evidence. **The connector is complete locally only when steps 1 to 9 are recorded as passed.**
