# Code Activity — G01 Contract Delta (live connection)

**Status: DRAFT v4.3 delta. NOT REVIEWED. NOT FROZEN. NOT APPROVED.** Re-review requested, not held (see `rereview-request.md`). Nothing here authorizes G03 or later work.
Recorded: 7 October 2026. Branch `katalist-plan/batch-a-baseline`, base `71be5b6`. Builds on `contracts.md` (v3) and `live-functionality-plan.md`. Where this file disagrees with v3, this file is the proposal; v3 stays in force until review.
Reviewers: **none recorded.** Architecture and authorization re-review (see `ledger.md`) remain CHANGES REQUESTED. No item below is marked approved.

Labels as in v3: ESTABLISHED (committed code or repository file), OFFICIAL (provider documentation, see `provider-evidence.md`), PROPOSED, OPEN, UNVERIFIED.

## Contract gaps and their disposition

| # | Gap | Disposition | Detail |
|---|---|---|---|
| C1 | Connection and proof schemas | PROPOSED, needs review | Section 1 |
| C2 | Repository-selection endpoint missing from v3 E1 to E15 | PROPOSED, needs review | Section 2 |
| C3 | Status and Refresh endpoints missing | PROPOSED, needs review | Section 2 |
| C4 | Flags: names, storage, fail-closed rule | PROPOSED, needs review | Section 3 |
| C5 | Local callback origin and cookie behavior | Chromium **VERIFIED** by a probe on `http://localhost`; Firefox and WebKit **UNVERIFIED** | Section 4 |
| C6 | Token handling | PROPOSED, needs review | Section 5 |
| C7 | Source mapping (pull request, push, check, patch) | PROPOSED; push history **UNVERIFIED** | Section 6 |
| C8 | Limits | PROVISIONAL, unchanged from v3 section 7 | Section 7 |
| C9 | Hosting and scheduler | **OPEN** (D17) | Section 8 |
| C10 | Error codes | PROPOSED | Section 2 |

## 1. Connection and proof schemas (C1)

Additive only. Feature-owned tables with the `code_activity_` prefix. No change to `lists`, `list_members`, `things`, `create_thing`, shared triggers, or their policies. Final column types are fixed at G03 against the then-current migration list (latest today: `20261006160000_device_session_limit.sql`).

| Table | Purpose | Key columns (proposed) |
|---|---|---|
| `code_activity_connections` | One live connection per List | `id`, `list_id`, `owner_profile_id`, `installation_id`, `repository_id`, `repository_full_name`, `status` (`pending_repository`, `active`, `suspended`, `revoked`, `disconnected`), `generation`, `sharing_acknowledged_at`, `connected_at`, `disconnected_at`, `last_synced_at`, `sync_status` |
| `code_activity_auth_states` | Single-use authorization state | `state_hash`, `profile_id`, `list_id`, `flow` (`oauth`, `install`), `nonce_hash`, `expires_at`, `consumed_at` |
| `code_activity_selection_proofs` | Server-written proof that the GitHub user and the installation both reach a repository | `id`, `list_id`, `profile_id`, `nonce_hash`, `installation_id`, `repository_id`, `repository_full_name`, `visibility`, `expires_at`, `consumed_at` |
| `code_activity_settings` | Master, sync, and AI switches | `key`, `enabled` |
| `code_activity_list_allowlist` | Lists permitted | `list_id` |

Rules:
- A partial unique index allows at most one live (`pending_repository`, `active`, `suspended`) row per List. Terminal rows stay for history.
- **Table access is per table, defined in the matrix below.** There is no blanket "authenticated may read" rule. Every new table has RLS enabled and `REVOKE ALL` from `PUBLIC`, `anon` and `authenticated` (tables and sequences) before anything is granted back.
- The proof stores the repository identity. The connect function derives the repository from the proof and never from client input.
- Tokens, private keys, and raw payloads are never stored. Only hashes of the state and nonce are stored.

### Per-table grants and row-level security (supersedes the grants wording in v3 section 3 and section 1 above)

Terms: `authenticated` = signed-in Katalist user on the user-scoped client. `service_role` = server-only credential. "Definer" = `SECURITY DEFINER` function with a fixed `search_path`. "Private" = **no grant and no policy for `authenticated`**.

