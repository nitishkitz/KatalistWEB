import { isValidElement, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { toast, useSonner } from "sonner";
import { AlertCircle, CheckCircle2, Info, MessageCircle, PictureInPicture2, X } from "lucide-react";
import { useSession } from "@/hooks/useSession";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { CourtDetailModal } from "@/features/court/CourtDetailModal";
import { ListChatPanel } from "@/features/lists/ListChatPanel";
import { useNotifications } from "@/features/notifications/use-notifications";
import { useThing } from "@/features/things/use-thing";
import { cn } from "@/lib/utils";
import { CoeyChatHeadArtwork } from "./CoeyChatHeadArtwork";
import { useConversations, type Conversation } from "./use-conversations";
import { markConversationAsRead, useConversationUnreadCount } from "./chat-read-state";

const BUBBLE_SIZE = 52;
const VIEWPORT_INSET = 12;
const DRAG_THRESHOLD_PX = 6;
const PREVIEW_DURATION_MS = 4400;
const POSITION_STORAGE_KEY = "katalist_chat_bubble_pos";
const OPEN_ASSIGNED_THING_EVENT = "katalist:open-assigned-thing";
type ActivityToast = ReturnType<typeof useSonner>["toasts"][number] & {
  receivedAt: number;
  read: boolean;
};
let activityOwnerId: string | undefined;
let activityCache: ActivityToast[] = [];
let seenToastCache = new Set<string | number>();

function activityForUser(userId: string | undefined) {
  if (typeof window === "undefined") return [];
  if (activityOwnerId !== userId) {
    activityOwnerId = userId;
    activityCache = [];
    seenToastCache = new Set();
  }
  return activityCache;
}

function toastContent(value: ReactNode | (() => ReactNode)) {
  return typeof value === "function" ? value() : value;
}

function ActivityFeed({ items, onClose }: { items: ActivityToast[]; onClose: () => void }) {
  return (
    <div
      data-chat-head-activity
      style={{
        height: "min(460px, calc(var(--radix-popover-content-available-height, 520px) - 60px))",
      }}
      className="flex flex-col overflow-hidden bg-white"
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {items.length === 0 ? (
          <p className="px-3 py-10 text-center text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          items.map((item) => {
            const Icon =
              item.type === "error" || item.type === "warning"
                ? AlertCircle
                : item.type === "success"
                  ? CheckCircle2
                  : Info;
            const color =
              item.type === "error" || item.type === "warning"
                ? "bg-red-50 text-red-600"
                : item.type === "success"
                  ? "bg-emerald-50 text-emerald-600"
                  : "bg-violet-50 text-violet-600";
            const action = item.action;
            return (
              <div key={item.id} className="flex gap-3 rounded-xl px-2 py-3 hover:bg-[#f8f6fc]">
                <span
                  className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${color}`}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1 text-sm">
                  <div className="break-words font-medium text-foreground">
                    {toastContent(item.title)}
                  </div>
                  {item.description ? (
                    <div className="mt-0.5 break-words text-xs text-muted-foreground">
                      {toastContent(item.description)}
                    </div>
                  ) : null}
                  {action &&
                    (isValidElement(action) ? (
                      action
                    ) : typeof action === "object" && "label" in action ? (
                      <button
                        type="button"
                        className="mt-2 text-xs font-semibold text-violet-700 hover:underline"
                        onClick={(event) => {
                          action.onClick(event);
                          onClose();
                        }}
                      >
                        {action.label}
                      </button>
                    ) : null)}
                </div>
                <time className="shrink-0 pt-0.5 text-[11px] text-muted-foreground">
                  {new Date(item.receivedAt).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </time>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/** Not yet in TypeScript's DOM lib (the API itself is still a Draft
 *  Community Group Report) — minimal shape for what this file uses. */
type PipWindow = Window & { document: Document };
interface DocumentPictureInPicture {
  requestWindow(options?: { width?: number; height?: number }): Promise<PipWindow>;
}
function getDocumentPip(): DocumentPictureInPicture | null {
  if (typeof window === "undefined") return null;
  return (
    (window as unknown as { documentPictureInPicture?: DocumentPictureInPicture })
      .documentPictureInPicture ?? null
  );
}

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
    if (typeof parsed.x === "number" && typeof parsed.y === "number") {
      return {
        x: clamp(parsed.x, window.innerWidth - BUBBLE_SIZE - VIEWPORT_INSET),
        y: clamp(parsed.y, window.innerHeight - BUBBLE_SIZE - VIEWPORT_INSET),
      };
    }
  } catch {
    // ignore
  }
  return defaultPosition();
}

function clamp(value: number, max: number) {
  return Math.min(Math.max(0, value), Math.max(0, max));
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
  onChange: (id: string, count: number | "unknown") => void;
}) {
  const count = useConversationUnreadCount(conversation, myId);
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
  const count = useConversationUnreadCount(conversation, myId);
  return (
    <button
      type="button"
      onClick={onSelect}
      title={conversation.title}
      aria-label={`Open conversation: ${conversation.title}`}
      aria-pressed={selected}
      className={cn(
        "relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 p-[2px] transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected ? "border-[#7b56fd]" : "border-transparent",
      )}
    >
      <PersonAvatar
        name={conversation.title}
        src={conversation.kind === "group" ? conversation.coverUrl : conversation.avatarUrl}
        size={36}
      />
      <span
        aria-label={selected ? "Online" : "Offline"}
        title={selected ? "Online" : "Offline"}
        className={cn(
          "absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white",
          selected ? "bg-emerald-500" : "bg-slate-300",
        )}
      />
      {count === "unknown" ? (
        <span
          title="Unread count unavailable — retrying"
          className="absolute right-0 top-0 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-background bg-amber-500 px-0.5 text-[12px] font-semibold text-white"
        >
          ?
        </span>
      ) : count > 0 ? (
        <span className="absolute right-0 top-0 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-background bg-[#fc404d] px-0.5 text-[12px] font-semibold text-white">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </button>
  );
}

function MiniChatContent({
  conversations,
  selected,
  myId,
  onSelect,
  onClose,
  pipSupported,
  poppedOut,
  onPopOut,
}: {
  conversations: Conversation[];
  selected: Conversation;
  myId: string | undefined;
  onSelect: (id: string) => void;
  onClose: () => void;
  pipSupported: boolean;
  poppedOut: boolean;
  onPopOut: () => void;
}) {
  const headerActions = (
    <div className="flex items-center gap-1">
      {pipSupported && !poppedOut ? (
        <button
          type="button"
          onClick={onPopOut}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#80758f] transition-colors hover:bg-[#f4f0fa] hover:text-[#59348c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title="Pop out — stays visible when you switch tabs or minimize the browser"
          aria-label="Pop out chat"
        >
          <PictureInPicture2 className="h-4 w-4" />
        </button>
      ) : null}
      <button
        type="button"
        onClick={onClose}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#80758f] transition-colors hover:bg-[#f4f0fa] hover:text-[#59348c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Close"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
  const conversationSwitcher = (
    <div className="flex min-w-0 items-center gap-2 overflow-x-auto py-1 [scrollbar-width:none]">
      {conversations.slice(0, 12).map((conversation) => (
        <SwitcherBubble
          key={conversation.id}
          conversation={conversation}
          myId={myId}
          selected={conversation.id === selected.id}
          onSelect={() => onSelect(conversation.id)}
        />
      ))}
    </div>
  );
  return (
    <div
      style={
        poppedOut
          ? { height: 460 }
          : {
              height:
                "min(460px, calc(var(--radix-popover-content-available-height, 520px) - 60px))",
            }
      }
      className="flex flex-col overflow-hidden bg-white"
    >
      <ListChatPanel
        listId={selected.id}
        placeholderName={selected.title}
        headerActions={headerActions}
        topContent={conversationSwitcher}
        className="flex-1"
      />
    </div>
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
 *
 * The mini chat can also "pop out" into a real always-on-top OS window via
 * the Document Picture-in-Picture API, where supported — that's the only
 * way a web page can stay visible across a tab switch or a minimized
 * browser; a normal in-tab popover categorically cannot (see the chat-heads
 * "visible all the time" discussion). Feature-detected: browsers without
 * support just don't show the pop-out button, no degraded fallback needed
 * since the in-tab popover already works fully on its own.
 */
export function ChatHeadsDock() {
  const { user } = useSession();
  const { conversations } = useConversations();
  const notifications = useNotifications();
  const { toasts } = useSonner();
  const [pos, setPos] = useState(loadPosition);
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"updates" | "chats">("chats");
  const [activity, setActivity] = useState<ActivityToast[]>(() => activityForUser(user?.id));
  const [previewId, setPreviewId] = useState<string | number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assignedThingId, setAssignedThingId] = useState<string | null>(null);
  const assignedThing = useThing(assignedThingId);
  const seenAssignmentsRef = useRef<{ userId: string; startedAt: number; ids: Set<string> } | null>(
    null,
  );
  const [unreadById, setUnreadById] = useState<Record<string, number | "unknown">>({});
  const [pipWindow, setPipWindow] = useState<PipWindow | null>(null);
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
    if (!user?.id || notifications.isLoading) return;
    const assignments = notifications.items.filter(
      (item) => item.kind === "thing_assigned" && item.thingId,
    );
    const seen = seenAssignmentsRef.current;
    if (!seen || seen.userId !== user.id) {
      seenAssignmentsRef.current = {
        userId: user.id,
        startedAt: Date.now(),
        ids: new Set(assignments.map((item) => item.id)),
      };
      return;
    }
    const fresh = assignments.filter((item) => !seen.ids.has(item.id));
    assignments.forEach((item) => seen.ids.add(item.id));
    for (const item of fresh.reverse()) {
      if (Date.parse(item.createdAt) < seen.startedAt - 5_000 || !item.thingId) continue;
      const thingId = item.thingId;
      toast.info("New Thing assigned to you", {
        description: item.body || "Open your Court to review it.",
        action: {
          label: "Open Thing",
          onClick: () =>
            window.dispatchEvent(
              new CustomEvent(OPEN_ASSIGNED_THING_EVENT, {
                detail: { thingId, notificationId: item.id },
              }),
            ),
        },
      });
    }
  }, [notifications.isLoading, notifications.items, user?.id]);

  useEffect(() => {
    const handleOpenAssignedThing = (event: Event) => {
      const detail = (event as CustomEvent<{ thingId?: string; notificationId?: string }>).detail;
      if (!detail?.thingId) return;
      setOpen(false);
      setAssignedThingId(detail.thingId);
      if (detail.notificationId) notifications.markOne.mutate([detail.notificationId]);
    };
    window.addEventListener(OPEN_ASSIGNED_THING_EVENT, handleOpenAssignedThing);
    return () => window.removeEventListener(OPEN_ASSIGNED_THING_EVENT, handleOpenAssignedThing);
  }, [notifications.markOne]);
  const updateActivity = (update: (current: ActivityToast[]) => ActivityToast[]) => {
    setActivity((current) => {
      const next = update(current);
      activityCache = next;
      return next;
    });
  };

  useEffect(() => {
    if (!toasts.length) return;
    const incoming = toasts.filter((item) => !seenToastCache.has(item.id));
    if (!incoming.length) return;
    incoming.forEach((item) => seenToastCache.add(item.id));
    const receivedAt = Date.now();
    updateActivity((current) =>
      [...incoming.map((item) => ({ ...item, receivedAt, read: false })), ...current].slice(0, 50),
    );
    if (!open) setPreviewId(incoming[0].id);
  }, [toasts, open]);

  useEffect(() => {
    if (previewId === null) return;
    const timer = window.setTimeout(() => setPreviewId(null), PREVIEW_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [previewId]);

  const unreadActivity = activity.filter((item) => !item.read).length;

  useEffect(() => {
    if (open && activeTab === "updates" && unreadActivity) {
      updateActivity((current) =>
        current.map((item) => (item.read ? item : { ...item, read: true })),
      );
    }
  }, [open, activeTab, unreadActivity]);

  useEffect(() => {
    if ((open || pipWindow) && selected) markConversationAsRead(selected.id, user?.id);
  }, [open, pipWindow, selected, user?.id]);

  useEffect(() => {
    const keepBubbleInView = () => {
      setPos((current) => {
        const next = {
          x: clamp(current.x, window.innerWidth - BUBBLE_SIZE - VIEWPORT_INSET),
          y: clamp(current.y, window.innerHeight - BUBBLE_SIZE - VIEWPORT_INSET),
        };
        if (next.x !== current.x || next.y !== current.y) {
          try {
            localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(next));
          } catch {
            // ignore storage errors
          }
        }
        return next;
      });
    };
    window.addEventListener("resize", keepBubbleInView);
    return () => window.removeEventListener("resize", keepBubbleInView);
  }, []);

  // If the user closes the PiP window from its own chrome (not our button),
  // fall back to the normal in-tab popover state.
  useEffect(() => {
    if (!pipWindow) return;
    const onPageHide = () => setPipWindow(null);
    pipWindow.addEventListener("pagehide", onPageHide);
    return () => pipWindow.removeEventListener("pagehide", onPageHide);
  }, [pipWindow]);

  const totalUnread = useMemo(
    () => Object.values(unreadById).reduce<number>((sum, n) => sum + (n === "unknown" ? 0 : n), 0),
    [unreadById],
  );
  const hasUnknownUnread = Object.values(unreadById).includes("unknown");

  const onUnreadChange = (id: string, count: number | "unknown") =>
    setUnreadById((prev) => (prev[id] === count ? prev : { ...prev, [id]: count }));

  const openPip = async () => {
    const dpip = getDocumentPip();
    if (!dpip) {
      toast.error("This browser doesn't support pop-out windows yet.");
      return;
    }
    try {
      const win = await dpip.requestWindow({ width: 340, height: 480 });
      // Clone every stylesheet/style tag rather than reading CSSOM (which
      // throws on cross-origin sheets) — the browser just re-applies them.
      document.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
        win.document.head.appendChild(node.cloneNode(true));
      });
      win.document.body.style.margin = "0";
      setOpen(false);
      setPipWindow(win);
    } catch (err) {
      // Surface the real reason instead of silently doing nothing — e.g.
      // requestWindow() throws NotAllowedError when called from a non-top-
      // level browsing context (an iframe), or if it wasn't called directly
      // from a user gesture.
      toast.error(
        err instanceof Error
          ? `Couldn't pop out: ${err.message}`
          : "Couldn't pop out the chat window.",
      );
    }
  };

  const closePip = () => {
    pipWindow?.close();
    setPipWindow(null);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    setPreviewId(null);
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPos: pos,
      current: pos,
      moved: false,
    };
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
    // A tap, not a drag. While popped out, bring that window forward
    // instead of also opening the in-tab popover.
    if (pipWindow) {
      pipWindow.focus();
      return;
    }
    if (!open) setActiveTab(unreadActivity > 0 || !selected ? "updates" : "chats");
    setOpen((o) => !o);
  };

  const badgeCount = totalUnread + unreadActivity;
  const preview = !open ? activity.find((item) => item.id === previewId) : null;
  const viewportWidth = typeof window === "undefined" ? 1024 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 768 : window.innerHeight;
  const previewWidth = Math.min(300, viewportWidth - 24);
  const previewOnRight = pos.x + BUBBLE_SIZE + previewWidth + 24 <= viewportWidth;
  const previewLeft = previewOnRight
    ? pos.x + BUBBLE_SIZE + 12
    : Math.max(12, pos.x - previewWidth - 12);
  const previewTop = Math.min(Math.max(12, pos.y - 2), viewportHeight - 132);

  return (
    <>
      {conversations.map((c) => (
        <UnreadReporter key={c.id} conversation={c} myId={user?.id} onChange={onUnreadChange} />
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <button
            data-chat-heads-dock
            ref={bubbleRef}
            type="button"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            title={
              hasUnknownUnread
                ? "Chats and activity — some unread counts unavailable"
                : "Chats and activity"
            }
            aria-label={
              hasUnknownUnread
                ? "Chats and activity — some unread counts unavailable"
                : `Chats and activity${badgeCount ? `, ${badgeCount} unread` : ""}`
            }
            style={{
              left: pos.x,
              top: pos.y,
              width: BUBBLE_SIZE,
              height: BUBBLE_SIZE,
              touchAction: "none",
            }}
            className="fixed z-40 flex items-center justify-center rounded-full outline-none cursor-grab active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-[#7b56fd] focus-visible:ring-offset-2"
          >
            <CoeyChatHeadArtwork size={BUBBLE_SIZE} />
            {badgeCount > 0 || hasUnknownUnread ? (
              <span
                className={cn(
                  "absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-background px-1 text-[12px] font-semibold text-white",
                  hasUnknownUnread ? "bg-amber-500" : "bg-[#fc404d]",
                )}
              >
                {hasUnknownUnread ? "?" : badgeCount > 99 ? "99+" : badgeCount}
              </span>
            ) : null}
          </button>
        </PopoverAnchor>
        <PopoverContent
          side="top"
          align="start"
          className="w-[340px] max-w-[calc(100vw-24px)] overflow-hidden rounded-[22px] border-[#e9e2f2] p-0 shadow-[0_20px_56px_rgba(54,35,82,0.18)]"
          sideOffset={12}
        >
          <div className="m-3 flex rounded-[14px] bg-[#f5f1fa] p-1">
            <button
              type="button"
              onClick={() => setActiveTab("updates")}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-[10px] px-2 py-2 text-xs font-semibold transition",
                activeTab === "updates"
                  ? "bg-white text-violet-700 shadow-sm"
                  : "text-muted-foreground hover:text-[#49325f]",
              )}
            >
              <Info className="h-3.5 w-3.5" />
              Activity{unreadActivity ? ` ${unreadActivity}` : ""}
            </button>
            {selected ? (
              <button
                type="button"
                onClick={() => setActiveTab("chats")}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-[10px] px-2 py-2 text-xs font-semibold transition",
                  activeTab === "chats"
                    ? "bg-white text-violet-700 shadow-sm"
                    : "text-muted-foreground hover:text-[#49325f]",
                )}
              >
                <MessageCircle className="h-3.5 w-3.5" />
                Chats{totalUnread ? ` ${totalUnread}` : ""}
              </button>
            ) : null}
          </div>
          {activeTab === "updates" || !selected ? (
            <ActivityFeed items={activity} onClose={() => setOpen(false)} />
          ) : (
            <MiniChatContent
              conversations={conversations}
              selected={selected}
              myId={user?.id}
              onSelect={(id) => setSelectedId(id)}
              onClose={() => setOpen(false)}
              pipSupported={Boolean(getDocumentPip())}
              poppedOut={false}
              onPopOut={() => void openPip()}
            />
          )}
        </PopoverContent>
      </Popover>
      {preview ? (
        <div
          data-chat-head-preview
          role="status"
          aria-live="polite"
          style={{ left: previewLeft, top: previewTop, width: previewWidth }}
          className="pointer-events-none fixed z-50 rounded-xl border border-violet-200 bg-white px-4 py-3 text-sm shadow-[0_12px_32px_rgba(43,26,84,0.18)] motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95"
        >
          <div className="font-semibold text-[#241747]">{toastContent(preview.title)}</div>
          {preview.description ? (
            <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {toastContent(preview.description)}
            </div>
          ) : null}
          <div className="mt-1.5 text-[11px] font-medium text-violet-600">
            Tap the cat to see activity
          </div>
          <span
            aria-hidden="true"
            className={cn(
              "absolute top-4 h-3 w-3 rotate-45 border-violet-200 bg-white",
              previewOnRight ? "-left-[7px] border-b border-l" : "-right-[7px] border-r border-t",
            )}
          />
        </div>
      ) : null}
      {pipWindow && selected
        ? createPortal(
            <MiniChatContent
              conversations={conversations}
              selected={selected}
              myId={user?.id}
              onSelect={(id) => setSelectedId(id)}
              onClose={closePip}
              pipSupported={false}
              poppedOut={true}
              onPopOut={() => {}}
            />,
            pipWindow.document.body,
          )
        : null}
      <Dialog
        open={Boolean(assignedThingId && !assignedThing.thing)}
        onOpenChange={(open) => {
          if (!open) setAssignedThingId(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto rounded-2xl p-5 sm:p-7">
          <DialogTitle className="sr-only">Assigned Thing details</DialogTitle>
          <DialogDescription className="sr-only">
            Review the Thing assigned to you.
          </DialogDescription>
          {assignedThing.isLoading ? (
            <p role="status" className="py-10 text-center text-[13px] text-muted-foreground">
              Loading Thing…
            </p>
          ) : (
            <div className="py-8 text-center">
              <p>This Thing is no longer available or couldn't be loaded.</p>
              <button
                type="button"
                className="mt-3 rounded-lg bg-[#e9defb] px-3 py-2 text-xs font-semibold text-[#6541ad]"
                onClick={() => void assignedThing.refetch()}
              >
                Try again
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <CourtDetailModal
        thing={assignedThing.thing}
        isOpen={Boolean(assignedThingId && assignedThing.thing)}
        onClose={() => setAssignedThingId(null)}
      />
    </>
  );
}
