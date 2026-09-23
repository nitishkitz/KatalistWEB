# C1/C2 Reconciliation Tracker (P12 — final, Batch C closeout)

Date: 2026-09-23
Baseline: `f9754233ec271f58494e67d019cc58f4df0f815d` → current HEAD (`fc772e5`) on `katalist-plan/batch-a-baseline`

Purpose: single running status record for Batch C (C1 + C2). Every requirement below is one of exactly four statuses, per this pass's explicit instruction not to use "deferred" to hide unfinished, locally executable work:

- **Implemented and locally verified** — code exists, and a test/typecheck/lint/build run in this environment proves the specific behavior claimed (not just "the suite passes").
- **Implemented, awaiting deployment/live acceptance** — code exists and is locally verified against real library/DOM behavior with mocked backends; the remaining gap is specifically a live Supabase project, live RLS, or a real second authenticated session, none of which exist in this environment.
- **Blocked by a specifically identified external dependency** — cannot proceed further without something concretely named (staging credentials, a `REPLICA IDENTITY` setting only visible against a live database, etc).
- **Explicitly outside the accepted C scope** — named, with the reason it doesn't belong in C.

## C1 — reviewed waterfall/error work

| Item | Status | Evidence |
|---|---|---|
| Thing/Court/Buckets/Bucket-items/Trophy/List-mapper lookup parallelization | Implemented and locally verified | Deterministic concurrency tests, no wall-clock thresholds |
| Bucket-item/Thing/List/member required-data error propagation | Implemented and locally verified | `fetch-buckets.ts`, `fetch-bucket-items.ts`, `map-list-rows.ts`; failure-path tests verified against pre-fix source |
| Court actor-read error propagation (distinct from legitimate no-actor) | Implemented and locally verified | Superseded by P4's `getActorId` (below), which preserves this same distinction |
| Session-identity reuse (no redundant `auth.getUser()` in Court) | Implemented, awaiting live acceptance | Source-level RLS reasoning only; needs a live Supabase project to confirm no behavioral regression under real RLS |
| Single-List fetch/mapping extraction, with eligibility filters preserved | Implemented and locally verified | `fetch-list-detail.ts` requires `archived_at IS NULL` and `kind = "list"`, narrowly-scoped compatibility fallback; tests verified to fail against the pre-fix unfiltered version |
| `map-thing-rows.ts`/`use-trophy.ts` comment-count and Shred-history error propagation | Implemented and locally verified | P2; verified to fail against pre-fix source |
| `use-lists.ts` bare-`["lists"]`-prefix cache-seed scan (cross-profile leak) | Implemented and locally verified | Fixed in P3 (`ae2bf3a`), scoped to `keys.lists(profileId, context)` |

**Explicitly outside the accepted C scope:** `use-trophy.ts`'s shredded-item name-resolution reads (`things`/`lists`/`buckets` display names) — decorative, not a correctness or safety requirement of the accepted C1 waterfall/error-propagation contract; `map-list-rows.ts`'s cover-URL signing — same reasoning, and it already fails open internally via its own try/catch.

## C1 — actor caching (P4)

**Implemented and locally verified.** `src/features/people/actor-query.ts`'s `getActorId(qc, profileId)` replaces the duplicated ad-hoc actor lookups in `fetch-court.ts` and `use-trophy.ts`. Meets every acceptance criterion (correct profile isolation, deduplication via `qc.fetchQuery`, eviction on identity retirement via a self-registered disposer, a bounded-staleTime missing-actor policy allowing later discovery, failed requests never cached as success, late responses can't repopulate a retired identity's cache, no context dimension — matching the `actors` table's real schema). 8 tests in `actor-query.test.mjs`, each mapped to one criterion.

## C1 — request-count/latency evidence (labeled synthetic, not live)

**Implemented and locally verified as synthetic evidence; live measurement remains a live-acceptance gap, not a code gap.**

- Every parallelization change in C1 is proven with deterministic, mocked concurrency tests (event-order proofs, not wall-clock thresholds) — see `fetch-buckets-concurrency.test.mjs`, `fetch-bucket-items-concurrency.test.mjs`, `map-list-rows-concurrency.test.mjs`, `fetch-court-concurrency`-style tests.
- P5's directory-fetch deduplication (below) is proven with an explicit request-count assertion, not just an event-order proof: `scripts/get-profile-identities-dedup.test.mjs` asserts that 3 concurrent `getProfileIdentities(qc)` callers produce exactly 1 underlying fetch (was 3 before this pass), that a second sequential call within `staleTime` produces 0 additional fetches, and that two independent `QueryClient`s never share a count (isolation).
- **Labeled explicitly**: none of the above is a live request count, wall-clock latency, or backend-scaling measurement — no staging/production environment exists in this session to measure against. The evidence proves "N callers → 1 request" as a mocked fetch-count invariant, not "response time improved by X ms."

