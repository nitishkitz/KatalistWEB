# Code Activity — T02 Contracts

**Status: DRAFT v3 — NOT REVIEWED FOR FREEZE.** Nothing here is frozen. Application implementation and migration work are not authorized.
Recorded: 7 October 2026. Base: `71be5b6fa273374d0e8802cfc100d86e7c8e577b` (see `baseline.md`).
Supporting files: `provider-evidence.md` (provider and platform evidence), `corrections.md` (corrections to the plans and mockups), `ledger.md`, and the T03 design drafts in `design/`.

> **Superseded in part (7 October 2026, still DRAFT).** `contract-delta.md` v4.2 replaces: the grants wording in section 3 with a per-table matrix and separate proof access; "callback family" cookie wording with one cookie table and lifetime; and the credential description with exact environment names. Where the two disagree, the delta is the current proposal and neither is approved.

## Review status

| Review | Reviewer | Status | Summary of the request |
|---|---|---|---|
| Architecture | Codex chat | **CHANGES REQUESTED** | Reconciliation promises, shared resource bounds, lifecycle transitions, runtime validation (findings F5, F6) |
| Authorization and sharing | Codex chat | **CHANGES REQUESTED** | Repository-level authorization proof, mandatory browser binding, database-boundary enforcement (F1, F2, F4) |
| Atomic confirmation | Codex chat | **CHANGES REQUESTED** | Transaction approach judged reasonable. Retention, replay semantics, and direct-RPC enforcement unresolved (F3, F4) |
| Product choices | Product owner | Retained | |
| Production enablement | Product owner | Retained | |

v3 revises the contract for all six findings below. It has not been re-reviewed. Unresolved findings continue to block freezing and every dependent task.

## Changes since v2

| Finding | Where addressed |
|---|---|
| F1 Installation access is not repository authorization | 6.2 steps 3 to 5; table `code_activity_selection_proofs` |
| F2 Callback browser binding was optional | 6.2 steps 1, 2, 6; PKCE; installation path demoted to non-identity |
| F3 Thirty-day receipt deletion allows later duplicates | 3 (`code_activity_confirmations`), 8.3 |
| F4 Route checks do not protect directly callable database surfaces; contradictory service-role rules | 1, 3 (RLS and grants), 5, 8.3 |
| F5 Reconciliation cannot reconstruct everything | 9 (outcomes, history gaps) |
| F6 Resource and lifecycle guarantees incomplete | 6.4 (state machine), 7 (limits), 9 (leases, budgets), 10 (runtime) |
| Decisions D13, D14, D17 | Decisions table |
| New defect found while checking flag storage | 5: `public.app_config` is readable by every signed-in user, so flags cannot live there |
| New defect found while checking the platform | 7: Vercel caps request bodies at 4.5 MB; the v2 webhook limit exceeded it |

Labels: **ESTABLISHED** (committed code), **OFFICIAL** (provider or platform documentation, see evidence file), **PRODUCT DECISION**, **PROVISIONAL** (engineering default with rationale), **OPEN**, **UNVERIFIED**.

## Decisions

| # | Decision | State |
|---|---|---|
| D1 | API style: TanStack server routes under `src/routes/api/code-activity/**` | PROPOSED; review pending |
| D2 | Request-based auth helper (existing `requireUser` takes an H3 event) | PROPOSED; review pending |
| D3 | View Only members may read activity, checks, and available diffs. They cannot connect, disconnect, change consent, draft, create, or assign | **PRODUCT DECISION** |
| D4 | v1 assignee scope: explicitly selected current List members, narrowed by D13 | **PRODUCT DECISION** |
| D5 | Draft provenance lives in the confirmation record, not in Thing notes | PROPOSED |
| D6 | Flags in a locked-down private table, not `app_config` (section 5) | PROPOSED (revised) |
| D7 | Resource limits | PROVISIONAL (section 7, revised) |
| D8 | Worker: delivery table plus scheduled drain | PREFERRED, conditional on D17 |
| D9 | How the PGlite preview applies `supabase/migrations/` | OPEN; research item for T12 |
| D10 | Sarvam on another branch; the Sarvam API | OPEN, UNVERIFIED |
| D12 | Handling of the modified `src/routeTree.gen.ts` | OPEN |
| D13 | **Exclude View Only members from assignee candidates in v1.** Candidates are the List owner and current collaborators, chosen explicitly, and eligibility is revalidated at confirmation inside the database. Feature-specific; existing manual assignment is unchanged | **PRODUCT DECISION** |
| D14 | **Include Contents read.** Ask owners to install on selected repositories. Narrow every runtime installation token to the connected repository ID and the minimum permissions for the call | **PRODUCT DECISION** |
| D15 | Store changes per connection, not shared per repository | PROPOSED |
| D16 | Browser binding mandatory; PKCE on the documented OAuth path; installation path never serves as identity | PROPOSED (resolves v2 D16); review pending |
| D17 | Hosting plan unknown. See 10 | **OPEN** |

**Research closed.** `GET /installation/repositories` accepts installation access tokens and needs no additional fine-grained permission, per the reviewer's reading of the endpoint documentation. My own retrieval of that page returned no permissions table, so I record this as closed on the reviewer's citation and recommend T14 re-confirm it with a mocked call. This endpoint does not replace the user-specific check in 6.2.

## 1. Feature root, API root, auth, actor mapping, and the write rule

**Client feature root. PROPOSED:** `src/features/code-activity/` (does not exist today).

**Auth, ESTABLISHED.** `server/lib/require-user.ts` verifies a Bearer token with `auth.getUser` and returns `{ userId, client }`, a user-scoped client under which `auth.uid()` and row-level security apply.

