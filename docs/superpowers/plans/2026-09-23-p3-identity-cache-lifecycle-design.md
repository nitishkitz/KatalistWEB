# P3 — Identity and Cache Lifecycle Design (Revision 3)

Date: 2026-09-23
Baseline: `cd8932a` on `katalist-plan/batch-a-baseline`
Status: **Design proposal only. No implementation in this document.** Revision 2 (committed at `b4bd232`) was not approved. This revision replaces §4's transition mechanism entirely in response to three further correctness gaps in that mechanism, plus the reviewer's explicit direction to design around "an aligned fallback + layout-effect disposal + protected-subtree identity snapshot/remount strategy." P4/P7 remain gated.

**What changed since Revision 2, and why**: Revision 2 fixed the five gaps found in Revision 1, but its own transition mechanism (§4) had three further problems, all confirmed on review: (1) it ran real side effects — disposal, epoch advance, `resetQueries()` — synchronously during render, which is not a valid use of React's "adjust state during render" pattern (that pattern covers deriving plain state values, not dispatching subscriptions-teardown and network calls); (2) it never actually *established* that only one identity's queries are ever observed at once — it asserted `resetQueries()` reaches every live observer (true, proven in §3) but treated "eventually reaches them" as equivalent to "never observed under two identities simultaneously," which it isn't; (3) it assumed the whole transition completes within one render pass instead of defining a real, inspectable "transition in progress" state.

Revision 3's §4 replaces the mechanism with: an explicit three-state gate (`pending` / `aligning` / `ready`) where `aligning` withholds the entire protected subtree (nothing renders, so nothing can observe under two identities at once); all real side effects moved into a `useLayoutEffect` (the sanctioned place for post-commit, pre-paint work); and the protected subtree keyed by identity, forcing a genuine unmount/remount on every real identity change rather than relying solely on `resetQueries()` reaching already-mounted observers. §1–§3, §5–§7 are otherwise unchanged from Revision 2 except where §4's new mechanism required a cross-reference update (noted inline).

Also carried forward, unresolved, from earlier revisions and this one: the component-level test needed to actually verify this mechanism's browser/React behavior (Strict Mode double-invocation, layout-effect-before-paint timing) requires `@testing-library/react` + a DOM environment, which are not currently installed. The reviewer's point that "QueryClient probes prove library behavior, not React boundary behavior" is accepted in full — §6 now treats that test as **required before this mechanism can be considered verified**, not as a nice-to-have alongside the probes.

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

## 4. Transition ordering (Revision 3 — replaces Revision 2's mechanism entirely)

Revision 2's mechanism is withdrawn, not patched. Three specific problems with it, all confirmed correct on review:

1. **Doing `runRegisteredDisposers`/`advanceIdentityEpoch`/`resetQueries()` synchronously inside the render body is not a sanctioned use of React's "adjust state during render" pattern — it's a render-purity violation.** That pattern exists for deriving/resetting *plain state values* in response to a changed input (React's own docs example: resetting a `useState` counter to `0` when a `userId` prop changes). It does not cover dispatching real external side effects — disposing subscriptions, mutating module-level `WeakMap`s other code reads, and triggering network fetches via `resetQueries()`. Render can run more than once for the same commit (React Strict Mode's intentional double-invoke in development, and concurrent rendering can discard an in-progress render entirely), and none of those side effects are safe to run an indeterminate number of times or to run and then have their work thrown away.
2. **Revision 2's gate never actually guaranteed exclusivity.** Even granting the timing were sound, nothing in Revision 2 stopped a `useQuery` inside `children` from being *already mounted* (from before the transition) and continuing to observe under the old identity while disposal was still in progress — Revision 2 asserted `resetQueries()` reaches all live observers, which is true (§3), but "eventually reaches them" is not the same as "they were never observed under two identities in the same instant," and the design never established the latter.
3. **Revision 2 treated the transition as instantaneous** (render, dispose, render children — all in one pass) instead of defining a real, inspectable state for "a transition is in progress." That's an assumption, not a specification — exactly what was asked not to do.

### The corrected mechanism: an explicit `aligning` state, disposal in a layout effect, and a keyed remount of the protected subtree

```ts
type GateStatus =
  | { status: "pending" }                                    // auth not yet resolved
  | { status: "aligning"; identity: Identity }                 // disposal in progress -- protected subtree is not rendered at all
  | { status: "ready"; identity: Identity };                    // safe: disposal for this identity has completed
```