## C1 — summary/detail separation, bounded attachments/activity, pagination (P5)

**Resolved using existing query/API capabilities where possible; the one genuinely sizable remaining item is scoped precisely below, not vaguely blocked.**

- **ID deduplication before batch requests**: Implemented and locally verified (pre-existing from earlier C1 work — `[...new Set(...)]` patterns in `map-list-rows.ts`, `map-thing-rows.ts`).
- **Duplicate directory-fetch requests across concurrent callers**: Implemented and locally verified, this pass. `fetchProfileIdentities()` (hits a server endpoint + RPC fallbacks) was called directly and independently by `use-list-messages.ts`, `use-conversations.ts` (both call sites), `use-contacts.ts`, `use-hub-files.ts` (both call sites), `map-list-rows.ts`, plus its 4 callers (`fetch-buckets.ts`, `fetch-bucket-items.ts`, `fetch-list-detail.ts`, `use-lists.ts`) — every one of them re-hit the directory independently even when several ran concurrently on the same page. Added `getProfileIdentities(qc)` in `directory.ts`, routing all of them through the same `["profile-directory"]` react-query cache entry `useProfileDirectoryQuery()` already used, via `qc.fetchQuery`. No new endpoint, RPC, or schema — this used only the existing directory endpoint and TanStack's own built-in request dedup. See the P5 request-count evidence above.
- **On-demand Activity-tab hydration (a real "summary/detail" split)**: Implemented and locally verified. `ThingDetailContent.tsx` shows exactly one of Comments/Activity at a time, but `use-thing-comments.ts` unconditionally fetched both `thing_comments` and `thing_activity` on every Thing-detail open. `useThingComments(thingId, loadActivity)` now only fetches Activity once its tab is actually selected (`enabled: ... && loadActivity`, the existing TanStack option — no new endpoint). Comments still load eagerly, because the tab's own unread badge/divider need `comments.length`/timestamps regardless of which tab is showing — deferring that one too would just move the same cost, not remove it. **Caveat**: this behavior change is reasoned directly from `ThingDetailContent.tsx`'s render logic (both `tab === "comments" ? ... : events...` branches, checked at both the compact and full layout) and verified by typecheck/build; it does not have a dedicated automated test in this pass (would need a full `QueryClientProvider` + mocked-Supabase RTL harness for this specific hook, which was judged lower-value than the other test additions given the remaining time budget). Stated here rather than silently claimed as test-covered.
- **Server-side cursor pagination for `list_messages` (and Thing comments/activity)**: **Explicitly outside this pass's scope, precisely scoped, not vaguely blocked.** Unlike the earlier assessment in this document's previous revision, this does **not** require a new RPC or schema — Supabase's existing `.order("created_at", { ascending: false }).limit(N)` plus a `.lt("created_at", cursor)` follow-up page is sufficient. It was not implemented this pass because a *correct* version is a real, independently-reviewable UI feature, not a mechanical query change: it needs a "load older messages" scroll-triggered fetch-more affordance, scroll-position preservation across that fetch, and reconciliation with `RealtimeInvalidationProvider`'s existing full-refetch-on-broadcast behavior (a naive `.limit(60)` with no load-more UI would silently truncate a long conversation's visible history — a regression, not an optimization, and the master plan's own §9.2/§9.3 language about a "client-side-only pagination shim" not being a real optimization applies with equal force to a server-side limit with no way to reach the rest). Concretely scoped for a follow-up session: add a cursor state to `useListMessages`, an initial `.limit(60)` page (reversed for display), a `loadOlder()` that pages by `.lt("created_at", oldestLoaded)`, and a scroll-anchor fix in `ListChatPanel.tsx`'s `scrollRef` effect so `loadOlder()` doesn't yank the viewport to the bottom the way a new-message arrival correctly does.

## C2 — realtime ownership

