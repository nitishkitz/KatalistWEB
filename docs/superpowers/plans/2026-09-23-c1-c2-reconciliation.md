# C1/C2 Reconciliation Tracker

Date: 2026-09-23
Baseline: `f9754233ec271f58494e67d019cc58f4df0f815d` on `katalist-plan/batch-a-baseline`
Purpose: single running status record for the C1 completion + C2 implementation plan. Updated at each commit boundary. Statuses are one of **completed**, **in progress**, **outstanding**, or **deferred** (deferred = explicitly accepted as out of scope for now, with a reason, not silently skipped).

## C1 — reviewed waterfall/error work

| Item | Status | Evidence |
|---|---|---|
| Thing/Court/Buckets/Bucket-items/Trophy/List-mapper lookup parallelization | Completed | Commits prior to `f975423`; deterministic concurrency tests, no wall-clock thresholds |
| Bucket-item/Thing/List/member required-data error propagation | Completed | `fetch-buckets.ts`, `fetch-bucket-items.ts`, `map-list-rows.ts`; failure-path tests verified against pre-fix source |
| Court actor-read error propagation (distinct from legitimate no-actor) | Completed | `fetch-court.ts`; `fetch-court-error-propagation.test.mjs` |
| Session-identity reuse (no redundant `auth.getUser()` in Court) | Completed | `fetch-court.ts`; source-level RLS evidence only, not live-verified — caveat stands |
| Single-List fetch/mapping extraction, with eligibility filters preserved | Completed | `fetch-list-detail.ts` now requires `archived_at IS NULL` and `kind = "list"` on the primary query, with a narrowly-scoped (missing-`kind`-column only) compatibility fallback that still filters by exact id and archive status; `fetch-list-detail.test.mjs` covers normal/archived/dm-group/missing-row/fallback/permission-failure/mapper-failure, verified to fail 6/7 against the pre-fix unfiltered version |

## C1 — broader scope (not yet started at this baseline)

| Item | Status | Reason |
|---|---|---|
| Actor caching (profile-scoped, QueryClient-based) | Deferred | Needs its own lifecycle design (P3) before implementation (P4) — bundling it into the waterfall pass would repeat the exact mistake being corrected for C2 |
| Route-level request counts/durations/scaling | Outstanding | No live measurement exists; mocked concurrency tests prove serialization reduction only, not request volume or latency |
| Summary/detail separation, bounded attachments/activity, pagination | Outstanding | Not addressed by any extraction done so far; scoped to P5 |
| `use-trophy.ts` decorative-stat error swallowing (`shreddedRows`/`tnames`/`lnames`/`bnames`/`actors`) | Deferred | Outside bucket/Thing/List/Court-partition scope; flagged, not fixed |

## C2 — realtime ownership (not yet started)

Not begun. P0 inventory (see `2026-09-23-realtime-ownership-inventory.md`) is complete as of this baseline. No design decisions have been made yet for P3 (identity/cache lifecycle) or P6-P8 (routing/batching/ownership relocation). Key facts the inventory established that any design must account for:

- One global owner today (`use-realtime.ts`, mounted once from `AppShell`), keyed on `[qc, real]` — does not re-key on `session.user.id` changing, only on `real` flipping.
- Two independent live-update paths for `list_messages` (global postgres_changes + per-list broadcast) with overlapping-but-different invalidation targets.
- `AppContextProvider.tsx:79` performs a full keyless `qc.invalidateQueries()`, broader than anything else in the tree.
- `query-updates.ts` runs direct optimistic `getQueryData`/`setQueryData` writes independent of both the realtime hook and every ad-hoc invalidate call — any P3/P7 design must account for this layer, not just subscribe/invalidate.
- `presence.ts` is a working precedent for a ref-counted single-owner channel lifecycle in this codebase.
- 18+ raw query-key prefixes have no factory, and 2 confirmed cases where a factory exists but a call site duplicates its shape without using it (`["list", listId]`, `["profile", ...]`). Key-convention work in P3 will need to resolve this drift, not just add new keys on top.

## Sequence status

| Step | Status |
|---|---|
| P0 — baseline, inventory | Completed |
| P1 — List-detail filters + regression tests | Completed |
| P2 — remaining read-error policy | Not started |
| P3 — identity/cache lifecycle design | Not started (review gate — needs explicit approval before P4/P7) |
| P4 — actor cache | Not started (depends on P3) |
| P5 — summary/detail split, bounded feeds | Not started |
| P6 — pure realtime routing/batching engine | Not started |
| P7 — application-level ownership relocation | Not started (depends on P3/P6) |
| P8 — chat/hub/membership safety | Not started (depends on P7) |
| P9 — reconnect/focus recovery, browser/staging validation | Not started |
| P10 — final reconciliation, handoff | Not started |

No behavior changes have been made in P0. No files edited except the addition of this tracker and the inventory doc.