**Server access rule (corrects v4.2, which listed writes only).** `service_role` bypasses row-level security, but **RLS bypass does not replace SQL privileges**: a role still needs `GRANT`s, and Supabase default privileges may have granted new tables to `service_role`, `authenticated` and `anon`. Therefore for the G03 tables:
1. Every table gets `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role`. G03 must also inspect `pg_default_acl` in the target project, because defaults can re-grant on later objects.
2. **`service_role` receives no direct table privilege on any G03 table.** All server reads and writes go through **server-only definer functions** executable by `service_role` only. Each re-checks ownership, archive state and flags in SQL, because a server function has no `auth.uid()`; the route passes the profile id it verified from the Bearer token, and the function never trusts it without checking `lists.owner_profile_id`.
3. Function privileges are explicit: `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role`, then `GRANT EXECUTE` to the intended role only. Function defaults are not trusted.

| Table | `authenticated` | Server access (functions only; no table privilege for `service_role`) |
|---|---|---|
| `code_activity_auth_states` | **None. Private** | Created by user function `code_activity_start_authorization` (owner, flags, no live connection, 5 per 10 minutes). Read and consumed only by `code_activity_server_consume_auth_state(state_hash, nonce_hash)`: one atomic update that requires **both** hashes, so a wrong cookie neither succeeds nor burns the state; then rechecks owner, archive, flags |
| `code_activity_selection_proofs` | **None. Private** | Written only by `code_activity_server_write_selection_proofs` (max 300 items, owner and flags rechecked, replaces unconsumed proofs, 15 minute expiry). Read for the installation check only by `code_activity_server_get_proof`. Marked verified only by `code_activity_server_mark_proof_verified`. Details below |
| `code_activity_settings` | **None. Private** | None directly. Flags are read inside definers (`katalist_priv.code_activity_flag`, not executable by any client or server role). Written only by an operator through the SQL console or an operator-run migration |
| `code_activity_list_allowlist` | **None. Private** | Same as settings |
| `code_activity_connections` | **Column-limited `SELECT`** (below) through the read predicate. No other privilege | Provider reads only through `code_activity_server_connection_for_provider(list_id, expected_generation)`: returns installation id, repository id and generation for an **active** connection, only when flags are on. Status transitions only inside `code_activity_connect` and `code_activity_disconnect` (user functions) and later reviewed server functions (G12) |
| deliveries, budget, confirmations, changes, checks, consents | Defined in their own gates (G07, G11, G12, G14, G15). They follow the same rule: no direct `service_role` table privilege unless that gate's review justifies it | Not part of G03 |

- **No `INSERT`, `UPDATE` or `DELETE` privilege exists for `authenticated` on any table.**
- **Read predicate** (connections): `status IN ('active','suspended')` AND `katalist_priv.code_activity_enabled_for(list_id)`. `enabled_for` includes `can_view_list`, so a non-member learns nothing about the allowlist; it also requires the master flag, an allowlist entry and an unarchived List. It is the only flag helper executable by `authenticated`.
- **Connection columns granted to `authenticated`:** `id`, `list_id`, `status`, `repository_id`, `repository_full_name`, `display_refreshed_at`, `sharing_acknowledged_at`, `last_synced_at`, `sync_status`, `created_at`, `disconnected_at`. A client `select *` therefore fails; routes must name columns. Never `installation_id`, `connected_by_profile_id`, `generation`, `updated_at` or lease fields.
- **Terminal states.** `code_activity_connection_status(list_id)` (definer, `authenticated`) returns `{ status, repository_full_name, last_synced_at, sync_status }` for the latest connection, including `revoked` and `disconnected`, only when `enabled_for` holds.

#### Complete function signatures (supersedes the v4.2 proof-access text)

