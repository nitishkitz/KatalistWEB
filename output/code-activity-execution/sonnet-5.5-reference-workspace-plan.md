# Code Activity — reference-locked implementation plan for Sonnet 5.5

Date: 7 October 2026. Owner: product owner. Implementer: Sonnet 5.5. Final visual refinement: Codex/Astra.

## 1. Outcome and authority

Build the Code Activity workspace to match the supplied image, not a new interpretation. Sonnet owns the majority of the implementation: layout, actual provider-backed functionality, responsive behavior, accessibility, failure handling and tests. Codex owns the subsequent visual comparison and small motion/interaction refinement. Polish is not permission to leave a rough layout or broken features.

Reference: [original image](design/reference/code-activity-approved-direction.png), native size **1536 × 1024**. This is the visual source of truth. Preserve its composition, restrained violet, white surfaces, compact rows, visible detail and file/diff split. Do not regenerate a replacement image.

![Visual target](/Users/nagasainathreddy/Documents/ChatGPT/KatalistWeb_dev/output/code-activity-execution/design/reference/code-activity-approved-direction.png)

The user has requested this PLAN. It does not itself authorize applying another migration, changing GitHub App permissions, creating a test Thing, pushing, deploying, or switching flags. Obtain the relevant explicit approval when those steps are reached. Existing GitHub/Supabase activation approval is not blanket approval for new writes.

Three deliberate differences from the picture are agreed:

1. Remove the Cmd+K badge from repository search: Ctrl+K / Cmd+K opens Magic Box.
2. Global **Create Thing** opens the existing Magic Box scoped to the current List; contextual **Create Thing** opens an explicitly reviewed, source-linked draft.
3. Real names, dates, avatars, counts, branches, status and history replace image content. Do not impersonate Katalist members as GitHub commit authors or hardcode the pictured numbers.

Deployments, branch comparison, all six filters, repository search and unified/split diffs are REQUIRED finished features. They may show explicit loading/permission/error states during development, but cannot be silently dropped or marked complete as decorative controls.

## 2. Starting facts — revalidate, do not restart

- Work in `/Users/nagasainathreddy/Documents/ChatGPT/KatalistWeb_dev`, branch `katalist-plan/batch-a-baseline`. Preserve all existing dirty/untracked work. Do not reset, stash everything, rewrite history, switch branches or reinstall dependencies by default.
- Start with ordinary `npm run dev`, real login, demo mode false. No preview command or production fixture imports.
- Existing GitHub App connection and live manual refresh work for WORKSHOP FRIDAY, repository `nitishkitz/KatalistWEB`. The last verified active connection saved 50 real activity rows. Recheck current state without reconnecting or acknowledging sharing on behalf of the user.
- Existing Supabase target is `jrdsmmiggezrhiakncwc` / Katalist_uat. Four applied/local migrations are `20261007180021`, `20261007180103`, `20261007180137`, `20261007181309`. Old draft documents are historical, not evidence these four are unapplied.
- Master is on for one allowlisted List; AI and background sync are off. Preserve this scope. Do not turn on a scheduler, webhook receiver or AI as a side effect.
- Assignee and confirmation functions are NOT applied. The feature now shows an honest setup error. Do not reintroduce an empty working-looking dropdown or bypass it with header names.
- Feed currently returns null additions/deletions/file counts. Detail reads fetch real stats. Current rows repeat a generic push title, and one failing row can render `0 checks failing`; both must be addressed.
- Latest focused UI/client/component run: 46 pass; targeted lint and build pass. Typecheck has three pre-existing errors (`find-phone-user.ts`, `error-component.tsx`, `__root.tsx`). Prior full suite had 27 known failures. Capture a fresh baseline rather than assuming the dirty tree is unchanged.
- Existing Ctrl/Cmd+K in `AppShell.tsx` always navigates to Court. `requestMagicBoxFocus()` dispatches the focus event; `MagicBox.tsx` has draft destination/race protection. `ListThingsSection.tsx` already mounts the real Magic Box with `listId`.

## 3. Modification boundary

Primary allowed implementation area:

- `src/features/code-activity/**` and `src/routes/api/code-activity/**`.
- `scripts/code-activity-*.test.mjs`; a new isolated `tests/e2e/code-activity-workspace.spec.ts`.
- Feature-scoped styles/tokens, not changes to the global palette.
- Minimal wiring inside `src/routes/lists.$listId.tsx` for the Code Activity wrapper and List composer callback.
- A narrowly scoped Magic Box handler registration in `src/features/court/magic-box-entry.ts` and its existing `AppShell.tsx` handler only for the agreed keyboard behavior; test every existing destination.

