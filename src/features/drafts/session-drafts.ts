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
  | "magic-box";

export type Draft<T> = {
  /** Text/body content, whatever shape the composer needs. */
  value: T;
  /** Already-uploaded descriptors (e.g. { key, name, url }) kept across a
   *  failed send/save so a retry doesn't have to re-upload. Any blob/object
   *  URLs inside these are the composer's own responsibility to revoke --
   *  this store only holds the descriptors, not the underlying blobs. */
  attachments?: unknown[];
};

type StoredDraft<T> = Draft<T> & { epoch: number };

const draftsByClient = new WeakMap<QueryClient, Map<string, StoredDraft<unknown>>>();
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

function ensureDisposerRegistered(qc: QueryClient) {
  if (disposerRegisteredFor.has(qc)) return;
  disposerRegisteredFor.add(qc);
  registerIdentityDisposer(qc, () => {
    draftsByClient.get(qc)?.clear();
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
  storeFor(qc).set(draftKey(composerKind, entityId), { ...draft, epoch: capturedEpoch });
}

/** Explicit discard/successful-send/confirmed-revoked-access clear for
 *  one (composer kind, entity) pair. Callers holding any blob/object URLs
 *  inside the draft's `attachments` must revoke them BEFORE calling this
 *  -- this only drops the store's own reference. */
export function clearDraft(qc: QueryClient, composerKind: DraftComposerKind, entityId: string): void {
  storeFor(qc).delete(draftKey(composerKind, entityId));
}