| Function | Role | Signature | Mandatory checks |
|---|---|---|---|
| `code_activity_start_authorization` | authenticated | `(p_list_id uuid, p_flow text, p_state_hash bytea, p_nonce_hash bytea) returns timestamptz` | `auth.uid()` owns the List; flags; flow in (`oauth`,`install`); both hashes exactly 32 bytes; no live connection; fewer than 5 starts in 10 minutes |
| `code_activity_list_selection_proofs` | authenticated | `(p_list_id uuid, p_nonce_hash bytea, p_after text default null, p_limit integer default 50)` returns `(proof_id, repository_full_name, visibility, repository_updated_at)` | owner; flags; proof `profile_id = auth.uid()`; **`nonce_hash = p_nonce_hash`**; unexpired; unconsumed; limit capped at 50. Never returns installation id, repository id or nonce hash. Returns an empty set (not an error) otherwise |
| **`code_activity_connect`** | authenticated | **`(p_list_id uuid, p_proof_id uuid, p_nonce_hash bytea, p_sharing_acknowledged boolean) returns uuid`** | `auth.uid()` owns the List; flags; `p_sharing_acknowledged IS TRUE`; `p_nonce_hash` exactly 32 bytes; the proof row is locked and must satisfy **all of**: `id = p_proof_id`, `list_id = p_list_id`, `profile_id = auth.uid()`, **`nonce_hash = p_nonce_hash`**, unexpired, unconsumed, **`installation_verified_at IS NOT NULL`**. Every failure raises the identical error `not allowed` (SQLSTATE 42501) so the cause is not an oracle. Consumes the proof, deletes the caller's other unconsumed proofs, inserts the `active` connection from the **proof's** installation and repository ids. A second live connection raises `already connected` (23505). It accepts no installation id and no repository id |
| `code_activity_disconnect` | authenticated | `(p_list_id uuid, p_confirm boolean) returns uuid` | owner; flags; `p_confirm IS TRUE`; sets `disconnected`, `generation + 1`; deletes unconsumed proofs; NULL when nothing was live |
| `code_activity_connection_status` | authenticated | `(p_list_id uuid)` | `enabled_for` |
| `code_activity_server_consume_auth_state` | service_role | `(p_state_hash bytea, p_nonce_hash bytea)` | as in the table above |
| `code_activity_server_write_selection_proofs` | service_role | `(p_list_id uuid, p_profile_id uuid, p_nonce_hash bytea, p_items jsonb) returns integer` | `p_profile_id` owns the unarchived List; flags; array of at most 300; nonce hash 32 bytes |
| `code_activity_server_get_proof` | service_role | `(p_proof_id uuid, p_list_id uuid, p_profile_id uuid, p_nonce_hash bytea)` | same binding as connect; returns installation id, repository id and name |
| `code_activity_server_mark_proof_verified` | service_role | `(p_proof_id uuid, p_list_id uuid, p_profile_id uuid, p_nonce_hash bytea) returns boolean` | same binding. **New in v4.3:** the route calls it only after minting a narrowed installation token and confirming the repository is reachable. `connect` refuses a proof without it, so **a direct RPC caller cannot skip the installation check** (v4.2 left that step route-only) |
| `code_activity_server_connection_for_provider` | service_role | `(p_list_id uuid, p_expected_generation integer default null)` | `active` only; flags; generation match when supplied |

#### Why a client-supplied nonce hash is acceptable, and its limits

A client-supplied argument is **not trusted by itself**. Security rests on four properties:
1. **Unguessable.** The nonce is 256 random bits generated by the server. The database stores only its SHA-256 hash and the browser holds only the raw value in an `HttpOnly` cookie, which script cannot read.
2. **Never exposed.** No function returns `nonce_hash`. The route computes the hash from the cookie on the server and never accepts a nonce or hash from the request body, query or headers. Logs, error messages and analytics must not record the cookie or the hash.
3. **Compared against a bound proof.** The hash is only ever matched together with `profile_id = auth.uid()` (or the verified profile id for server functions) and `list_id`. A hash alone selects nothing.
4. **Short life and single use.** Proofs expire after 15 minutes and are consumed at connect.

**Residual risk to review.** PostgREST or Supabase API logs may record RPC arguments, which would put `p_nonce_hash` in logs. The hash is not the cookie, and an attacker would also need the user's Bearer token and an unexpired, unconsumed, **server-verified** proof, but the reviewers should decide whether that is acceptable or whether the route should call the functions only from a server context that avoids argument logging. A second server-held binding is the alternative.

#### View Only and consent (product decision, not made here)

The reviewer recommends exposing **only the `enabled` boolean** to View Only members and keeping consent audit metadata (who, when) owner-only. I have **not** decided this. Consent is not part of G03 (`code_activity_consents` arrives with G14), so no draft SQL implements it. The proposal for review: no `authenticated` table grant on the consent table; `code_activity_consent_enabled(list_id)` returns a boolean to any member; audit fields through an owner-only function. **Decision needed from the product owner.**

**Resolved (PROPOSED, Gap 2):** `repository_id` is the identity and the only value used for authorization and provider calls. `repository_full_name` is stored only as a **display snapshot** with `display_refreshed_at`, updated on each sync from the repository ID, and never used to build a provider path or to match a proof. A rename therefore cannot redirect a connection. **UNVERIFIED:** that GitHub's repository-by-ID endpoint (`GET /repositories/{id}`) works with a narrowed installation token. G04 must confirm it with a mocked call and against documentation before relying on it; if it does not, refetch through `GET /installation/repositories` instead.