Protected: login/auth, push/calls, Court layout and genie animation, Morning Brief, profile, Things/Chat/Members rendering, attachment processing, shared Thing creation semantics and shared Supabase RLS/functions. `MagicBox.tsx`, `styles.css`, the List route and route tree are already dirty; compare against the captured starting contents before touching overlap. Prefer reusing the composer unmodified. If an overlap cannot be safely isolated, ask about that exact overlap, not the entire task.

Keep the error boundary outside the lazy chunk. New provider failures must stay inside their pane; failed deployments must not take down branches, feed, diff, Things or Chat.

## 4. Visual contract — do not improvise

Measurements below are implementation targets derived from the raster, not original Figma measurements. Check at 1536 × 1024 CSS pixels, DPR 1, screenshot of application content without browser chrome. Primary layout anchors should be within 4 CSS px; minor raster/font differences are reviewed by Codex.

| Region | Target at 1536 px | Requirement |
|---|---|---|
| Outer gutters | 16 px each | Workspace width 1504 px; no nested extra 32–48 px gutter |
| Existing List header | y≈16–146 | Reuse header/navigation, not a replacement sidebar or duplicate header |
| Header-to-workspace gap | ≈18 px | One rounded white workspace surface |
| Repository toolbar | y≈164–241, 76–78 px high | GitHub mark/name/status left; branch/compare, Sync, Manage, overflow right |
| Category/search row | 54 px | All activity, Commits, Pull requests, Checks, Deployments; search and global creation right |
| Filter row | 58–60 px | Author, Branch, Status, Activity type, Date, File path; Clear filters right |
| Main vertical divider | x≈554 | Feed ~35.8%, detail ~64.2%; at 1536 feed width ≈538 px |
| Feed rows | 108–122 px typical | Avatar, actual title, author/time, branch, SHA/copy, check/files/stats; allow content expansion |
| Selected feed row | 3 px violet left indicator | Light violet fill, rounded 8 px; never thick black outline or heavy shadow |
| Detail padding | 24 px | Title/actions, author/revision/branch, stats, section tabs |
| File list vs diff | file list ~34%, diff ~66% of files area | Single separator, individual file selection, wide readable code area |
| Inputs/buttons | 36–38 px desktop | 44 px touch targets on mobile; icons 16–18 px, avatars 32–40 px |

Typography: reuse loaded Poppins for Katalist UI, existing monospace stack for SHAs/paths/code. Detail title 22 px/600, row title 14 px/600, controls 13 px/500, metadata 12–13 px, code 12–13 px with 20 px line height. Never add text below 12 px or change global fonts. Code can scroll horizontally; general page cannot.

Create scoped semantic tokens in `src/features/code-activity/workspace/code-activity-workspace.css` under one `[data-code-activity-workspace]` root: canvas pale lavender, white surface, deep navy ink, muted indigo text, subtle divider, violet action/selection, green success, red failure, amber pending. Use existing tokens where they match. For feature-specific new colors use named CSS variables with oklch values, derived visually from the reference; do not change root variables or sprinkle raw colors through JSX. Measure contrast rather than copying faint screenshot text blindly.

Keep the reference's moderate radii (workspace 12 px, controls 9–10 px, badges pill). Use existing elevation tokens sparingly; no glow around every card, glass panels, bouncy entrances, huge headings, replacement icons or giant empty cards.

Desktop ≥1200 px: persistent feed/detail split, no click-open modal for ordinary browsing. At 1024–1199 px: 320 px feed, flexible detail; file navigator may collapse behind a file selector. Below 1024 px: list → detail navigation with a real Back action restoring row focus and scroll. Below 768 px: full-width detail, wrapped toolbar, horizontally scrollable category rail, filters in a labeled popover; unified diff default. No squeezed three-column phone layout.

## 5. Component and state boundaries

Proposed feature-local components (create only as needed, not an empty scaffold explosion):

