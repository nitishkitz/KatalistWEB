# P3 — Identity and Cache Lifecycle Design

Date: 2026-09-23
Baseline: `cd8932a` on `katalist-plan/batch-a-baseline`
Status: **Design proposal only. No implementation in this document.** Per the plan's review gate, this must be approved before P4 (actor cache) or P7 (realtime ownership relocation) starts. P4/P7 remain gated regardless of this doc's approval status until separately signed off.

Every claim below is grounded in the current source (`f9754233ec271f58494e67d019cc58f4df0f815d` through `cd8932a`) and the P0 inventory (`2026-09-23-realtime-ownership-inventory.md`). Where I found a concrete, already-existing gap while researching this design (not a hypothetical), it's called out explicitly as a **finding**, separate from the **proposal** text, because those findings are evidence for the design, not the design itself.

---

## 1. Identity

### Definition

```ts
type Identity =
  | { kind: "live"; profileId: string }
  | { kind: "preview"; profileId: string } // demo persona, e.g. "demo-priya"
  | { kind: "none" }; // no session yet, or signed out
```

`profileId` is `session.user.id` (`useSession()`, `src/hooks/useSession.ts:201`). `kind` comes from `isPreviewSession(session)` (`src/lib/session-mode.ts:9-12`), which is already the single existing source of truth for live-vs-demo — this design reuses it rather than inventing a second classification.

**Context (work/home) is explicitly not part of identity.** It's a per-profile *setting* (`AppContextProvider.tsx:31-61` reads/writes `profiles.active_context`), already threaded through the query-key factories that need it (`keys.court/lists/buckets/nudges/nudgeHistory/catchup/accessibleThings`, all `(profileId, context) => [...]` — `src/domain/query-keys.ts:2-19`). Switching context must not bump the identity epoch (defined in §3) or dispose any identity-scoped owner — it only needs to select a different context-scoped query, which the existing factories already do correctly.

### Distinguishing the three cases the plan asks for

| Transition | `onAuthStateChange` event (per Supabase) | `profileId` before/after | Identity changed? |
|---|---|---|---|
| Token refresh, same user | `TOKEN_REFRESHED` | same | **No.** `useSession()` (`useSession.ts:168-177`) calls `setSession(next)` unconditionally for every event type — it does not currently distinguish `TOKEN_REFRESHED` from `SIGNED_IN`, but `next.user.id` is unchanged, so a `profileId`-keyed identity comparison naturally treats this as a no-op without needing `useSession()` itself to filter event types. |
| Account switch (A signs out, B signs in, or a demo-persona swap via `signInAsDemo`) | `SIGNED_OUT` then `SIGNED_IN`, or the custom `katalist_auth_state_change` event (`useSession.ts:66,125,185`) for demo | different | **Yes.** |
| Work ⇄ home context switch | none (no Supabase auth event at all — `AppContextProvider.tsx`'s `setContext` only writes `profiles.active_context` and local state) | same | **No** (identity unaffected; only the context-scoped query selection changes). |
| Logout | `SIGNED_OUT` | `profileId` → none | **Yes** (transitions to `{ kind: "none" }`). |
| Live ⇄ preview (demo) toggle | custom event / `SIGNED_OUT`+`SIGNED_IN` combination, since demo sessions bypass real Supabase auth entirely (`getStoredDemoSession()` checked first in `refreshSession`, `useSession.ts:151-156`) | `kind` changes even if a `profileId` string collides (unlikely — demo ids are `demo-${persona.key}`, `useSession.ts:74`) | **Yes** — comparison must be on the full `Identity` value (kind + profileId), not `profileId` alone. |

**Proposal**: identity equality is `identity.kind === next.kind && identity.profileId === next.profileId` (with `"none"` having no `profileId` to compare). This is computed from `useSession()`'s existing `session`/`isPreviewSession()` output — no new auth listener, no centralized auth provider. This directly satisfies the plan's constraint that `useSession()` is not assumed to be a centralized provider and that any centralization must be justified by a demonstrated lifecycle problem — the demonstrated problem here is narrow (need one place to notice identity changed) and is solved by one new hook, not by rearchitecting `useSession()`.

---

## 2. Query keys

### Current state (from the P0 inventory, restated here only where it matters for this decision)

- 12 of 16 `keys.xxx()` factories already embed `profileId` (11 with `context` too, 4 profile-only) — these are already correctly identity-scoped.
- Entity-only keys exist in two flavors: factory-backed (`keys.thing`, `keys.list`, `keys.bucket`, `keys.bucketItems`, `keys.listMeetings`) and ad-hoc raw arrays with no factory at all (`["list-things", listId]`, `["list-messages", listId]`, `["thing-comments", thingId]`, `["thing-activity", thingId]`, `["hub-files", listId, parentId]`, and others — full list in the inventory doc).
- 18+ raw-array key prefixes have no factory, and at least 2 confirmed cases (`["list", listId]` in `use-lists.ts:105`, `["profile", ...]` in `use-profile.ts:24`) where a factory exists with the identical shape but the call site doesn't use it — factory and call site have already drifted apart once.

### Finding: entity-only keys are not a hypothetical risk — one is already broken

`use-lists.ts`'s `useList` seeds its detail query from:

```ts
initialData: (): ListRow | null | undefined => {
  const entries = qc.getQueriesData<ListRow[]>({ queryKey: ["lists"] });   // use-lists.ts:110
  for (const [, data] of entries) {
    const found = data?.find((l) => l.id === listId);
    ...
```

`{ queryKey: ["lists"] }` is a **prefix match** in TanStack Query — it matches every cached entry whose key starts with `"lists"`, i.e. every `keys.lists(profileId, context)` entry for **every profile** currently or previously cached in this `QueryClient`. If profile A's Lists were fetched earlier in this browser session (even after A signed out, if nothing evicted the cache), and profile B later opens a List detail page for a List B can also see (List sharing across members is a real product feature — List X isn't exclusive to one profile), B's detail view can seed from A's cached row instead of B's own. This is precisely the scenario the plan names as a required test ("List initial-data seeding cannot scan another profile's cache") — except it's not a test gap, it's a live bug in the current code. **This must be fixed as part of P3's implementation, not just tested.**