## 2. Endpoints (C2, C3, C10)

Retains E1 to E15 from v3. Adds three and fixes shapes for the first live milestone. All authenticated replies carry `Cache-Control: private, no-store`. Error envelope is `{ "error": "<code>", "message": "<neutral text>" }`.

| # | Method and path | Roles | Notes |
|---|---|---|---|
| E1 | `GET capabilities?listId` | Any caller | Returns `{ configured, enabled }` only. Non-members and unknown Lists receive the same body as disabled. **Resolved (PROPOSED, Gap 1):** the body is `{ enabled }` for every caller and is byte-identical for non-members, unknown Lists, and disabled features. A member of that List additionally receives `configured`. Membership is checked first with the user-scoped client, before any configuration is read, so the reply cannot reveal whether the operator has set up the App to an outsider |
| E2, E3 | `POST github/authorize/start`, `GET github/authorize/callback` | Owner; state-bound | As v3 section 6.2 |
| **E16 (new)** | `GET github/repositories?listId&cursor` | Owner | Returns only unexpired proofs bound to this caller and List: `{ items: [{ proofId, fullName, visibility, updatedAt }], nextCursor }`. Page size 50. **Never** returns global installations or lets a client name a repository ID |
| E4 | `POST connection` | Owner | Body `{ listId, proofId, sharingAcknowledged: true }`. The body **never** carries a nonce or hash: the route derives `nonce_hash` from the `ca_connect_nonce` cookie. Sequence: verify Bearer; `server_get_proof`; mint a token narrowed to that repository and confirm it is reachable; `server_mark_proof_verified`; call `code_activity_connect` on the user-scoped client; clear the cookie. Repository derived from the proof |
| E17 (new) | `GET connection?listId` | Owner, collaborator, view_only | Status and display identity only: `{ status, repositoryFullName, connectedAt, lastSyncedAt, syncStatus }`. Never tokens or proof data |
| E5 | `DELETE connection` | Owner | Body `{ listId, confirm: true }`. Increments `generation` |
| E7 | `GET feed?listId&cursor` | Members | Stable cursor, 25 default and 50 maximum, with freshness |
| **E18 (new)** | `POST refresh` | Owner, collaborator | Body `{ listId }`. List-scoped, rate limited, reuses an active job. Returns `{ syncStatus }` and a cursor when partial. View Only cannot refresh (matches `access.ts`) |
| E8, E9 | `GET changes/{id}/checks`, `.../patch?revision&path` | Members | Authorize the owning connection first |

Error codes (C10): `disabled`, `not_allowed`, `not_configured`, `source_unavailable`, `rate_limited`, `timed_out`. Status mapping proposed: 403 `not_allowed`/`disabled` (identical body), 503 `not_configured`, 502 `source_unavailable`, 429 `rate_limited`, 504 `timed_out`. **Unauthorized and disabled must be indistinguishable to a caller who is not a member.** AI endpoints E10 to E13 are outside the first milestone (G14, G15).

## 3. Flags (C4)

- Keys: `master`, `sync`, `ai`, plus the List allowlist. Stored in `code_activity_settings` and `code_activity_list_allowlist`, **not** `public.app_config` (readable by every signed-in user, v3 section 5).
- Absent or unreadable means off. Every handler and database function reads flags per call. Missing GitHub secrets disable only Code Activity.
- The current client gate (`resolveCodeActivityPreview`, development only) is a **UI visibility gate**. It is not authorization and must not be used as one. In G02 it only decides whether the tab appears.
- Nobody changes flags through the product; only the service role can. Production stays off until explicitly enabled after review.

## 4. Local callback and cookies (C5)

