import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Conversation } from "./use-conversations";

/**
 * Device-local "last read" timestamp per conversation — same convention as
 * things/read-state.ts (Thing comments). Not synced across a user's devices;
 * that would need a server-side last_read_at per profile per conversation,
 * a larger follow-up if ever needed. Good enough to drive the chat-heads
 * dock's unread badges on the device where the app is actually open.
 */
const READ_STORAGE_PREFIX = "katalist_conversation_read_";
const READ_EVENT_NAME = "katalist-conversation-read";

export function getConversationLastReadAt(listId: string): number {
  if (typeof window === "undefined") return 0;
  try {
    const val = localStorage.getItem(`${READ_STORAGE_PREFIX}${listId}`);
    return val ? parseInt(val, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

export function markConversationAsRead(listId: string | null | undefined) {
  if (!listId || typeof window === "undefined") return;
  try {
    const now = Date.now();
    localStorage.setItem(`${READ_STORAGE_PREFIX}${listId}`, String(now));
    window.dispatchEvent(new CustomEvent(READ_EVENT_NAME, { detail: { listId, timestamp: now } }));
  } catch {
    // ignore local storage errors
  }
}

/** Re-renders callers whenever any conversation is marked read. */
export function useConversationReadState() {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => setVersion((v) => v + 1);
    window.addEventListener(READ_EVENT_NAME, handler);
    return () => window.removeEventListener(READ_EVENT_NAME, handler);
  }, []);

  return version;
}

/** True once a conversation's latest message is newer than its local
 *  last-read mark and wasn't sent by me. */
export function isConversationUnread(c: Conversation, myId: string | undefined, lastReadAt: number): boolean {
  if (!c.lastAt || !c.lastAuthorId || c.lastAuthorId === myId) return false;
  return new Date(c.lastAt).getTime() > lastReadAt;
}

/** Exact unread count for one conversation — a lightweight head-count query,
 *  only fired while that conversation is actually flagged unread. Shared by
 *  the chat-heads bubble and the Team Hub sidebar so both surfaces agree. */
export function useConversationUnreadCount(conversation: Conversation, myId: string | undefined): number {
  useConversationReadState();
  const lastReadAt = getConversationLastReadAt(conversation.id);
  const unread = isConversationUnread(conversation, myId, lastReadAt);
  const query = useQuery({
    queryKey: ["conversation-unread-count", conversation.id, lastReadAt, conversation.lastAt],
    enabled: unread,
    staleTime: 10_000,
    queryFn: async () => {
      const { count } = await supabase
        .from("list_messages")
        .select("id", { count: "exact", head: true })
        .eq("list_id", conversation.id)
        .is("deleted_at", null)
        .gt("created_at", new Date(lastReadAt).toISOString())
        .neq("author_profile_id", myId ?? "");
      return count ?? 0;
    },
  });
  if (!unread) return 0;
  return query.data ?? 1; // optimistic "1" while the exact count is still loading
}
