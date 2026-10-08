# Code Activity workspace: contracts and component map (S01)

Date: 7 October 2026. Source: `sonnet-5.5-reference-workspace-plan.md`. These are this project's proposed contracts, not GitHub guarantees. Provider shapes were taken from GitHub's REST documentation; anything not run against the live API is marked **UNVERIFIED**.

## 1. Control to action map (every visible control in the reference)

| Control | Action | Source of truth |
|---|---|---|
| Repository name, GitHub mark, Connected, Last synced, Up to date | Existing connection/freshness state | `/connection`, `/feed` freshness |
| Branch picker | Sets the ONE shared branch scope (also the Branch filter) | `GET /branches` |
| "N ahead, M behind <base>" | Verified comparison of selected branch against the base | `GET /compare` |
| Sync | Existing manual Refresh (saved PR/push rows), then reloads every source | `POST /refresh` |
| Manage, overflow menu | Existing owner Manage dialog; overflow = copy repository URL / open on GitHub | existing |
| All activity / Commits / Pull requests / Checks / Deployments | Category (one active) | merged sources, see 4 |
| Search | Plain text over loaded rows, debounced 250 ms; never intercepts K | client |
| Global Create Thing | Reveals the existing List Magic Box (same call as Ctrl/Cmd+K) | `magic-box-entry` |
| Author / Branch / Status / Activity type / Date / File path / Clear filters | Six composable filters, see 5 | client + pushdown |
| Feed row (title, author, time, branch, SHA + copy, checks, files, +/-) | Select, copy full SHA | `WorkspaceItem` |
| Row overflow | Copy SHA, copy link, open on GitHub | client |
| Detail: title, Create Thing, Open on GitHub, overflow | Contextual creation, external link, copy | existing confirm route |
| Detail: author, revision (copy), branch -> base | From the item | provider |
| Detail: files changed, additions, deletions, checks passed | Revision-bound stats; unknown is shown as unknown | `commit-detail`, `change-stats` |
| Overview / Files / Checks tabs | Same detail, three views | detail |
| Files changed list, Search files, Unified / Split, file menu | File navigator and diff modes over ONE patch | detail |

## 2. Authorization sequence (every new read endpoint)

1. Bearer token verified (existing). Caller-scoped RPC `code_activity_connection_status(list)` must return an `active`, not-`needs_reverification` row (membership and flags are enforced inside that function). Suspended: `source_unavailable`. Anything else: `not_allowed` with the shared neutral body.
2. Server-only `code_activity_server_connection_for_provider(list)` returns connection id, installation, repository id and generation. The browser never sends them.
3. A meter (interactive class) is attached to the GitHub client: every provider request is counted; a spent budget makes no request and answers 429.
4. After the reads, `connection_for_provider(list, generation, connection_id)` is called again. If it no longer matches (disconnect, reconnect, revocation) the result is discarded (`not_allowed`).
5. Replies are `Cache-Control: private, no-store`. Whole new read sequence deadline 25 s; per request 8 s (existing).

## 3. Endpoints (all GET, `listId` required)

| Endpoint | Query | Reply |
|---|---|---|
| `/api/code-activity/branches` | `cursor?` (page number) | `{ defaultBranch, branches: [{name, sha}], nextCursor, complete }`. At most 300 names (3 pages); `complete=false` when truncated |
| `/api/code-activity/compare` | `head`, `base` (branch names) | `{ head:{name,sha}, base:{name,sha}, status: identical\|ahead\|behind\|diverged, ahead, behind, checkedAt }` or `{ error: ref_not_found, which }` |
| `/api/code-activity/commits` | `branch`, `cursor?`, `author?`, `path?`, `since?`, `until?` | `{ items: [{sha, subject, authorName, authorLogin\|null, avatarUrl\|null, committedAt, url}], nextCursor, windowComplete }`. 50 per page, at most 200 per window (4 pages) |
| `/api/code-activity/change-stats` | `items` = up to 10 of `commit:<sha>` or `pr:<number>` | `{ results: [{ id, revision, status: ok\|unavailable, reason?, additions\|null, deletions\|null, files\|null, filesComplete, checkState\|null, checks: {passed, failing, pending, total}\|null, checksComplete }] }`. Concurrency 2 |
| `/api/code-activity/deployments` | `cursor?` | `{ permission: ok\|needed, items: [{id, sha, ref, environment, createdAt, creator, state\|null, description, links:{log\|null, target\|null}}], nextCursor, windowComplete }`. 10 per page, statuses read for all 10, at most 50 per window |
| `/api/code-activity/commit-detail` | `sha` | `WorkspaceDetail` (see 6) for a commit: files (bounded patches), checks (runs + statuses), stats, message body |
| existing `/feed`, `/changes/detail`, `/refresh`, `/capabilities`, `/connection`, `/assignee-candidates`, `/drafts/confirm` | unchanged | unchanged |

