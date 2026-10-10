import type { QueryClient } from "@tanstack/react-query";
import { getIdentityEpoch, isEpochCurrent, registerIdentityDisposer } from "@/features/realtime/identity-cache-policy";

/**
 * D03: an identity-owned, in-memory-only draft store for composers
 * (chat/comment/notes text, plus already-uploaded-but-unsent attachment
 * descriptors) that must survive same-session navigation away from and
 * back to the same entity, but must NEVER follow a selection to a
 * *different* entity, and must never survive an identity switch (a B who
 * signs in on the same device must not see A's half-typed message).
 *
 * In-memory only, deliberately -- draft text can be sensitive, and this
 * store is not localStorage/sessionStorage. It is lost on a hard reload,
 * which is the accepted tradeoff (same as every other "session" store in
 * this codebase, e.g. local-state.ts's preview data).
 *
 * Key = identity epoch (not just "current identity", so a retired
 * identity's drafts are unreachable even before the disposer below has
 * run) + composer kind + entity id. Two different entities of the same
 * kind (two different List chats, two different Things' comment boxes)
 * never share a slot; the same entity keeps its draft across navigating
 * away and back within the same identity.
 */
export type DraftComposerKind =
  | "thing-comment"
  | "list-chat"
  | "bucket-note"
  | "magic-box"
  // Thing references staged beside a message/comment draft. Kept in their own slot so the main draft's
  // metadata (people mentions) keeps its shape; both are cleared together on send.
  | "list-chat-references"
  | "thing-comment-references";

export type Draft<T> = {
  /** Text/body content, whatever shape the composer needs. */
  value: T;
  /** Already-uploaded descriptors (e.g. { key, name, url }) kept across a
   *  failed send/save so a retry doesn't have to re-upload. Any blob/object
   *  URLs inside these are the composer's own responsibility to revoke --
   *  this store only holds the descriptors, not the underlying blobs. */
  attachments?: unknown[];
  /** Composer-specific selection metadata; kept with the same revision as text. */
  metadata?: unknown;
};

type StoredDraft<T> = Draft<T> & { epoch: number };

const draftsByClient = new WeakMap<QueryClient, Map<string, StoredDraft<unknown>>>();
// T02: a monotonically increasing edit count per (composer kind, entity),
// separate from the draft's own content/presence -- bumped by EVERY
// setDraft()/clearDraft() call, never reset or deleted alongside the
// draft entry itself. A caller that captures this at submit time and
// compares it after an await can tell "the user hasn't touched this
// composer since I submitted" from "the user typed something new, then
// deliberately cleared it back to empty" -- the latter is also an empty
// draft, but is NOT "unchanged", and a stale failed-submit restore must
// not overwrite that deliberate decision. Never reset even across a
// clearDraft(), and deliberately NOT scoped/reset by identity epoch --
// it only ever answers "did anything happen to this key since I looked",
// which is meaningful even across an epoch change (the answer is still
// "yes, something happened": the disposer clearing every draft on
// retirement is itself a change).
const revisionByClient = new WeakMap<QueryClient, Map<string, number>>();
const listenersByClient = new WeakMap<QueryClient, Map<string, Set<() => void>>>();
const disposerRegisteredFor = new WeakSet<QueryClient>();

function draftKey(composerKind: DraftComposerKind, entityId: string): string {
  return `${composerKind}:${entityId}`;
}

function storeFor(qc: QueryClient): Map<string, StoredDraft<unknown>> {
  let store = draftsByClient.get(qc);
  if (!store) {
    store = new Map();
    draftsByClient.set(qc, store);
  }
  return store;
}

function revisionsFor(qc: QueryClient): Map<string, number> {
  let store = revisionByClient.get(qc);
  if (!store) {
    store = new Map();
    revisionByClient.set(qc, store);
  }
  return store;
}

function bumpRevision(qc: QueryClient, key: string): void {
  const revisions = revisionsFor(qc);
  revisions.set(key, (revisions.get(key) ?? 0) + 1);
  for (const listener of listenersByClient.get(qc)?.get(key) ?? []) listener();
}

