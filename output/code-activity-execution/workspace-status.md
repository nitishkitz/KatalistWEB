# Code Activity workspace: delivery status (S00 to S13)

Date: 7 October 2026. Branch `katalist-plan/batch-a-baseline`. Nothing here is committed, pushed, deployed or applied to a shared database.
Reference: `design/reference/code-activity-approved-direction.png`. Plan: `sonnet-5.5-reference-workspace-plan.md`. Contracts: `workspace-contracts.md`.

## Result in one line
The workspace is implemented and verified in code, tests and a MOCKED visual harness. It has NOT been exercised with a signed-in browser, real GitHub data, or a real Magic Box, and live Thing creation from a change is intentionally unavailable until the S10 package is approved and applied.

## Evidence, separated by kind

### REAL (run in this session)
| Check | Result |
|---|---|
| `npm run typecheck` | exactly the 3 baseline errors (`find-phone-user.ts`, `error-component.tsx`, `__root.tsx`); none from this work |
| `eslint src/features/code-activity ...` | 0 errors, 0 warnings |
| `vite build` | passes |
| Code Activity suites (`scripts/code-activity-*.test.mjs`) | 250 / 250 pass (was 203 before; adds logic 13, workspace server 14, workspace UI 16 and updated structure counts) |
| SQL integration (PGlite, applied connector + g10 harness) | 20 / 20 and read-only subset 3 / 3 |
| S10 SQL package (PGlite, `CODE_ACTIVITY_SUBSET=workspace`) | 13 / 13 |
| Full suite `npm test` | 1191 tests, 27 failures. The failing set is **identical** to the recorded pre-work set (Morning Brief/Court, Thing detail, MagicBox destination rows, shadow and 12 px font audits in other files, avatar, auth autofill). None involve the new files |

### MOCKED (visual harness, `visual-harness/`, fixtures in `fixtures.ts`)
The real `CodeActivityWorkspace` renders against scripted replies; the Magic Box is a labelled stub. Authors, commits and diffs are invented. Evidence for LAYOUT and STATES only.
- Screenshots in `screenshots/`: 1536 (default, Files tab, empty, source error, deployments permission needed), 1440, 1024, 768 (+ detail), 390 (+ detail), and 200% zoom of 1280 (640 px viewport, + detail).
- Measured anchors (`screenshots/geometry.json`, 1536 x 1024): workspace x = 16 and width 1504 (target 16 / 1504), divider x = 555 (target about 554), feed share 0.358 (target 0.358), first row 116 px (target 108 to 122), no horizontal page overflow at any width, no text below 12 px, and every control at 390 px is at least 44 px. At 768 px controls stay 36 px (the 44 px rule applies below 768 px).

### NOT VERIFIED (needs approval or an environment that does not exist here)
- Signed-in browser run of the real Lists > Code Activity tab, and a comparison screenshot of it against the reference.
- Real GitHub responses for branches, compare, commits, change stats, deployments and commit detail. The provider parsers are tested against provider-shaped fixtures only. The `X-GitHub-Api-Version: 2026-03-10` header and how GitHub answers a refused `deployments: read` token request (assumed 403 or 422) are UNVERIFIED.
- The real Magic Box focus and the real Ctrl/Cmd+K path through `AppShell` (the jsdom test covers the shared handler with a stub Magic Box; the AppShell wiring is covered by the existing source-pattern test and a typecheck).
- `tests/e2e/preview/code-activity-workspace.spec.ts` is written and never run.

