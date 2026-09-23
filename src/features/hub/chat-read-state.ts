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
 *
 * Scoped by profile id: this browser/device can be shared by more than one
 * signed-in account (a shared machine, or preview mode followed by a real
 * sign-in), and an unscoped key would leak one profile's read/unread state
 * onto another's conversations. A pre-scoping build of this feature wrote a
 * single unscoped `${READ_STORAGE_PREFIX}${listId}` key; that legacy value is
 * never read as a fallback for a *different* profile (there is no way to
 * know which profile actually wrote it), so on first scoped read for a given
 * profile+conversation this treats it as unset and starts fresh rather than
 * crediting the legacy value to whichever account happens to sign in next.
 * The legacy key is opportunistically removed on the next write so it can't
 * keep resurfacing in a future scan of localStorage.
 */
const READ_STORAGE_PREFIX = "katalist_conversation_read_";
const LEGACY_UNSCOPED_PREFIX = "katalist_conversation_read_";
const READ_EVENT_NAME = "katalist-conversation-read";

function scopedKey(profileId: string, listId: string): string {
  return `${READ_STORAGE_PREFIX}${profileId}_${listId}`;
}

export function getConversationLastReadAt(listId: string, profileId: string | undefined): number {
  if (!profileId || typeof window === "undefined") return 0;
  try {
    const val = localStorage.getItem(scopedKey(profileId, listId));
    return val ? parseInt(val, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

export function markConversationAsRead(listId: string | null | undefined, profileId: string | undefined) {
  if (!listId || !profileId || typeof window === "undefined") return;
  try {
    const now = Date.now();
    localStorage.setItem(scopedKey(profileId, listId), String(now));
    // Best-effort cleanup of the pre-scoping unscoped key -- never read, only removed.
    localStorage.removeItem(`${LEGACY_UNSCOPED_PREFIX}${listId}`);
    window.dispatchEvent(new CustomEvent(READ_EVENT_NAME, { detail: { listId, profileId, timestamp: now } }));
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
  const lastReadAt = getConversationLastReadAt(conversation.id, myId);
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

/** How many unread messages in this conversation actually @mention me — a
 *  strict subset of the unread count above. Same gating (only queries while
 *  the conversation is flagged unread at all) to avoid a query per
 *  conversation on every render. */
export function useConversationMentionCount(conversation: Conversation, myId: string | undefined): number {
  useConversationReadState();
  const lastReadAt = getConversationLastReadAt(conversation.id, myId);
  const unread = isConversationUnread(conversation, myId, lastReadAt);
  const query = useQuery({
    queryKey: ["conversation-mention-count", conversation.id, lastReadAt, conversation.lastAt, myId],
    enabled: unread && Boolean(myId),
    staleTime: 10_000,
    queryFn: async () => {
      const { count } = await supabase
        .from("list_messages")
        .select("id", { count: "exact", head: true })
        .eq("list_id", conversation.id)
        .is("deleted_at", null)
        .gt("created_at", new Date(lastReadAt).toISOString())
        .neq("author_profile_id", myId ?? "")
        .contains("mentioned_profile_ids", [myId]);
      return count ?? 0;
    },
  });
  if (!unread || !myId) return 0;
  return query.data ?? 0; // unlike unread count, no optimistic guess — a mention is specific enough to wait for
}
