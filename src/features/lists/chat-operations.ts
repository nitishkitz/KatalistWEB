import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isEpochCurrent, registerIdentityDisposer } from "@/features/realtime/identity-cache-policy";
import type { ChatAttachment } from "./use-list-messages";

export type ChatSendInput = {
  id: string;
  listId: string;
  authorId: string;
  epoch: number;
  body: string;
  kind: "message" | "system";
  attachment: ChatAttachment | null;
  mentionedProfileIds: string[];
  /** Source Thing IDs, in display order. Separate from people mentions; sending them notifies no one. */
  thingReferenceIds: string[];
  /** Two mounted composers submitting one draft revision are one operation. */
  draftRevision?: number;
};

export type ChatOperation = {
  input: ChatSendInput;
  delivery: "pending" | "sent" | "failed";
  error: string | null;
  at: string;
  completedAt?: number;
  restoredDraftRevision?: number;
  promise?: Promise<ChatSendResult>;
};

export type ChatSendResult = { id: string; inserted: boolean };

type Store = { operations: Map<string, ChatOperation>; revision: number; listeners: Set<() => void> };
const byClient = new WeakMap<QueryClient, Store>();

function storeFor(qc: QueryClient): Store {
  let store = byClient.get(qc);
  if (!store) {
    store = { operations: new Map(), revision: 0, listeners: new Set() };
    byClient.set(qc, store);
    registerIdentityDisposer(qc, () => {
      store?.operations.clear();
      notify(store!);
    });
  }
  return store;
}

function notify(store: Store): void {
  store.revision += 1;
  for (const listener of store.listeners) listener();
}

export function subscribeChatOperations(qc: QueryClient, listener: () => void): () => void {
  const store = storeFor(qc);
  store.listeners.add(listener);
  return () => store.listeners.delete(listener);
}

export function chatOperationsRevision(qc: QueryClient): number {
  return storeFor(qc).revision;
}

export function chatOperationsFor(qc: QueryClient, listId: string): ChatOperation[] {
  return [...storeFor(qc).operations.values()].filter((op) => op.input.listId === listId && isEpochCurrent(qc, op.input.epoch));
}

export function pendingChatOperationCount(qc: QueryClient): number {
  return [...storeFor(qc).operations.values()].filter((operation) =>
    operation.delivery === "pending" && isEpochCurrent(qc, operation.input.epoch)).length;
}

export function removeChatOperation(qc: QueryClient, id: string): void {
  const store = storeFor(qc);
  const operation = store.operations.get(id);
  if (!operation || operation.delivery === "pending") return;
  store.operations.delete(id);
  notify(store);
}

export function markChatOperationDraftRestored(qc: QueryClient, id: string, revision: number): void {
  const operation = storeFor(qc).operations.get(id);
  if (operation?.delivery === "failed") operation.restoredDraftRevision = revision;
}

/** A successful authoritative refetch supersedes sent overlays, including
 * ones already pushed out of the newest page by later traffic. */
export function acknowledgeChatOperations(qc: QueryClient, listId: string, fetchedAt: number): void {
  const store = storeFor(qc);
  let changed = false;
  for (const [id, operation] of store.operations) {
    if (operation.input.listId === listId && operation.delivery === "sent" &&
        operation.completedAt !== undefined && operation.completedAt <= fetchedAt) {
      store.operations.delete(id);
      changed = true;
    }
  }
  if (changed) notify(store);
}

function sameMessage(row: {
  id: string; list_id: string; author_profile_id: string; body: string; kind: string;
  attachment: unknown; mentioned_profile_ids: string[] | null; thing_reference_ids: string[] | null;
}, input: ChatSendInput): boolean {
  const storedAttachment = row.attachment as { key?: string; name?: string; mime?: string | null; size?: number | null } | null;
  return row.id === input.id && row.list_id === input.listId && row.author_profile_id === input.authorId &&
    row.body === input.body && row.kind === input.kind &&
    (storedAttachment?.key ?? null) === (input.attachment?.key ?? null) &&
    (storedAttachment?.name ?? null) === (input.attachment?.name ?? null) &&
    (storedAttachment?.mime ?? null) === (input.attachment?.mime ?? null) &&
    (storedAttachment?.size ?? null) === (input.attachment?.size ?? null) &&
    JSON.stringify([...(row.mentioned_profile_ids ?? [])].sort()) === JSON.stringify([...input.mentionedProfileIds].sort()) &&
    JSON.stringify(row.thing_reference_ids ?? []) === JSON.stringify(input.thingReferenceIds ?? []);
}

async function insertOrRecover(input: ChatSendInput): Promise<ChatSendResult> {
  const row = {
    id: input.id,
    list_id: input.listId,
    author_profile_id: input.authorId,
    body: input.body,
    kind: input.kind,
    attachment: input.attachment ? {
      key: input.attachment.key, name: input.attachment.name,
      mime: input.attachment.mime, size: input.attachment.size,
    } : null,
    mentioned_profile_ids: input.mentionedProfileIds,
    thing_reference_ids: input.thingReferenceIds ?? [],
  };
  const { error } = await supabase.from("list_messages").insert(row);
  if (!error) return { id: input.id, inserted: true };

  // A lost HTTP response can arrive after the INSERT committed. A retry uses
  // the same primary key. RLS gates this read; a collision is accepted only
  // when the authorized row matches the complete logical operation.
  const existing = await supabase.from("list_messages")
    .select("id,list_id,author_profile_id,body,kind,attachment,mentioned_profile_ids,thing_reference_ids")
    .eq("id", input.id).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) {
    if (!sameMessage(existing.data, input)) throw new Error("Message ID belongs to another send.");
    return { id: input.id, inserted: false };
  }
  throw error;
}

/** Claims synchronously, before the first network await. */
export function submitChatOperation(qc: QueryClient, input: ChatSendInput): Promise<ChatSendResult> {
  if (!isEpochCurrent(qc, input.epoch)) return Promise.reject(new Error("This chat session has ended."));
  const store = storeFor(qc);
  const existing = store.operations.get(input.id);
  if (existing?.promise && existing.delivery === "pending") return existing.promise;
  if (existing && existing.delivery !== "failed") return Promise.resolve({ id: input.id, inserted: false });
  const sameDraft = [...store.operations.values()].find((op) =>
    op.delivery === "pending" && op.input.listId === input.listId &&
    input.draftRevision !== undefined && op.input.draftRevision === input.draftRevision,
  );
  if (sameDraft?.promise) return sameDraft.promise;

  const operation: ChatOperation = existing ?? {
    input, delivery: "pending", error: null, at: new Date().toISOString(),
  };
  operation.delivery = "pending";
  operation.error = null;
  store.operations.set(input.id, operation);
  notify(store);

  operation.promise = (async () => {
    try {
      if (!isEpochCurrent(qc, input.epoch)) throw new Error("This chat session has ended.");
      const result = await insertOrRecover(input);
      if (isEpochCurrent(qc, input.epoch)) {
        operation.delivery = "sent";
        operation.completedAt = Date.now();
        notify(store);
      }
      return result;
    } catch (error) {
      if (isEpochCurrent(qc, input.epoch)) {
        operation.delivery = "failed";
        operation.error = error instanceof Error ? error.message : "Message could not be sent.";
        notify(store);
      }
      throw error;
    } finally {
      operation.promise = undefined;
    }
  })();
  return operation.promise;
}
