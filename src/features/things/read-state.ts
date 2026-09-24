import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const READ_STORAGE_PREFIX = "katalist_thing_read_";
const LEGACY_UNSCOPED_PREFIX = "katalist_thing_read_";
const READ_EVENT_NAME = "katalist-thing-read";

// T05: the storage key used to be bare `${prefix}${thingId}`, with no
// identity scoping at all -- same hazard, same fix shape, as chat-read-
// state.ts's own identical scoping (see its doc comment): on a shared
// device (or a browser profile more than one account signs into), one
// profile's "read" marker for a Thing silently applied to a different
// profile's own view of that same Thing. Without a known identity, this
// is now a no-op (matching chat-read-state.ts) rather than falling into
// a shared "unscoped" bucket that a later identity could still collide
// on. The pre-scoping legacy unscoped key is never read as a fallback for
// any specific identity -- only opportunistically removed on the next
// scoped write, so it can't keep resurfacing.
function scopedKey(thingId: string, profileId: string): string {
  return `${READ_STORAGE_PREFIX}${profileId}_${thingId}`;
}

export function getThingLastReadAt(thingId: string, profileId?: string | null): number {
  if (!profileId || typeof window === "undefined") return 0;
  try {
    const val = localStorage.getItem(scopedKey(thingId, profileId));
    return val ? parseInt(val, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

export function markThingAsRead(thingId: string | null | undefined, profileId?: string | null) {
  if (!thingId || !profileId || typeof window === "undefined") return;
  try {
    const now = Date.now();
    localStorage.setItem(scopedKey(thingId, profileId), String(now));
    // Best-effort cleanup of the pre-scoping unscoped key -- never read, only removed.
    localStorage.removeItem(`${LEGACY_UNSCOPED_PREFIX}${thingId}`);
    window.dispatchEvent(new CustomEvent(READ_EVENT_NAME, { detail: { thingId, profileId, timestamp: now } }));

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

  // T05: currentActorId is ALSO the identity this "read" state is scoped
  // to -- each profile has at most one actor row (actors.profile_id is
  // unique), so it's just as good an anti-collision key as the profile id
  // itself, and unlike profile id it's already threaded through every
  // caller of this function.
  const lastRead = getThingLastReadAt(thingId, currentActorId);
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
