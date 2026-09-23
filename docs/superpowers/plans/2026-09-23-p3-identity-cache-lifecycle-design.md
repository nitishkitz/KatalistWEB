# P3 — Identity and Cache Lifecycle Design (Revision 4)

Date: 2026-09-23
Baseline: `cd8932a` on `katalist-plan/batch-a-baseline`
Status: **Design proposal only. No implementation in this document.** Revision 3 (committed at `c2cf0d0`) was not yet approved — one correctness gap in the new mechanism, plus two items explicitly left as open approval gates. All three are addressed in this revision. P4/P7 remain gated.

**What changed since Revision 3, and why**:

1. **Correctness gap, fixed**: the `aligning`/`ready` gate's render-time comparison only triggered on `nextIdentity.kind !== "pending"` — meaning a hypothetical transition from a committed, ready identity back to `pending` (auth becoming unconfirmed again) left `gate` at its old `{ status: "ready", identity: A }` value, and the boundary would keep rendering A's protected content while identity was actually unconfirmed. Fixed in §4: `nextIdentity.kind === "pending"` is now checked first and unconditionally, before any comparison against what was previously committed. (Today's `useSession()` never re-enters `loading: true` after initial mount, so this specific transition isn't reachable yet — the fix doesn't depend on that staying true, deliberately, since baking in an assumption about a security-relevant boundary's own dependency is exactly the wrong place to do it.)
2. **The caller-level invalidation audit — previously deferred, now part of the gate itself.** The reviewer's fourth (previously hidden) comment: a stale identity-A mutation callback calling `qc.invalidateQueries()` on an entity-only key after the switch can trigger a fetch under B's session, and this isn't touched by `resetQueries()`, the keyed remount, or `withOptimisticPatch`'s own guard points — all three protect *reads* and *query-updates.ts's own* writes, not arbitrary callers' `onSuccess`/`onError` handlers. §5 now defines `withEpochGuard` concretely and provides a complete, prioritized inventory of every `invalidateQueries` call site the P0 sweep found (excluding `use-realtime.ts`'s own handlers, which are P7's remit) — the "Required" tier (entity-only keys, mutation-callback-driven) must be retrofitted before this gate closes, even though the retrofit itself can land as multiple commits, per the reviewer's explicit allowance.
3. **Component-tree placement — traced against the real code, not left as an open question.** §4's "what this still does not cover" now reports the actual result: `AppShell`, `ChatHeadsDock`, and `useRealtimeInvalidation()` are all confirmed descendants of `<Outlet />` (reached only via route `component`s — never referenced from `__root.tsx` directly), so the specific "chat dock" case named in review is inside the boundary. Two real exceptions were found — `CallRingProvider` and `PushRegistrar`, both structural siblings of `<Outlet />` — with a concrete placement recommendation to close even that gap.

