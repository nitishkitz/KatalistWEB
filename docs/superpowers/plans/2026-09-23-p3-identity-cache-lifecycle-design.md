# P3 — Identity and Cache Lifecycle Design (Revision 2)

Date: 2026-09-23
Baseline: `cd8932a` on `katalist-plan/batch-a-baseline`
Status: **Design proposal only. No implementation in this document.** This revision responds to five specific correctness gaps identified in review of Revision 1 (committed at `6c7a896`), including one bug the reviewer reproduced against the current code. P4/P7 remain gated pending explicit approval, unchanged.

**What changed since Revision 1, and why**: every one of the five review points below turned out to be correct, and researching the fix for point 1 surfaced an empirical finding that changes the core mechanism (`qc.clear()` does not do what Revision 1 assumed — see §3). Nothing here is defended by re-asserting the old argument; where Revision 1 was wrong, that's stated plainly.

1. §4's root-`useEffect` disposal timing was unsound — corrected with a synchronous, render-time gate (no reliance on effect ordering).
2. §2's "not actively wrong, no correctness benefit" framing for viewer-dependent computed fields (role, "Owned by you", unread counts) was wrong — retracted; the actual argument for keeping entity-only keys now rests entirely on the isolation boundary being provably airtight, not on RLS.
3. The claim/chain `WeakMap`s in `query-updates.ts` are **not** touched by anything in Revision 1's epoch-guard proposal — reproduced and fixed below with epoch-scoped, token-based ownership.
4. The guard-point list was incomplete and contained an inaccurate claim about the code (`withOptimisticPatch` has no "finally cache write on success" — corrected).
5. `use-list-messages.ts`'s mounted-consumer gap is real and is **not** resolved by this revision's mechanism either — named explicitly as an open gap for P8, not silently assumed away.

---

## 1. Identity

Expanded to four variants — Revision 1 only had three, and collapsing "auth not yet resolved" into the same bucket as "confirmed logged out" was exactly backwards for deciding what to render:

```ts
type Identity =
  | { kind: "pending" }                        // useSession().loading === true
  | { kind: "none" }                            // resolved: no session
  | { kind: "live"; profileId: string }
  | { kind: "preview"; profileId: string };      // demo persona
```

`pending` maps directly to `useSession()`'s own `loading` flag (`src/hooks/useSession.ts:148`, `refreshSession`/`onAuthStateChange` both eventually call `setLoading(false)` once resolved). `none`/`live`/`preview` are computed exactly as in Revision 1, from `session` + `isPreviewSession(session)`.

