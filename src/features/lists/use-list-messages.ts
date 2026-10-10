import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { acquireListChatChannel, broadcastListChatChange } from "@/features/lists/list-chat-channel-registry";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { addListMessage, getListMessages, pinListMessageLocal } from "@/features/things/local-state";
import { useLocalVersion } from "@/features/things/use-local-version";
import { matchProfile } from "@/features/people/directory";
import { isPersonallyShreddedList, usePersonalShred } from "@/features/things/personal-shred";
import { getIdentityEpoch, isEpochCurrent } from "@/features/realtime/identity-cache-policy";
import { clearDraft, getDraftRevision, setDraft } from "@/features/drafts/session-drafts";
import { flattenHistory, type HistoryCursor } from "@/lib/history-pages";
import { classifyAsyncError } from "@/lib/query-policy";
import { fetchListAttachmentPage, fetchListMessagesPage, fetchListSystemPage, fetchPinnedListMessagesPage, searchListMessagesPage } from "./fetch-list-message-pages";
import {
  acknowledgeChatOperations, chatOperationsFor, chatOperationsRevision, markChatOperationDraftRestored, removeChatOperation, submitChatOperation, subscribeChatOperations,
  type ChatSendInput,
} from "./chat-operations";
import { mergeChatFeed } from "./chat-feed-model";
import { sanitizeThingReferences, type ThingReference } from "@/features/thing-references/thing-reference";

const CHAT_BUCKET = "list-chat";
const isConfirmedAccessLoss = (error: unknown) => error != null &&
  ["unauthenticated", "forbidden", "not-found"].includes(classifyAsyncError(error));

export type ChatAttachment = {
  key: string;
  name: string;
  mime: string | null;
  size: number | null;
  /** Fresh signed URL, minted at fetch time (not persisted). */
  url?: string;
};

export type ListChatMessage = {
  id: string;
  body: string;
  author: string;
  authorId: string | null;
  avatarUrl: string | null;
  at: string;
  kind: "message" | "system";
  attachment: ChatAttachment | null;
  pinnedAt: string | null;
  mentionedProfileIds: string[];
  thingReferences: ThingReference[];
  delivery?: "pending" | "sent" | "failed";
  error?: string | null;
};

export type SendMessageRequest = {
  body: string;
  attachment?: ChatAttachment | null;
  mentionedProfileIds?: string[];
  thingReferences?: ThingReference[];
  /** The draft revision captured when the composer cleared its submitted text. */
  draftRevision?: number;
};