§1–§3, and everything in §4/§5/§6/§7 not called out above, are unchanged from Revision 3.

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
  //
  // `nextIdentity.kind === "pending"` always wins, checked first and
  // unconditionally -- not guarded behind a comparison against what
  // was previously committed. useSession() currently only reports
  // `loading: true` once, at initial mount (useSession.ts never calls
  // setLoading(true) again after that), so a ready(A) -> pending
  // transition isn't reachable with today's implementation -- but this
  // boundary is exactly the wrong place to bake in an assumption about
  // that staying true forever. If identity ever becomes unconfirmed
  // again for any reason, "we don't currently know who this is" must
  // never render as "keep showing who it was a moment ago," so the
  // check does not depend on that assumption holding.
  const committedIdentity = gate.status === "ready" ? gate.identity : null;
  if (nextIdentity.kind === "pending") {
    if (gate.status !== "pending") setGate({ status: "pending" });
  } else if (
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

**Stated tradeoff in this fix**: any resolution out of `pending` — even back to the exact same identity that was committed before — goes through `aligning` again, since `committedIdentity` is derived only from `gate.status === "ready"` and `gate.status` was `"pending"`, not `"ready"`, going in. This means a hypothetical future `loading: true` blip that resolves back to the same profile would trigger an unnecessary disposal/remount rather than resuming untouched. This is accepted deliberately: correctness (never render an unconfirmed identity's stale content) is prioritized over avoiding a redundant remount for a transition that isn't reachable with today's `useSession()` implementation anyway. If `pending` ever becomes reachable mid-session in the future and the redundant remount turns out to matter in practice, a `lastKnownIdentityRef` (tracking the last committed identity independently of transient `pending` detours) is the natural follow-up optimization — deliberately not built now, since it's unneeded complexity for a currently-unreachable path.

### Why remount, given `resetQueries()` already works (§3)

`resetQueries()` is still necessary and correct — it's what makes the layout effect's disposal actually take effect on any observer that happens to still exist. But relying on it *alone*, as Revision 2 did, means the guarantee depends on trusting `QueryObserver` internals (that every currently-mounted observer, however deeply nested, correctly receives and acts on the reset) rather than on something directly verifiable from the tree structure. Keying the protected subtree by `identityKey(identity)` makes the guarantee structural instead: React unmounts every component in the old subtree (running all their cleanup effects — closing the per-list chat channel, releasing local `useState`/refs, discarding any component holding a reference to a now-stale `QueryObserver`) and mounts entirely new component instances only after the layout effect's disposal has already run (`aligning` is rendered first; `ready` — and the remount — only happens after `setGate({ status: "ready", ... })`, which is itself sequenced after `resetQueries()` in the same effect). There is no window where an old component instance is still alive holding an old `QueryObserver` subscription while a new identity's data exists in the cache.

This directly resolves the reviewer's point 5 (`use-list-messages.ts`'s mounted-consumer gap): if the component calling that hook is anywhere inside `children`, the remount tears down its effect (closing the `list-chat:${listId}` channel) unconditionally on every real identity change, regardless of whether `listId`/`preview`/`hidden`/`qc` themselves changed. This was unresolved in Revision 2 and is resolved here, **provided** the component sits inside the boundary — see the placement note below.

**Accepted cost, stated plainly**: a live account switch (not a context switch, not a token refresh) unmounts and remounts the entire protected subtree — scroll position, open dialogs/menus, and any other local UI state tied to a specific entity are lost. This is judged acceptable because switching accounts is exactly the kind of event where a user does not expect their previous session's open modal to persist, and it only fires on the transitions in §1's table that are marked "identity changed," not on context switches or token refreshes.

### What this still does not cover, named explicitly

1. **Placement — now verified against the actual component tree, not assumed.** Traced the real JSX: `__root.tsx:139-148` nests `QueryClientProvider → AppContextProvider → ProfileDirectoryProvider → { <Outlet />, <CallRingProvider />, <PushRegistrar />, <Toaster /> }` (the last four as siblings inside `ProfileDirectoryProvider`, not `Outlet`'s children). `AppShell.tsx` is never referenced from `__root.tsx` or any router-config file — it's only rendered from individual route `component`s (`index.tsx`, `team.tsx`, `buckets.$bucketId.tsx`, `nudges.tsx`, `buckets.index.tsx`, `lists.$listId.tsx`, `lists.index.tsx`, `me.tsx`), which is exactly what renders inside `<Outlet />`. `ChatHeadsDock` (`AppShell.tsx:60`) and `useRealtimeInvalidation()` (`AppShell.tsx:28`) are therefore both confirmed descendants of `<Outlet />` — the specific "chat dock" case named in review is **inside** the boundary, not a sibling exception. (`ChatHeadsDock` uses `createPortal` for its DOM output, but portaling doesn't change its position in the React tree for mount/unmount purposes — that's still `AppShell`'s child.)
   - **Two real exceptions found**: `CallRingProvider` (`__root.tsx:143`) and `PushRegistrar` (`__root.tsx:144`) are structural siblings of `<Outlet />`, both nested inside `ProfileDirectoryProvider`. If `IdentityBoundary` replaces `AppContextProvider` (wrapping everything `ProfileDirectoryProvider` currently wraps, as one unit), both fall inside the boundary and get the remount treatment. If it's placed more narrowly (wrapping only `<Outlet />`), they don't. Both already call `useSession()` and key their own effects on `user?.id` directly (`CallRingProvider.tsx:18,36`; `PushRegistrar.tsx:17,21`) — so both already correctly react to an identity change on their own, independent of this design. They don't strictly *need* the remount to be correct, but leaving them outside it means their correctness rests on their own existing `user?.id`-keyed effects rather than the same structural guarantee everything else gets. **Recommendation**: place `IdentityBoundary` where `AppContextProvider` currently sits (wrapping the same four-sibling group `ProfileDirectoryProvider` wraps today), so `CallRingProvider`/`PushRegistrar` get the same guarantee as everything else rather than relying on a second, independent correctness argument — but per the plan's own instruction not to touch call-room/lobby/presence in this phase, this is a placement recommendation for P3's implementation, not a change to either provider's own code.
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

### Caller-level invalidation audit — the reviewer's fourth point, now part of the P3 gate, not later work

The concern, stated precisely: `resetQueries()` (§3) and the keyed remount (§4) both protect *reads* — a component's own `useQuery`. Neither protects a **mutation's completion callback** that was already running under identity A when the switch happened. `withOptimisticPatch`'s own guard point 1 above covers `query-updates.ts`'s internal callers, but every *other* file that does its own `qc.invalidateQueries(...)` inside a `useMutation`'s `onSuccess`/`onError` is untouched by anything in §3/§4. A stale A-mutation's `onSuccess` firing after the switch and calling `qc.invalidateQueries({ queryKey: ["thing", someId] })` would trigger a fresh fetch for that entity-only key under B's now-active session — exactly the reviewer's example. **This was previously deferred as "later work"; it is not later work — it's part of what "the boundary is complete" has to mean, even though the retrofit itself can land as multiple commits.**

**The primitive**, defined concretely (not just gestured at):

```ts
// identity-cache-policy.ts
export function withEpochGuard<Args extends unknown[]>(
  qc: QueryClient,
  capturedEpoch: number,
  fn: (...args: Args) => void,
): (...args: Args) => void {
  return (...args) => {
    if (!isEpochCurrent(qc, capturedEpoch)) return;
    fn(...args);
  };
}
```

Usage at a call site (illustrative, matches the shape every entry in the inventory below would take):

```ts
const epoch = getIdentityEpoch(qc).epoch; // captured when the mutation is created/dispatched
useMutation({
  mutationFn: ...,
  onSuccess: withEpochGuard(qc, epoch, () => {
    qc.invalidateQueries({ queryKey: keys.court(profileId, context) });
  }),
});
```

**Complete inventory of every `invalidateQueries` call site this audit covers**, pulled from the P0 inventory (`2026-09-23-realtime-ownership-inventory.md`), *excluding* the ten `use-realtime.ts` postgres_changes handlers (those are P7's realtime-controller remit — they get epoch-guarded as part of that owner's own lifecycle, not this retrofit) and `query-updates.ts`'s own calls (already covered by guard points 1-2 above):

| Priority | File:line | Key family / shape | Why this priority |
|---|---|---|---|
| **Required before the P3 gate closes** — entity-only key, mutation-callback-driven | `ThingDetailContent.tsx:448,449,463,465,466` | `thing`, `court`, `buckets`/`bucket`/`bucket-items` | Entity-only keys targeted from a mutation's own completion callback — exactly the reviewer's scenario |
| Required | `CourtWithOthersSidebar.tsx:68-72` | `nudges`, `nudge-history`, `court`, `thing`, `notifications` | Same — mutation-driven, mixed entity-only and profile-scoped targets in one handler |
| Required | `MagicBox.tsx:319,321,322,325` | `court`, `list-things`, `lists`, `buckets` | Same |
| Required | `use-thing-comments.ts:143-145` | `thing-comments`, `thing-activity`, `court` | Same |
| Required | `use-list-messages.ts:107,108,120` | `list-messages` (entity-only), `lists` | `list-messages` is entity-only and this file already has a documented mounted-consumer gap (§4) — even after the remount fixes the *subscription* lifetime, the mutation callbacks themselves (`onSuccess` at lines 177-180, 195-198, 215-218 per the P0 inventory) still need the guard for the window before any remount completes |
| Required | `use-buckets.ts:96,97,103-105`; `use-bucket-items.ts:79-81`; `SpringLoadedBucketFlyout.tsx:107-109`; `CourtBucketsSidePanel.tsx:51,154-156` | `bucket`, `bucket-items`, `buckets` | Entity-only and profile-scoped mixed; several independent call sites for the same key families |
| **Lower priority, still tracked, not blocking** — profile-scoped key only | `personal-shred.ts:86-99`; `personal-snooze.ts:86-88`; `use-profile.ts:78-83,112-120`; `use-catchup.ts:212`; `nudges.tsx:127-131`; `use-notifications.ts:65,80`; `use-list-meetings.ts:58`; `use-doorman.ts:70,82`; `me.tsx:494`; `use-hub-files.ts:111`; `use-contacts.ts:125,161,171-173`; `use-lists.ts:71,76`; `use-conversations.ts:182,190` | All profile-scoped (`keys.xxx(profileId, ...)`) or already-namespaced ad-hoc (`["hub-conversations", user.id]`, etc.) | A stale-epoch invalidation here targets a key that already differs after a real switch (the profile id is baked into the key) — the *practical* risk is a wasted request against an orphaned cache slot, not cross-identity data exposure. Still gets the wrapper for defense-in-depth and consistency, but does not block calling the boundary safe |
| **Named, not retrofitted, tracked separately** | `AppContextProvider.tsx:79` (`qc.invalidateQueries()`, no key at all) | n/a | This fires on a *context* switch, not an identity change — out of scope for the epoch guard by definition (§1: context switches don't advance the epoch). Unchanged from earlier revisions' finding. |

**What "required before the gate closes" means concretely, per the instruction that the retrofit can span multiple commits**: every row in the "Required" tier must be wrapped with `withEpochGuard` (or have its containing `useMutation` call demonstrated safe by some other explicit argument, on a case-by-case basis, if wrapping turns out to be the wrong shape for a given call site) before P3 is declared complete and P4/P7 are unblocked. The "Lower priority" tier should also be retrofitted, but a gap there does not, by this design's own reasoning, block the safety property the gate exists to establish. This inventory is exhaustive against the P0 sweep's `invalidateQueries` findings; it is not exhaustive against every possible side effect a mutation callback could have (toasts, navigation) — no instance of either was found attached to these specific mutations in the P0/P2 passes, but that was not a search conducted for this specific purpose, and implementation should re-check rather than rely on this document's absence-of-evidence.

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

4. **`identity-epoch.test.mjs`** — pure epoch primitive: capture/compare, pending→known vs. known→known transition classification, `requiresDisposal`-equivalent truth table for `GateStatus` transitions — including the ready(A)→pending→live(A) case (this revision's fix): asserts the gate renders `pending` (never A's stale committed identity) the instant `nextIdentity.kind` becomes `"pending"`, regardless of what was previously `ready`.
5. **`thing-mutation-claim-epoch.test.mjs`** — reproduces the reviewer's exact finding (`claimSurvivesClear`, `nextIdentityCanClaim`) against **today's** code first, as a documented, currently-failing regression test (matching this batch's established discipline of proving a fix against a real failure before trusting it), then proves the token+self-heal fix resolves it: A claims, epoch advances, A's stale token fails to release, B successfully claims the same `thingId`, A's late `finally` release is a no-op against B's claim.
6. **`with-epoch-guard.test.mjs`** — pure test of the `withEpochGuard` primitive itself (§5): a wrapped callback fires when the captured epoch is still current and is a no-op when it isn't, independent of any specific call site. This is necessary but not sufficient — it proves the primitive works, not that any specific one of the "Required" inventory rows in §5 has actually been wrapped. Each retrofitted call site needs its own test at the point it's retrofitted (e.g. extending `fetch-buckets-error-propagation.test.mjs`-style existing files, or new ones alongside them), the same file-by-file discipline P2's read-error-policy audit used — not enumerated exhaustively in this document.

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
2. Add `identity-cache-policy.ts` (epoch primitive, including `withEpochGuard` — §5) **together with** the epoch-scoped claim/chain storage rewrite in `query-updates.ts` — these are now one step, not two, because Revision 1's mistake was treating the `WeakMap` fix as if it fell out of "guard cache writes" for free; it doesn't, so it's built at the same time as the primitive it depends on. Includes tests 4-6 above, plus tests 1-3 formalized from the empirical probes.
3. **Decision point requiring separate sign-off**: add `@testing-library/react` + a DOM environment as devDependencies, in their own test-infra-only commit. Per §6, this now comes *before* step 4, not after — the mechanism in step 4 is not considered verified until tests 7-8 exist and pass.
4. Add `IdentityBoundary` (the `pending`/`aligning`/`ready` gate, the layout effect, the identity-keyed remount), placed where `AppContextProvider` currently sits so `CallRingProvider`/`PushRegistrar` fall inside it too (§4's placement recommendation), and wire it into `__root.tsx` — first behavior-changing commit. Includes tests 7-8 (component-level, real DOM) alongside the account-switch/logout/preview-toggle/context-switch scenarios from earlier revisions, rerun against the corrected mechanism.
5. Guard `withOptimisticPatch`'s pre-RPC-dispatch point, using the epoch-scoped claim from step 2. Includes the "mutation settles after switch" test, precisely specified in §5's guard point 1.
6. **Retrofit every "Required" row in §5's caller-level invalidation inventory with `withEpochGuard`** — this is part of the P3 gate itself, not later work, though it may span multiple commits (one per file or small group, matching P2's file-by-file precedent): `ThingDetailContent.tsx`, `CourtWithOthersSidebar.tsx`, `MagicBox.tsx`, `use-thing-comments.ts`, `use-list-messages.ts`, `use-buckets.ts`/`use-bucket-items.ts`/`SpringLoadedBucketFlyout.tsx`/`CourtBucketsSidePanel.tsx`. Each commit includes its own regression test proving the specific call site's `onSuccess`/`onError` no-ops once the epoch has advanced.
7. The "Lower priority" tier from §5's inventory (profile-scoped keys) — retrofitted for consistency, but explicitly not blocking P3's closure per §5's own reasoning.
8. Named, not fixed, explicitly tracked for later phases: `patchThingInCaches`'s cross-profile `["court"]` prefix scan (Revision 1's finding, unchanged), `chat-read-state.ts` (P8), `AppContextProvider.tsx`'s non-profile-scoped live storage key (Revision 2's finding), and any toast/navigation side effect discovered during step 6's file-by-file audit that wasn't caught by the P0/P2 passes.

P4 and P7 remain gated on this design's approval, unchanged. Step 3's dependency addition is called out as needing its own explicit go-ahead separate from the rest of this design, sequenced *before* the behavior-changing commit it gates. Steps 6-7 are the reviewer's fourth point made concrete — P3 is not complete until the "Required" tier of step 6 has landed, even across multiple commits.
