# C1/C2 Reconciliation Tracker (P10 — final)

Date: 2026-09-23
Baseline: `f9754233ec271f58494e67d019cc58f4df0f815d` → current HEAD on `katalist-plan/batch-a-baseline`
Purpose: single running status record for the C1 completion + C2 implementation plan. Statuses: **completed** (implemented and locally verified), **live-pending** (implemented and locally verified; live/staging acceptance not run — no credentials in this environment), **outstanding** (not started, not blocked), **deferred** (explicitly out of scope for now, with a reason), **blocked** (cannot proceed without something outside this environment: live credentials, or a new schema/RPC requiring its own review gate).

## C1 — reviewed waterfall/error work

| Item | Status | Evidence |
|---|---|---|
| Thing/Court/Buckets/Bucket-items/Trophy/List-mapper lookup parallelization | Completed | Deterministic concurrency tests, no wall-clock thresholds |
| Bucket-item/Thing/List/member required-data error propagation | Completed | `fetch-buckets.ts`, `fetch-bucket-items.ts`, `map-list-rows.ts`; failure-path tests verified against pre-fix source |
| Court actor-read error propagation (distinct from legitimate no-actor) | Completed | Superseded by P4's `getActorId` (below), which preserves this same distinction |
| Session-identity reuse (no redundant `auth.getUser()` in Court) | Completed | Source-level RLS evidence only, not live-verified — caveat stands |
| Single-List fetch/mapping extraction, with eligibility filters preserved | Completed | `fetch-list-detail.ts` requires `archived_at IS NULL` and `kind = "list"`, narrowly-scoped compatibility fallback; tests verified to fail against the pre-fix unfiltered version |
| `map-thing-rows.ts`/`use-trophy.ts` comment-count and Shred-history error propagation | Completed | P2; verified to fail against pre-fix source |
| `use-lists.ts` bare-`["lists"]`-prefix cache-seed scan (cross-profile leak) | Completed | Fixed in P3 (`ae2bf3a`), scoped to `keys.lists(profileId, context)` |

**Deferred, deliberately decorative, unchanged:** `use-trophy.ts`'s shredded-item name-resolution reads (`things`/`lists`/`buckets` display names); `map-list-rows.ts`'s cover-URL signing.

## C1 — actor caching (P4)

**Completed.** `src/features/people/actor-query.ts`'s `getActorId(qc, profileId)` replaces the duplicated ad-hoc actor lookups in `fetch-court.ts` and `use-trophy.ts`. Meets every acceptance criterion (correct profile isolation, deduplication via `qc.fetchQuery`, eviction on identity retirement via a self-registered disposer, a bounded-staleTime missing-actor policy allowing later discovery, failed requests never cached as success, late responses can't repopulate a retired identity's cache, no context dimension — matching the `actors` table's real schema). 8 tests in `actor-query.test.mjs`, each mapped to one criterion.

## C1 — request-count/latency evidence

**Live-pending / outstanding.** Every parallelization change in this batch is proven with deterministic, mocked concurrency tests (event-order proofs, not wall-clock). None of that is live request-count, latency, or backend-scaling measurement — no staging/production environment exists in this session to measure against. Explicitly not claimed as verified.

## C1 — summary/detail separation, bounded attachments/activity, pagination (P5)

**Partially completed, rest blocked pending a separate review gate.**

- ID deduplication before batch requests: **already completed** (from earlier Batch C1 work, confirmed present in `map-list-rows.ts`, `map-thing-rows.ts` — `[...new Set(...)]` patterns for profile ids, list ids, cover paths).
- Summary/detail fetch contracts, deferred attachment/activity hydration for detail-only views, and server-side cursor pagination for `list_messages`/Thing comments/activity: **blocked**. The master plan's own §9.2/§9.3 explicitly requires proposing any new aggregate RPC/schema change "in a separate reviewed change" — this session has no authorization to create migrations or new RPCs, and the environment has no live database to apply or test one against even if it did. Implementing a client-side-only pagination shim over an already-fully-downloaded dataset would not be a real optimization (the plan's own words) and was not attempted for that reason, not for lack of effort.

## C2 — realtime ownership

| Step | Status | Evidence |
|---|---|---|
| P0 — inventory | Completed | `2026-09-23-realtime-ownership-inventory.md` |
| P3 — identity/cache lifecycle design + implementation | Completed | 5 design revisions (`6c7a896`…`8e41a9a`), then implemented: epoch primitive + epoch-scoped claims/chains (`60255d7`), `IdentityBoundary` (`f93930c`), Required-tier invalidation retrofit (`c8c6604`), context-race fix + `initialData`/`resetQueries()` verification (`bad8810`) |
| P4 — actor cache | Completed | See above |
| P5 — summary/detail, pagination | Blocked (see above) | — |
| P6 — pure event-routing + invalidation-batching engine | Completed | `event-invalidation-map.ts`, `invalidation-batcher.ts` (`16316af`); 11 tests, deterministic fake-clock scheduling |
| P7 — application-level ownership relocation | Completed | `RealtimeInvalidationProvider.tsx` replaces `use-realtime.ts` (deleted), mounted once inside `IdentityBoundary`'s remounted children instead of once per `AppShell` instance (`3979311`); 5 real DOM/React tests |
| P8 — chat/hub/membership safety | Completed (the two concrete, testable deliverables); rest deferred | Ref-counted `list-chat` channel registry (`0a3bdf7`); best-effort membership-revocation cache eviction (same commit, explicitly not the primary mechanism — see below). `hub-conversations`' dead broadcast listener left untouched (see "Deferred" below) |
| P9 — reconnect + browser validation | Completed (reconnect logic); browser validation done and limited (see below) | Reconnect catch-up revalidation (`968734f`), 4 tests; real-browser smoke test (Playwright, not committed — see below) |
| P10 — final reconciliation | This document | — |