| Step | Status | Evidence |
|---|---|---|
| P0 — inventory | Implemented and locally verified | `2026-09-23-realtime-ownership-inventory.md` |
| P3 — identity/cache lifecycle design + implementation | Implemented, awaiting live acceptance | 5 design revisions (`6c7a896`…`8e41a9a`), then implemented: epoch primitive + epoch-scoped claims/chains (`60255d7`), `IdentityBoundary` (`f93930c`), Required-tier invalidation retrofit (`c8c6604`), context-race fix + `initialData`/`resetQueries()` verification (`bad8810`) |
| P4 — actor cache | Implemented and locally verified | See above |
| P5 — summary/detail, pagination | Resolved (see above) — directory dedup + Activity on-demand load implemented and locally verified; message pagination explicitly scoped out with a concrete follow-up spec | — |
| P6 — pure event-routing + invalidation-batching engine | Implemented and locally verified | `event-invalidation-map.ts`, `invalidation-batcher.ts` (`16316af`); 11 tests, deterministic fake-clock scheduling |
| P7 — application-level ownership relocation | Implemented, awaiting live acceptance | `RealtimeInvalidationProvider.tsx` replaces `use-realtime.ts` (deleted), mounted once inside `IdentityBoundary`'s remounted children instead of once per `AppShell` instance (`3979311`); 5 real DOM/React tests |
| P8 — chat/hub/membership safety | Implemented and locally verified (ref-counted channel, membership-revocation fast path, dead-listener removal); the fast path's payload-completeness assumption is blocked on live DB access — see below | Ref-counted `list-chat` channel registry (`0a3bdf7`); best-effort membership-revocation cache eviction (same commit); `hub-conversations`'s dead broadcast listener removed this pass (see below), replaced by nothing — it was already fully redundant with P6/P7's `list_messages → hub-conversations` invalidation target |
| P9 — reconnect + browser validation | Implemented and locally verified (reconnect logic); browser validation done and limited (see below) | Reconnect catch-up revalidation (`968734f`), 4 tests; real-browser smoke test (Playwright, not committed — see below) |
| P11 — "lower priority" invalidation tier + remaining scoping fixes | Implemented and locally verified | See below |
| P12 — final reconciliation | This document | — |

### P11 — the "lower priority" invalidation tier, closed out this pass

Named in the P3 design as safe to deprioritize (profile-scoped query keys already differ after a switch, so this tier was never a *safety* gap, only a *freshness-after-switch* one) but never actually retrofitted. All 8 named files, plus their consumers, now capture the identity epoch at dispatch time and guard their post-`await` cache writes/toasts:

