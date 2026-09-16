import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const READ_STORAGE_PREFIX = "katalist_thing_read_";
const READ_EVENT_NAME = "katalist-thing-read";

export function getThingLastReadAt(thingId: string): number {
  if (typeof window === "undefined") return 0;
  try {
    const val = localStorage.getItem(`${READ_STORAGE_PREFIX}${thingId}`);
    return val ? parseInt(val, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

export function markThingAsRead(thingId: string | null | undefined) {
  if (!thingId || typeof window === "undefined") return;
  try {
    const now = Date.now();
    localStorage.setItem(`${READ_STORAGE_PREFIX}${thingId}`, String(now));
    window.dispatchEvent(new CustomEvent(READ_EVENT_NAME, { detail: { thingId, timestamp: now } }));

    // Also mark notifications for this thing as read in Supabase if any exist
    void supabase
      .from("notifications")
      .update({ read_at: new Date(now).toISOString() })
      .eq("thing_id", thingId)
      .is("read_at", null)
      .then(() => {
        // ignore errors
      });
  } catch {
    // ignore local storage errors
  }
}

export function useThingReadState() {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => {
      setVersion((v) => v + 1);
    };
    window.addEventListener(READ_EVENT_NAME, handler);
    return () => {
      window.removeEventListener(READ_EVENT_NAME, handler);
    };
  }, []);

  return version;
}

export function calculateCommentCounts(
  thingId: string,
  comments: Array<{
    authorActorId?: string | null;
    author?: string | null;
    createdAt?: string | null;
    at?: string | null;
  }>,
  currentActorId?: string | null,
  currentUserName?: string | null
): { commentCount: number; unreadCommentCount: number } {
  if (!comments || comments.length === 0) {
    return { commentCount: 0, unreadCommentCount: 0 };
  }

  const lastRead = getThingLastReadAt(thingId);
  let unread = 0;

  for (const c of comments) {
    // If the comment was authored by the current user, it is not unread to them
    const isMe =
      (Boolean(currentActorId) && c.authorActorId === currentActorId) ||
      (Boolean(currentUserName) && c.author === currentUserName);
    if (isMe) continue;

    const timeStr = c.createdAt || c.at;
    const commentTime = timeStr ? new Date(timeStr).getTime() : 0;

    // If never read (lastRead === 0) or comment timestamp is newer than lastRead
    if (lastRead === 0 || commentTime > lastRead) {
      unread++;
    }
  }

  return {
    commentCount: comments.length,
    unreadCommentCount: unread,
  };
}