- `CodeActivityWorkspace`: layout/root and selection state.
- `RepositoryToolbar`: connection, freshness, branch selector/comparison, Sync/Manage.
- `ActivityToolbar`: categories, search and Magic Box entry.
- `ActivityFilterBar`: six real filters and active/clear states.
- `WorkspaceActivityList` / `WorkspaceActivityRow`: adapt existing feed/row rendering.
- `WorkspaceChangeDetail`: reuse existing inspector logic; desktop embedded, mobile routed within feature.
- `WorkspaceFilesPanel` / `WorkspaceDiff`: reuse safe patch renderer, add navigator/search and split mode.
- `DeploymentsPanel`: latest status, environment/ref and safe destination/log links.

Keep provider/domain logic out of JSX. Prefer adapting `ActivityView.tsx`, `ChangeInspector.tsx`, `FileDiff.tsx`, `ActivityRow.tsx` over copying their entire logic. Tests may use fixtures; the live bundle may not.

Important existing type boundary: `ActivityChange.kind` currently permits pull_request/push/gap; the saved SQL table permits only pull_request/push. Define a NEW discriminated `WorkspaceItem` in the feature's workspace types for commit/pull_request/push/check/deployment. Do not force-cast new items into ActivityChange, silently widen the hosted constraint, or make legacy workers interpret deployments as pushes. Legacy push/PR adapters remain valid. Tests must verify both old and new parsers.

State is keyed by List + connection ID + generation + selected branch + immutable revision. Abort requests on changes. A late reply from a previous branch, repository, List, file, filter or disconnected connection must not appear in the current pane. Clear private in-memory detail on disconnect/removal. Cache only bounded session results, never sensitive patches in localStorage or new database columns.

Category/filter/search state survives selecting another row. Clear selection when it no longer belongs to the result set; explain why rather than showing a stale detail. Auto-select the first real result on first desktop load only. Do not steal selection during Sync. Never prefill assignee/date from a guess.

## 6. Real-data contracts and semantics

Read endpoint proposals below are NEW, not claims that the routes already exist. Every route must authenticate through the existing caller-scoped auth, verify current List membership/flags/connection in SQL BEFORE GitHub, resolve repository identity server-side, and spend the existing shared request budget. Browser sends List ID and validated selectors, not installation ID, provider token or arbitrary provider URL.

| Proposed read endpoint | Purpose | Minimum result contract |
|---|---|---|
| `GET /api/code-activity/branches` | Branch picker | names, immutable head SHAs, actual default branch, cursor, completeness |
| `GET /api/code-activity/compare` | selected head vs chosen base | head/base names and SHAs, ahead, behind, comparison status, checkedAt |
| `GET /api/code-activity/commits` | real commit rows | SHA, subject, verified author identity/fallback, date, branch context, next cursor |
| `GET /api/code-activity/change-stats` | revision-bound row enrichment | identity/revision, added/removed/file counts or explicit unknown, completeness |
| `GET /api/code-activity/deployments` | real deployment list | id, SHA/ref, environment, latest status, time, safe links, cursor |

Reuse existing feed/detail/checks/assignee/confirmation routes where possible. Record final endpoint/parser contracts before implementing consumers; no unresolved `TODO` fields. All responses no-store; server-only bounded cache may be used after authorization with connection/generation keys. Cursor must bind branch/filter/category scope and be validated; no arbitrary pagination URLs forwarded from the browser.

Suggested NEW request bounds (freeze at S02 after checking existing budgets): 50 rows/page; ≤300 branch names with explicit truncation; ≤200 commits per browsing window before user narrows date/branch; ≤50 deployments/window; latest statuses enriched for visible rows in batches ≤10. Existing 8 s provider deadline and hourly budget stay enforced. Use a 25 s whole new read sequence unless a measured reason justifies a stricter bound; abort before exceeding host execution limits. Stats enrichment prioritizes selected + first 10 visible rows, concurrency ≤2 and cancellation. Never hydrate hundreds of full diffs just to paint the sidebar.

### Identity, commits and size

Use actual commit subject for commit rows. Do not convert a push range into a fabricated single commit. `All activity` merges typed commit/PR/check/deployment entries; suppress a push wrapper only when its relationship to an actual commit is verified. Preserve existing saved push records and their before/after identity; multi-commit ranges remain explicitly labeled pushes if shown. No lossy rewriting of existing feed data.

Commit author display comes from GitHub, not matching nicknames to List members. Email-only git identities must not be unnecessarily exposed. Avatar failure uses initials. Copy copies the full SHA, while the pill shows seven characters; say Copied or show a non-blocking failure.