**API styles, ESTABLISHED.** `server/api/**` (Nitro) does not run in `vite dev`; dev behavior is duplicated as Vite middleware plugins. `src/routes/api/**` runs in dev and production. **D1 and D2, PROPOSED:** use `src/routes/api/code-activity/**` with a Request-based helper that returns the same `{ userId, client }` shape and leaves `requireUser` unchanged.

**Actor and List identity, ESTABLISHED.** `katalist_priv.current_actor_id()` maps `auth.uid()` to `actors.id`. The owner is `lists.owner_profile_id` and is not a row in `list_members` (trigger `trg_list_members_no_owner`). Helpers `is_list_owner`, `is_list_member`, `can_view_list`, and `can_create_thing_in_list` are `SECURITY DEFINER` and granted to `authenticated`.

### The single write rule (replaces the contradictory v2 text, F4)

| Actor | Credential | May do |
|---|---|---|
| Any signed-in member | User-scoped client | Read through row-level security. Call the specific definer functions listed in 3 |
| Owner-only mutations (connect, disconnect, consent) | User-scoped client calling a `SECURITY DEFINER` function | The function itself checks owner, flags, state, and arguments. The route is a convenience, not the boundary |
| Confirmation | User-scoped client calling the definer function in 8 | Same: all checks inside the function |
| Callback handler, webhook receiver, processor, reconciler, budget and proof writers | Service role | Writes to tables that `authenticated` cannot write. Every query carries an explicit connection or List scope |

No handler writes a user-initiated change with the service role after checking in application code only. A direct call to the database function must be exactly as safe as a call through the route.

## 2. Endpoints, roles, schemas

Error envelope, PROPOSED: `{ "error": "<code>", "message": "<neutral text>" }` plus the HTTP status. Unauthorized and disabled replies share one neutral body and reveal no configuration.

| # | Method and path | Authentication | Roles |
|---|---|---|---|
| E1 | `GET /api/code-activity/capabilities?listId=` | Bearer | Any caller; non-members, disabled, and unknown Lists receive an identical `{ enabled: false }` |
| E2 | `POST /api/code-activity/github/authorize/start` | Bearer | Owner |
| E3 | `GET /api/code-activity/github/authorize/callback` | State plus browser-bound nonce | Actor bound in the state, who must still own the List |
| E4 | `POST /api/code-activity/connection` (connect a verified selection) | Bearer, fresh | Owner |
| E5 | `DELETE /api/code-activity/connection` | Bearer | Owner |
| E6 | `PUT /api/code-activity/consent` | Bearer | Owner |
| E7 | `GET /api/code-activity/feed?listId=&cursor=` | Bearer | Owner, collaborator, view_only |
| E8 | `GET /api/code-activity/changes/{changeId}/checks` | Bearer | Owner, collaborator, view_only |
| E9 | `GET /api/code-activity/changes/{changeId}/patch?revision=&path=` | Bearer | Owner, collaborator, view_only |
| E10 | `POST /api/code-activity/changes/{changeId}/summary` | Bearer | Owner, collaborator; consent required |
| E11 | `POST /api/code-activity/changes/{changeId}/draft` | Bearer | Owner, collaborator; consent required |
| E12 | `GET /api/code-activity/lists/{listId}/assignee-candidates` | Bearer | Owner, collaborator |
| E13 | `POST /api/code-activity/drafts/confirm` | Bearer | Owner, collaborator |
| E14 | `POST /api/public/code-activity/github/webhook` | Signature | GitHub only |
| E15 | `GET /api/jobs/code-activity-drain` | Scheduler secret | Server only |

**Read rule (D3).** Every read, including patch reads, first reads the List's connection through the user-scoped client. Row-level security, which now includes the flag and lifecycle checks in 3, returns the row only to an authorized member. Only then may a handler use app credentials to call GitHub. A provider call without that preceding successful read is a defect.

**Fixed shapes.** Check state and pull request state are separate. Counts are nullable when unknown. Check state: `passed`, `failing`, `pending`, `none`, `unavailable`. Pull request state: `draft`, `open`, `merged`, `closed`; a push without a pull request has `kind: "push"` and no pull request state. Patch state: `available`, `binary`, `omitted`, `truncated`, `empty`, `unavailable`. Freshness: `lastSyncedAt` (nullable) and `syncStatus` (`ok`, `syncing`, `partial`, `stale`, `unavailable`). A feed row of `kind: "gap"` marks a period whose history could not be reconstructed (section 9). Field-level request and response schemas for T04 follow once review accepts 3, 8, and 9.

## 3. Data model (additive; PROPOSED)

**Migration target, ESTABLISHED.** `supabase/migrations/<14-digit timestamp>_<description>.sql` (latest today: `20261006160000`). Not `migrations/`. **D9 OPEN:** whether the preview runtime applies these files.

**Compatibility.** Additive only. No change to `things`, `thing_assignments`, `lists`, `list_members`, or `create_thing`.