```tsx
function IdentityBoundary({ children }: { children: ReactNode }) {
  const { session, loading } = useSession();
  const preview = isPreviewSession(session);
  const nextIdentity = computeIdentity({ loading, session, preview });
  const qc = useQueryClient();

  const [gate, setGate] = useState<GateStatus>(() =>
    nextIdentity.kind === "pending" ? { status: "pending" } : { status: "aligning", identity: nextIdentity },
  );

  // Render stays pure: this is a plain comparison and a setState call,
  // nothing external. It only decides *that* a transition is needed and
  // records *which* identity it's for -- it does not run disposal,
  // does not touch the QueryClient, and is safe to execute any number
  // of times (Strict Mode's double-render, a discarded concurrent
  // render) because it has no effect beyond computing what to render.
  const committedIdentity = gate.status === "ready" ? gate.identity : null;
  if (
    nextIdentity.kind !== "pending" &&
    !identityEquals(committedIdentity, nextIdentity) &&
    !(gate.status === "aligning" && identityEquals(gate.identity, nextIdentity))
  ) {
    setGate({ status: "aligning", identity: nextIdentity });
  }

  // Every real side effect -- disposal, epoch advance, resetQueries()
  // -- lives here, not in render. useLayoutEffect is the right tool
  // specifically because React guarantees it runs after this render's
  // DOM is committed but before the browser paints, and a state update
  // made inside it is applied (re-rendering and re-committing) before
  // that paint happens too -- so the transition can require zero, one,
  // or more extra synchronous passes without ever needing render itself
  // to do the work. While gate.status is "aligning", the block below
  // renders <AligningFallback />, not `children` -- nothing under this
  // boundary is mounted, so no useQuery anywhere in the protected
  // subtree can be observing under two identities at once. This is the
  // exclusivity guarantee Revision 2 asserted but never established.
  useLayoutEffect(() => {
    if (gate.status !== "aligning") return;
    runRegisteredDisposers(qc);           // P4/P7 owners register into this; must be idempotent (Strict Mode)
    advanceIdentityEpoch(qc, gate.identity); // also resets the claim/chain WeakMaps (§3)
    qc.resetQueries();                    // NOT qc.clear() -- see §3's empirical findings
    setGate({ status: "ready", identity: gate.identity });
  }, [gate, qc]);

  if (gate.status === "pending") return <AuthResolvingFallback />;
  if (gate.status === "aligning") return <AligningFallback />;

  return (
    <IdentityContext.Provider value={gate.identity}>
      {/* Keyed by identity: forces React to fully unmount the previous
          identity's protected subtree and mount a genuinely fresh one,
          rather than reusing existing component instances/observers.
          See "Why remount" below for what this buys beyond resetQueries(). */}
      <Fragment key={identityKey(gate.identity)}>{children}</Fragment>
    </IdentityContext.Provider>
  );
}
```

### Why remount, given `resetQueries()` already works (§3)

`resetQueries()` is still necessary and correct — it's what makes the layout effect's disposal actually take effect on any observer that happens to still exist. But relying on it *alone*, as Revision 2 did, means the guarantee depends on trusting `QueryObserver` internals (that every currently-mounted observer, however deeply nested, correctly receives and acts on the reset) rather than on something directly verifiable from the tree structure. Keying the protected subtree by `identityKey(identity)` makes the guarantee structural instead: React unmounts every component in the old subtree (running all their cleanup effects — closing the per-list chat channel, releasing local `useState`/refs, discarding any component holding a reference to a now-stale `QueryObserver`) and mounts entirely new component instances only after the layout effect's disposal has already run (`aligning` is rendered first; `ready` — and the remount — only happens after `setGate({ status: "ready", ... })`, which is itself sequenced after `resetQueries()` in the same effect). There is no window where an old component instance is still alive holding an old `QueryObserver` subscription while a new identity's data exists in the cache.

This directly resolves the reviewer's point 5 (`use-list-messages.ts`'s mounted-consumer gap): if the component calling that hook is anywhere inside `children`, the remount tears down its effect (closing the `list-chat:${listId}` channel) unconditionally on every real identity change, regardless of whether `listId`/`preview`/`hidden`/`qc` themselves changed. This was unresolved in Revision 2 and is resolved here, **provided** the component sits inside the boundary — see the placement note below.

**Accepted cost, stated plainly**: a live account switch (not a context switch, not a token refresh) unmounts and remounts the entire protected subtree — scroll position, open dialogs/menus, and any other local UI state tied to a specific entity are lost. This is judged acceptable because switching accounts is exactly the kind of event where a user does not expect their previous session's open modal to persist, and it only fires on the transitions in §1's table that are marked "identity changed," not on context switches or token refreshes.