Cursors are opaque to the browser and bind the scope: `v1.<base64url(JSON{p: page, s: scopeHash})>`; a cursor from another branch/filter is rejected (`invalid_request`). Branch and ref names are validated (no `..`, no control characters, length <= 255) and path-encoded per segment.

Deployments permission: the token is minted with `deployments: read` ONLY for the deployments endpoint. If GitHub refuses that mint with 403 or 422 the reply is `{ permission: "needed" }` (**UNVERIFIED** that GitHub answers this way; any other failure is an error, not a permission claim). Token validation still rejects any write permission, any repository other than the requested one, and now also any permission name that was not requested.

## 4. Types and merge rules

`WorkspaceItem` (feature-local, not an `ActivityChange`): `{ id, kind: commit\|pull_request\|push\|check\|deployment, title, author: {name, login\|null, avatarUrl\|null}, occurredAt, branch\|null, sha\|null, number\|null, state\|null, checkState\|null, stats: {additions, deletions, files}\|null, statsStatus: loaded\|loading\|unavailable\|unknown, url\|null, saved: boolean (a saved feed row id for detail), deployment?: {...} }`. Ids: `commit:<sha>`, `pr:<number>`, `push:<saved id>`, `deployment:<id>`, `check:<sha>`.

Sources: commits (live, scoped to the selected branch), pull requests and pushes (the saved feed), deployments (live). `check` items are derived, labelled as such: one per loaded revision that has a known check result. They appear in the Checks category ONLY; All activity shows each row's check chip instead, so a revision is never listed twice. A merge is shown only when strictly newer than the horizon (equal times wait for the next page). A source that fails counts as read with nothing in it, so it cannot hold the other sources back; it is reported with its own Retry.

Merge: each source delivers pages newest first. The merged list emits only items whose time is not older than the oldest time of every source that still has more pages (the horizon), so a late page can never be inserted above an item already shown. Ties break on item id. A push row is suppressed only when a loaded commit has the same SHA. Stable identities never repeat.

## 5. Filters and search (frozen)

All filters compose with AND; several selections inside one filter compose with OR. Search: case-insensitive substring over title, author name/login, SHA (prefix), branch and file paths known from loaded details. Date: two calendar dates in the browser time zone, converted once to UTC (start of first day, end of last day); `from > to` is a field error and applies nothing. File path: literal path or directory prefix (no regex); pushed down to commits (`path`), applied to other rows only when their paths are known, otherwise those rows stay and are marked "path not checked". Author and date also push down to commits. Branch is the shared scope (changing it reloads commits; PR/push/deployment rows match when their head, base or ref equals it). Clear filters resets search, the five filters and the branch to the repository default.

Results always state their window ("searched the latest N commits; older activity was not searched") and show "Results incomplete" while more pages exist. Loading more advances the sources until enough matches or the cap is reached.

## 6. Detail model

`WorkspaceDetail`: `{ kind, id, title, body|null, author, occurredAt, sha|null, branch|null, base|null, url|null, stats: {additions, deletions, files}|null (null = unknown), statsComplete, files: ChangeFile[], filesPartial, checks: CheckRun[], checkState, checksRevision, checksPartial, deployment?: {...} }`. Saved PR/push detail from the existing route is adapted into this shape. Patch text is inert text. Selection state is keyed by list + connection + generation + branch + item id; replies for a previous key are dropped, and private detail is cleared on disconnect.

## 7. Component map (feature-local, `src/features/code-activity/workspace/`)

`CodeActivityWorkspace` (layout, selection) / `RepositoryToolbar` / `ActivityToolbar` / `ActivityFilterBar` / `WorkspaceActivityList` + `WorkspaceActivityRow` / `WorkspaceChangeDetail` / `FilesPanel` + `DiffView` (unified and split) / `DeploymentsPane` / `CreateThingDock` (Magic Box) plus pure modules `merge.ts`, `filters.ts`, `diff.ts`, `types.ts` and hooks `use-workspace.ts`. Reused unchanged: `ChecksPanel`, `FileDiff` parsing helpers (`parsePatch`), `ConnectionPanels`, the existing `CoeyDraftReview` form, the error boundary (outside the lazy chunk).

## 8. Rollout and fallback

New client flag `VITE_CODE_ACTIVITY_WORKSPACE` (default on in development; `"false"` falls back to the previous `ActivityView`). No server flag is added; the existing master and allowlist still gate everything. AI and background sync remain off.