### Proposal: keep the two-tier structure, but close the two real gaps

I'm recommending **against** migrating every entity-only key to embed `profileId` (e.g. rewriting `["thing", id]` → `["thing", profileId, id]` everywhere). Reasons:

1. **Blast radius vs. benefit.** This touches `use-thing.ts`, `use-lists.ts`/`fetch-list-detail.ts`, `use-buckets.ts`/`fetch-bucket-items.ts`, `use-list-meetings.ts`, `use-list-things.ts`, `use-list-messages.ts`, `use-thing-comments.ts`, `use-hub-files.ts`, `query-updates.ts`'s `["thing", thingId]`/`["court"]` cache-location math, every `invalidateQueries`/`cancelQueries` call site targeting these keys (dozens, per the P0 inventory), and every test that asserts on these key shapes. That is exactly the "combine query-key migration ... in one commit" the plan explicitly forbids, and doing it piecemeal across many commits leaves the app in an inconsistent, partially-migrated state for the whole span.
2. **These are structurally shared entities, not private-to-one-profile data.** A Thing, List, or Bucket with a given ID is the same row regardless of which member is viewing it — RLS decides *whether* a profile can read it, not what the row *is*. Embedding `profileId` in the key would fragment one shared cache entry into N per-viewer copies of the same data, which is a regression (more requests, more cache entries, no correctness benefit — RLS already prevents A's request from ever returning B's inaccessible data in the first place).
3. **The actual hazard is temporal, not a mislabeling hazard**, and the plan's own text agrees: "RLS remains authoritative on the server, but RLS alone does not isolate already-cached client data." The risk is a *stale, already-cached, or late-arriving* value being shown after the viewer changes — not the server returning the wrong profile's data for a given ID.

**Instead:**