Stats mean lines added/removed and files changed. Fill them from authoritative revision-bound detail/commit data; never infer zero from missing data. Do not show `size not available` on every normal row. While loading use small placeholders; on failure use `Stats unavailable` with a reason. If files are truncated, exact totals must come from a separate authoritative field or stay unknown. A failed file list is not `0 files`.

Checks use checks + commit statuses for the same revision. The existing saved aggregate can say failing without individual checks loaded: show `Checks failing`, not `0 checks failing`. Never claim Passed unless both sources meet the completeness rules. Distinguish pending, none reported, unavailable, partial and stale. Numbers and PR badges must be computed from the queried scope, never copied from the picture; label partial totals.

### Branch selection and comparison

Picker controls READ scope only. No checkout, push, merge, reset, rebase or production deployment. Default to the repository's returned default branch; restore a saved selection only if it still exists. The picture's branch name is a real selection if available, not a hardcoded default.

The Branch filter and toolbar picker are two controls for the SAME state, not contradictory independent filters. Base defaults to the returned default branch and can be changed through Compare options. Resolve both refs to immutable SHAs before comparing. Same head/base shows verified zero/zero. Branch deletion/unrelated histories/forbidden/rate limit are explicit states, not zero counts. Ahead/behind describes branch history, not deployment health.

### Deployments

Scope is GitHub-recorded deployments/statuses, not a claim to enumerate every Vercel build. Read only: no create deployment, redeploy, promote, rollback, delete or provider-console mutation. If a hosting provider reports only a commit check and no GitHub deployment, keep it under Checks, not invented Deployments.

The existing runtime token permissions do not include deployments. Prepare an optional `deployments: read` extension and permission-aware state; updating the App/install permissions requires user approval. Without it, show a specific permission-needed state inside the same tab geometry. Add it to the token verifier deliberately: continue rejecting write scopes and unrequested repository access. Do not weaken token validation globally to accept any extra permission.

### Filter/search behavior — frozen rules

Search is plain case-insensitive text over title, known author, SHA, branch and indexed file paths, debounced 250 ms; Enter is not needed. No Cmd/Ctrl+K handler here. File search in the detail filters only that change's files and never changes the activity category.

All filters compose with AND. Within a multi-select filter, selections compose with OR. Date boundaries use the browser/user timezone, convert once to UTC, and group Today/Yesterday consistently. Invalid ranges show a field error. Clear filters resets search + six filters and branch selection to the repository default; it does not disconnect or clear drafts.

Author = provider identities; Branch = shared branch state; Status = category-valid PR/check/deployment states; Activity type = typed sources; Date = activity time; File path = normalized literal path/prefix, not arbitrary regex. Commits may use GitHub's path query. Mixed-category path matching needs verified indexed paths; rows whose paths are unknown are not silently excluded as non-matches. Expose “Searching remaining changes…” and “Results incomplete” on bounded scans. Deployment path matches require evidence from its commit, not the deployment label. Never say repository-wide search is complete after filtering one downloaded page. Label the supported window and scope beside results; advance source cursors until enough matches or the approved cap is reached.

### Unified/split diff

Same immutable patch and file selection in both modes. Parse unified hunk headers into left/right line numbers; pair additions/removals deterministically, with blank placeholders where there is no opposite line. Do not invent omitted context or syntax. Patch text is inert escaped text; provider HTML/scripts never execute. Show binary, missing patch, truncated, renamed, deleted and revision-changed states. File icons denote actual file status. File overflow menu offers real Copy path/Open on GitHub actions only. Expanded diff is a scoped accessible dialog with focus return.

### Two creation actions and keyboard behavior

Global button uses the SAME dispatch as Ctrl+K / Cmd+K. On the current List's Code Activity tab it reveals the existing List-scoped Magic Box in a bottom overlay/dock and focuses it after mounting, without navigating to Court, replacing selected GitHub detail or auto-submitting. On close/Escape preserve the existing List draft, restore initiating focus, and return to the unchanged workspace. Do not show a second simultaneous composer. Reuse its existing draft key and attachments; no new parser or Thing creation path.

Implementation routing: add a scoped registration to `magic-box-entry.ts` for the active List capture handler. `AppShell.tsx` asks that handler first; if handled, skip its Court navigation. Otherwise keep the existing navigate-to-Court/focus behavior for every other screen. Unregister on unmount/List change. Button and shortcut call the same handler, do not synthesize keyboard events. If an existing overlay owns an unsaved draft, focus that draft or use its discard-confirmation flow; do not silently close it.