export function useListMessages(listId: string) {
  const { session, user } = useSession();
  const preview = isPreviewSession(session);
  const qc = useQueryClient();
  const shred = usePersonalShred();
  const hidden = isPersonallyShreddedList(listId, shred);
  useLocalVersion();

  const query = useInfiniteQuery({
    queryKey: ["list-messages", listId, "pages"],
    queryFn: ({ pageParam, signal }) => fetchListMessagesPage(qc, listId, pageParam, signal),
    initialPageParam: null as HistoryCursor | null,
    getNextPageParam: (page) => page.nextCursor,
    enabled: Boolean(listId) && !preview && !hidden,
    staleTime: 10_000,
  });
  const accessLost = isConfirmedAccessLoss(query.error);
  useEffect(() => {
    if (accessLost && listId) clearDraft(qc, "list-chat", listId);
  }, [accessLost, listId, qc]);

  const subscribeOperations = useCallback((listener: () => void) => subscribeChatOperations(qc, listener), [qc]);
  const operationSnapshot = useCallback(() => chatOperationsRevision(qc), [qc]);
  useSyncExternalStore(subscribeOperations, operationSnapshot, () => 0);
  const operations = chatOperationsFor(qc, listId);
  useEffect(() => {
    if (query.dataUpdatedAt > 0) acknowledgeChatOperations(qc, listId, query.dataUpdatedAt);
  }, [qc, listId, query.dataUpdatedAt]);

  const invalidate = (targetListId: string, epoch: number) => {
    if (!isEpochCurrent(qc, epoch)) return;
    void qc.invalidateQueries({ queryKey: ["list-messages", targetListId] });
    void qc.invalidateQueries({ queryKey: ["list-message-attachments", targetListId] });
    void qc.invalidateQueries({ queryKey: ["list-system-history", targetListId] });
    void qc.invalidateQueries({ queryKey: ["list-message-search", targetListId] });
    void qc.invalidateQueries({ queryKey: ["list-pinned-messages", targetListId] });
    void qc.invalidateQueries({ queryKey: ["lists"] });
    void qc.invalidateQueries({ queryKey: ["hub-conversations"] });
    broadcastListChatChange(targetListId);
  };

  useEffect(() => {
    if (!listId || preview || hidden || accessLost) return;
    return acquireListChatChannel(listId, () => {
      void qc.invalidateQueries({ queryKey: ["list-messages", listId] });
      void qc.invalidateQueries({ queryKey: ["list-message-attachments", listId] });
      void qc.invalidateQueries({ queryKey: ["list-system-history", listId] });
      void qc.invalidateQueries({ queryKey: ["list-message-search", listId] });
      void qc.invalidateQueries({ queryKey: ["list-pinned-messages", listId] });
    });
  }, [listId, preview, hidden, accessLost, qc]);

  const notifyMessage = (input: ChatSendInput) => {
    const token = session?.access_token;
    if (!token || !isEpochCurrent(qc, input.epoch)) return;
    void fetch("/api/hub/notify-message", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ listId: input.listId, messageId: input.id }),
    }).catch(() => {
      // Push is best effort. A later retry is safe because the server claims
      // notification delivery by the persisted message ID.
    });
  };

  const execute = async (input: ChatSendInput) => {
    const result = await submitChatOperation(qc, input);
    if (isEpochCurrent(qc, input.epoch)) {
      invalidate(input.listId, input.epoch);
      if (input.kind === "message") notifyMessage({ ...input, id: result.id });
    }
    return result;
  };

  const sendAsync = (request: string | SendMessageRequest) => {
    const body = typeof request === "string" ? request : request.body;
    const attachment = typeof request === "string" ? null : request.attachment ?? null;
    const mentionedProfileIds = typeof request === "string" ? [] : request.mentionedProfileIds ?? [];
    const thingReferences = typeof request === "string" ? [] : sanitizeThingReferences(request.thingReferences);
    const draftRevision = typeof request === "string" ? undefined : request.draftRevision;
    const targetListId = listId;
    const epoch = getIdentityEpoch(qc).epoch;
    if (hidden || accessLost) return Promise.reject(new Error("That List isn’t available."));
    if (!body.trim() && !attachment && thingReferences.length === 0) return Promise.reject(new Error("Write a message, attach a file, or add a Thing."));
    if (preview) {
      addListMessage(targetListId, body, "Me", thingReferences.map((ref) => ref.thingId));
      return Promise.resolve({ id: crypto.randomUUID(), inserted: true });
    }
    if (!user?.id) return Promise.reject(new Error("Sign in to chat."));
    const input: ChatSendInput = {
      id: crypto.randomUUID(), listId: targetListId, authorId: user.id, epoch,
      body: body.trim(), kind: "message", attachment,
      mentionedProfileIds: [...new Set(mentionedProfileIds)], draftRevision,
      thingReferenceIds: thingReferences.map((ref) => ref.thingId),
    };
    return execute(input).catch((error: unknown) => {
      if (draftRevision !== undefined && isEpochCurrent(qc, epoch) &&
          getDraftRevision(qc, "list-chat", targetListId) === draftRevision) {
        setDraft(qc, "list-chat", targetListId, { value: body, attachments: attachment ? [attachment] : undefined }, epoch);
        if (thingReferences.length) setDraft(qc, "list-chat-references", targetListId, { value: thingReferences }, epoch);
        markChatOperationDraftRestored(qc, input.id, getDraftRevision(qc, "list-chat", targetListId));
      }
      throw error;
    });
  };

  const sendSystemAsync = async (body: string) => {
    const targetListId = listId;
    const epoch = getIdentityEpoch(qc).epoch;
    if (hidden || accessLost || preview || !user?.id) return;
    await execute({
      id: crypto.randomUUID(), listId: targetListId, authorId: user.id, epoch,
      body, kind: "system", attachment: null, mentionedProfileIds: [], thingReferenceIds: [],
    });
  };

  const pin = useMutation({
    mutationFn: async ({ messageId, pinned }: { messageId: string; pinned: boolean }) => {
      const epoch = getIdentityEpoch(qc).epoch;
      const targetListId = listId;
      if (hidden || accessLost) throw new Error("That List isn’t available.");
      if (preview) {
        pinListMessageLocal(targetListId, messageId, pinned);
        return { epoch, targetListId };
      }
      const { error } = await supabase.rpc("pin_list_message", { p_message_id: messageId, p_pinned: pinned });
      if (error) throw error;
      return { epoch, targetListId };
    },
    onSuccess: ({ epoch, targetListId }) => invalidate(targetListId, epoch),
  });

  const uploadAttachment = async (file: File): Promise<ChatAttachment> => {
    const targetListId = listId;
    const authorId = user?.id;
    const epoch = getIdentityEpoch(qc).epoch;
    if (!authorId) throw new Error("Sign in to attach files.");
    if (hidden || accessLost) throw new Error("That List isn’t available.");
    const safeName = file.name.replace(/[^\w.-]+/g, "_").slice(0, 80) || "file";
    const key = `${targetListId}/${authorId}/${crypto.randomUUID()}-${safeName}`;
    if (!isEpochCurrent(qc, epoch)) throw new Error("This chat session has ended.");
    const { error } = await supabase.storage.from(CHAT_BUCKET).upload(key, file, {
      contentType: file.type || undefined, upsert: false,
    });
    if (error) throw error;
    if (!isEpochCurrent(qc, epoch)) throw new Error("This chat session has ended.");
    return { key, name: file.name, mime: file.type || null, size: file.size };
  };

  const serverRows = flattenHistory(query.data?.pages);
  const merged = mergeChatFeed(serverRows, operations, {
    name: user?.user_metadata?.display_name || user?.email?.split("@")[0] || "Me",
    avatarUrl: (user?.user_metadata?.avatar_url as string | undefined) ?? null,
  });
  const messages: ListChatMessage[] = hidden || accessLost ? [] : preview ? getListMessages(listId).map((m) => ({
    id: m.id, body: m.body, author: m.author, authorId: null, avatarUrl: null, at: m.at,
    kind: m.kind ?? "message", attachment: m.attachment ?? null, pinnedAt: m.pinnedAt, mentionedProfileIds: [], thingReferences: sanitizeThingReferences((m.thingReferenceIds ?? []).map((thingId) => ({ version: 1, thingId }))), delivery: "sent" as const,
  })) : merged;

  return {
    messages,
    pinnedMessages: messages.filter((message) => message.pinnedAt),
    send: {
      mutateAsync: sendAsync,
      mutate: (request: string | SendMessageRequest) => { void sendAsync(request).catch(() => {}); },
      isPending: operations.some((operation) => operation.delivery === "pending" && operation.input.kind === "message"),
    },
    sendSystem: {
      mutateAsync: sendSystemAsync,
      mutate: (body: string) => { void sendSystemAsync(body).catch(() => {}); },
    },
    retry: (id: string) => {
      if (hidden || accessLost) return Promise.reject(new Error("That List isn’t available."));
      const operation = chatOperationsFor(qc, listId).find((item) => item.input.id === id && item.delivery === "failed");
      if (!operation) return Promise.reject(new Error("This message is no longer available for retry."));
      return execute(operation.input).then((result) => {
        if (isEpochCurrent(qc, operation.input.epoch) && operation.restoredDraftRevision !== undefined &&
            getDraftRevision(qc, "list-chat", operation.input.listId) === operation.restoredDraftRevision) {
          clearDraft(qc, "list-chat", operation.input.listId);
        }
        return result;
      });
    },
    removeFailed: (id: string) => removeChatOperation(qc, id),
    pin,
    uploadAttachment,
    accessLost,
    isLoading: !preview && !hidden && query.isLoading,
    error: query.error,
    hasMore: query.hasNextPage,
    isLoadingOlder: query.isFetchingNextPage,
    olderError: query.isFetchNextPageError,
    loadOlder: () => query.fetchNextPage(),
  };
}