- **Leave the entity-only key shapes as they are** (`["thing", id]`, `["list", id]`, `["bucket", id]`, `["bucket-items", id]`, `["list-meetings", id]`, and the ad-hoc ones), since the entities they name are legitimately shared.
- **Close the two real gaps that make this unsafe today**, both narrow and independently reviewable:
  1. Fix `use-lists.ts:110`'s `initialData` scan to use `keys.lists(profileId, context)` as an exact prefix (`["lists", profileId]`, letting `context` vary), not the bare `["lists"]` global prefix. Same audit needed for any other `getQueriesData`/`findAll` call using a bare top-level prefix — the P0 inventory's `query-updates.ts:211` (`qc.getQueryCache().findAll({ queryKey: ["court"] })`) is the other one, and it's discussed in §5 below because it's a Batch B compatibility concern, not a query-key-shape concern.
  2. On an **identity change** (not context, not token refresh — see §1's table), evict every protected cache entry rather than trying to enumerate and prefix-match every one of the 18+ raw key families by hand. §4 covers this as part of the epoch mechanism, not as a query-key-shape change.
- **New keys going forward** should use a factory in `query-keys.ts`, and any raw-array key that duplicates a shape a factory already provides (the two drifted cases found) should be migrated to the factory **as an isolated, single-purpose commit** — low risk, easy to review, not bundled with anything else.

### Migration inventory (for the commit sequence in §7, not for this doc to execute)

| Surface | Current key | Action |
|---|---|---|
| `use-lists.ts` `useList` initial-data seed | scans bare `["lists"]` | **Fix now (P3 implementation)**: scope to `["lists", profileId]` |
| `use-profile.ts:24` | ad-hoc `["profile", user?.id ?? "none"]` | Migrate to existing unused `keys.profile(profileId)` — isolated commit |
| `use-lists.ts:105` (`useList`'s own key) | ad-hoc `["list", listId]` | Migrate to existing `keys.list(listId)` — isolated commit (no shape change, just using the factory) |
| `use-notifications.ts:45` | ad-hoc `["notifications-unread", user?.id]` parallel to `keys.notifications` | Decide whether this is truly a separate cache entry (unread count vs. full list) or should collapse — separate review, not P3 |
| Every other ad-hoc entity-only key (`list-things`, `list-messages`, `thing-comments`, `thing-activity`, `hub-files`, `hub-conversations`, `hub-conversation`, `hub-contacts`/`-requests`/`-invitations`, `doorman`, `upcoming-meetings`, `profile-directory`, `assignable-people`, `team-members`) | ad-hoc, no factory | Add factories opportunistically when each file is next touched for another reason; not a dedicated migration — the epoch-based eviction in §4 doesn't require them to have factories, only to be reachable by `qc.clear()` |
| `personal-shred.ts`, `personal-snooze.ts` | `keys.shredded(profileId)`, `keys.snoozed(profileId)` | Already correct, no change |
| Cancellation/optimistic-write targets in `query-updates.ts` | bare `["court"]`, `["thing", id]` | Covered in §5 (Batch B compatibility), not a key-shape change |

---

## 3. Epoch lifecycle

### Mechanism

```ts
// Proposed: src/features/realtime/identity-cache-policy.ts
type IdentityEpoch = { epoch: number; identity: Identity };

const epochByClient = new WeakMap<QueryClient, IdentityEpoch>();
```

This follows the exact pattern already proven in this codebase for per-`QueryClient` state that must never leak across independent clients (tests, potential SSR): `query-updates.ts`'s `chainsByClient` and `inFlightThingIds` (`query-updates.ts:55,93`) are both `WeakMap<QueryClient, ...>` for the same reason. No new pattern is introduced — this reuses the one that's already reviewed and in production.

- `getIdentityEpoch(qc)` — current `{ epoch, identity }`.
- `advanceIdentityEpoch(qc, nextIdentity)` — called exactly once, from one place (see §4), whenever computed identity changes. Increments `epoch`, stores `nextIdentity`.
- `isEpochCurrent(qc, capturedEpoch)` — the guard every consumer calls before applying a side effect.

### Who captures and checks an epoch

| Consumer | Capture point | Check point | Action if stale |
|---|---|---|---|
| Entity-only-keyed `queryFn`s (`fetchListDetail`, `fetchThing`-equivalent, `fetchBucketItems`, etc.) | At `queryFn` invocation start | Immediately before returning | Throw a distinguishable `StaleIdentityError` instead of returning data — TanStack treats it as a query error for a query nothing observes anymore (the new identity's UI isn't reading that query instance), so it's inert, not user-facing |
| `withOptimisticPatch` / `patchThingInCaches` (`query-updates.ts`) | At `withOptimisticPatch()` call start | Inside the returned rollback closure, and before the `finally` cache write on success | If stale: skip the cache write entirely (success or rollback) — the mutation's own RPC still ran (can't be cancelled after the fact), but its cache-side effects must not touch the new identity's view. This is a compatibility-preserving addition to Batch B's existing machinery, not a rewrite of it — see §5 |
| Future P4 actor-cache | At fetch start | Before caching the result | Discard the result instead of caching it under the new identity |
| Future P7 realtime controller | At channel creation and at every event callback | Every event callback | Owner disposal itself is epoch-driven (see §4), so a correctly-disposed owner's callbacks simply can't fire after retirement — the epoch check here is defense in depth for any callback already queued in the microtask/event loop at disposal time |
| Timers (any `setTimeout`/`setInterval` a future phase introduces, e.g. the batcher's debounce in P6) | At schedule time | At fire time | No-op if stale |
| Reconnect callbacks (P9) | At subscribe-status-change time | At the point the reconnect logic would trigger a refresh | No-op if stale |

### What "stale" causes to happen (and not happen)

- A stale entity-only-keyed query throwing is safe because nothing in the new identity's render tree is `useQuery`-subscribed to that exact query instance anymore (its `queryKey` didn't change, but its *observer* — the component that called `useQuery` under the old identity — either unmounted or the whole subtree remounted; the query object itself becoming an error is invisible to anyone since no one's watching).
- A stale optimistic patch not writing to cache is safe because the alternative — writing anyway — is the actual bug being prevented ("Pending A mutation settles after B activates: no writes to B's cache" is a named required test in the plan, and `patchThingInCaches`'s existing design of patching "every Court query... any profile/context key" — its own words, `query-updates.ts:191-196` — means an unguarded stale patch could touch a *different profile's* live Court cache entry for a shared Thing, not just a stale copy of the same profile's own data).

---

## 4. Transition ordering

### Where identity-change handling lives

One new hook, colocated with (not replacing) `AppContextProvider`, e.g. `useIdentityLifecycle()` called once near the root (inside `QueryClientProvider`, likely as a sibling to or wrapping `AppContextProvider` in `__root.tsx:135-150`, exact nesting decided at P7 implementation time once the realtime controller's actual dependency on this hook is known). It:

1. Computes `Identity` from `useSession()` on every render.
2. In a `useEffect` keyed on the *computed identity value* (not `session` object reference — a `TOKEN_REFRESHED` event produces a new `Session` object with the same `user.id`, and identity equality per §1 correctly treats that as unchanged, so the effect does not re-run and does not touch the epoch):
   - If the identity actually changed since the last render: run the disposal sequence below, synchronously, before returning from the effect.

### Disposal sequence (runs on every real identity change, in order)

1. **Dispose old owners first.** Call disposal hooks for whatever identity-scoped owners exist at that point in the rollout (initially: none beyond this hook itself; after P4: the actor-cache subscription; after P7: the realtime controller). Each disposal is synchronous and idempotent.
2. **Advance the epoch** (`advanceIdentityEpoch`) — this is what makes any already-in-flight callback from the old identity self-reject per §3, including ones that started *before* step 1's disposal calls even ran (e.g. a promise that was already resolved and queued on the microtask queue).
3. **Evict protected cache.** Call `qc.clear()` — not a selective `removeQueries` with a hand-maintained key-family list. Rationale: the P0 inventory found 18+ raw key families with no factory and at least 2 already-drifted duplicates between a factory and its call site; a hand-maintained eviction list is exactly the kind of thing that silently misses an entry the same way the factories already have. `qc.clear()` is total, simple, and cannot miss a key nobody remembered to list. The cost is that public/non-identity data (`profile-directory`, `assignable-people`, `team-members`) also gets evicted and must refetch — cheap, and correctness-safe by construction beats an enumeration that's already proven fallible in this codebase.
4. **Only then** does the new identity's queries become eligible to run. Because step 3 happens in the same effect, synchronously, before the effect returns, React's render for the *new* identity's `enabled: Boolean(user) && !preview` queries (which re-evaluate on the next render pass, after this effect has committed) never observes the pre-eviction cache — by the time anything re-renders and re-subscribes, the cache is already empty and the epoch has already advanced.

### Handling late completions explicitly

- A **request** that started under identity A, still in flight when the effect above runs: its `queryFn` (for entity-only-keyed queries) checks its captured epoch before returning (per §3) — even though `qc.clear()` in step 3 has already dropped any result it might have cached, the epoch check is what stops it from writing a *new* cache entry after the clear, which `qc.clear()` alone cannot prevent (clear only affects what's in the cache *now*, not future writes from stragglers).
- A **mutation** that started under identity A, settling after B is active: `withOptimisticPatch`'s epoch-guarded rollback/success paths (§3) skip their cache writes. The mutation's server-side effect (the RPC) already happened and cannot be undone by this design — that's a server-side concern (idempotency, RLS), not a client-cache concern, and out of scope here.
- A **realtime event or timer** queued before disposal: covered by the owner's own disposal (step 1) plus the epoch check as defense-in-depth (§3's table).

---

## 5. Compatibility

### Batch B rollback/claims (`query-updates.ts`)

No change to the chain/rollback algorithm itself (`pushChainEntry`, `spliceChainEntry`, the deep-equal "did something else touch this" check) — that machinery is unrelated to identity and stays exactly as reviewed. The only addition is the epoch guard described in §3/§4, wrapping `withOptimisticPatch`'s entry and the rollback closure's cache-write points. `claimThingMutation`/`releaseThingMutation`'s cross-surface dedup is also untouched — it's already `WeakMap<QueryClient, ...>`-scoped and has no identity dimension of its own to worry about (a claim naturally can't outlive the identity change if the mutation itself gets epoch-guarded).

**Finding worth flagging, not fixing in P3**: `patchThingInCaches` patches "every Court query... any profile/context key" (`query-updates.ts:191-196`, `qc.getQueryCache().findAll({ queryKey: ["court"] })` — a bare prefix, matching every profile's Court cache the same way `use-lists.ts:110` does). Today, in practice, this is likely harmless because `qc.clear()` on identity change (once implemented) means only one identity's Court cache exists at a time in the common case. But it's the same *class* of prefix-match-across-profiles pattern as the `use-lists.ts` bug, and if a future change ever keeps two identities' data alive in one `QueryClient` simultaneously (e.g. a multi-account feature), this becomes exploitable the same way. Recommend a follow-up, scoped commit to change this to `findAll({ queryKey: ["court", identity.profileId] })` once `useIdentityLifecycle()` exists and can supply the current profile id — not blocking this design's approval, since today's single-identity-per-client invariant (enforced by `qc.clear()` in step 3 of §4) makes it safe in the meantime.

### Chat (`use-list-messages.ts`)

No change proposed here in P3. `["list-messages", listId]` stays entity-only (a List's messages are shared among members, same reasoning as §2). The per-list `list-chat:${listId}` broadcast channel (`use-list-messages.ts:117-122`) is a component-instance-owned channel (created/torn down with the hook's own mount lifecycle, not a global owner), so it isn't in scope for P3's identity-epoch work at all — it's already scoped to whatever's currently mounted, and unmounts naturally on navigation away, independent of identity. P8 (chat/hub integration) is where this gets reconsidered, per the plan's own sequencing.

**Adjacent finding, out of scope for P3 but worth recording**: `chat-read-state.ts:19,30` stores "last read at" timestamps in `localStorage` keyed only by `listId` (`${READ_STORAGE_PREFIX}${listId}`), with no profile scoping at all. On a shared device where profile A signs out and profile B (a different member of the same List) signs in, B would inherit A's last-read timestamp for any List they both belong to, potentially suppressing B's unread indicator for messages B hasn't actually read. This is `localStorage`, not the `QueryClient` cache, so `qc.clear()` in §4 does not touch it — it needs its own fix (profile-scoped storage key) and its own test, scoped to P8 (hub/chat) rather than bundled into P3.

### Calls and presence

**No change.** `call-room.ts`'s per-call channel and `call-lobby.ts`'s ring mechanism have zero `queryClient` interaction (confirmed in the P0 inventory) — nothing about the identity/cache lifecycle touches them. `presence.ts`'s ref-counted singleton channel is likewise entirely outside `QueryClient` and is explicitly the *precedent* this design's owner-disposal pattern (P4/P7) should follow for its own lifecycle shape — but presence itself needs no code change for P3. Its one known caveat (documented in the P0 inventory: `selfId` isn't re-keyed if a second, different identity calls `ensureChannel` while the channel is already open) is a real gap, but presence's `refCount`-based lifecycle is orthogonal to `QueryClient` identity — if it needs fixing, that's a presence-specific fix, not something this design's epoch mechanism can or should reach into.

### Drafts

**Finding**: grepping the tree for persisted draft/compose state found no `QueryClient`-cached or `localStorage`-persisted draft mechanism at all — `ListCallPanel.tsx:164`'s `draft` is local `useState` for an in-call chat compose box, cleared on send (`ListCallPanel.tsx:722-725`) and naturally reset on component unmount. There is currently nothing that needs identity-scoping under "drafts" because nothing persists a draft across an identity change today. If a future feature adds persisted drafts (e.g. a List-message compose box that survives navigation), it should key any such storage by `(profileId, listId)`, following the same principle as everything else in this design — but there's no existing behavior to preserve or migrate here.

---

## 6. Tests

All of these are deterministic (fake `QueryClient` + fake identity transitions + fake scheduling where relevant) and run in the existing plain-Node test runner — no browser needed for any of them. Browser/staging checks are listed separately and explicitly marked **pending** per the plan's own instruction not to claim unverified checks as done.

### Deterministic (to be written at P3 implementation time, not in this doc)

1. **Live A → live B**: after `advanceIdentityEpoch`, `qc.getQueryCache().getAll()` is empty; a query enabled for B does not observe any of A's previously-cached entries.
2. **Live A → logout**: same eviction; identity becomes `{ kind: "none" }`; no query is `enabled`.
3. **Preview → live, live → preview**: identity `kind` change alone (with or without a `profileId` collision) triggers the same disposal sequence.
4. **Same-user token refresh**: constructing two `Session` objects with the same `user.id` but different tokens and feeding both through the identity computation does *not* advance the epoch and does not evict the cache (regression guard against `useSession()`'s `setSession(next)` being mistaken for an identity change).
5. **Context switch preserves identity**: switching `work` ⇄ `home` does not advance the epoch and does not evict the cache; only context-scoped keys' active query changes.
6. **Pending A request resolves after B activates**: a fake entity-only `queryFn` that captures its epoch, `advanceIdentityEpoch` fires mid-flight, then the `queryFn` resolves — assert it throws `StaleIdentityError` and never calls `qc.setQueryData`.
7. **Pending A mutation settles after B activates**: a fake `withOptimisticPatch` call, epoch advances mid-flight, mutation resolves (success and failure both) — assert no `setQueryData` call occurs on either path.
8. **Old-epoch timer/channel callback runs after cleanup**: schedule a fake callback capturing the epoch, advance the epoch, fire the callback — assert it no-ops.
9. **List initial-data seeding cannot scan another profile's cache**: seed the `QueryClient` with `keys.lists("profile-A", "work")` data, then run `useList`-equivalent initial-data lookup for `profileId: "profile-B"` — assert it does not return A's row. (This test should fail against the *current* code, proving the `use-lists.ts:110` finding in §2 is real, the same "verify it fails against pre-fix source" discipline used for every fix so far this batch.)

### Browser/staging — explicitly pending, not run

- Actual account switch in a real browser tab: confirm no visual flash of the old account's data.
- Actual token refresh in a real session: confirm no observable re-fetch storm or flicker.
- Actual work/home switch: confirm no cross-context data appears, and confirm whether the existing `qc.invalidateQueries()` in `AppContextProvider.tsx:79` (full, keyless — see the P0 inventory) can be safely narrowed once the context-scoped keys are confirmed sufficient on their own, or whether it's still covering something the key scoping doesn't. **This needs a browser session to observe actual behavior before touching that line — not something to decide from static reading alone.**
- Two browser tabs, two different accounts, same device: confirm `localStorage`-based state (session mode, demo persona, the `chat-read-state.ts` finding in §5) doesn't cross-contaminate — this is explicitly a `localStorage` question, not a `QueryClient` question, and needs real multi-tab observation.

---

## 7. Tradeoffs, alternatives, and migration sequence

### Recommended approach (summarized)

- Identity = `(kind, profileId)`, computed from existing `useSession()`/`isPreviewSession()` — no new auth listener.
- Keep entity-only keys as-is; don't do a mechanical profile-namespacing migration.
- Fix the one already-broken prefix-scan (`use-lists.ts:110`) as a narrow, isolated change.
- Add one `WeakMap<QueryClient, IdentityEpoch>` (same pattern as `query-updates.ts`'s existing two WeakMaps) plus one root-level effect that disposes owners, advances the epoch, and calls `qc.clear()` — in that order — on real identity changes only.
- Epoch-guard entity-only `queryFn`s and `withOptimisticPatch`'s cache-write points.
- Defer the `patchThingInCaches` cross-profile-prefix finding and the `chat-read-state.ts` `localStorage` finding to later, explicitly-scoped commits — name them now, fix them later, don't bundle them into P3.

### Alternatives considered and rejected

1. **Global profile-namespaced key migration** (rewrite every entity-only key to embed `profileId`). Rejected: large blast radius, violates the plan's own "don't combine query-key migration ... in one commit," and actively wrong for genuinely shared entities (§2, reason 2).
2. **Selective `removeQueries` by hand-maintained key-family list instead of `qc.clear()`**. Rejected: the P0 inventory already found 18+ ungoverned raw key families and 2 confirmed drift cases — a hand-maintained list is provably the kind of thing this codebase's own history shows gets missed. `qc.clear()` is simple and can't miss an entry, at the cost of evicting a small amount of non-identity-scoped public data that just refetches.
3. **A parallel, non-`QueryClient` identity-scoped cache** (e.g. a second `Map` keyed by `profileId`). Rejected outright per the plan's explicit instruction and because there is no evidence it's needed — every problem found (the `use-lists.ts` scan, the `patchThingInCaches` prefix, late completions) is solvable with the existing single `QueryClient` plus an epoch guard.
4. **Centralizing `useSession()`'s auth listener into a single provider** to make identity computation "cleaner." Rejected for P3: no lifecycle problem *requires* it (identity computation only needs to *read* `useSession()`'s output once, in one new hook, not change how `useSession()` itself works), and the plan explicitly says centralization needs its own justified review, not a ride-along in this one.

### Migration sequence (small, independently reviewable commits, per the plan's §15)

This design doc is itself commit 4 in the plan's numbering (P0 was commit 1, P1 was commit 2, P2 was commit 3 — already committed as `360c7c0`, `d13582b`, `cd8932a`). If approved, P3's *implementation* (still gated separately per the plan) would be:

1. Fix `use-lists.ts:110`'s bare `["lists"]` scan → `["lists", profileId]`, with the regression test in §6 item 9. Small, isolated, no epoch mechanism needed yet — a correctness fix that stands on its own.
2. Add `identity-cache-policy.ts` (the `WeakMap`, `advanceIdentityEpoch`, `isEpochCurrent`) with its own unit tests (§6 items 4-8), no wiring into the app yet — pure, testable, reviewable in isolation.
3. Add the root-level `useIdentityLifecycle()` hook and wire it in (disposal-order + `qc.clear()`), with the account-switch/logout/preview-toggle/context-switch tests (§6 items 1-3, 5). This is the first commit that actually changes runtime behavior.
4. Epoch-guard `withOptimisticPatch`/`patchThingInCaches`'s cache-write points, with the mutation-settles-late test (§6 item 7). Batch B's own rollback algorithm is untouched — this is additive.
5. (Separate, later, explicitly not part of this sequence) The `patchThingInCaches` cross-profile-prefix finding and the `chat-read-state.ts` finding, each as their own scoped fix when their respective phases (a hardening pass, and P8) come up.

Only after step 3 lands and is reviewed does P4 (actor cache, which needs `isEpochCurrent` to exist) or P7 (realtime ownership relocation, which needs the same) become unblocked — both remain separately gated per the original plan regardless of this document's approval.
