# GitHub connector: finish the user-facing connection flow

Date: 7 October 2026.
Branch: `katalist-plan/batch-a-baseline`.
Implementer: Sonnet 5.5. This document is a plan, not permission to modify code, register an external App, apply a migration, commit, push, or deploy.

## The requirement

The List owner uses their EXISTING GitHub account:

`List → Code Activity → Connect GitHub → GitHub authorization → repository selection → sharing confirmation → connected → real activity`

If GitHub asks for installation or repository-access approval, complete it on GitHub and return to the same List. This may require more than one GitHub screen; do not promise literally one click or skip provider consent. Reuse the existing OAuth/install flow.

Ordinary users never create a GitHub App, enter a personal access token, upload a private key, or edit environment variables. Katalist's operator registers/configures ONE application per environment behind the scenes. An existing Codex GitHub connection is not a credential source for Katalist.

This is NOT a rebuild of G00–G16. Reuse the connection services, routes, proofs, repository picker, feed, and inspector already written. Ship the local read-only connector first. Coey, Thing creation, webhooks, scheduling, and production exposure are not prerequisites for that milestone.

## Facts inspected for this plan

- `CodeActivityRoot.tsx` renders `NotConfiguredPanel` instead of the connection panel when readiness fails. That panel has no connection button.
- `live/use-connection.ts` currently merges `enabled=false` and `configured=false` into the same phase, explaining the misleading setup message.
- Owner connection, OAuth start/callback, verified repository selection, connection persistence, and return-to-Code-Activity routing already exist.
- The latest inspected SQL contains connection-ID-plus-generation AI checks and `needs_reverification` handling. Those edits are present, NOT independently approved or proven live by this plan.
- The last local configuration check found all eight required `CODE_ACTIVITY_*` connection values absent. Do not assume a working GitHub App exists.
- Feature schemas remain draft files outside `supabase/migrations/`. No live database or GitHub connection is established by writing this plan.

## Screen contract

Keep the existing List header, tabs, Katalist typography, white surfaces and purple primary action. Use a compact connector card with a GitHub icon, a clear heading and one primary action. No sample repositories, invented connection status, mock feed, redundant giant empty cards, or user-facing secret forms.

| State | What the owner sees | Action/network behavior |
|---|---|---|
| Loading readiness | Connector card with loading indicator | Connect disabled; no GitHub request |
| Feature unavailable (`enabled=false`) | “GitHub connection is unavailable for this List.” | Connect visible but disabled; do not claim missing credentials or disclose allowlist details |
| Enabled, backend not configured | “GitHub integration is not enabled yet. Katalist's operator needs to finish setup.” | Connect visible but disabled; no fake authorization link or provider request |
| Ready, no connection | “Connect GitHub” / “Use your GitHub account to choose a repository for this List.” | Enabled Connect GitHub button |
| Authorization starting | “Opening GitHub…” | Disable repeated clicks; navigate only to the verified GitHub authorization URL |
| Repository selection | Verified repositories, search, Load more, Cancel | Select one verified proof; no arbitrary repository-ID field |
| No accessible repository | Explain access/install step | Install/manage access on GitHub; Continue/retry existing OAuth flow |
| Sharing review | Repository identity and all-List-member sharing warning | Unchecked acknowledgement required before final Connect |
| Connected | Real repository, actual freshness, Refresh and owner Manage | Initial bounded sync; real rows or honest empty/error state |
| Revoked/access uncertain | “GitHub access needs verification.” | No saved private feed; owner uses the existing disconnect/reconnect path with fresh proof |
| Cancelled/failed | Clear reason and Retry | Never claim connected; preserve Katalist login and other tabs |

Collaborators and View Only members never get an enabled connection-management action. For an eligible, unconnected List, show “Only the List owner can connect GitHub.” Server authorization remains the authority; visibility of a button is not permission.

Use the current capabilities API. Separate its existing `enabled` and `configured` outcomes in the client; no new public setup/status endpoint is needed. Keep outsider responses neutral. Never expose secret names or values through member-facing readiness messages. Network failure is an error with Retry, not a claim that the App is unconfigured.

## Six bounded tasks

### C01 — Snapshot and verify the existing corrections