/** Server search covers unloaded pages; consumers debounce and scope by List. */
export function useListMessageSearch(listId: string, search: string) {
  const { session } = useSession();
  const qc = useQueryClient();
  const preview = isPreviewSession(session);
  const normalized = search.trim();
  const query = useInfiniteQuery({
    queryKey: ["list-message-search", listId, normalized],
    enabled: Boolean(listId) && !preview && normalized.length >= 2 && normalized.length <= 80,
    queryFn: ({ pageParam, signal }) => searchListMessagesPage(qc, listId, normalized, pageParam, signal),
    initialPageParam: null as HistoryCursor | null,
    getNextPageParam: (page) => page.nextCursor,
    staleTime: 10_000,
  });
  return {
    data: isConfirmedAccessLoss(query.error) ? undefined : query.data ? flattenHistory(query.data.pages).reverse() : undefined,
    isFetching: query.isFetching,
    error: query.error,
    hasMore: query.hasNextPage,
    isLoadingMore: query.isFetchingNextPage,
    loadMore: () => query.fetchNextPage(),
  };
}

export function useListAttachmentHistory(listId: string) {
  const { session } = useSession();
  const qc = useQueryClient();
  const preview = isPreviewSession(session);
  const query = useInfiniteQuery({
    queryKey: ["list-message-attachments", listId],
    enabled: Boolean(listId) && !preview,
    queryFn: ({ pageParam, signal }) => fetchListAttachmentPage(qc, listId, pageParam, signal),
    initialPageParam: null as HistoryCursor | null,
    getNextPageParam: (page) => page.nextCursor,
  });
  return {
    messages: isConfirmedAccessLoss(query.error) ? [] : flattenHistory(query.data?.pages).reverse(),
    isLoading: query.isLoading,
    error: query.error,
    hasMore: query.hasNextPage,
    isLoadingMore: query.isFetchingNextPage,
    loadMore: () => query.fetchNextPage(),
  };
}