- Dev server: `npm run dev` runs `vite dev --host 0.0.0.0 --port 8080 --strictPort` (ESTABLISHED, `package.json`, `vite.config.ts`). The only stable origin is `http://localhost:8080`.
- Proposed callback: `http://localhost:8080/api/code-activity/github/authorize/callback` for local development, and one exact HTTPS URL per deployed environment. GitHub Apps list callback URLs exactly; wildcards stay off.
- **Probe result (Gap 3), 7 October 2026.** A throwaway Node server on `http://localhost:<port>` sent `Set-Cookie: ca_nonce=...; HttpOnly; Secure; SameSite=Lax; Path=/api/code-activity; Max-Age=600`. In headless Chromium 153 (Playwright) the cookie **was stored and returned** on the next same-origin request to the cookie path. Firefox and WebKit could not be launched (the installed Playwright browser builds do not match the installed library), so those are **UNVERIFIED**, and Playwright WebKit is not Safari in any case. The probe covers only same-origin top-level navigation, not the GitHub redirect back to the callback (a cross-site top-level GET, which `SameSite=Lax` permits by specification but which this probe did not exercise). The probe script lived in the session scratch area and is not part of the repository.
- **Consequence (PROPOSED).** No loopback exception is needed for Chromium. The cookie stays `Secure` everywhere. G05 must repeat the test in Firefox and Safari and through a real GitHub redirect before the local flow is called supported. If a browser rejects it, the fallback is an explicit, development-only, loopback-host-only non-Secure variant covered by a test that production never takes it.
- Trusted origins come from an explicit server allowlist. Never derive a redirect from the `Host` header.
- **One cookie, one path, covering the whole connect flow (PROPOSED).** Name `ca_connect_nonce`. Attributes: `HttpOnly; Secure; SameSite=Lax; Path=/api/code-activity`. The path is the common prefix of every route that checks it:

  | Step | Route | Checks the cookie |
  |---|---|---|
  | Start (E2) | `POST /api/code-activity/github/authorize/start` | **Sets** it (same-origin response to an authenticated request) |
  | Callback (E3) | `GET /api/code-activity/github/authorize/callback` | Yes; **re-issues** it (see lifetime) |
  | Repository selection (E16) | `GET /api/code-activity/github/repositories` | Yes; derives `nonce_hash` for the read function |
  | Final connect (E4) | `POST /api/code-activity/connection` | Yes; derives `nonce_hash` for `code_activity_connect`; **clears** it on success |
  | Disconnect (E5) | `DELETE /api/code-activity/connection` | Clears it |

  The prefix also covers other `/api/code-activity/**` routes (feed, checks, patch, capabilities), which will receive the cookie but must ignore it. It carries only a random nonce, is HttpOnly, and is cleared at connect, so this is accepted. A narrower design (separate cookies per route) is rejected as more error-prone. The v3 phrase "callback family" is retired and replaced by this table.
- **Lifetime (corrects the 10 minute figure).** The state lives 10 minutes, but a proof lives 15 minutes **after** the callback, and the owner reads the sharing notice during that time. A 10 minute cookie would expire first. So: Start sets `Max-Age=600`; the callback re-issues the **same nonce** with `Max-Age=900`; connect, disconnect and a failed or expired flow clear it with `Max-Age=0`. A missing or mismatched cookie fails with the neutral error and no provider request.
- **What the Chromium probe did and did not cover.** The probe used `Path=/api/code-activity` and requested `/api/code-activity/probe` only. It did not request the five routes above and did not follow a GitHub redirect. G05 must test each route in the table.
- Webhooks need a reachable HTTPS endpoint. Manual Refresh must work without one. No tunnel is created by the implementer.

## 5. Token handling (C6)

- The GitHub user token lives in memory for one callback request, is never logged, stored, placed in a URL, or sent to the browser, and is discarded after proofs are written.
- App credentials are server-only and never carry a `VITE_` prefix. Exact **proposed** names follow. **This documents names only: no value exists in this repository, none is requested here, and `.env.example`, `.env`, `vercel.json`, `netlify.toml` and every other config are unchanged.** A search of the repository found no existing variable with the `CODE_ACTIVITY_` prefix.

  | Name | Secret | Meaning | First needed |
  |---|---|---|---|
  | `CODE_ACTIVITY_GITHUB_APP_ID` | No | Numeric GitHub App ID | G04 |
  | `CODE_ACTIVITY_GITHUB_APP_SLUG` | No | App slug, used in `https://github.com/apps/<slug>/installations/new` | G05 |
  | `CODE_ACTIVITY_GITHUB_CLIENT_ID` | No | OAuth client ID; also the `iss` of the App JWT per v3 6.2 | G04 |
  | `CODE_ACTIVITY_GITHUB_CLIENT_SECRET` | **Yes** | OAuth client secret for the code exchange | G05 |
  | `CODE_ACTIVITY_GITHUB_PRIVATE_KEY` | **Yes** | App private key (PEM) used to sign the App JWT. How a multi-line PEM is stored (escaped newlines or base64) is decided at G04 | G04 |
  | `CODE_ACTIVITY_GITHUB_WEBHOOK_SECRET` | **Yes** | HMAC secret for webhook signature checks | G11 |
  | `CODE_ACTIVITY_STATE_SECRET` | **Yes** | Server secret for the PKCE verifier derivation, HMAC(secret, state and nonce) | G05 |
  | `CODE_ACTIVITY_GITHUB_CALLBACK_URL` | No | The one exact registered callback URL for this environment | G05 |
  | `CODE_ACTIVITY_ALLOWED_ORIGINS` | No | Comma-separated exact origins allowed for redirects and cookies, for example the local and deployed origins | G05 |

  Not proposed here: a scheduler secret for E15. The existing `CRON_SECRET` is already read by `src/routes/api/jobs/*.ts`; whether E15 reuses it or gets its own name is **OPEN** for G12 and the hosting answer (D17). Sarvam or other AI variables are out of scope until G14. Missing or empty values make `capabilities` report not configured and disable only this feature. Nothing validates them at application startup.