| Transition | Identity change? |
|---|---|
| App boot, before first `getSession()`/demo check resolves | `pending` (not `none`) |
| Token refresh, same user | No — `profileId` unchanged, `useSession()` still calls `setSession(next)` for every event type without filtering, but comparison is on `profileId`, not the `Session` object |
| Account switch (A signs out, B signs in; demo persona swap) | Yes |
| Logout | Yes (→ `none`) |
| Live ⇄ preview toggle | Yes (`kind` differs even if a `profileId` string ever collided, which it won't in practice — demo ids are `demo-${persona.key}`) |
| Work ⇄ home context switch | No — context is a per-profile setting (`AppContextProvider.tsx:31-61`), not part of identity, unchanged from Revision 1 |

Identity equality: `kind` and (where applicable) `profileId` both match. `pending` never equals anything else, including another `pending` (it's a transient state, not a value to compare against for disposal purposes — see §4).

---

## 2. Query keys — correction to Revision 1's argument

**Retracted**: Revision 1 said profile-namespaced keys have "no correctness benefit given RLS." That's wrong, and the reviewer's examples prove it: `mapDbListRows()` computes `role` and `ownerLine` ("Owned by you") *relative to the calling profile* (`src/features/lists/map-list-rows.ts:154-163` — `mine = listMembers.find((m) => m.profile_id === profileId)`), and `map-thing-rows.ts`'s comment counts are computed with `myActorId` factored in (`calculateCommentCounts(tId, cList, myActorId)`, `map-thing-rows.ts:113-120` — unread status is viewer-relative). These are **not** "the same row, RLS just decides who can see it" — they are *different computed values for the same entity ID*, depending on who's asking. If two identities' data for the same entity ID were ever simultaneously live in one `QueryClient`, an entity-only key would let one identity's viewer-relative fields leak into the other's rendered view of "the same" cached object. RLS has nothing to say about this, because RLS governs what a *query* is allowed to return, not what a *client-side cache slot* is allowed to hold once two different queries have both written into it.

**Still recommending against a global key migration**, but the justification is now precise, not RLS-based: it's correct **only if** the app enforces, as an invariant, that at most one identity's protected queries are ever active/observed at a time in a given `QueryClient` — i.e., exactly the guarantee §4's transition gate exists to provide. This is the "proven isolation boundary" the reviewer asked for in place of the RLS argument: the boundary is "only one identity observes protected queries at a time," proven by the tests in §6 (specifically the mounted-consumer and race tests), not asserted from RLS semantics.

If that invariant ever needs to be relaxed (e.g. a future multi-account-tabs feature that keeps two identities' data live in one `QueryClient` simultaneously), entity-only keys for viewer-relative fields become actively wrong at that point, and the global migration Revision 1 rejected would become necessary. That's a real constraint on this design, not a hypothetical — recorded here so it isn't forgotten if that feature is ever proposed.

The narrow `use-lists.ts:110` fix and the migration-inventory table from Revision 1 are unchanged and still recommended as-is.

---

## 3. Epoch lifecycle

### Correction: `qc.clear()` does not do what Revision 1 assumed

I wrote and ran (against the actual installed `@tanstack/react-query@^5.101.0`, no mocking — `QueryObserver`/`QueryClient` are plain JS classes, importable and testable without React) four probes before writing this revision, specifically because the reviewer is right that "fake epoch-function tests alone cannot prove old content never renders." Results, all reproducible:

1. **`qc.clear()` does not update an already-subscribed `QueryObserver`.** A `QueryObserver` watching `["thing", "shared-thing-1"]` with cached `{ owner: "A" }` still reports `{ owner: "A" }` after `qc.clear()`, indefinitely, with no further fetch triggered. Revision 1's assumption that `useQuery`'s internal `useSyncExternalStore` usage would "automatically propagate the clear to live observers" was **false**.
2. **`qc.removeQueries()` has the identical problem** — same stale result, no refetch.
3. **`qc.resetQueries()` (no filter) is the mechanism that actually works.** The same already-mounted, already-subscribed observer correctly transitions to the fresh value (`{ owner: "B" }`) once the profile that would answer its `queryFn` has changed — no remount, no manual re-subscribe. An unrelated *inactive* (unobserved) cached query is evicted by the same call **without** triggering a wasted background refetch (confirmed: fetch count stayed `0` for an unobserved key across the reset).
4. **A slow fetch already in flight under the old identity, still pending when `resetQueries()` triggers a second fetch for the same key, does not clobber the newer result on late arrival.** TanStack Query's own internal fetch-generation tracking discards the superseded attempt. This is built-in behavior, not something this design has to build — it narrows where an explicit epoch guard is actually load-bearing (see below).

**Correction to the design**: replace every `qc.clear()` reference from Revision 1 with `qc.resetQueries()` (no filter — reset everything, matching finding 3's active/inactive behavior). This is the mechanism that makes §4's transition gate actually work, and it is why Revision 1's root-`useEffect` design was unsound for a second, independent reason beyond the timing problem the reviewer named: even if the effect *had* run at the right time, `clear()` inside it would still have left already-mounted consumers stale indefinitely.

### Where an explicit epoch guard is still required (narrowed, not eliminated, by finding 4)

| Consumer | Still needs an epoch guard? | Why |
|---|---|---|
| Plain entity-only-keyed reads (`fetchListDetail`, `fetchThing`-equivalent, `fetchBucketItems`, etc.), once `resetQueries()` is used at the boundary | **No**, for the specific "late completion from before the switch" race — TanStack's own fetch-generation tracking already handles it (finding 4). An epoch guard here would be redundant defense, not load-bearing. |
| Optimistic cache writes (`patchThingInCaches`'s `setQueryData` calls) | **Yes.** These are direct `setQueryData` calls made by our own code, entirely outside TanStack's fetch-generation machinery — nothing about `resetQueries()` or the built-in race protection touches a manual `setQueryData` call made after the fact. |
| Claim/chain `WeakMap`s in `query-updates.ts` | **Yes — and Revision 1 didn't actually guard these at all.** See below. |
| Caller-level `onSuccess`/`onError`/`invalidateQueries`/toast/navigation side effects | **Yes**, unaudited — see §5. |
| Future P4/P6/P7/P9 realtime/timer/reconnect callbacks | **Yes**, unchanged from Revision 1. |

### Correction: epoch-owned claims and chains (reviewer's reproduction)

The reviewer ran this against the current code and reported it here verbatim: `claimSurvivesClear: true`, `nextIdentityCanClaim: false`. That's because `inFlightThingIds` and `chainsByClient` (`query-updates.ts:55,93`) are `WeakMap<QueryClient, ...>` — keyed by the `QueryClient` **object**, which is the same single instance for the entire app lifetime (`router.tsx:7`). Nothing about an identity switch changes which `QueryClient` object exists, so nothing in Revision 1's proposal — which only talked about guarding *cache write points* — ever touched these maps. A claim made under identity A survives every mechanism proposed so far, including the corrected `resetQueries()`-based disposal.

**Fix**: make claim/chain storage epoch-scoped and self-healing, and make claim ownership an unforgeable token rather than a boolean:

```ts
// query-updates.ts, revised
type ClaimToken = { epoch: number; thingId: string; claimId: number };
let nextClaimId = 0;

const inFlightState = new WeakMap<QueryClient, { epoch: number; claims: Map<string, number> }>();

function currentInFlight(qc: QueryClient): { epoch: number; claims: Map<string, number> } {
  const epoch = getIdentityEpoch(qc).epoch;
  const existing = inFlightState.get(qc);
  if (existing && existing.epoch === epoch) return existing;
  // Self-healing: a stored epoch that doesn't match means every claim
  // recorded under it belongs to a retired identity and is void, the
  // same "reset and start fresh" principle pushChainEntry already uses
  // for detecting an external change to a chain's expected value.
  const fresh = { epoch, claims: new Map<string, number>() };
  inFlightState.set(qc, fresh);
  return fresh;
}

export function claimThingMutation(qc: QueryClient, thingId: string): ClaimToken | null {
  const state = currentInFlight(qc);
  if (state.claims.has(thingId)) return null;
  const claimId = ++nextClaimId;
  state.claims.set(thingId, claimId);
  return { epoch: state.epoch, thingId, claimId };
}

export function releaseThingMutation(qc: QueryClient, token: ClaimToken | null): void {
  if (!token) return;
  const state = currentInFlight(qc);
  // Only release if this token is still the live claim for this epoch —
  // an old epoch's token can never match `state.epoch` (self-healing
  // already replaced the map), and even a same-epoch, superseded claim
  // for the same thingId won't match on `claimId`. This is exactly what
  // stops "A's late finally from releasing B's newer claim."
  if (state.epoch !== token.epoch) return;
  if (state.claims.get(token.thingId) !== token.claimId) return;
  state.claims.delete(token.thingId);
}
```

Same treatment for `chainsByClient`: store `{ epoch, chains: Map<locationKey, ChainEntry[]> }`, self-heal on epoch mismatch via the same pattern. This has a pleasant consequence: `spliceChainEntry`'s **existing** "entry not found → return `undefined`, do nothing" behavior (`query-updates.ts:148-151`) already handles the epoch-stale case correctly once the storage itself is epoch-scoped — a rollback closure invoked after the epoch advanced will look up a chain that's already been reset to empty, find nothing, and safely no-op. No change to `spliceChainEntry`/`pushChainEntry`'s own logic is needed, only to what storage they read from.

`isThingMutationInFlight` becomes `state.claims.has(thingId)` against `currentInFlight(qc)` — same self-heal, so a query from a new identity asking "is this Thing mid-mutation" correctly sees "no" once the epoch has turned over, even if A's claim was never explicitly released.

---

## 4. Transition ordering (revised)

### Correction: why the Revision 1 mechanism was unsound, precisely

The reviewer's point 1 is correct on both counts: (a) a `useEffect` runs after the commit that rendered the new identity's children, so those children's first render can read old cache contents; and, as the empirical findings above now show, (b) even if the effect ran at the *right* time, calling `qc.clear()` inside it would not have forced already-mounted `useQuery` consumers to stop showing old data anyway. The fix has to address both: run synchronously at the correct point in the render, **and** use `resetQueries()`, not `clear()`.

### The gate

One component, `IdentityBoundary`, mounted once as the outermost wrapper around the entire protected subtree — inside `QueryClientProvider`, wrapping `AppContextProvider` + `ProfileDirectoryProvider` + `Outlet` (`__root.tsx:135-150`). `CallRingProvider`/`PushRegistrar` placement relative to the boundary is an open question, noted below, not decided here.

```tsx
function IdentityBoundary({ children }: { children: ReactNode }) {
  const { session, loading } = useSession();
  const preview = isPreviewSession(session);
  const identity = computeIdentity({ loading, session, preview });
  const qc = useQueryClient();

  const lastIdentityRef = useRef<Identity>(identity);
  if (requiresDisposal(lastIdentityRef.current, identity)) {
    // Synchronous, inside this render's function body, before returning
    // JSX -- not deferred to an effect. React guarantees this component's
    // render executes before any descendant's render in the same commit,
    // so by the time children render, disposal has already happened.
    runRegisteredDisposers(qc);          // P4/P7 owners register into this
    advanceIdentityEpoch(qc, identity);  // resets the claim/chain WeakMaps too (§3)
    qc.resetQueries();                  // NOT qc.clear() -- see §3's empirical findings
  }
  lastIdentityRef.current = identity;

  if (identity.kind === "pending") return <AuthResolvingFallback />;

  return <IdentityContext.Provider value={identity}>{children}</IdentityContext.Provider>;
}

function requiresDisposal(prev: Identity, next: Identity): boolean {
  if (prev.kind === "pending") return false; // nothing existed yet to dispose
  return !identityEquals(prev, next);
}
```

This is a deliberate, narrow use of React's sanctioned "adjust state/refs during render in response to a changed input" pattern (the same category as React's own documented "reset state when a prop changes" recipe) — not a `useEffect`, specifically because the ordering guarantee this needs (parent's disposal *before* any descendant renders in the *same* commit) is something only synchronous-during-render code gets, and `useEffect` does not.

### Does the protected subtree remount?

**No, not by default**, and this is a real answer, not an assumption (per the reviewer's explicit instruction not to assume). `resetQueries()` (proven in §3) already correctly refreshes every actively-observed query without destroying and recreating the component tree — a full remount would be a heavier mechanism than the `QueryClient`-cache problem actually requires, once `resetQueries()` is used instead of `clear()`.

This means the *cache* dimension of the problem is solved without a remount. It does **not** mean every other kind of state a mounted component might hold is automatically safe — see the next two subsections, which the reviewer specifically flagged and which this revision does **not** claim to have solved just by adding the gate.

### What a non-remounting design does not cover, named explicitly

1. **Local component state / open UI tied to a now-inaccessible entity.** A Thing detail panel open for a Thing the new identity can't see isn't addressed by this design at all — that's a routing/authorization-boundary question (does the app's existing 403/404 handling already close or redirect such a view?), not a cache-lifecycle question. **Open question, needs implementation-time verification against how the router currently handles an authorization failure mid-view** — not resolved in this document.
2. **`use-list-messages.ts`'s mounted-consumer gap (reviewer's point 5, confirmed, not fixed by this revision).** Its effect's dependency array is `[listId, preview, hidden, qc]` (`use-list-messages.ts:128`) — no profile id. If a component using this hook stays mounted across a live A → live B switch on the same route (this requires verifying whether the app's own navigation flow even allows staying on the same route through an account switch — **not verified in this document**), its `list-chat:${listId}` broadcast channel keeps running, and its `invalidate()`/`broadcastChange()` calls keep firing, attributed to whichever identity happens to be active when they run. `resetQueries()` does not touch a component's own `useEffect`-owned channel subscription — only `QueryClient`-observed data. **This is not resolved by `IdentityBoundary` and is not claimed to be.** It's recorded as a named, tracked gap for P8 (which already owns chat/hub redesign per the plan's sequencing) rather than silently deferred — see §5 and §6 for the test that documents it.

### Distinguishing unresolved auth from confirmed logout

Solved directly by the four-variant `Identity` type: `pending` renders `<AuthResolvingFallback />`; `none` renders `children` normally (a logged-out/landing surface is legitimate content, not a loading spinner) — and if `none` was reached *from* a live/preview identity, `requiresDisposal` already ran the full disposal sequence on that transition, so no protected data lingers into the logged-out view either.

---

## 5. Compatibility (revised)

### Batch B rollback/claims

No change to `pushChainEntry`/`spliceChainEntry`'s algorithm (unchanged from Revision 1). What's different from Revision 1: the epoch-scoped, token-based claim/chain storage in §3 is now the actual mechanism (Revision 1 asserted an "epoch guard on cache-write points" that never touched these `WeakMap`s at all — that was a real gap, not a simplification).

**Correction**: Revision 1 referenced "a finally cache write on success" in `withOptimisticPatch` that does not exist in the current code — `withOptimisticPatch` has no additional write on success at all; the pre-flight optimistic write from `patchThingInCaches` *is* the final state once `fn()` resolves without throwing (the function's own comment says exactly this: "On success, the patch is left in place"). The actual guard points, precisely:

1. After `await cancelThingReads(...)` resolves, **before** calling `patchThingInCaches` or invoking `fn()` (the RPC dispatch) at all: check the claim token's epoch is still current. If not, release nothing new was claimed for and return early. This is stronger than just "don't write a stale patch" — it means a mutation whose *intent* was formed under identity A never fires its RPC once B is active, which matters because the underlying Supabase client always authenticates with whatever session is *currently* active, not whatever was active when the JS closure was created — dispatching `fn()` late would run the RPC under B's credentials for a mutation A initiated, not merely write stale cache data.
2. Inside the rollback closure, at each cache-write point (unchanged from Revision 1's intent, now correctly grounded — the epoch-scoped chain storage from §3 makes this fall out of `spliceChainEntry`'s existing "not found" handling rather than needing a new explicit check).
3. **Not yet enumerated, and not claimed to be solved by the core primitive**: every caller-level `onSuccess`/`onError` handler that does its own `qc.invalidateQueries(...)` outside `query-updates.ts` — the P0 inventory lists dozens of these call sites (`CourtWithOthersSidebar.tsx`, `MagicBox.tsx`, `ThingDetailContent.tsx`, `use-thing-comments.ts`, `personal-shred.ts`, `personal-snooze.ts`, `use-profile.ts`, `use-buckets.ts`, and more). A stale-epoch invalidation from one of these after a switch is a smaller, "wastes a request" problem for profile-scoped keys (whose key already differs after a switch) but a real problem for anything targeting an entity-only key. **This needs a file-by-file audit at implementation time**, the same way P2's read-error-policy audit went file-by-file — this design proposes the primitive (an exported `isEpochCurrent`/`withEpochGuard` helper any caller can use) but does not claim the retrofit is complete or even fully scoped yet. Toasts/notifications and any navigation side effect a mutation callback triggers need the same audit; none were found to exist for these specific mutations in the P0/P2 passes, but that was not an exhaustive search for this purpose.

### Chat, calls, presence

Calls (`call-room.ts`, `call-lobby.ts`) and presence (`presence.ts`): unchanged from Revision 1 — zero `QueryClient` interaction, nothing in this design touches them.

Chat (`use-list-messages.ts`): the mounted-consumer gap is now a **named, tracked compatibility risk**, not a footnote — see §4. `chat-read-state.ts`'s unscoped `localStorage` "last read" keys (Revision 1's finding) stands unchanged: still `localStorage`, still untouched by `resetQueries()` or anything else in this design, still deferred to P8.

**New finding**: `AppContextProvider.tsx:33` reads a **bare, non-profile-scoped** `STORAGE_KEY` (`"katalist.active_context"`) for live sessions — only the demo path scopes its storage key by persona (`demoContextKey()`, lines 11-17). On a shared device, profile A's last-picked work/home context can render for profile B's very first paint, before the existing DB-driven effect (lines 45-61) corrects it shortly after. This is the same *class* of gap as the `chat-read-state.ts` finding — `localStorage`, not `QueryClient`, unaffected by anything in §3/§4 — named here, not fixed, for whenever `AppContextProvider.tsx` is next touched.

### Drafts

Unchanged from Revision 1 — no persisted draft mechanism found in the tree; nothing to migrate.

---

## 6. Tests (revised — real `QueryClient`/`QueryObserver`, not just fake epoch functions)

### Already run as empirical grounding for this revision (to be formalized as permanent tests, not just scratch probes)

These use the actual installed `@tanstack/react-query` `QueryClient`/`QueryObserver` classes directly — no React, no DOM, runnable today in the existing plain `node:test` runner with zero new dependencies:

1. **`qc.clear()` leaves an active observer stale** — documents *why* `resetQueries()` is used instead; written as a passing "this is why we don't do X" regression guard, not a bug report.
2. **`qc.resetQueries()` (no filter) correctly refreshes an active observer and evicts an inactive one without an eager refetch.**
3. **A slow fetch in flight under the old identity does not clobber a newer post-switch fetch for the same key** — proves TanStack's own fetch-generation tracking, which §3 now relies on instead of an app-level guard for this specific race.

### To be written at implementation time

4. **`identity-epoch.test.mjs`** — pure epoch primitive: capture/compare, pending→known vs. known→known transition classification, `requiresDisposal` truth table.
5. **`thing-mutation-claim-epoch.test.mjs`** — reproduces the reviewer's exact finding (`claimSurvivesClear`, `nextIdentityCanClaim`) against **today's** code first, as a documented, currently-failing regression test (matching this batch's established discipline of proving a fix against a real failure before trusting it), then proves the token+self-heal fix resolves it: A claims, epoch advances, A's stale token fails to release, B successfully claims the same `thingId`, A's late `finally` release is a no-op against B's claim.
6. **`use-list-messages` mounted-consumer gap** — a test that documents (not fixes) the retained-subscription behavior across a simulated identity change, so P8 inherits a concrete regression check instead of rediscovering the gap.
7. **Component-level test for a mounted consumer across a live A → live B switch** — this is the one item in the reviewer's request that **cannot be delivered with existing tooling**. `package.json` has `react`/`react-dom`/`@tanstack/react-query` but no `@testing-library/react`, no `@testing-library/dom`, and no DOM environment (`jsdom`/`happy-dom`) — confirmed by inspection, not assumed. Writing a real "render `IdentityBoundary` + a mock protected consumer, simulate a switch, assert the DOM never shows stale content" test requires adding these as new devDependencies. **This is a decision point requiring sign-off, not just a design choice** — proposed as its own dedicated, reviewable, test-infra-only commit (no production code in the same commit) before the component-level test is written. Until that's decided, this specific test category stays **pending**, named honestly rather than substituted with another fake-mock test dressed up as equivalent.

### Browser/staging — unchanged from Revision 1, still explicitly pending

Real account switch, real token refresh, real work/home switch (including whether `AppContextProvider.tsx:79`'s existing full `qc.invalidateQueries()` can be narrowed once this design's key/reset scoping is confirmed sufficient — still needs real browser observation, not static reading), two-tab/two-account `localStorage` contamination (now including the newly-found `AppContextProvider` storage-key gap alongside `chat-read-state.ts`'s).

---

## 7. Tradeoffs, alternatives, and migration sequence (revised)

### Alternatives considered and rejected (updated)

1. Global profile-namespaced key migration — still rejected, but for the corrected reason in §2 (contingent on the isolation boundary being proven, not on an RLS argument that doesn't apply to viewer-relative fields).
2. **Relying on `qc.clear()` alone** — this was Revision 1's actual proposal, and it's now retracted with empirical evidence (§3) rather than replaced with a different assumption.
3. **Remounting the whole protected subtree as the primary mechanism** — considered again in this revision specifically because the reviewer asked me not to assume it isn't needed. Rejected as the *primary* mechanism because `resetQueries()` is proven sufficient for the `QueryClient`-cache dimension without the cost of destroying local component state (scroll position, open dialogs) that has nothing to do with identity. Not rejected as *categorically* wrong — individual components remain free to key/remount themselves for their own local-state reasons, and §4 names at least one place (a detail view of a now-inaccessible entity) where something in that spirit may still be needed, pending the routing-boundary investigation.
4. A parallel non-`QueryClient` cache, and centralizing `useSession()` — both still rejected, unchanged reasoning from Revision 1.

### Migration sequence (revised)

1. Fix `use-lists.ts:110`'s bare `["lists"]` scan — unchanged, still first, still isolated.
2. Add `identity-cache-policy.ts` (epoch primitive) **together with** the epoch-scoped claim/chain storage rewrite in `query-updates.ts` — these are now one step, not two, because Revision 1's mistake was treating the `WeakMap` fix as if it fell out of "guard cache writes" for free; it doesn't, so it's built at the same time as the primitive it depends on. Includes tests 4-5 above, plus tests 1-3 formalized from the empirical probes.
3. Add `IdentityBoundary` and wire it into `__root.tsx`, using `resetQueries()` — first behavior-changing commit. Includes the `pending`/`none`/live/preview rendering tests and the account-switch/logout/preview-toggle/context-switch scenarios from Revision 1's original list, rerun against the corrected mechanism.
4. Guard `withOptimisticPatch`'s pre-RPC-dispatch point, using the now-epoch-scoped claim from step 2. Includes the "mutation settles after switch" test, now precisely specified (§5, guard point 1).
5. **Decision point requiring separate sign-off**: add `@testing-library/react` + a DOM environment as devDependencies, in their own test-infra-only commit, before attempting the component-level mounted-consumer test.
6. Named, not fixed, explicitly tracked for later phases: `patchThingInCaches`'s cross-profile `["court"]` prefix scan (Revision 1's finding, unchanged), `chat-read-state.ts` (P8), `AppContextProvider.tsx`'s non-profile-scoped live storage key (this revision's finding), `use-list-messages.ts`'s mounted-consumer gap (P8, now with a regression test to inherit rather than rediscover), and the caller-level `onSuccess`/`onError`/`invalidateQueries` audit (§5) — file-by-file, at implementation time, not resolved by the core primitive alone.

P4 and P7 remain gated on this design's approval, unchanged. Step 5's dependency addition is called out as needing its own explicit go-ahead separate from the rest of this design, since it's the one part of this proposal that changes the project's dependency surface rather than just its source.