### C2 — what "completed" does NOT include (named, not silently assumed)

- **Live Supabase/RLS behavior.** Every claim above is proven against real `@tanstack/react-query` (`QueryClient`/`QueryObserver`), a real DOM (jsdom + `@testing-library/react`), and mocked Supabase clients/channels. None of it has run against a live Supabase project. **Blocked: no staging credentials in this environment.**
- **A real two-account live switch.** The A→B identity-switch tests (P3/P7/P9) simulate the switch by changing what a mocked `useSession()` returns — this proves the boundary's own logic correctly, but does not prove it against two real authenticated Supabase sessions in one browser. **Blocked: same reason.**
- **`hub-conversations`'s dead broadcast listener.** Confirmed via repository search (P0) that nothing sends to it — the plan's own instruction was to remove it only after that search *and* an integration scenario establish it's redundant. The search is done; the live integration scenario is not (needs a live app + a real message send to observe whether the hub rail still updates without this listener). **Deferred, not removed**, pending that live check.
- **The membership-revocation fast path's payload-completeness assumption.** Works correctly when a `list_members` DELETE payload includes `profile_id`/`list_id`; whether Postgres actually delivers those fields depends on the table's `REPLICA IDENTITY` setting, which requires live database access to check. The *primary* mechanism (batched invalidate-and-refetch, discovering "no longer accessible" via RLS regardless of payload completeness) does not depend on this and is fully verified. **Blocked (the fast path's real-world applicability only): no live database access.**
- **The "Lower priority" caller-level invalidation tier** named in the P3 design (profile-scoped keys in `nudges.tsx`, `use-notifications.ts`, `use-list-meetings.ts`, `me.tsx`, `use-hub-files.ts`, `use-contacts.ts`, `use-lists.ts`'s own mutations, `use-conversations.ts`) — **outstanding**, not retrofitted. The design's own reasoning is that this tier doesn't block safety (profile-scoped keys already differ after a switch), so it was correctly deprioritized under time constraints, not silently dropped.
- **`patchThingInCaches`'s cross-profile `["court"]` prefix scan** (named in P3 design revision 1) and **`AppContextProvider.tsx`'s non-profile-scoped live `localStorage` context key** and **`chat-read-state.ts`'s unscoped `localStorage` read-state** — all three **deferred**, named with file:line evidence in the design docs, not fixed in this pass.

### Real-browser verification actually performed (not claimed beyond what was run)

Using Playwright (already an installed devDependency; no config exists, none added) against a throwaway dev-server instance on a port distinct from any already-running session, with `VITE_KATALIST_DEMO_MODE` overridden for that one instance only (never touching `.env.local`):

- App boots cleanly at the sign-in screen: HTTP 200, no uncaught page errors.
- Demo persona flow (clicking "Priya Sharma"): successfully signs in and navigates to the Court page, rendering real demo data (Catch Up moments, Now/Next/Later lanes) — confirms `IdentityBoundary`'s pending→aligning→ready transition works correctly end-to-end in a real browser for the preview/demo path, not just jsdom.
- Console showed expected, unrelated noise: `navigator.vibrate` blocked (browser autoplay-style policy, pre-existing, unrelated to this work) and failed real-Supabase-connection attempts (401s, a WebSocket `ERR_CONNECTION_RESET` to the project's realtime endpoint) — expected and correct, since this environment has no live, reachable Supabase credentials. No JS crash resulted from any of these failures.
- **Not performed**: a live account switch (needs two real authenticated sessions), reconnect against a real Supabase realtime connection (the one connection attempt made, failed outright — never reached a connected state to reconnect from), or any RLS-dependent behavior.

This was a manual, one-off verification pass, not a committed test suite — no Playwright config or test files were added to the repository.

## Final commit list (P3 onward, this implementation pass)

`ae2bf3a` `60255d7` `8d47911` `f93930c` `c8c6604` `bad8810` `513283b` `ef2926c` `16316af` `3979311` `0a3bdf7` `968734f` — 12 commits, all on `katalist-plan/batch-a-baseline`, none pushed. Full test suite grew from 258 (start of this pass) to 328, typecheck/lint (0 errors, 80 warnings — unchanged baseline)/build clean at every commit boundary.