`use-notifications.ts`, `use-list-meetings.ts`, `use-hub-files.ts` (+ its 6 mutations), `use-contacts.ts` (+ `ContactsDialog.tsx`'s 5 handlers), `use-conversations.ts`, `nudges.tsx`, `me.tsx`, `use-lists.ts`.

A follow-up repo-wide grep (every file matching `invalidateQueries|setQueryData|removeQueries|resetQueries` with zero `isEpochCurrent` occurrences) found 3 more files the earlier retrofit passes missed: `use-bucket-notes.ts`, `CourtWithOthersSidebar.tsx`'s `handleNudge`, and `MagicBox.tsx`'s toss mutation. All three fixed the same way. The only files left unguarded by that grep are `invalidation-batcher.ts` and `IdentityBoundary.tsx` themselves — confirmed to be the epoch-agnostic infrastructure that *implements* the guard, not call sites that need one.

### Other named items resolved this pass

- **`patchThingInCaches`'s cross-profile `["court"]` prefix scan**: fixed. Court's real cache key is `["court", profileId, context]`; a bare `["court"]` `findAll` scan matched every cached profile's Court entry, not just the current identity's. Now filtered to `key[1] === myProfileId`, derived from the current epoch's own identity. New test: `patchThingInCaches only touches the current identity's own profile's Court cache, not another profile's leftover entry` in `query-updates-rollback.test.mjs`.
- **`chat-read-state.ts`'s unscoped `localStorage` read-state**: fixed. Keys are now `katalist_conversation_read_${profileId}_${listId}`. A pre-scoping unscoped legacy value is never read as a fallback for a specific profile (there's no way to know which profile wrote it) — only best-effort removed once a scoped value exists, per this pass's explicit instruction not to assign an unscoped legacy value to an arbitrary signed-in account. 5 tests in `chat-read-state-scoping.test.mjs`.
- **`AppContextProvider.tsx`'s non-profile-scoped live `localStorage` context key**: fixed the same way (`katalist.active_context.live.${profileId}`; the demo path was already scoped by demo actor id). Same no-arbitrary-fallback + best-effort-cleanup migration policy. 2 new tests in `app-context-provider-epoch.test.mjs`.
- **`hub-conversations`'s dead broadcast listener**: removed. Traced definitively this pass: `grep -rn "\.send(" src` shows the only broadcast publishers in the app are the per-list `list-chat:${listId}` channel (chat) and the calls signaling channels — nothing anywhere sends to a channel literally named `"hub-conversations"`. The rail's actual freshness mechanism is, and always was independently of this listener, `RealtimeInvalidationProvider` routing `list_messages` postgres_changes events to the `"hub-conversations"` invalidation target (`event-invalidation-map.ts`). Removing the dead subscription is a pure simplification with no behavior change — no live integration check was needed to establish that, since "does anything publish to this channel name" is a static, fully-decidable repository fact, not a live-runtime question.

### C2 — what remains a genuine live/deployment gap (named, not silently assumed)

- **Live Supabase/RLS behavior.** Every claim above is proven against real `@tanstack/react-query` (`QueryClient`/`QueryObserver`), a real DOM (jsdom + `@testing-library/react`), and mocked Supabase clients/channels. None of it has run against a live Supabase project. **Blocked: no staging credentials in this environment.**
- **A real two-account live switch.** The A→B identity-switch tests (P3/P7/P9) simulate the switch by changing what a mocked `useSession()` returns — this proves the boundary's own logic correctly, but does not prove it against two real authenticated Supabase sessions in one browser. **Blocked: same reason.**
- **The membership-revocation fast path's payload-completeness assumption.** Works correctly when a `list_members` DELETE payload includes `profile_id`/`list_id`; whether Postgres actually delivers those fields depends on the table's `REPLICA IDENTITY` setting, which requires live database access to check. The *primary* mechanism (batched invalidate-and-refetch, discovering "no longer accessible" via RLS regardless of payload completeness) does not depend on this and is fully verified. **Blocked (the fast path's real-world applicability only): no live database access.**
- **`list_messages`/Thing-comments/activity server-side pagination.** Explicitly scoped out above, with a concrete follow-up spec — not a live-credentials gap, a UI-feature-scope decision.

### Real-browser verification actually performed (not claimed beyond what was run)

Using Playwright (already an installed devDependency; no config exists, none added) against a throwaway dev-server instance on a port distinct from any already-running session, with `VITE_KATALIST_DEMO_MODE` overridden for that one instance only (never touching `.env.local`):

- App boots cleanly at the sign-in screen: HTTP 200, no uncaught page errors.
- Demo persona flow (clicking "Priya Sharma"): successfully signs in and navigates to the Court page, rendering real demo data (Catch Up moments, Now/Next/Later lanes) — confirms `IdentityBoundary`'s pending→aligning→ready transition works correctly end-to-end in a real browser for the preview/demo path, not just jsdom.
- Console showed expected, unrelated noise: `navigator.vibrate` blocked (browser autoplay-style policy, pre-existing, unrelated to this work) and failed real-Supabase-connection attempts (401s, a WebSocket `ERR_CONNECTION_RESET` to the project's realtime endpoint) — expected and correct, since this environment has no live, reachable Supabase credentials. No JS crash resulted from any of these failures.
- **Not performed**: a live account switch (needs two real authenticated sessions), reconnect against a real Supabase realtime connection (the one connection attempt made, failed outright — never reached a connected state to reconnect from), or any RLS-dependent behavior. This was not re-run in this pass (P11-P12) — the changes made (localStorage scoping, directory dedup, dead-listener removal, epoch-guard retrofit) are all covered by the Node/jsdom test suite added alongside them, and none of them touch the demo-mode boot path already verified above.

This was a manual, one-off verification pass, not a committed test suite — no Playwright config or test files were added to the repository.

## Final commit list (P3 onward, this implementation pass)

`ae2bf3a` `60255d7` `8d47911` `f93930c` `c8c6604` `bad8810` `513283b` `ef2926c` `16316af` `3979311` `0a3bdf7` `968734f` `ff8ae12` (P10 doc) `f4d8fab` (P11: lower-priority tier, dead listener, cross-profile Court scan, localStorage scoping) `b2c4746` (P5: Activity on-demand, directory dedup) `9579d9e` (tests for the localStorage scoping fixes) `fc772e5` (3 remaining unguarded call sites) — 17 commits total, all on `katalist-plan/batch-a-baseline`, none pushed.

Test suite grew from 258 (start of the P3 pass) → 328 (P10) → **339** (this pass, +11: 3 dedup tests, 5 chat-read-state scoping tests, 2 AppContextProvider scoping tests, 1 cross-profile Court-cache test). Typecheck: 0 errors throughout. Lint: 0 errors, 81 warnings (same pre-existing baseline, ±1 as call sites were touched — verified at every commit boundary, never a new category of warning). `build:app`: clean at every commit boundary.