export function useListSystemHistory(listId: string, enabled = true) {
  const { session } = useSession();
  const qc = useQueryClient();
  const preview = isPreviewSession(session);
  const query = useInfiniteQuery({
    queryKey: ["list-system-history", listId],
    enabled: Boolean(listId) && !preview && enabled,
    queryFn: ({ pageParam, signal }) => fetchListSystemPage(qc, listId, pageParam, signal),
    initialPageParam: null as HistoryCursor | null,
    getNextPageParam: (page) => page.nextCursor,
  });
  return {
    messages: isConfirmedAccessLoss(query.error) ? [] : flattenHistory(query.data?.pages).reverse(),
    error: query.error,
    hasMore: query.hasNextPage,
    isLoadingMore: query.isFetchingNextPage,
    loadMore: () => query.fetchNextPage(),
  };
}

export function useListPinnedMessages(listId: string) {
  const { session } = useSession();
  const qc = useQueryClient();
  const preview = isPreviewSession(session);
  const query = useInfiniteQuery({
    queryKey: ["list-pinned-messages", listId],
    enabled: Boolean(listId) && !preview,
    queryFn: ({ pageParam, signal }) => fetchPinnedListMessagesPage(qc, listId, pageParam, signal),
    initialPageParam: null as HistoryCursor | null,
    getNextPageParam: (page) => page.nextCursor,
  });
  return {
    messages: isConfirmedAccessLoss(query.error) ? [] : flattenHistory(query.data?.pages).reverse(),
    hasMore: query.hasNextPage,
    isLoadingMore: query.isFetchingNextPage,
    loadMore: () => query.fetchNextPage(),
    error: query.error,
  };
}

export { matchProfile };