## Task ledger
| Task | Status | Notes |
|---|---|---|
| S00 baseline | DONE | starting state recorded; no starting live screenshot was possible |
| S01 contracts | DONE | `workspace-contracts.md`; derived-check wording corrected |
| S02 desktop geometry | DONE (mock evidence) | scoped CSS tokens, three toolbar rows, persistent split, files split, no modal on desktop; List route wrapper changed to 16 px gutters |
| S03 Magic Box | DONE (stub evidence) | `registerMagicBoxHandler` / `tryHandleMagicBoxCapture`; AppShell asks the handler first, then falls back to Court (existing regex test still passes); dock reveals the same List-scoped Magic Box in place, once, focuses it, Escape restores focus, draft kept while hidden |
| S04 branches and compare | DONE | `/branches`, `/compare`; one shared branch state with the Branch filter; slow replies for a previous branch are dropped (tested) |
| S05 commits and categories | DONE | `/commits` with cursor bound to scope; author, path and dates pushed down to GitHub where possible |
| S06 stats and checks | DONE | `/change-stats` (10 ids, concurrency 2); unknown is never zero; rows show an honest "unavailable" |
| S07 deployments | PARTIAL | read-only list and states done. Needs the `deployments: read` GitHub App permission, which is not granted; the pane shows a specific "permission needed" state |
| S08 filters and search | DONE | six filters, search, Clear filters, local-day dates, literal path filter, "path not checked" marker, "Results may be incomplete" notice |
| S09 files and diff | DONE | file list + diff, search files, Unified (default) / Split, expand dialog, copy path, open on GitHub; patches stay text (tested with a hostile patch) |
| S10 contextual creation | PARTIAL (code complete, database not applied) | `s10/DRAFT_code_activity_workspace_creation.sql` (13 tests) is NOT applied. Server routes `workspace-source` (reads the commit from GitHub, then records it) and `workspace-confirm`, plus a manual review form for commits, are written and tested against stubs. Until the SQL is applied the form explains that setup is missing and keeps the person's text. Saved pull requests and pushes still use the existing reviewed flow |
| S11 responsive and a11y | DONE (mock evidence) | breakpoints, Back restores row focus (tested), roving tabs with arrow keys, container-query row actions, 44 px targets below 768 px, reduced motion |
| S12 integrated acceptance | DONE except the live items above | |
| S13 packet | this file | |

## Differences from the reference picture (agreed in the plan)
No Cmd+K badge on search; the toolbar Create Thing opens the Magic Box while the detail Create Thing opens a reviewed source-linked draft; real data replaces the picture's content. Also: sync labelled "Sync" as in the picture; a "Default branch" label shows when the selected branch is the default.

## Review round 2 (functional fixes, all with new tests)
1. A branch is now compared with the repository default when no base is chosen.
2. The selected branch scopes pull requests (head or base), pushes and deployments, not just commits.
3. Checks asks for details of the underlying commits and pull requests, so the derived rows fill in instead of staying empty.
4. Clear filters also clears search and returns to the default branch; a non-default branch counts as an active filter.
5. Commit Thing creation: source registration route, confirm route and a manual form (see S10).

## Bugs found and fixed while building
- A failed source (for example commits) held the whole list empty; a failed source now counts as read with nothing in it and shows its own Retry (UI test added).
- Branch and ref validation accepted spaces, `~`, `^`, `:`, `?`, `*`, `[`, `@{` and `.lock`; now rejected before any GitHub request.
- The Create Thing dock could ask for focus before React had rendered it; it now renders synchronously first, with a bounded retry.
- PostgreSQL rejects `{1,300}` in a regular expression; the source URL check uses `{1,250}`.
- Test infrastructure: the Node test loader had no `.css` stub; `assert.equal` on DOM elements hung the runner (serialisation), so element comparisons use `===`.

## Approval gates (nothing below was done)
1. Grant the GitHub App `deployments: read` (changes real GitHub configuration) to enable the Deployments tab.
2. Apply `s10/DRAFT_code_activity_workspace_creation.sql` to Katalist_uat as a single migration, exact target, then verify with real PostgREST. It replaces the manual part of the unapplied G15 draft: apply this OR G15, never both. The routes and form are already written; after applying, verify them end to end with real PostgREST.
3. Create one named test Thing, and run the signed-in browser, collaborator and View Only checks.
4. Commit, push or deploy (not requested).

## Hand-off to polish (P01 to P03)
Known polish items, none blocking: the selected row's accent bar and the 1024 px row layout, filter popover density, detail-pane empty state when a deployment has no description, and a real-data pass on typography once screenshots exist from a signed-in session.
