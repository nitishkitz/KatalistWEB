import type { QueryClient } from "@tanstack/react-query";

/**
 * Identity as the P3 design defines it: profile id + session mode, not a
 * truthy logged-in flag or a Session object reference. `pending` (auth not
 * yet resolved) is distinct from `none` (confirmed logged out) -- a
 * transition INTO pending from a known identity must still retire that
 * identity's epoch (see advanceIdentityEpoch's callers in identity-boundary.tsx),
 * even though nothing renders while pending.
 */
export type Identity =
  | { kind: "pending" }
  | { kind: "none" }
  | { kind: "live"; profileId: string }
  | { kind: "preview"; profileId: string };

export function identityEquals(a: Identity | null | undefined, b: Identity): boolean {
  if (!a) return false;
  if (a.kind !== b.kind) return false;
  if ((a.kind === "live" || a.kind === "preview") && (b.kind === "live" || b.kind === "preview")) {
    return a.profileId === b.profileId;
  }
  return true;
}

/** Stable string for use as a React `key` or a Map key -- never used for equality logic itself (identityEquals is). */
export function identityKey(identity: Identity): string {
  if (identity.kind === "live" || identity.kind === "preview") return `${identity.kind}:${identity.profileId}`;
  return identity.kind;
}

type EpochState = { epoch: number; identity: Identity };

/**
 * WeakMap<QueryClient, ...>, matching the pattern already in production in
 * query-updates.ts (chainsByClient, inFlightThingIds) -- per-QueryClient
 * state that never leaks across independent clients (tests, SSR), no new
 * architecture introduced.
 */
const epochByClient = new WeakMap<QueryClient, EpochState>();

function currentState(qc: QueryClient): EpochState {
  let state = epochByClient.get(qc);
  if (!state) {
    state = { epoch: 0, identity: { kind: "pending" } };
    epochByClient.set(qc, state);
  }
  return state;
}

export function getIdentityEpoch(qc: QueryClient): EpochState {
  return currentState(qc);
}

/** Advances the epoch and records the new identity. Returns the new epoch number. */
export function advanceIdentityEpoch(qc: QueryClient, identity: Identity): number {
  const next = { epoch: currentState(qc).epoch + 1, identity };
  epochByClient.set(qc, next);
  return next.epoch;
}

export function isEpochCurrent(qc: QueryClient, capturedEpoch: number): boolean {
  return currentState(qc).epoch === capturedEpoch;
}

/**
 * Wraps a callback so it only runs if `capturedEpoch` is still current at
 * the moment of invocation. `capturedEpoch` must be read at the point the
 * mutation/timer/subscription this callback belongs to was CONSTRUCTED
 * (before any `await`, before `mutate()` is called) -- never re-read
 * "the current epoch" inside the callback itself, since by completion
 * time that would already be the new identity's epoch, making the check
 * a no-op tautology.
 *
 * This only guards the ENTRY to `fn` -- if `fn` is async and performs more
 * than one side-effecting phase (e.g. two sequential `invalidateQueries`
 * calls, then a toast, then a timer), it must re-check `isEpochCurrent`
 * itself after each `await` before each subsequent phase. A single
 * entry check does not protect work after an `await` -- the epoch can
 * advance while `fn` is suspended.
 *
 * Preserves `fn`'s return value (including a Promise) so a mutation's
 * `onSuccess`/`onError` still correctly gates settlement on it -- a
 * wrapper that discarded the return value would make `useMutation`
 * consider the mutation settled before an awaited side effect actually
 * finished.
 */
export function withEpochGuard<Args extends unknown[], Result>(
  qc: QueryClient,
  capturedEpoch: number,
  fn: (...args: Args) => Result,
): (...args: Args) => Result | undefined {
  return (...args: Args) => {
    if (!isEpochCurrent(qc, capturedEpoch)) return undefined;
    return fn(...args);
  };
}

/**
 * Wraps a timer callback (setTimeout/setInterval) so the epoch is checked
 * at FIRE time, not schedule time -- a timer captured under identity A
 * that fires after a switch to B is a late completion, the same category
 * as a late RPC response, and scheduling it under a since-advanced epoch
 * must not run its body.
 */
export function withEpochGuardedTimer(qc: QueryClient, capturedEpoch: number, fn: () => void): () => void {
  return () => {
    if (!isEpochCurrent(qc, capturedEpoch)) return;
    fn();
  };
}

/**
 * Small registry for identity-owned resources (P4's actor-cache
 * subscription, P7's realtime controller) that must be torn down on every
 * real identity change. Registering here is the ONLY thing a disposer
 * does at registration time -- actual disposal happens later, when
 * runRegisteredDisposers is called by the identity boundary.
 *
 * Disposer contract, enforced at review time (this module cannot verify
 * it automatically): teardown-only. A disposer must not read or write
 * QueryClient state, since it can run either just before or just after
 * the epoch has advanced depending on registration order -- ordering
 * hardened both ways (identity-boundary.tsx advances the epoch before
 * running disposers, AND disposers are required to be teardown-only) so
 * neither on its own has to be trusted alone.
 */
const disposersByClient = new WeakMap<QueryClient, Set<() => void>>();

export function registerIdentityDisposer(qc: QueryClient, dispose: () => void): () => void {
  let set = disposersByClient.get(qc);
  if (!set) {
    set = new Set();
    disposersByClient.set(qc, set);
  }
  set.add(dispose);
  return () => set!.delete(dispose);
}

export function runRegisteredDisposers(qc: QueryClient): void {
  const set = disposersByClient.get(qc);
  if (!set) return;
  for (const dispose of set) dispose();
}
