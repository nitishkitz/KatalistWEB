import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { useConversations, type Conversation } from "./use-conversations";
import { getConversationLastReadAt, markConversationAsRead, useConversationReadState } from "./chat-read-state";

const MAX_BUBBLES = 5;

/** True once the conversation's latest message is newer than the local
 *  last-read mark and wasn't sent by me. */
function isUnread(c: Conversation, myId: string | undefined, lastReadAt: number): boolean {
  if (!c.lastAt || !c.lastAuthorId || c.lastAuthorId === myId) return false;
  return new Date(c.lastAt).getTime() > lastReadAt;
}

/** Exact unread count for one conversation — a lightweight head-count query,
 *  only fired for the handful of conversations the dock actually renders
 *  (not all of them), so this stays cheap without any new backend. */
function useUnreadCount(conversation: Conversation, myId: string | undefined, lastReadAt: number): number {
  const unread = isUnread(conversation, myId, lastReadAt);
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
  // Optimistic "1" while the exact count is still loading, rather than 0
  // (which would hide the badge for a moment we already know is unread).
  return query.data ?? 1;
}

function ChatHeadBubble({ conversation, myId }: { conversation: Conversation; myId: string | undefined }) {
  const navigate = useNavigate();
  useConversationReadState(); // re-render when any conversation is marked read
  const lastReadAt = getConversationLastReadAt(conversation.id);
  const unreadCount = useUnreadCount(conversation, myId, lastReadAt);

  return (
    <button
      type="button"
      onClick={() => {
        markConversationAsRead(conversation.id);
        void navigate({ to: "/team/$conversationId", params: { conversationId: conversation.id } });
      }}
      title={conversation.title}
      className="relative shrink-0 rounded-full transition-transform hover:-translate-y-0.5"
    >
      <PersonAvatar name={conversation.title} src={conversation.avatarUrl} size={44} />
      {unreadCount > 0 ? (
        <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-background bg-[#fc404d] px-1 text-[10px] font-semibold text-white">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      ) : null}
    </button>
  );
}

/**
 * A close, buildable analog of Messenger's "Chat Heads": a small persistent
 * row of avatar bubbles for recent conversations with unread badges. Unlike
 * the original Android feature, this can only float over our own app — a
 * web page cannot draw over the OS desktop or other apps, so this stays an
 * in-app dock (see the chat-heads research/plan discussion), not a system
 * overlay. Clicking a bubble opens the conversation; a true inline mini-chat
 * popover anchored to the bubble is a possible larger follow-up, not built
 * here.
 */
export function ChatHeadsDock() {
  const { user } = useSession();
  const { conversations } = useConversations();
  if (conversations.length === 0) return null;

  const recent = conversations.slice(0, MAX_BUBBLES);

  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-40 flex items-end gap-2 md:bottom-6">
      {recent.map((c) => (
        <div key={c.id} className="pointer-events-auto">
          <ChatHeadBubble conversation={c} myId={user?.id} />
        </div>
      ))}
    </div>
  );
}