- Installation tokens are minted per use, held in memory, expire in one hour, and are narrowed to the single connected repository ID and the minimum permissions per call (D14, v3 6.1). A token that covers other repositories is never used for reads.
- GitHub authorization links an account to this flow only. It never creates or replaces the Katalist session.
- No secret is eagerly validated at application startup.

## 6. Source mapping (C7)

| Katalist field | GitHub source | Note |
|---|---|---|
| Pull request row | `GET /repos/{o}/{r}/pulls` and per-PR detail | State `draft`, `open`, `merged`, `closed`. Counts nullable when the list endpoint omits them |
| Push row | Webhook `push` identifiers, then refetch commits or compare | **UNVERIFIED:** `GET /repos/{o}/{r}/activity` with the push filter can backfill, but completeness, token type, and pagination are tested in G07. History it cannot reconstruct is an explicit `gap`, never invented |
| Files | PR files or compare files | At most 300 listed (v3 section 7) |
| Checks | Check runs plus commit statuses for the head SHA | Bound to the head SHA. States `passed`, `failing`, `pending`, `none`, `unavailable` |
| Patch | File `patch` field | `available`, `binary`, `omitted`, `truncated`, `empty`, `unavailable`. 100 KiB and 2,000 lines per file |

## 7. Limits (C8)

No change to v3 section 7. All remain PROVISIONAL: one repository per List, 50 rows per feed page, 8 second provider deadline, 30 second sync slice, two jittered retries for safe reads, `Retry-After` respected. G01 has **not** validated aggregate call and time limits, database leases, or pagination resumability against a real run. They must not be treated as contracts yet.

## 8. Hosting (C9)

**OPEN.** `vercel.json` defines two daily crons (ESTABLISHED), and `netlify.toml` sets `NITRO_PRESET = "netlify"` (ESTABLISHED). Nothing in the repository establishes which host serves production, its plan, or whether Fluid compute applies. Per the existing Vercel pricing evidence, Hobby cron is daily only. Until confirmed, sync is manual Refresh and any scheduled drain is "stale/manual-refresh", never "real time". The operator must answer: which host, which plan, and whether a minute-level scheduler exists. G11 and G12 cannot start without it.

## 9. G02 scope clarification

G02 implements only what is true without a server: the tab shows **"GitHub connection is not configured yet"** because no capabilities endpoint exists and no operator setup is recorded. No request is made. The Connect panel exists with a disabled button that says connecting is not available in this build yet. Selecting a repository, the live connection state, and any feed are G05 to G08.

## Review blockers (nothing here is approved)

1. Architecture re-review of v3 plus this delta: not held.
2. Authorization and sharing re-review (proof binding, definer functions, direct RPC denial): not held.
3. Reviewer acceptance of the E1 disclosure rule (members only see `configured`).
4. Reviewer acceptance of storing `repository_full_name` as a display snapshot, and confirmation of the repository-by-ID call.
5. Hosting and plan (D17).
6. Cookie behavior: Chromium passed a same-origin probe. Firefox, Safari, and the real GitHub redirect are untested (C5).
7. Push backfill completeness (C7).
8. Operator creates and configures the GitHub App (external action; not done, not authorized).

## Not done

No migration, schema, route, secret, App registration, or provider call exists. No contract is marked approved or frozen.