/** Lets every mounted composer for the same entity observe one draft slot. */
export function subscribeDraft(qc: QueryClient, composerKind: DraftComposerKind, entityId: string, listener: () => void): () => void {
  let byKey = listenersByClient.get(qc);
  if (!byKey) {
    byKey = new Map();
    listenersByClient.set(qc, byKey);
  }
  const key = draftKey(composerKind, entityId);
  let listeners = byKey.get(key);
  if (!listeners) {
    listeners = new Set();
    byKey.set(key, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners?.delete(listener);
    if (listeners?.size === 0) byKey?.delete(key);
  };
}

/** Current edit revision for this (composer kind, entity) pair -- 0 if it
 *  has never been written to or cleared. Capture this BEFORE submitting so
 *  a later restore-on-failure can tell whether the user has touched this
 *  composer since, regardless of what the draft's content looks like now. */
export function getDraftRevision(qc: QueryClient, composerKind: DraftComposerKind, entityId: string): number {
  return revisionsFor(qc).get(draftKey(composerKind, entityId)) ?? 0;
}

function ensureDisposerRegistered(qc: QueryClient) {
  if (disposerRegisteredFor.has(qc)) return;
  disposerRegisteredFor.add(qc);
  registerIdentityDisposer(qc, () => {
    draftsByClient.get(qc)?.clear();
    // Every draft this identity owned is being cleared -- from a would-be
    // restorer's perspective that's exactly as much "something happened
    // to this key" as the user editing it themselves.
    for (const key of revisionsFor(qc).keys()) bumpRevision(qc, key);
  });
}

/** Returns the draft for this exact (composer kind, entity) pair, or
 *  `undefined` if there isn't one, it belongs to a since-retired
 *  identity, or the epoch it was written under is no longer current. */
export function getDraft<T>(
  qc: QueryClient,
  composerKind: DraftComposerKind,
  entityId: string,
): Draft<T> | undefined {
  const stored = storeFor(qc).get(draftKey(composerKind, entityId)) as StoredDraft<T> | undefined;
  if (!stored || !isEpochCurrent(qc, stored.epoch)) return undefined;
  const { epoch: _epoch, ...draft } = stored;
  return draft;
}

/** Writes/replaces the draft for this (composer kind, entity) pair under
 *  the CURRENT epoch. A write attempted under an already-stale epoch
 *  (the caller captured its epoch before an `await`, and identity
 *  retired during it) is silently dropped -- writing a new identity's
 *  epoch here would misattribute stale content as belonging to the new
 *  identity instead of correctly discarding it. */
export function setDraft<T>(
  qc: QueryClient,
  composerKind: DraftComposerKind,
  entityId: string,
  draft: Draft<T>,
  capturedEpoch: number = getIdentityEpoch(qc).epoch,
): void {
  if (!isEpochCurrent(qc, capturedEpoch)) return;
  ensureDisposerRegistered(qc);
  const key = draftKey(composerKind, entityId);
  storeFor(qc).set(key, { ...draft, epoch: capturedEpoch });
  bumpRevision(qc, key);
}

/** Explicit discard/successful-send/confirmed-revoked-access clear for
 *  one (composer kind, entity) pair. Callers holding any blob/object URLs
 *  inside the draft's `attachments` must revoke them BEFORE calling this
 *  -- this only drops the store's own reference. */
export function clearDraft(qc: QueryClient, composerKind: DraftComposerKind, entityId: string): void {
  const key = draftKey(composerKind, entityId);
  // Only counts as an edit if there was actually something to clear --
  // an idempotent clear of an already-empty/already-cleared slot (e.g. the
  // write-through effect settling a clear a caller already made explicitly
  // and synchronously) must not look like a second, independent edit to a
  // revision comparison made in between.
  const existed = storeFor(qc).has(key);
  storeFor(qc).delete(key);
  if (existed) bumpRevision(qc, key);
}
