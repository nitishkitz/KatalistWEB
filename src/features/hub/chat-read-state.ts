import { useEffect, useState } from "react";

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