```sql
-- PROPOSED DDL. Names and types are provisional. Nothing is applied anywhere.

CREATE TYPE public.code_activity_connection_status AS ENUM
  ('pending_repository','active','suspended','revoked','disconnected');

CREATE TABLE public.code_activity_connections (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id                 uuid NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  status                  public.code_activity_connection_status NOT NULL,
  installation_id         bigint NOT NULL,
  repository_id           bigint,
  repository_full_name    text,                       -- display cache; identity is repository_id
  connected_by_profile_id uuid NOT NULL REFERENCES public.profiles(id),
  sharing_acknowledged_at timestamptz,
  generation              integer NOT NULL DEFAULT 1, -- incremented on disconnect and on re-verification
  last_synced_at          timestamptz,
  sync_status             text NOT NULL DEFAULT 'unavailable'
                            CHECK (sync_status IN ('ok','syncing','partial','stale','unavailable')),
  sync_lease_token        uuid,                       -- reconcile fencing (section 9)
  sync_lease_until        timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  disconnected_at         timestamptz
);
CREATE UNIQUE INDEX code_activity_one_live_per_list ON public.code_activity_connections (list_id)
  WHERE status IN ('pending_repository','active','suspended');
CREATE INDEX ON public.code_activity_connections (installation_id, repository_id);

-- One-time authorization state. flow separates identity from installation (6.2).
CREATE TABLE public.code_activity_auth_states (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash  bytea NOT NULL UNIQUE,                  -- sha256 of the random state
  nonce_hash  bytea NOT NULL,                         -- browser binding is mandatory
  flow        text NOT NULL CHECK (flow IN ('oauth','install')),
  list_id     uuid NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  profile_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Server-written proof that THIS GitHub user and THIS installation can both reach THIS repository.
CREATE TABLE public.code_activity_selection_proofs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id              uuid NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  profile_id           uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  nonce_hash           bytea NOT NULL,
  installation_id      bigint NOT NULL,
  repository_id        bigint NOT NULL,
  repository_full_name text NOT NULL,
  expires_at           timestamptz NOT NULL,          -- provisional 15 minutes
  consumed_at          timestamptz
);

CREATE TYPE public.code_activity_delivery_status AS ENUM
  ('received','processing','processed','failed','dead','ignored');

CREATE TABLE public.code_activity_deliveries (
  delivery_id      uuid PRIMARY KEY,                   -- X-GitHub-Delivery
  event            text NOT NULL,
  action           text,
  installation_id  bigint,
  repository_id    bigint,
  refetch          jsonb NOT NULL CHECK (octet_length(refetch::text) <= 4096),
  status           public.code_activity_delivery_status NOT NULL DEFAULT 'received',
  attempts         integer NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  lease_token      uuid,                               -- fencing token
  lease_until      timestamptz,
  last_error_code  text,
  received_at      timestamptz NOT NULL DEFAULT now(),
  processed_at     timestamptz
);
CREATE INDEX ON public.code_activity_deliveries (status, next_attempt_at);

CREATE TABLE public.code_activity_changes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id       uuid NOT NULL REFERENCES public.code_activity_connections(id) ON DELETE CASCADE,
  kind                text NOT NULL CHECK (kind IN ('pull_request','push','gap')),
  provider_key        text NOT NULL,                   -- PR number; 'ref@after-sha'; or gap range key
  title               text,
  pr_state            text CHECK (pr_state IN ('draft','open','merged','closed')),
  head_sha            text,
  head_ref            text,
  base_ref            text,
  author_login        text,
  author_kind         text NOT NULL DEFAULT 'unknown' CHECK (author_kind IN ('user','bot','unknown')),
  additions           integer,                         -- nullable: unknown is not zero
  deletions           integer,
  changed_files       integer,
  source_url          text,
  gap_from            timestamptz,                     -- kind = 'gap' only
  gap_to              timestamptz,
  gap_reason          text CHECK (gap_reason IN
                        ('sync_disabled','missed_unrecoverable','object_unavailable','limit_reached')),
  provider_updated_at timestamptz NOT NULL,
  last_activity_at    timestamptz NOT NULL,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, kind, provider_key)
);
CREATE INDEX ON public.code_activity_changes (connection_id, last_activity_at DESC);

CREATE TABLE public.code_activity_checks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  change_id           uuid NOT NULL REFERENCES public.code_activity_changes(id) ON DELETE CASCADE,
  head_sha            text NOT NULL,
  source              text NOT NULL CHECK (source IN ('check_run','status')),
  provider_id         text NOT NULL,
  name                text NOT NULL,
  status              text NOT NULL,
  conclusion          text,
  provider_updated_at timestamptz NOT NULL,
  UNIQUE (change_id, head_sha, source, provider_id)
);

CREATE TABLE public.code_activity_consents (
  list_id               uuid PRIMARY KEY REFERENCES public.lists(id) ON DELETE CASCADE,
  enabled               boolean NOT NULL DEFAULT false,
  changed_by_profile_id uuid REFERENCES public.profiles(id),
  changed_at            timestamptz NOT NULL DEFAULT now()
);

-- Permanent minimal deduplication record (F3). No time-based deletion.
CREATE TABLE public.code_activity_confirmations (
  actor_id        uuid NOT NULL REFERENCES public.actors(id) ON DELETE RESTRICT,
  list_id         uuid NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  payload_hash    bytea NOT NULL,
  thing_id        uuid REFERENCES public.things(id) ON DELETE SET NULL,
  evidence        jsonb NOT NULL CHECK (octet_length(evidence::text) <= 2048),
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, list_id, idempotency_key)
);

-- Shared provider budget per installation (F6).
CREATE TABLE public.code_activity_budget (
  installation_id bigint PRIMARY KEY,
  window_start    timestamptz NOT NULL,
  used            integer NOT NULL DEFAULT 0,
  blocked_until   timestamptz                          -- set from retry-after / x-ratelimit-reset
);

-- Feature flags and allowlist (section 5). Not app_config.
CREATE TABLE public.code_activity_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.code_activity_list_allowlist (
  list_id  uuid PRIMARY KEY REFERENCES public.lists(id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now()
);
```

### Grants, row-level security, and functions (database boundary, F4)

- **Every new table:** enable RLS. `REVOKE ALL` from `PUBLIC`, `anon`, and `authenticated`. Then grant only what follows.
- **Private tables** (`auth_states`, `selection_proofs`, `deliveries`, `budget`, `settings`, `list_allowlist`, `confirmations`): no grant and no policy for `authenticated`. Only the service role and definer functions touch them. Note that confirmations are read and written only through the definer function in 8.
- **Readable tables** (`connections`, `changes`, `checks`, `consents`): grant `SELECT` to `authenticated`, gated by this policy expression, evaluated at read time:
  `katalist_priv.code_activity_enabled_for(list_id)` **AND** `katalist_priv.can_view_list(list_id)` **AND** the connection status is `active` or `suspended`.
  `code_activity_enabled_for` is a definer helper that requires the master flag, the allowlist entry, and an unarchived List. A disabled feature, a removed member, a disconnected or revoked connection, or an archived List therefore returns zero rows even to a caller who bypasses every route. `changes` and `checks` inherit through the connection.