### What this still does not cover, named explicitly

1. **Placement matters, and isn't fully decided.** The remount guarantee only covers components that are descendants of `IdentityBoundary`. If a persistent, always-mounted surface (e.g. the hub chat dock, if it turns out to be rendered outside `<Outlet />` rather than inside it — **not yet verified against the actual component tree**) sits as a *sibling* to the boundary rather than a descendant, it is not remounted and its identity-unsafe state is not addressed by this design. This needs an implementation-time trace of exactly what's mounted where relative to the proposed boundary position (inside `QueryClientProvider`, wrapping `AppContextProvider` + `ProfileDirectoryProvider` + `Outlet`) before this can be called complete for every consumer, not just the ones inspected so far.
2. **A now-inaccessible entity's detail view**, if reached via a route that itself survives the remount somehow (e.g. the router's own state is outside this boundary) — still an open routing/authorization-boundary question, unchanged from Revision 2, not resolved here either.
3. **Strict Mode double-invocation of the layout effect itself needs a real test, not an assertion.** The effect's `if (gate.status !== "aligning") return` guard should make a second, dev-only invocation a no-op (the first invocation already advanced `gate` to `ready`), but "should" is exactly the word the reviewer is pushing back on — this needs the component-level test named in §6, not a claim of correctness from reading the code.

### Distinguishing unresolved auth from confirmed logout

Unchanged in substance from Revision 2, now expressed as `GateStatus` variants instead of `Identity` variants: `pending` renders `<AuthResolvingFallback />`; a transition from any known identity to `{ kind: "none" }` (confirmed logout) goes through `aligning` exactly like any other real identity change (disposal runs, then `ready` renders `children` normally — a logged-out/landing surface is legitimate content, not a loading state).

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