Read branch/dirty-file state and the latest ledger. Preserve all unrelated changes. Inspect the updated reconnect and access-uncertain checks, including provider reads, feed reads, direct confirmation RPCs and installation unsuspend behavior.

Run the existing targeted regressions for (a) disconnect then reconnect to a different repository at the same generation, and (b) overflow followed by feed/read/confirmation/unsuspend attempts. Do not reopen the whole architecture or repeat G00–G16. Record pass/fail and exact remaining fixes. Do not call schema drafts approved based only on PGlite.

Acceptance: the two previously reproduced bypasses are denied, with connection ID AND generation binding and persistent re-verification blocking. Existing valid connections still work in tests.

### C02 — Make the connection action discoverable

Allowed files: `src/features/code-activity/CodeActivityRoot.tsx`, `ConnectionPanels.tsx`, `live/use-connection.ts`, and focused feature tests. Touch List routing only if a demonstrated callback-return bug requires a minimal fix.

Implement the screen contract above. Reuse `UnconnectedPanel` and the existing start action; adapt the setup panel rather than add a second OAuth implementation. Render an owner-visible Connect GitHub button even while unavailable, but clearly disabled with the correct explanation. Once ready, the SAME action becomes usable.

Acceptance: configured owner sees enabled Connect; unconfigured owner sees disabled Connect plus setup explanation; feature-disabled state does not falsely accuse missing credentials; non-owner cannot connect; API failure shows Retry. No credentials form, fixtures or new global styles. Keyboard focus, disabled semantics and mobile layout work.

### C03 — Prepare the one-time operator bootstrap

Reuse `operator-setup-guide.md`. Keep operator work separate from end-user onboarding. Verify whether an existing Katalist-owned GitHub App can be reused; otherwise the operator creates a development App with the exact callback and read-only permissions. An App intended for other users must have appropriate installation availability; the initial private test can stay restricted to its test account.

Register the exact local callback:

`http://localhost:8080/api/code-activity/github/authorize/callback`

Configure these server-only values in an uncommitted local environment or approved secret store:

`CODE_ACTIVITY_GITHUB_APP_ID`, `CODE_ACTIVITY_GITHUB_APP_SLUG`, `CODE_ACTIVITY_GITHUB_CLIENT_ID`, `CODE_ACTIVITY_GITHUB_CLIENT_SECRET`, `CODE_ACTIVITY_GITHUB_PRIVATE_KEY`, `CODE_ACTIVITY_STATE_SECRET`, `CODE_ACTIVITY_GITHUB_CALLBACK_URL`, `CODE_ACTIVITY_ALLOWED_ORIGINS`.

Check the existing server-only Supabase service credential is available in the test environment. Never put secrets in `VITE_*`, frontend code, chat, evidence screenshots or source control. Validate and report presence/validity by name only. Confirm the running server actually loads the values after restart; configuration written to disk is not proof.

Acceptance: the operator has a real App and server credentials; the test user only authorizes their account and selected test repository. Missing configuration disables only Code Activity. No global-auth change, PAT fallback, or reuse/export of Codex credentials.

This task needs operator participation. Continue independent UI/test preparation if credentials are missing; report the live gate honestly rather than inventing credentials or a successful connection.

### C04 — Prepare an isolated database and activate one test List

After explicit approval of the corrected schemas AND the exact database target, promote the read-only dependency set into individually applied migrations in order: g03, g07, g11, g12. The current provider meter needs g12's budget functions, which depend on g11's queue schema; applying those structures does NOT enable webhooks or scheduled processing. Defer g14/g15 and their AI/Thing-creation acceptance to a later authorized gate. Check timestamps against the current migration directory; no automatic shared/prod application.

Use a separate test database containing Katalist's base schema, with a separate test app process/configuration. Do NOT repoint the user's currently signed-in app to another Supabase project without approval. Do not replace its auth keys or modify global login behavior as a shortcut.

Verify real PostgREST/RPC transport, grants/RLS and concurrency across at least two database connections. Confirm absent optional AI functions are handled as unavailable rather than breaking capabilities. Verify the real `create_thing` integration only when the later g15 gate is authorized; it is not a blocker for the read-only connector. Enable only `master` and one newly created test List's allowlist entry. Keep `ai` and `sync` off for the first manual-Refresh milestone. Use the actual test List ID, not an unverified ID copied from the current app screenshot.