- **No `INSERT`, `UPDATE`, or `DELETE` grant or policy for `authenticated` on any table.**
- **Definer functions granted to `authenticated`** (each `SET search_path` as the existing functions do, each `REVOKE`d from `PUBLIC` and `anon`): `code_activity_connect`, `code_activity_disconnect`, `code_activity_set_consent`, `code_activity_assignee_candidates`, `confirm_code_activity_draft`. Each re-checks the owner or creation eligibility, the flags, the connection state, and argument bounds itself.
- **Selection proofs are the only source of installation and repository IDs for `code_activity_connect`.** The function accepts a proof ID and the sharing acknowledgement, never an installation ID or repository ID from the caller. A direct caller cannot connect an arbitrary repository.
- **Flag changes.** Only the service role, through an operator-run migration or SQL console. No API, no `authenticated` grant, no definer function exposes a write. Who holds the service role is an operator matter recorded in the T35 runbook.

**Deletion behavior.** Deleting a List cascades to its connection, changes, checks, consent, auth states, proofs, allowlist entry, and confirmations. A confirmation row sets `thing_id` to null if the Thing is shredded.

**Retention, PROVISIONAL.** Processed deliveries 14 days; failed and dead deliveries 30 days; changes and checks 90 days after last activity; auth states and proofs deleted after expiry plus 1 day; budget rows after 2 hours idle. **Confirmation rows are not deleted on a timer.** Each is a few hundred bytes per created Thing and goes with its List.

**D15, PROPOSED.** Changes and checks are stored per connection, which duplicates data across two Lists that connect the same repository but isolates their disconnection and access.

**Patches are never stored.** Each patch read refetches from GitHub.

## 4. Sharing policy (PRODUCT DECISION)

- A connected repository's activity, checks, and available diffs are readable by the owner and all List members, **including View Only members**.
- View Only members cannot connect, disconnect, change consent, generate drafts, create Things, or assign Things.
- **Connection screen.** Before connecting, the Owner is told explicitly that repository content will become readable by all List members, including View Only members. The Owner records a separate acknowledgement, stored as `sharing_acknowledged_at` by `code_activity_connect`. It is not AI consent.
- Membership is enforced on every read, including patch reads (section 2). The database policy enforces it too (section 3).
- **Loss of access.** Removal, archival, disconnect, revocation, or a disabled flag ends reads on the next request. The client clears protected cached content on any authorization failure. The server rules are authoritative.

## 5. Flags and kill switch

**Storage (D6, revised).** `public.app_config` **cannot** hold these settings. ESTABLISHED: it grants `SELECT` to every `authenticated` user with policy `USING (true)`, so an allowlist of List IDs there would be readable by anyone signed in and would violate "reveal no private configuration." Use the locked-down `code_activity_settings` and `code_activity_list_allowlist` tables in 3, read only through definer helpers.

| Key | Meaning | When absent or unreadable |
|---|---|---|
| `master` | Master switch | off |
| `sync` | Intake, processing, reconciliation | off |
| `ai` | Summary and draft generation | off |
| Allowlist table | Lists permitted | empty: no List permitted |

**Behavior.**
- Every handler and every definer function reads the flags per call. Missing or unreadable means disabled, with no provider call.
- E1 returns only `{ enabled: boolean }` and the same body for every non-enabled case.
- **Webhook intake while sync is off (PROVISIONAL):** respond 503 without storing. GitHub then shows the delivery as failed, and the 3-day redelivery window plus the redelivery assist (section 9) can replay it. A known disabled window is later recorded as a `gap` with reason `sync_disabled`.
- Workers check flags and the connection `status` and `generation` before each batch and again immediately before each write.
- **What "stops" means.** New requests see a flag change on their next read. In-flight work stops at its next checkpoint, so the bound is one provider request deadline (provisional 8 s) plus database latency. This is not instant termination and has not been measured.
- Missing GitHub secrets disable only this feature and must not affect application startup.
- Nobody can change a flag through the product. Only the service role can.

## 6. Provider flows (OFFICIAL basis in `provider-evidence.md`)

### 6.1 GitHub App configuration (operator action; nothing is configured by this plan)

- **Read-only permissions, D14:** Metadata (mandatory), Pull requests, Checks, Commit statuses, and Contents, all read.
- **Events:** `push`, `pull_request`, `check_run`, `status`. `installation` and `installation_repositories` arrive by default.
- **Installation scope.** Owners are asked to install on **selected repositories**, never "all repositories." Because the app cannot force this, **runtime tokens are always narrowed**: every installation token for repository reads is minted with `repository_ids` set to the single connected repository and `permissions` set to the minimum for that call (patch and files: pull requests and contents read; checks: checks read; statuses: commit statuses read). A token that covers other repositories must never be used for reads. T14 adds a test for this. "One repository per List" is a product rule; it does not limit what an installation can reach, so the narrowing is what enforces it.
- **Callback URL:** exactly one registered URL per environment; wildcard matching off. **User-token expiration:** on. **OAuth during installation:** selected, which disables the Setup URL.
- **Webhook secret and private key:** server secrets only, never in the repository.

### 6.2 Connection flow

The existing app authenticates with a Bearer header, but GitHub returns the browser to the callback as a plain navigation with no Authorization header. The callback therefore cannot identify the user from the request. This flow makes the identity come from state, a cookie, a proof, and a fresh Bearer request at the final step.