Contextual button keeps the GitHub-linked review, current List fixed, source/revision retained, explicit eligible assignee, optional unset due date, existing Waiting for Catch behavior and atomic idempotent confirmation. View Only can read but gets neither creation action. Missing backend setup remains explicit. Do not apply G15 to “fix the dropdown” without approval and reviewing its dependency on the unapplied consent table/AI guard. AI remains off; no Sarvam requests.

New workspace items are not necessarily persisted G07 changes. Their contextual action needs a trusted source ID, not a browser-authored commit title passed off as evidence. S10's candidate must add a private, bounded `code_activity_workspace_sources` registry keyed by connection + generation + source kind + provider identity + immutable SHA. Server-only registration validates current connection and canonical provider facts; authenticated lookup returns only authorized source metadata. The confirmation contract accepts that source ID and rechecks List, connection/generation, identity and revision. Never create dummy push rows just to satisfy the old confirmation RPC. Reuse ONE shared feature receipt/idempotency namespace across legacy and workspace sources so a retry cannot duplicate a Thing through another endpoint.

Manual-only confirmation must reject AI-generated input and must NOT execute SQL referencing the missing G14 consent table. Review/adapt the unapplied G15 candidate accordingly before it is presented for approval; activating the entire AI schema is not needed to make manual creation work. Include assignee reads, the source registry and atomic manual confirmation in one explicitly reviewed additive feature-schema package. Do not claim that applying the existing G15 file unchanged is sufficient.

## 7. Small tasks Sonnet can execute precisely

Run in order inside each milestone; continue independent work if an external permission gate blocks one task. Each task requires a focused passing test and a short ledger entry before moving on. Do not run a full-repository test/mutation sweep after every small visual adjustment.

### Milestone A — faithful shell and safe interactions

**S00 — capture starting state.** Read AGENTS and relevant skills; record branch, changed-file inventory, existing migrations/flags and baseline command results without secrets. Save starting screenshots. Do not fix baseline failures. Done: a reproducible baseline record and exact protected edits.

**S01 — lock contracts and component map.** Write the above endpoint/filter/identity contracts in `workspace-contracts.md`; identify reused components and minimal shared-file overlaps. Inspect original image directly. No new schema yet. Done: every visible control maps to an action and response/error contract; no magic defaults or guessed limits.

**S02 — desktop geometry.** Add scoped tokens and three workspace toolbar rows, left list/right detail, then inner files/diff split. Keep current connection states and real data. Match the table's anchors before embellishment. Done: 1536 screenshot has the same hierarchy/proportions; desktop row click does NOT open a modal; other List tabs unchanged.

**S03 — Magic Box action.** Implement one scoped handler and reuse List-scoped Magic Box. Update global-shortcut tests to preserve Court fallback and test local handling; do not weaken old tests just to pass. Done: button + both shortcuts focus one correct composer, List destination/drafts persist, Escape restores focus, search cannot hijack K.

### Milestone B — authoritative GitHub workspace data

**S04 — branch picker/comparison.** Extend provider reader/parsers and add branches/compare routes; freeze actual SHAs in responses. Tests: slash/Unicode branch encoding, wrong List/repo, same ref, deleted ref, cancellation/out-of-order reply, unknown != zero, token budget denial. Done: real branch selection changes scope and verified ahead/behind appears.

**S05 — commit rows and typed categories.** Add true commit pagination, real subject/author/time/SHA, typed identities, and adapters for existing PRs/checks. All activity must merge source pages deterministically by activity time with stable tie-breakers and no duplicated identities; document composite cursors. Tests: overlapping pages, force push, multi-commit push, unknown author, partial source, category change. Done: live rows match the reference's content hierarchy without relabeling ranges as commits.

**S06 — row stats/check summaries.** Add bounded enrichment with immutable revision keys and response completeness. Reuse detail results; no persistent patch storage. Tests: visible-row budget, cancellation, changed SHA, null != zero, failing aggregate with zero loaded runs, partial checks. Done: normal enriched rows show actual files/+/-; selected detail agrees; no `0 checks failing` artifact.