Acceptance: owner sees eligible readiness; collaborator/View Only can read only after connection; outsiders cannot probe or read private data; direct RPC mutation checks hold; duplicate connect is prevented. No existing application tables, policies or creation functions are changed.

### C05 — Exercise the real connector in the browser

Reuse current routes: capabilities, `POST github/authorize/start`, `GET github/authorize/callback`, repository selection, connection lifecycle, feed, Refresh and detail. Preserve the current Katalist session across GitHub navigation. Return to the same List with Code Activity selected. Install/update GitHub access when needed, then continue through verified proofs.

Run this against a real test App/repository and the approved test database:

1. Click Connect GitHub; authorize the existing GitHub account; select one verified repository; acknowledge sharing; connect.
2. Reload and verify persistence. Initial sync or Refresh shows real pull requests/pushes/checks; opening a row shows real detail.
3. Cancel GitHub authorization; deny repository access; use an expired/replayed callback; double-click Connect. No false connection, duplicate row or Katalist logout.
4. Test empty repository, no accessible repositories, provider timeout and failed Refresh. Preserve last good data only while authorization remains valid.
5. Check owner/collaborator/View Only/outsider behavior; disconnect; reconnect a DIFFERENT repository; ensure old data and in-flight results cannot cross the boundary.
6. Check nonce cookies through the actual GitHub redirect in Chrome; record Firefox/Safari as passed or untested, never infer them from Chrome.
7. Check Things, Chat, Members and Call remain usable after a feature render/chunk failure and provider error.

Acceptance: actual end-to-end browser evidence, not mocked fetches or an unauthenticated 401. Never record secrets, authorization codes, state, nonce cookies or tokens in the evidence.

### C06 — Consolidated handoff and completion

Run feature tests serially for the acceptance result; separately investigate parallel timeout failures rather than dismissing them. Run relevant SQL/integration tests and browser tests. Run full tests, typecheck, lint and build once at the final code milestone, comparing exact failure names with the current ledger. Do not fix unrelated failures without authorization.

Update the ledger with code status, operator readiness, schema target/application status, browser outcomes and unresolved external gates. Make one consolidated review/handoff, not a new review request after every small file edit.

“Connector complete locally” means the owner really connected their existing account, chose a repository, loaded real activity, survived reload and disconnected safely in normal `npm run dev` with demo mode false. A visible button, passing mocks, or configured environment alone is NOT completion. Production remains hidden and undeployed unless separately authorized.

## Scope and containment

- No application code is changed by this plan.
- Implementation stays in Code Activity modules, tests and narrowly scoped route integration. Preserve existing auth, Court, Magic Box, push, calls, Morning Brief/genie and shared Thing edits.
- Keep the error boundary outside the lazy chunk. Do not disable authorization or flags just to display a working-looking button.
- Read-only Metadata, Contents, Pull requests, Checks and Commit statuses; verify both user and installation access. Runtime tokens stay narrowed to the selected repository.
- Retain single-use state, browser nonce, PKCE S256, fixed redirect origins, proof consumption, List-sharing acknowledgement and connection-ID-plus-generation fencing.
- User/account authorization does not automatically connect a repository or enable AI. No automatic creation or writes on GitHub.
- Local failure disables this feature/connection; it must not trigger app-wide logout, cleanup of user edits or resets. Shared database/provider resource limits still need measurement; do not promise mathematically zero shared-resource impact.
- No GitHub App creation, credentials editing, migration application, commit, push, scheduler registration or deployment without the appropriate explicit authorization. Do not rewrite published Lovable-connected history.

## Implementer handoff

Execute only the C-task range explicitly authorized by the user. Reuse the already-built G implementation; do not restart it. Complete authorized code/tests as one focused batch, preserve unrelated files and stop before external setup or schema application that lacks approval. Keep operator bootstrap separate from the owner-facing OAuth flow. Report “code built”, “test backend configured” and “live flow passed” separately. Never mark the connector done until C05 actually passes.

## Provider basis

GitHub's web application flow requires the App's client ID, callback, server-side exchange and authorization state; PKCE S256 is documented. The ordinary user authorizes their existing account, not a new application registration: [GitHub user authorization](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app).

Installation tokens can be restricted to repository IDs and permissions; keep that restriction even if the App installation covers more repositories: [GitHub installation-token documentation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app).
