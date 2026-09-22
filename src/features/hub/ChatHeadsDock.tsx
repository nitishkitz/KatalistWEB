import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { ListChatPanel } from "@/features/lists/ListChatPanel";
import { cn } from "@/lib/utils";
import katalistMark from "@/assets/katalist-mark.png.asset.json";
import { useConversations, type Conversation } from "./use-conversations";
import { getConversationLastReadAt, markConversationAsRead, useConversationReadState } from "./chat-read-state";

const BUBBLE_SIZE = 52;
const DRAG_THRESHOLD_PX = 6;
const POSITION_STORAGE_KEY = "katalist_chat_bubble_pos";

function defaultPosition() {
  if (typeof window === "undefined") return { x: 16, y: 500 };
  return { x: 16, y: window.innerHeight - BUBBLE_SIZE - 24 };
}

function loadPosition(): { x: number; y: number } {
  if (typeof window === "undefined") return defaultPosition();
  try {
    const raw = localStorage.getItem(POSITION_STORAGE_KEY);
    if (!raw) return defaultPosition();
    const parsed = JSON.parse(raw) as { x: number; y: number };
    if (typeof parsed.x === "number" && typeof parsed.y === "number") return parsed;
  } catch {
    // ignore
  }
  return defaultPosition();
}

function clamp(value: number, max: number) {
  return Math.min(Math.max(0, value), Math.max(0, max));
}

/** True once a conversation's latest message is newer than its local
 *  last-read mark and wasn't sent by me. */
function isUnread(c: Conversation, myId: string | undefined, lastReadAt: number): boolean {
  if (!c.lastAt || !c.lastAuthorId || c.lastAuthorId === myId) return false;
  return new Date(c.lastAt).getTime() > lastReadAt;
}

/** Exact unread count for one conversation — a lightweight head-count query,
 *  only fired while that conversation is actually flagged unread. */
function useUnreadCount(conversation: Conversation, myId: string | undefined): number {
  useConversationReadState();
  const lastReadAt = getConversationLastReadAt(conversation.id);
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
  return query.data ?? 1; // optimistic "1" while the exact count is still loading
}

/** Renders nothing itself — reports its conversation's unread count up to
 *  the parent so the single launcher bubble can show a true total across
 *  every conversation, not just the ones visible in the switcher row. */
function UnreadReporter({
  conversation,
  myId,
  onChange,
}: {
  conversation: Conversation;
  myId: string | undefined;
  onChange: (id: string, count: number) => void;
}) {
  const count = useUnreadCount(conversation, myId);
  useEffect(() => onChange(conversation.id, count), [conversation.id, count, onChange]);
  return null;
}

function SwitcherBubble({
  conversation,
  myId,
  selected,
  onSelect,
}: {
  conversation: Conversation;
  myId: string | undefined;
  selected: boolean;
  onSelect: () => void;
}) {
  const count = useUnreadCount(conversation, myId);
  return (
    <button
      type="button"
      onClick={onSelect}
      title={conversation.title}
      className={cn(
        "relative shrink-0 rounded-full transition-transform hover:-translate-y-0.5",
        selected && "ring-2 ring-[#7b56fd] ring-offset-2",
      )}
    >
      <PersonAvatar name={conversation.title} src={conversation.avatarUrl} size={36} />
      {count > 0 ? (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-background bg-[#fc404d] px-0.5 text-[9px] font-semibold text-white">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </button>
  );
}

/**
 * A close, buildable analog of Messenger's mobile "Chat Heads": one
 * draggable circular launcher bubble (not one per conversation — a web page
 * can't draw over the OS/other apps like the original Android feature did,
 * so this stays confined to our own app; see the chat-heads discussion) with
 * a total-unread badge. Tapping it — as opposed to dragging it — expands a
 * small popover, anchored wherever the bubble currently sits, containing a
 * conversation switcher and an embedded mini chat. Nothing here navigates
 * away from whatever page you're on.
 */
export function ChatHeadsDock() {
  const { user } = useSession();
  const { conversations } = useConversations();
  const [pos, setPos] = useState(loadPosition);
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [unreadById, setUnreadById] = useState<Record<string, number>>({});
  const bubbleRef = useRef<HTMLButtonElement | null>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    startPos: { x: number; y: number };
    current: { x: number; y: number };
    moved: boolean;
  } | null>(null);

  const selected = conversations.find((c) => c.id === selectedId) ?? conversations[0] ?? null;

  useEffect(() => {
    if (open && selected) markConversationAsRead(selected.id);
  }, [open, selected]);

  const totalUnread = useMemo(
    () => Object.values(unreadById).reduce((sum, n) => sum + n, 0),
    [unreadById],
  );

  const onUnreadChange = (id: string, count: number) => setUnreadById((prev) => (prev[id] === count ? prev : { ...prev, [id]: count }));

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, startPos: pos, current: pos, moved: false };
  };

  // Move the bubble by writing directly to the DOM, not React state — a
  // setPos() per pointermove was re-rendering the whole dock (every
  // conversation's unread-count query included) up to 60+ times a second,
  // fighting the drag and making it feel broken/laggy. State is only
  // committed once, on release.
  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) drag.moved = true;
    if (!drag.moved) return;
    const maxX = window.innerWidth - BUBBLE_SIZE;
    const maxY = window.innerHeight - BUBBLE_SIZE;
    const next = { x: clamp(drag.startPos.x + dx, maxX), y: clamp(drag.startPos.y + dy, maxY) };
    drag.current = next;
    const el = bubbleRef.current;
    if (el) {
      el.style.left = `${next.x}px`;
      el.style.top = `${next.y}px`;
    }
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (drag.moved) {
      setPos(drag.current);
      try {
        localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(drag.current));
      } catch {
        // ignore storage errors
      }
      return;
    }
    // A tap, not a drag — toggle the popover.
    setOpen((o) => !o);
  };

  if (conversations.length === 0) return null;

  return (
    <>
      {conversations.map((c) => (
        <UnreadReporter key={c.id} conversation={c} myId={user?.id} onChange={onUnreadChange} />
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <button
            ref={bubbleRef}
            type="button"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            title="Chats"
            style={{ left: pos.x, top: pos.y, width: BUBBLE_SIZE, height: BUBBLE_SIZE, touchAction: "none" }}
            className="fixed z-40 flex items-center justify-center rounded-full bg-white shadow-lg outline-none ring-1 ring-black/10 cursor-grab active:cursor-grabbing"
          >
            <img src={katalistMark.url} alt="" className="h-7 w-7" />
            {totalUnread > 0 ? (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-background bg-[#fc404d] px-1 text-[10px] font-semibold text-white">
                {totalUnread > 99 ? "99+" : totalUnread}
              </span>
            ) : null}
          </button>
        </PopoverAnchor>
        <PopoverContent side="top" align="start" className="w-[320px] p-0" sideOffset={10}>
          {selected ? (
            <div className="flex h-[420px] flex-col overflow-hidden rounded-md">
              <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                <div className="flex flex-1 items-center gap-1.5 overflow-x-auto">
                  {conversations.slice(0, 12).map((c) => (
                    <SwitcherBubble
                      key={c.id}
                      conversation={c}
                      myId={user?.id}
                      selected={c.id === selected.id}
                      onSelect={() => {
                        setSelectedId(c.id);
                        markConversationAsRead(c.id);
                      }}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="truncate px-3 pt-2 text-[13px] font-semibold text-foreground">{selected.title}</p>
              <ListChatPanel listId={selected.id} placeholderName={selected.title} className="flex-1" />
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
    </>
  );
}