**S07 — read-only deployments.** Prepare optional read permission + two provider read parsers, deployment/status pagination and dedicated pane. Ask once for the precise App permission change; do not reset the connection. Tests: missing permission, no deployments, latest failed/pending/success/inactive/no-status, stale status response, malicious external URL. Done: live GitHub deployment evidence is rendered, or a documented operator gate remains open; mocked success alone is not complete.

### Milestone C — all pictured controls work

**S08 — six filters and search.** Implement pure query normalization, state sharing, bounded matching/indexing and cursor reset. Tests: all filters together, path unknown, match on later page, category-invalid status, timezone midnight, literal hostile query, stale response, clear behavior. Done: changing each control changes actual results, loading/partial scopes are honest, search has no K shortcut.

**S09 — files navigator/diff modes.** Reuse safe detail flow; implement file search, status icons, SHA/path copy, unified/split modes and expand. Tests: hunk line numbers, insert/delete-only, binary, missing/truncated patches, long path, hostile patch, file search/selection stability. Done: reference's Files view is faithful and all toggles work from the same data.

**S10 — contextual creation readiness.** Review G15 and consent dependency against current hosted schema and existing create_thing signature. Draft the manual-only additive package described above, including source registry, deny-by-default grants/RLS, one replay namespace, legacy/new source identities, current List candidates and rejection of AI input without referencing unapplied consent tables. Do not modify the shared creation function. Without explicit user approval, keep live creation unavailable but finish all independent tasks. With approval, apply individually to the exact target, verify owner/collaborator/View Only/outsider access and real PostgREST candidate reads. Ask before creating a named test Thing. Tests include repeat requests across source adapters, arbitrary client SHA/provider IDs, removed assignee/member, disconnected generation, missing AI schema and concurrent confirmations. Done: actual assignees and atomic confirmation work in the approved environment; no claim based only on PGlite.

**S11 — responsive/accessibility/failure behavior.** Implement the specified breakpoints; keyboard-select rows and tabs, visible focus, labeled filters, Escape/back, no color-only state, 200% zoom, reduced motion. Fail each new pane independently and preserve saved data/drafts. Done: 1536/1440/1024/768/390 layouts usable without horizontal page overflow or focus loss.

### Milestone D — verified handoff, not another redesign

**S12 — integrated acceptance.** Run focused feature suites, touched-file lint and build; full suite/typecheck once at this milestone, compare failure names to S00. Run real-browser flow below. Record real vs mocked evidence separately. Done: no new attributable test/type/lint failures; every required task has evidence or an exact external gate, not vague “done.”

**S13 — Sonnet delivery packet.** Produce `workspace-status.md` with task states, files, commands, permission/migration outcomes, remaining defects and screenshots. Capture 1536, 1440, 1024, 768, 390 plus 200% zoom. Use deterministic test data only in isolated visual tests; signed-in live screenshots prove provider behavior separately. Keep the saved original image next to comparison screenshots. Done: Codex can compare and polish without rediscovering architecture or missing controls.

### Codex/Astra polish — after Sonnet's delivery

**P01** Compare original/implementation side-by-side; fix typography, exact alignment, rhythm, borders, chips, avatars, truncation and diff density inside the feature. **P02** Add restrained 120–180 ms color/opacity feedback and at most a 140–180 ms detail transition; no height bounce, elastic entrance, animated code lines or remount flicker. Respect reduced motion and do not replay transitions on background refresh. **P03** Recheck visual snapshots, keyboard focus and touched-feature tests after polish.

Sonnet must not change functionality to imitate a screenshot. Codex must not rewrite working provider/security logic just to add life.

## 8. Acceptance sheet — all required for “finished”

- Original silhouette at 1536; persistent desktop split, compact selected row, file navigator/diff ratios. No modal-only desktop implementation or redesigned sidebar.
- Ordinary npm run dev, real login, existing GitHub connection retained. No production fixtures or secret/token leakage.
- Live commits, PRs, checks, deployments, branch comparison; honest partial/unavailable/permission states.
- All six filters and both searches work, pagination does not duplicate or fabricate results, missing metadata does not become zero.
- Global button/Ctrl+K/Cmd+K reach the same List-scoped Magic Box; contextual action retains revision/evidence and requires explicit confirmation.
- View Only/outsider restrictions verified server-side; permissions checked again before every provider read. Wrong repository IDs or arbitrary URLs cannot bypass scope.
- Stats/checks/detail belong to the same immutable revision; late replies/disconnect cannot resurrect old data.
- Unified/split/expand/copy/open actions work. Patch text stays inert and unwritable.
- Things, Chat, Members, calls, login, push, Court/Morning Brief and existing Magic Box drafts still behave as at baseline.
- No new attributable full-suite/type/lint failure; no claim that the repository's known failures are green.
- Sonnet delivers screenshots/tests/status; Codex completes P01–P03. A feature blocked on live permission or approved schema is PARTIAL, not complete.