1. **Start (E2).** Bearer. Checks the flags, `is_list_owner`, and that the List is unarchived. Creates a random 256-bit state with `flow = 'oauth'`, stores only its hash with the profile, List, and 10-minute expiry, and **sets a mandatory HttpOnly, Secure, SameSite=Lax cookie** carrying a nonce whose hash is stored with the state. The cookie is set on a same-origin response to the authenticated start request. Returns the GitHub authorize URL (`https://github.com/login/oauth/authorize`) with `client_id`, the exact `redirect_uri`, `state`, and a PKCE `code_challenge` (S256, per RFC 7636; T15 confirms the method name against GitHub's page). The PKCE verifier is not stored: it is derived as HMAC(server secret, state ‖ nonce), so the callback can recompute it. A rotated secret invalidates only states already in flight (at most 10 minutes).
2. **Callback (E3), identity.** Atomically consume the state (`UPDATE … WHERE state_hash = $1 AND consumed_at IS NULL AND expires_at > now() RETURNING …`). Require the nonce cookie to match `nonce_hash`. A missing, expired, replayed, or mismatched state or cookie aborts with a neutral error and causes no provider request. Recheck that the bound profile still owns the unarchived List and that the flags are on.
3. **Callback, user proof.** Exchange `code` (with the derived verifier) for a user token held in memory only. Call `GET /user/installations`, then `GET /user/installations/{installation_id}/repositories` for each returned installation. That endpoint lists repositories the user's token can reach in that installation, and a user token is limited to what both the user and the app can access (OFFICIAL). Bounds: at most 10 installations and 300 repositories in total. If more exist, abort with "narrow the installation to selected repositories" rather than guess.
4. **Callback, proof record.** For each reachable repository, write a `selection_proofs` row bound to the List, the profile, the nonce hash, the installation ID, and the repository ID, expiring in 15 minutes (PROVISIONAL), then discard the user token. A `installation_id` query parameter on the redirect is only a hint and is never used as authority (its presence is SECONDARY evidence). Redirect to a fixed in-app path, never to a URL taken from the query.
5. **Selection and connect (E4).** A fresh, authenticated request from the owner carries the proof ID and the sharing acknowledgement. The handler (a) verifies the nonce cookie, (b) mints an installation token narrowed to that repository ID and confirms `GET /installation/repositories` returns it, proving the **installation** can reach the repository, then (c) calls `code_activity_connect`. The function atomically consumes the proof and checks `auth.uid() = proof.profile_id`, `is_list_owner`, the flags, the unarchived List, and the acknowledgement, then creates the connection from the **proof's** installation and repository IDs. The repository must therefore be reachable by both the authorizing GitHub user (step 3) and the installation (step 5b). A repository URL typed by the owner is only matched against the owner's proof rows; the URL alone never connects.
6. **Installation path demoted (resolves the v2 gap).** If the owner has no installation or no reachable repository, the app shows an "Install on GitHub" action that begins an `flow = 'install'` state and opens `https://github.com/apps/<slug>/installations/new?state=…` (OFFICIAL). Because OAuth during installation is selected, GitHub returns the browser to the same callback with a `code`. For an `install` state the callback consumes the state, **does not exchange the code, and creates no proof**, then redirects back with "continue." The owner then performs a fresh Start (step 1). Identity and PKCE are therefore always established by the documented OAuth path, and the installation path never proves identity. Behavior when the app is already installed on the account remains NOT FOUND in the official pages; the OAuth path covers it, because it lists existing installations.

**Server credentials.** App JWT: RS256, `iat` 60 seconds in the past, `exp` at most 10 minutes ahead, `iss` the client ID (OFFICIAL). Installation tokens last 1 hour and are held in memory only. Nothing secret is stored or logged.

### 6.3 Sarvam

No client exists in committed code. D10 and the Sarvam API are not researched here. T28 is blocked until they are.

### 6.4 Connection lifecycle: explicit, conditional transitions (F6)

Every transition is a single `UPDATE … WHERE id = $id AND status = $expected` (and `generation = $gen` where a job carries one). A transition that matches no row is a no-op, never an error and never a fallback.

| Trigger | From | To | Notes |
|---|---|---|---|
| `code_activity_connect` | (new row) | `active` | Via a proof (6.2) |
| Owner disconnect (E5) | `pending_repository`, `active`, `suspended` | `disconnected` | Increments `generation`. **Terminal.** Nothing reactivates it |
| `installation` `suspend` | `active` | `suspended` | Only rows for that installation |
| `installation` `unsuspend` | `suspended` | `active` | **Matches `suspended` only.** A `disconnected` or `revoked` row never matches, so an intentional disconnect cannot be undone. On success set `sync_status = 'stale'`, increment `generation`, and require a verifying reconcile before the feed reports `ok` |
| `installation` `deleted` | `pending_repository`, `active`, `suspended` | `revoked` | `disconnected` rows untouched |
| `installation_repositories` `removed` | same three | `revoked` | Matched by repository ID |
| Reconnect after disconnect or revoke | n/a | new row | The old row stays terminal. The partial unique index permits the new live row |

Jobs and leases carry `(connection_id, generation)`. Every write checks `status = 'active' AND generation = $gen`. A stale job therefore cannot restore a connection or write into a newer one.

## 7. Resource limits — PROVISIONAL engineering defaults

No traffic data exists. Values are conservative starting points with rationale, to be re-measured before cohort promotion. "OFFICIAL" marks a provider or platform limit.

| Limit | Value | Rationale |
|---|---|---|
| Webhook body | **2 MiB (2,097,152 bytes)**; larger replies 413 | **Revised from v2.** Vercel Functions cap request bodies at 4.5 MB and reject larger ones with 413 before application code runs (OFFICIAL, Vercel; retrieved 7 Oct 2026). GitHub allows up to 25 MB (OFFICIAL). Events between 2 MiB and 4.5 MB reach the handler and are rejected. Larger events never reach it. Either way the outcome is a recorded gap (section 9), never silent loss |
| Webhook handler deadline | 3 s for verification plus one insert | GitHub requires 2XX within 10 s (OFFICIAL) |
| Stored `refetch` identifiers | 4 KiB per delivery | Identifiers only |
| Processing attempts | 5 | Bounded work |
| Retry backoff | 30 s, 2 min, 10 min, 1 h, 6 h, up to 20% jitter | About 7 h in total, inside GitHub's 3-day redelivery window (OFFICIAL) |
| Provider request deadline | 8 s | |
| Processing budget per delivery | 30 s hard stop | Prevents one delivery holding a lease |
| **Lease duration** | **60 s**, one renewal of 60 s allowed while progressing | Exceeds the 30 s per-delivery budget with margin, so a healthy worker never loses its lease and a crashed one releases it within a minute |
| **Global concurrent leases** | **4 across all instances** | Enforced in the claim function with an advisory lock, not per instance (section 9) |
| Concurrent reconcile per connection | 1 | Enforced by `sync_lease_*` |
| **Provider requests per installation** | **1,000 per hour: 700 background, 300 reserved for interactive reads** | 20% of the 5,000 base hourly allowance (OFFICIAL), leaving headroom for installations that share the budget. Enforced atomically in `code_activity_budget`, not in memory |
| Rate-limit response | Block the installation until `x-ratelimit-reset` or `retry-after` (OFFICIAL behavior); otherwise at least 60 s then exponential | |
| Feed page | default 25, maximum 50 | |
| Reconcile | `per_page` 50, at most 10 pages and 60 provider requests per connection per run | About 1.2% of the hourly allowance per run |
| Files listed per change | 300 | GitHub allows 3,000 (OFFICIAL); beyond 300 the change is labeled partial |
| Check runs read per revision | 200 | GitHub limits to 1,000 suites (OFFICIAL); beyond 200 labeled partial |
| Patch per file | 100 KiB (102,400 bytes) and 2,000 lines | |
| Patch response total | 512 KiB (524,288 bytes) | Well inside the 4.5 MB response cap (OFFICIAL, Vercel) |
| Stored title | 300 characters | |
| Auth state expiry | 10 minutes | |
| Selection proof expiry | 15 minutes | Time to read the sharing notice and choose |
| Authorization starts | 5 per owner per 10 minutes | |
| Confirmation payload | title 300 characters, notes 8,000 characters (checked inside the function) | Bounded input to the existing creation path |
| AI input | 48 KiB (about 12,000 tokens, estimated) | Sarvam limits UNVERIFIED |
| AI output / deadline / rate | 1,500 tokens / 20 s / 3 per user per 10 minutes, 20 per List per hour | |

**Runtime validation (F6).** Checked against Vercel documentation retrieved 7 October 2026 (OFFICIAL): request and response bodies up to 4.5 MB; function duration defaults to 300 s on all plans with Fluid compute, with higher maximums on Pro. All budgets above fit within those caps. **UNVERIFIED:** which host serves production. The repository holds both `vercel.json` (two cron entries) and `netlify.toml` (sets the Netlify build preset). Nothing in the code establishes which is live, which plan applies, or whether Fluid compute is on. Body and duration limits on Netlify are not researched. This must be confirmed before T19.

## 8. Atomic confirmation (review: CHANGES REQUESTED)

### 8.1 What the code establishes

The effective `public.create_thing` is in `20260820133000_create_thing_waiting_owner_nudge.sql`. No later migration redefines it.

- `SECURITY DEFINER`, resolves the caller through `auth.uid()`, so it must run in the user's session.
- Requires a non-empty title and `can_create_thing_in_list(p_list_id)`. View Only cannot create. A null List is permitted by that helper, so the wrapper must require a List.
- **No unassigned Thing exists:** omitting the assignee makes the creator the assignee. It checks only that the actor exists.
- **Every new Thing starts `waiting_for_catch` and `not_started`, including a self-assigned one.**
- One transaction writes `things`, `thing_assignments`, then `created` and `assigned` activity.
- No idempotency parameter and no uniqueness guard.
- The manual workflow (`rpcCreateThing`, a direct browser RPC) must remain unchanged.

**Notification, verified.** The trigger `thing_activity_notify` fires on the `assigned` activity and writes a `thing_assigned` in-app notification, "A Thing is waiting for your Catch," for the assignee, in the same transaction. It is skipped for self-assignment and for an external actor with no profile. Push delivery for assignment was not traced and must not be promised.

### 8.2 Assignee scope (D4, D13)

- **Candidates:** the List owner and current collaborators, chosen explicitly. **View Only members are excluded.** Display names come from `public_profiles`.
- No assignee comes from model output, job title, role, or name similarity. The assignee field is required and starts unselected. The screen offers an explicit selection, including an explicit "Assign to me." An empty selection never becomes self-assignment.
- **Revalidated at confirmation, inside the database** (8.3): the chosen actor must be the owner or a current collaborator at that moment.
- This is narrower than the manual workflow, which `create_thing` allows to name any actor. The manual workflow does not change.

### 8.3 `confirm_code_activity_draft` (PROPOSED)

One `SECURITY DEFINER` function, `SET search_path` as the existing functions do, granted to `authenticated` only. Arguments: `p_list_id` (required), `p_idempotency_key` (uuid), `p_title`, `p_notes`, `p_assignee_actor_id` (**required**), `p_due_at`, `p_due_has_time`, `p_owner_importance`, an evidence reference (repository ID, change key, head SHA), and `p_ai_generated`. Because any authenticated client can call it directly, **every check below runs inside the function**.

**Order of operations, which separates replay from new creation:**

1. **Identity.** `v_me := katalist_priv.current_actor_id()`; reject if null.
2. **Replay lookup first.** Read `code_activity_confirmations` by `(actor, list, key)`.
   - **Found, same `payload_hash`:** this is a replay. Return the original `thing_id` with `replayed = true`. Do **not** re-run source-change, connection, flag, consent, or assignee checks. A retry of a successful request must never fail because the source changed, the repository was disconnected, or consent was withdrawn since. The one condition: the caller must still pass `katalist_priv.can_view_thing(thing_id)`, otherwise return `not_visible`. A shredded Thing returns `thing_removed`.
   - **Found, different `payload_hash`:** reject as a conflicting key reuse.
3. **New creation. Eligibility, all inside the function:** master flag on and the List allowlisted; List unarchived; `can_create_thing_in_list(p_list_id)` with a non-null List (owner or collaborator); connection `active`; the evidence belongs to that connection; the assignee is the owner or a current collaborator; title and notes within bounds; source check below; consent check below. Any failure raises a typed error and writes nothing.
4. **Source change.** Compare the submitted head SHA to the stored change. If it moved, reject `source_changed`. The client may resubmit with an explicit `acknowledge_source_change` flag, which becomes part of the payload hash, so an acknowledged resubmission is a distinct, deliberate request.
5. **Consent.** If `p_ai_generated` is true, the `ai` flag and the List consent must still be on, else reject `consent_withdrawn` until the user submits the text as their own (`p_ai_generated = false`).
6. **Create.** `INSERT … ON CONFLICT (actor_id, list_id, idempotency_key) DO NOTHING RETURNING`. If a concurrent request inserted first, this statement waits for its commit and returns no row, so the function re-enters the replay branch of step 2. Otherwise call `public.create_thing(...)` and set `thing_id` on the receipt in the same transaction. Any exception rolls back both.
7. Return `{ thing_id, replayed }`.

**Retention (F3).** The deduplication row is permanent for the life of the List. Because no row is deleted on a timer, a key can never look new after a window passes, and no key-expiry rule is needed. Cost: a few hundred bytes per Thing created through this feature.

**Idempotency key ownership.** The client generates one UUID per draft review session. The server scopes it to (actor, List), so one person's key cannot match another's.

**For the reviewer.** Confirm: concurrent-insert behavior in step 6 under PostgREST; that `auth.uid()` holds inside the nested definer call (the existing pattern suggests yes); the replay-before-eligibility order; the visibility rule on replay; and the `thing_removed` result.

### 8.4 Preview

In preview, confirmation creates only local fixture state and is labeled "Preview", never a real Thing. It follows the `runDomainMutation({ live, preview })` pattern used throughout `src/features/things/rpc.ts`.

## 9. Intake, recovery, reconciliation, and queue control

**Intake (E14).** In order: reject by length above the limit; read raw bytes; compute HMAC-SHA256 with the webhook secret and compare `X-Hub-Signature-256` in constant time (OFFICIAL); reject missing or invalid signatures with 401 before parsing; extract the `refetch` identifiers; insert the delivery row keyed by `X-GitHub-Delivery` with `ON CONFLICT DO NOTHING`; return 200. No provider call. A duplicate delivery ID inserts nothing and returns 200. With `sync` off, return 503 without storing (section 5).

**Retained identifiers.** A delivery ID alone cannot recover a failed delivery. GitHub does not redeliver automatically and keeps 3 days of history (OFFICIAL). The row therefore keeps identifiers only, at most 4 KiB:

| Event | Retained in `refetch` |
|---|---|
| `pull_request` | repository ID, PR number, `head.sha`, `updated_at`, action |
| `push` | repository ID, `ref`, `before`, `after`, repository `full_name` |
| `check_run` | repository ID, check-run ID, `head_sha`, status, conclusion, `updated_at`, associated PR numbers |
| `status` | repository ID, `sha`, `context`, `state`, `updated_at` |
| `installation`, `installation_repositories` | installation ID, action, repository IDs added or removed |

No raw body, commit message text, patch, token, or secret is stored.

**Processing outcomes (replaces the v2 "always recovered" language).** Processing refetches the authoritative state from GitHub using those identifiers. A delivery ends in exactly one of: `processed`, `ignored` (event not relevant or connection not live), or `dead` after five attempts. Retries are bounded, and `dead` is a truthful final state, not a promise of later recovery.

**What recovery can and cannot do.** The system promises to restore **available** authoritative state: current pull request state, current check state for a head revision, and current statuses, because those can be refetched. It does **not** promise to reconstruct history. Deleted branches, force-pushed or rewritten history, garbage-collected commits, repository transfers, and unavailable objects can make a historical push, its commit list, or its patch unrecoverable. When recovery cannot reconstruct an event, a **history gap** is recorded as a feed row (`kind = 'gap'`, with `gap_from`, `gap_to`, and a reason: `sync_disabled`, `missed_unrecoverable`, `object_unavailable`, or `limit_reached`). The feed and the inspector show that gap openly. A push whose objects can no longer be fetched keeps its recorded identifiers and shows patch state `unavailable`, never a fabricated diff.

**Reconciliation (bounded).** Per connection and cursor-based: list open and recently updated pull requests, refetch changed pull requests, their check runs, and statuses within the limits in 7, update `last_synced_at` and `sync_status` (`syncing` while running, `ok` when complete, `partial` when a limit stopped it, `stale` when overdue, `unavailable` after failures). It covers dropped receipts, oversize events, and gaps beyond 3 days **for the state it can still fetch**. **OPEN:** a verified endpoint for listing pushes without pull requests (repository activity or commits-by-branch) has not been researched. Until it is, recovery of push-only history is not specified, and a missed push becomes a gap.

**Redelivery assist, optional.** A scheduled pass with the app JWT lists failed deliveries from the last 3 days (`GET /app/hook/deliveries?status=failure`) and redelivers those not recorded as processed (`POST /app/hook/deliveries/{id}/attempts`). These endpoints are app-wide, so the pass is idempotent by GUID. It is an assist.

**Ordering.** The retrieved GitHub pages make no ordering promise (NOT FOUND), so events may arrive out of order. Upserts apply only when `provider_updated_at` is not older than the stored value; on equal or doubtful values the processor refetches. Checks are keyed by (change, head SHA, source, provider ID), so an old revision's check cannot overwrite the current one.

### Shared queue control (F6)

- **Claim function.** A service-role function `code_activity_claim_deliveries(n)` takes a transaction-scoped advisory lock, counts rows whose lease has not expired, and claims at most `4 − active` due rows with `FOR UPDATE SKIP LOCKED`. Serialization by the advisory lock is what makes the global bound of 4 hold across instances. A per-instance counter would not.
- **Lease and fencing.** A claim sets `lease_token` (a fresh UUID) and `lease_until = now() + 60 s`, and increments `attempts`. The worker's completion, failure, and renewal statements all include `WHERE delivery_id = $1 AND lease_token = $2`. If the lease expired and another worker reclaimed the row, the first worker's later statements match no row and it discards its result. Data writes are idempotent upserts guarded by `provider_updated_at`, so a duplicate execution after an expired lease is harmless.
- **Safe expiry.** The 30 s per-delivery hard stop is shorter than the 60 s lease, so a healthy worker finishes or aborts before expiry. A crashed worker's row becomes claimable after at most 60 s.
- **Provider budget.** Before every provider request the caller runs an atomic `UPDATE code_activity_budget … SET used = used + 1 WHERE installation_id = $1 AND window_start = <current hour> AND used < $cap AND (blocked_until IS NULL OR blocked_until <= now())` and proceeds only if one row changed. Background work may use 700 per hour and interactive reads 300. A refusal returns the `unavailable` or `rate_limited` state to the user. A 403 or 429 sets `blocked_until`.
- **Kill switch.** The claim function returns nothing when the master or `sync` flag is off.

## 10. Worker options (D8, D17)

**Platform facts (OFFICIAL, Vercel documentation retrieved 7 October 2026).** Cron jobs: Hobby allows once per day with timing precision of one hour (a job set for 01:00 can run any time from 01:00 to 01:59). Pro and Enterprise allow once per minute with per-minute precision. The retrieved page did not state whether an invocation can be duplicated or retried, so the design must be idempotent regardless.

**What is unknown.** The repository's two daily schedules do not establish the plan. The repository also contains a `netlify.toml`, so even the host is unconfirmed.

| Option | Description | Assessment |
|---|---|---|
| A. Inline in the webhook request | Process after the receipt in the same function | Competes with the 10 s GitHub window and the shared runtime; weakest isolation |
| B. Delivery table with a scheduled drain (preferred) | Intake stores a receipt. A scheduled route (E15) claims due rows in bounded batches under the leases above | Failures stay in the feature. Freshness depends on scheduler capacity |
| C. External worker | A separate runtime drains the same table | Best isolation. Adds infrastructure; availability unverified |

**Decision.** B remains the preferred design **conditional on verified scheduling capacity**: the team must confirm the hosting provider, the plan, and that a per-minute (or other adequate) schedule is available. If only a daily schedule is available, the feature runs in a **degraded mode**: a daily drain plus a user-triggered Refresh that runs one bounded drain for that List after the membership check. Degraded mode is **not** a promise of timely background activity. No refresh interval is committed in this document or in the designs. The feed shows honest freshness (`lastSyncedAt`, `syncStatus`) and never implies liveness it cannot provide.

## 11. Test harness

ESTABLISHED: `npm test` runs the Node built-in runner over `scripts/**/*.test.mjs` through `scripts/alias-loader.mjs`. Playwright covers browser journeys (`npm run test:e2e`, `tests/e2e/`). PROPOSED: new tests are `scripts/code-activity-<topic>.test.mjs`, with database behavior following the PGlite pattern in `scripts/bridge-authorization-sql.test.mjs`. No second runner. UNVERIFIED: how existing tests exercise React components, and whether the loader can load `.tsx` and images (it cannot load a `.png`, per the baseline).

Required test themes added by this revision: direct RPC calls bypassing routes; disabled flag and removed member returning zero rows; replay after disconnect, source change, and consent withdrawal; concurrent confirmation; expired-lease double execution; `unsuspend` against a disconnected row; narrowed-token enforcement; and a callback with a missing cookie.

**The baseline is not green (corrections C11).** `npm test` fails (25 failing, 907 passing). `npm run typecheck` fails with 3 errors. They are known findings. Later verification compares against `baseline.md` and must never state that all gates pass.

## 12. Preview, feature-off behavior, deployment

- **Preview** follows `runDomainMutation({ live, preview })`: labeled fixtures, no network request.
- **Feature off:** no tab, no lazy module request, no feature endpoint call, no polling.
- **Deployment (corrections C12):** `npm run build` does not run migrations. Migration order is an explicit operator step in T35. This plan applies no migration, configures no provider, and deploys nothing.

## Acceptance status against the plan

The plan requires "no unresolved placeholder for an endpoint, role, table, limit, migration target or deduplication boundary" before T04.

- Endpoints, roles, tables, grants, limits, and the deduplication boundary now carry proposed concrete values.
- **Still blocking a freeze:** all three reviews (changes requested, v3 not re-reviewed); D9, D10, D12; the hosting provider, plan, and scheduler capacity (D17); push-only reconciliation; Sarvam; confirmation of `GET /installation/repositories` by test; and field-level schemas for T04.
- Contracts and T03 designs both remain **drafts**.