Chat (`use-list-messages.ts`): the mounted-consumer gap is **addressed structurally by §4's keyed-remount mechanism**, provided the component sits inside `IdentityBoundary` (placement not yet fully verified — see §4's "what this still does not cover"). This is a change from Revision 2, where the gap was named but left open. `chat-read-state.ts`'s unscoped `localStorage` "last read" keys (Revision 1's finding) stands unchanged: still `localStorage`, still untouched by a component remount or anything else in this design (remounting doesn't clear `localStorage`), still deferred to P8.

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

4. **`identity-epoch.test.mjs`** — pure epoch primitive: capture/compare, pending→known vs. known→known transition classification, `requiresDisposal`-equivalent truth table for `GateStatus` transitions.
5. **`thing-mutation-claim-epoch.test.mjs`** — reproduces the reviewer's exact finding (`claimSurvivesClear`, `nextIdentityCanClaim`) against **today's** code first, as a documented, currently-failing regression test (matching this batch's established discipline of proving a fix against a real failure before trusting it), then proves the token+self-heal fix resolves it: A claims, epoch advances, A's stale token fails to release, B successfully claims the same `thingId`, A's late `finally` release is a no-op against B's claim.

### Required before this mechanism can be considered verified — not optional, not substitutable by the probes above

The reviewer's point stands in full: "the QueryClient probes prove library behavior, not the React boundary behavior you need... treat adding a DOM/component harness as a separate required decision, not as equivalent coverage." Tests 1-5 above (the `QueryClient`/`QueryObserver` probes and the pure epoch-primitive tests) are real and worth keeping, but none of them exercise `IdentityBoundary` itself — none of them can observe whether `aligning` is actually rendered before `ready`, whether the layout effect actually runs before paint, whether Strict Mode's double-invocation is actually idempotent in practice, or whether a mounted `use-list-messages`-style consumer's effect actually tears down on the keyed remount. Those are exactly the claims §4 makes, and none of them are proven by anything in this document yet.

6. **Decision point requiring separate sign-off, now elevated to a precondition, not an optional follow-up**: add `@testing-library/react`, `@testing-library/dom`, and a DOM environment (`jsdom` or `happy-dom`) as devDependencies, in their own dedicated, reviewable, test-infra-only commit (no production code in the same commit) — confirmed absent from `package.json` by inspection, not assumed.
7. **`identity-boundary.test.tsx`** (or equivalent, gated on item 6): render `IdentityBoundary` wrapping a minimal mock protected consumer (a component that calls a real `useQuery` against a real `QueryClient` for an entity-only key) inside a real DOM. Simulate a live A → live B switch by changing what `useSession()` returns. Assert, in order: (a) the DOM shows the `aligning` fallback, never identity A's data, at any point after the switch begins; (b) the mock consumer's mount effect count increases by exactly one across the switch (proving a real unmount+remount happened, not a reuse); (c) after settling, the DOM shows identity B's data; (d) React Strict Mode wrapping does not cause disposal/`resetQueries()`/the mount-effect count to run more than once per real transition.
8. **`use-list-messages`-style mounted-consumer test** (gated on item 6, supersedes Revision 2's "document, don't fix" version): a mock component using the same effect-dependency shape as `use-list-messages.ts` (`[listId, preview, hidden, qc]`, no profile id) rendered inside `IdentityBoundary`'s protected subtree — assert its channel-subscription effect tears down and re-runs across a live A → live B switch, proving §4's remount claim for this specific, previously-unresolved gap rather than asserting it from the design alone.

Until item 6 is decided and items 7-8 exist and pass, **§4's mechanism is a design, not a verified one** — this document does not claim otherwise.

### Browser/staging — unchanged from Revision 1, still explicitly pending

Real account switch, real token refresh, real work/home switch (including whether `AppContextProvider.tsx:79`'s existing full `qc.invalidateQueries()` can be narrowed once this design's key/reset scoping is confirmed sufficient — still needs real browser observation, not static reading), two-tab/two-account `localStorage` contamination (now including the newly-found `AppContextProvider` storage-key gap alongside `chat-read-state.ts`'s).

---

## 7. Tradeoffs, alternatives, and migration sequence (revised)

### Alternatives considered and rejected (updated)

1. Global profile-namespaced key migration — still rejected, but for the corrected reason in §2 (contingent on the isolation boundary being proven, not on an RLS argument that doesn't apply to viewer-relative fields).
2. **Relying on `qc.clear()` alone** — this was Revision 1's actual proposal, retracted with empirical evidence (§3).
3. **Relying on `resetQueries()` alone, with no explicit `aligning` state and no remount** — this was Revision 2's actual proposal. Rejected in this revision because it never established the exclusivity guarantee (§4, problem 2) and ran real side effects during render (§4, problem 1) — not because `resetQueries()` itself is wrong; it's still used, just no longer trusted as the *sole* mechanism.
4. A parallel non-`QueryClient` cache, and centralizing `useSession()` — both still rejected, unchanged reasoning from Revision 1.

### Migration sequence (revised)

1. Fix `use-lists.ts:110`'s bare `["lists"]` scan — unchanged, still first, still isolated.
2. Add `identity-cache-policy.ts` (epoch primitive) **together with** the epoch-scoped claim/chain storage rewrite in `query-updates.ts` — these are now one step, not two, because Revision 1's mistake was treating the `WeakMap` fix as if it fell out of "guard cache writes" for free; it doesn't, so it's built at the same time as the primitive it depends on. Includes test 5 above, plus tests 1-3 formalized from the empirical probes and test 4 (pure `GateStatus` transition logic).
3. **Decision point requiring separate sign-off**: add `@testing-library/react` + a DOM environment as devDependencies, in their own test-infra-only commit. Per §6, this now comes *before* step 4, not after — the mechanism in step 4 is not considered verified until tests 7-8 exist and pass.
4. Add `IdentityBoundary` (the `pending`/`aligning`/`ready` gate, the layout effect, the identity-keyed remount) and wire it into `__root.tsx` — first behavior-changing commit. Includes tests 7-8 (component-level, real DOM) alongside the account-switch/logout/preview-toggle/context-switch scenarios from earlier revisions, rerun against the corrected mechanism.
5. Guard `withOptimisticPatch`'s pre-RPC-dispatch point, using the epoch-scoped claim from step 2. Includes the "mutation settles after switch" test, precisely specified in §5's guard point 1.
6. Named, not fixed, explicitly tracked for later phases: `patchThingInCaches`'s cross-profile `["court"]` prefix scan (Revision 1's finding, unchanged), `chat-read-state.ts` (P8), `AppContextProvider.tsx`'s non-profile-scoped live storage key (Revision 2's finding), the exact component-tree placement audit for §4's "what this still does not cover" item 1, and the caller-level `onSuccess`/`onError`/`invalidateQueries` audit (§5) — file-by-file, at implementation time, not resolved by the core primitive alone.

P4 and P7 remain gated on this design's approval, unchanged. Step 3's dependency addition is called out as needing its own explicit go-ahead separate from the rest of this design, and is now sequenced *before* the behavior-changing commit it gates, not after it as an afterthought.