## 9. Stop, safety and progress rules

Before delivery, execute this real-browser sheet and record each step separately (screenshots and outcomes, never credentials):

1. Run ordinary npm run dev and sign in normally; open the connected List. Verify Things/Chat/Members still work and the existing repository remains connected.
2. At 1536 × 1024 select the first real row. Check persistent detail, actual subject/author/SHA, stats and Files layout against the original. Switch rows rapidly; no old reply may replace the latest selection.
3. Select two real branches and a base; verify comparison against GitHub. Include same-ref and missing/ref-error cases without checking out a branch.
4. Visit Commits/PRs/Checks/Deployments; verify real evidence or an honest empty state. Confirm deployment permission failure affects only Deployments, not the working feed.
5. Test each filter independently, then author + branch + date + path together. Find a match beyond page one, exercise Load more, clear filters and confirm documented partial/window scope.
6. Search titles/SHA/path, then search files inside the selected change. Toggle unified/split and expand. Check line numbers and revision match, long paths, copy success/failure and safe external links.
7. Press Ctrl+K and Cmd+K separately, then click the global Create Thing button. Each must activate one correct List Magic Box. Write a draft without submitting; Escape/reopen preserves it. Check Court fallback separately.
8. Open contextual creation. Verify source/revision and real eligible List assignees with no guessed date. Without schema approval verify setup state; with approval verify the candidates and permissions. Submit ONE clearly named test Thing only after explicit authorization; replay the same request and verify one Thing/receipt, not two.
9. Use approved test identities for collaborator/View Only/outsider checks, including direct API reads. Never change live members' roles to manufacture a test. Check disconnect/revocation using an approved disposable scenario, not the user's active connection without confirmation.
10. Capture 1440/1024/768/390 and 200% zoom; keyboard/back/focus restoration and reduced motion. Restore any test viewport override. Deliver task status with exact unresolved external gates.

Stop only the affected new operation on denied access, changed connection/revision, missing configuration, exhausted budget or partial provider failure. Keep saved read data appropriately labeled and other panes/tabs working. Do not bypass authorization, delete history or expand permissions to make a test pass.

Backend: no change to shared auth/RLS/create_thing; only reviewed additive feature schema with explicit target approval. Keep privileged credentials server-only, explicit function search_path/grants, transaction/lease generation checks and safe URL validation. Rollout: retain the one-List allowlist; disable only the new workspace flag if introduced, falling back to the current working Code Activity view. Do not drop new tables as rollback. Any new flag needs explicit documented configuration, default behavior and tests; no unexplained “not available” dead end.

Process: one task at a time, targeted checks first, full checks at milestones. Do not reopen settled product choices or repeatedly ask “what next?” between authorized tasks. Record a genuine external gate once, continue independent tasks, then give one consolidated approval request. Plan does not waive confirmations. No commits/push/deploy unless separately requested.

## 10. Provider evidence checked for this plan

These are endpoint facts, not live validation of the planned additions. Recheck against the API version in use before coding; do not change the version header merely because a documentation URL contains a version query.

- Commit listing supports branch/SHA, author, path and date selectors; commit detail returns stats. Comparison accepts refs/SHAs, with bounded first-page file data. [GitHub commits/compare documentation](https://docs.github.com/en/rest/commits/commits).
- Branch listing uses Contents read. [GitHub branch documentation](https://docs.github.com/en/rest/branches/branches).
- Deployment listing requires Deployments read and supports ref/SHA/environment filters. [GitHub deployments documentation](https://docs.github.com/en/rest/deployments/deployments).
- Deployment status listing requires Deployments read; use the latest provider status rather than equating a deployment request with success. [GitHub deployment-status documentation](https://docs.github.com/en/rest/deployments/statuses).

All feature limits, component boundaries, scope/matching rules and rollout details above are this plan's proposed implementation contract, not GitHub guarantees.
