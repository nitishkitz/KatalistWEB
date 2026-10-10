import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Search,
  MessageSquare,
  Paperclip,
  AtSign,
  Smile,
  Download,
  FileText,
  Phone,
  Pin,
  PinOff,
  ArrowDown,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { ChatMessagesSkeleton } from "@/components/katalist/ScreenSkeletons";
import {
  useListMessages,
  useListMessageSearch,
  useListPinnedMessages,
  type ChatAttachment,
  type ListChatMessage,
} from "@/features/lists/use-list-messages";
import { useSessionDraft } from "@/features/drafts/use-session-draft";
import { useReferenceDraft } from "@/features/thing-references/use-reference-draft";
import { ThingReferenceDraftTray } from "@/features/thing-references/ThingReferenceDraftTray";
import { ThingReferenceList } from "@/features/thing-references/ThingReferencesSection";
import { getDraft, getDraftRevision, setDraft } from "@/features/drafts/session-drafts";
import { useBlockWhile } from "@/components/katalist/use-interaction-blocker";
import { reconcileMentions, type SelectedMention } from "@/features/lists/chat-mentions";
import { MentionMenu, handleMentionKey } from "@/features/mentions/MentionMenu";
import { filterMentionPeople, findMentionTrigger, type MentionPerson, type MentionTrigger } from "@/features/mentions/mention-trigger";
import { useChatMentionPeople } from "@/features/mentions/use-chat-mention-people";
import type { ConversationParticipant } from "@/features/hub/use-conversations";
import { useSession } from "@/hooks/useSession";
import { formatFileSize } from "@/lib/file-utils";
import { describeUploadError } from "@/lib/upload-errors";
import { domainErrorMessage } from "@/lib/domain-error";
import { cn } from "@/lib/utils";

const MAX_CHAT_FILE_BYTES = 50 * 1024 * 1024;

/** Renders a message body with any "@Name" mention of an actual member
 *  highlighted — bold + tinted, more strongly if it's you. */
function MessageBody({
  body,
  people,
  myId,
  mine = false,
}: {
  body: string;
  people: Array<Pick<ConversationParticipant, "id" | "name">>;
  myId: string | undefined;
  mine?: boolean;
}) {
  const mentionNames = people.map((p) => p.name).filter(Boolean);
  const bubbleClass = mine
    ? "rounded-[16px_16px_5px_16px] bg-[#7046d9] px-3.5 py-2.5 text-[12.5px] leading-[18px] text-white"
    : "rounded-[16px_16px_16px_5px] bg-[#f3f0f7] px-3.5 py-2.5 text-[12.5px] leading-[18px] text-[#281d35]";
  if (mentionNames.length === 0) return <p className={bubbleClass}>{body}</p>;
  const pattern = mentionNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const parts = body.split(new RegExp(`(@(?:${pattern})(?!\\w))`, "gi"));
  return (
    <p className={bubbleClass}>
      {parts.map((part, i) => {
        const person = people.find((p) => part.toLowerCase() === `@${p.name.toLowerCase()}`);
        if (!person) return <span key={i}>{part}</span>;
        return (
          <span
            key={i}
            className={cn(
              "rounded px-1 font-medium",
              mine
                ? "bg-white/20 text-white"
                : person.id === myId
                  ? "bg-[#fdb412]/30 text-[#7a5200]"
                  : "bg-[#e6dcf5] text-[#6638ec]",
            )}
          >
            {part}
          </span>
        );
      })}
    </p>
  );
}

/** Renders a chat attachment: an inline preview for images, a file chip otherwise. */
function ChatAttachmentView({ attachment }: { attachment: ChatAttachment }) {
  const isImage = (attachment.mime ?? "").startsWith("image/");
  const sizeLabel = attachment.size ? formatFileSize(attachment.size) : null;
  if (isImage && attachment.url) {
    return (
      <a href={attachment.url} target="_blank" rel="noreferrer" className="mt-1.5 block w-fit">
        <img
          src={attachment.url}
          alt={attachment.name}
          className="max-h-56 max-w-[260px] rounded-[10px] border border-[#ebecf7] object-cover"
        />
      </a>
    );
  }
  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noreferrer"
      className="mt-1.5 inline-flex max-w-[280px] items-center gap-2.5 rounded-[10px] border border-[#ebecf7] bg-[#f9f9fe] px-3 py-2 transition-colors hover:border-[#975ee2]"
    >
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#eef0f6] text-[#6a769c]">
        <FileText className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium text-[#000533]">
          {attachment.name}
        </span>
        {sizeLabel ? <span className="block text-[12px] text-[#8487a7]">{sizeLabel}</span> : null}
      </span>
      <Download className="h-3.5 w-3.5 shrink-0 text-[#8487a7]" />
    </a>
  );
}

export type ListChatPanelHandle = {
  /** Scrolls a message into view — used by the combined Chat+Files search
   *  in ConversationWorkspace to jump to a result after switching tabs. */
  scrollToMessage: (id: string) => void;
  showMessageResult: (message: ListChatMessage) => void;
};

/**
 * Self-contained List/conversation chat: message timeline + composer, backed by
 * `useListMessages`. Reused by the Team hub and available to the List detail page.
 */
export const ListChatPanel = forwardRef<
  ListChatPanelHandle,
  {
    listId: string;
    placeholderName?: string;
    /** Compact conversation title/search row used by the floating quick chat. */
    headerTitle?: string;
    headerSubtitle?: string;
    headerAvatar?: ReactNode;
    headerActions?: ReactNode;
    topContent?: ReactNode;
    viewOnly?: boolean;
    className?: string;
  }
>(function ListChatPanel(
  {
    listId,
    placeholderName,
    headerTitle,
    headerSubtitle,
    headerAvatar,
    headerActions,
    topContent,
    viewOnly = false,
    className,
  },
  forwardedRef,
) {
  const qc = useQueryClient();
  const chat = useListMessages(listId);
  const pinned = useListPinnedMessages(listId);
  const draft = useSessionDraft("list-chat", listId, "");
  const msg = draft.value;
  const selectedMentions = (draft.metadata as SelectedMention[] | undefined) ?? [];
  const stagedAttachment = draft.attachments?.[0] as ChatAttachment | undefined;
  const setMsg = (value: string) => draft.write(value, draft.attachments, selectedMentions);
  const referenceDraft = useReferenceDraft("list-chat-references", listId);
  const { user } = useSession();
  const mentionable = useChatMentionPeople(listId);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [focusedResult, setFocusedResult] = useState<ListChatMessage | null>(null);
  const [uploading, setUploading] = useState(false);
  useBlockWhile(
    Boolean(msg.trim()) || Boolean(stagedAttachment) || referenceDraft.references.length > 0 || uploading || chat.send.isPending,
    "list-chat-draft",
  );
  const [mentionTrigger, setMentionTrigger] = useState<MentionTrigger | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const msgInputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // G04: "New messages while scrolled away show a control and do not jump
  // to bottom." Tracks the scroll position continuously (not just at the
  // moment a new message arrives, since by then the DOM has already
  // grown) so the length-triggered effect below knows whether the user
  // was already near the bottom BEFORE this update.
  const isNearBottomRef = useRef(true);
  const prependAnchorRef = useRef<{ height: number; top: number } | null>(null);
  const previousEdgeRef = useRef<{ first: string | null; last: string | null } | null>(null);
  const initialScrollDoneRef = useRef(false);
  const renderedListRef = useRef(listId);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const NEAR_BOTTOM_THRESHOLD_PX = 80;

  const updateNearBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_THRESHOLD_PX;
    isNearBottomRef.current = nearBottom;
    if (nearBottom) setHasNewMessages(false);
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    isNearBottomRef.current = true;
    setHasNewMessages(false);
  }, []);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const mentionMatches = useMemo(
    () => (mentionTrigger ? filterMentionPeople(mentionable, mentionTrigger.query) : []),
    [mentionTrigger, mentionable],
  );
  const activeMentionIndex = Math.min(mentionIndex, Math.max(mentionMatches.length - 1, 0));

  const insertMention = (person: MentionPerson) => {
    if (!mentionTrigger) return;
    const before = msg.slice(0, mentionTrigger.start);
    const after = msg.slice(mentionTrigger.start + 1 + mentionTrigger.query.length);
    const label = `@${person.name}`;
    const next = `${before}${label} ${after}`;
    draft.write(next, draft.attachments, [
      ...reconcileMentions(msg, next, selectedMentions),
      { id: person.id, label, start: before.length, end: before.length + label.length },
    ]);
    setMentionTrigger(null);
    setMentionIndex(0);
    requestAnimationFrame(() => msgInputRef.current?.focus());
  };

  const onMsgChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    draft.write(value, draft.attachments, reconcileMentions(msg, value, selectedMentions));
    const caret = e.target.selectionStart ?? value.length;
    setMentionTrigger(findMentionTrigger(value, caret));
    setMentionIndex(0);
  };

  const scrollToMessage = (id: string) => {
    messageRefs.current.get(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  useImperativeHandle(
    forwardedRef,
    () => ({
      scrollToMessage,
      showMessageResult: (message) => {
        setSearch("");
        setDebouncedSearch("");
        setFocusedResult(message);
        setSearchOpen(false);
      },
    }),
    [],
  );

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const searchQuery = useListMessageSearch(listId, debouncedSearch);

  const togglePin = async (messageId: string, pinned: boolean) => {
    try {
      await chat.pin.mutateAsync({ messageId, pinned });
    } catch (err) {
      toast.error(domainErrorMessage(err));
    }
  };

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (renderedListRef.current !== listId) {
      renderedListRef.current = listId;
      initialScrollDoneRef.current = false;
      previousEdgeRef.current = null;
      prependAnchorRef.current = null;
      isNearBottomRef.current = true;
    }
    if (prependAnchorRef.current) {
      const anchor = prependAnchorRef.current;
      el.scrollTop = anchor.top + el.scrollHeight - anchor.height;
      prependAnchorRef.current = null;
      return;
    }
    if (!initialScrollDoneRef.current && !chat.isLoading) {
      el.scrollTop = el.scrollHeight;
      isNearBottomRef.current = true;
      initialScrollDoneRef.current = true;
    }
    const first = chat.messages[0]?.id ?? null;
    const last = chat.messages.at(-1)?.id ?? null;
    const previous = previousEdgeRef.current;
    previousEdgeRef.current = { first, last };
    if (!previous || previous.last === last) return;
    if (isNearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    } else {
      setHasNewMessages(true);
    }
  }, [chat.messages, chat.isLoading, listId]);

  useEffect(() => {
    setSearch("");
    setDebouncedSearch("");
    setFocusedResult(null);
    setHasNewMessages(false);
  }, [listId]);

  const filtered = chat.accessLost
    ? []
    : focusedResult
      ? [focusedResult]
      : debouncedSearch.length >= 2
        ? (searchQuery.data ?? [])
        : chat.messages;

  const loadOlder = async () => {
    const el = scrollRef.current;
    if (el) prependAnchorRef.current = { height: el.scrollHeight, top: el.scrollTop };
    try {
      await chat.loadOlder();
    } catch {
      prependAnchorRef.current = null;
    }
  };

  const handleFile = async (file?: File) => {
    if (!file) return;
    if (stagedAttachment) {
      toast.error("Send or remove the current attachment first.");
      return;
    }
    if (file.size > MAX_CHAT_FILE_BYTES) {
      toast.error("Files must be 50 MB or smaller.");
      return;
    }
    setUploading(true);
    try {
      const attachment = await chat.uploadAttachment(file);
      const current = getDraft<string>(qc, "list-chat", listId);
      if (current?.attachments?.length) {
        toast.error("Send or remove the current attachment first.");
        return;
      }
      setDraft(qc, "list-chat", listId, {
        value: current?.value ?? "",
        attachments: [attachment],
        metadata: current?.metadata,
      });
    } catch (err) {
      toast.error(describeUploadError(err));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const searchToggle = (
    <button
      type="button"
      onClick={() =>
        setSearchOpen((open) => {
          setFocusedResult(null);
          if (open) setSearch("");
          return !open;
        })
      }
      title="Search messages"
      aria-label="Search messages"
      aria-pressed={searchOpen}
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        searchOpen ? "bg-[#f0e9fb] text-[#975ee2]" : "text-[#8487a7] hover:bg-[#f4f5fb]",
      )}
    >
      <Search className="h-4 w-4" />
    </button>
  );

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col bg-white", className)}>
      {headerTitle ? (
        <div className="flex min-h-[64px] items-center gap-3 px-4 py-2">
          {headerAvatar}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold text-[#241747]">{headerTitle}</p>
            {headerSubtitle ? (
              <p className="mt-0.5 text-[11px] font-medium text-emerald-600">{headerSubtitle}</p>
            ) : null}
          </div>
          {searchToggle}
          {headerActions}
        </div>
      ) : (
        <div className="flex h-[52px] items-center gap-2 px-3">
          {topContent ? <div className="min-w-0 flex-1">{topContent}</div> : <div className="flex-1" />}
          <div className="flex shrink-0 items-center gap-1">
            {searchToggle}
            {headerActions}
          </div>
        </div>
      )}

      {headerTitle ? topContent : null}

      {searchOpen && (
        <div className={cn(headerTitle ? "px-3 pt-1" : "px-5 pt-1")}>
          <div className="relative flex items-center">
            <Search className="pointer-events-none absolute left-3 h-4 w-4 text-[#8487a7]" />
            <input
              autoFocus
              value={search}
              maxLength={80}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setSearch("");
                  setSearchOpen(false);
                }
              }}
              placeholder="Search messages"
              className="h-[38px] w-full rounded-[10px] border border-[#ebecf7] bg-[#f9f9fe] pl-9 pr-3 text-[12px] text-[#000533] outline-none transition-colors placeholder:text-[#8487a7] focus:border-[#975ee2]"
            />
          </div>
          {debouncedSearch.length >= 2 ? (
            <p className="pt-1 text-[12px] text-[#8487a7]">
              {searchQuery.isFetching
                ? "Searching all messages…"
                : searchQuery.error
                  ? "Search failed. Edit the query to retry."
                  : "Search covers the full conversation history."}
            </p>
          ) : null}
        </div>
      )}

      {focusedResult && !chat.accessLost ? (
        <button
          type="button"
          onClick={() => setFocusedResult(null)}
          className="mx-5 mt-2 rounded-lg bg-[#f0e9fb] px-3 py-2 text-left text-xs text-[#6638ec]"
        >
          Showing a search result from the full history · Back to conversation
        </button>
      ) : null}

      {!chat.accessLost && (pinned.messages.length > 0 || chat.pinnedMessages.length > 0) && (
        <div className="mx-5 mt-2 space-y-1 rounded-[10px] border border-[#ebecf7] bg-[#f9f9fe] px-3 py-2">
          {(pinned.messages.length > 0 ? pinned.messages : chat.pinnedMessages).map((m) => (
            <div key={m.id} className="flex items-center gap-2">
              <Pin className="h-3 w-3 shrink-0 text-[#975ee2]" />
              <button
                type="button"
                onClick={() => {
                  if (chat.messages.some((row) => row.id === m.id)) scrollToMessage(m.id);
                  else setFocusedResult(m);
                }}
                className="min-w-0 flex-1 truncate text-left text-[12px] text-[#3d3f74] hover:text-[#000533]"
              >
                <span className="font-medium">{m.author}:</span> {m.body || "📎 attachment"}
              </button>
              {!viewOnly ? (
                <button
                  type="button"
                  onClick={() => void togglePin(m.id, false)}
                  title="Unpin"
                  aria-label="Unpin message"
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[#8487a7] hover:bg-[#f0e9fb] hover:text-[#975ee2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <PinOff className="h-3 w-3" />
                </button>
              ) : null}
            </div>
          ))}
          {pinned.hasMore ? (
            <button
              type="button"
              disabled={pinned.isLoadingMore}
              onClick={() => void pinned.loadMore()}
              className="w-full text-left text-[12px] text-[#6638ec] disabled:opacity-50"
            >
              {pinned.isLoadingMore ? "Loading pinned…" : "More pinned messages"}
            </button>
          ) : null}
        </div>
      )}

      <div className="relative mt-3 min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={updateNearBottom}
          className="h-full space-y-4 overflow-y-auto px-5 pb-2"
        >
          {!focusedResult && !debouncedSearch && (chat.hasMore || chat.olderError) ? (
            <button
              type="button"
              disabled={chat.isLoadingOlder}
              onClick={() => void loadOlder()}
              className="w-full rounded-lg border border-[#ebecf7] px-3 py-2 text-xs font-medium text-[#6638ec] disabled:opacity-50"
            >
              {chat.isLoadingOlder
                ? "Loading older messages…"
                : chat.olderError
                  ? "Couldn't load older messages. Retry"
                  : "Load older messages"}
            </button>
          ) : null}
          {chat.error && chat.messages.length === 0 ? (
            <p role="alert" className="py-4 text-center text-xs text-red-600">
              Couldn't load messages. Reopen this conversation to retry.
            </p>
          ) : null}
          {chat.isLoading ? (
            <ChatMessagesSkeleton />
          ) : chat.error && chat.messages.length === 0 ? null : filtered.length === 0 ? (
            <div className="py-12 text-center">
              <MessageSquare className="mx-auto mb-1.5 h-7 w-7 text-[#c5cae0]" />
              <p className="text-[12.5px] font-medium text-[#000533]">No messages yet</p>
              <p className="mt-0.5 text-[12px] text-[#6a769c]">
                {viewOnly ? "There are no messages here." : "Start the conversation below."}
              </p>
            </div>
          ) : (
            filtered.map((m) =>
              m.kind === "system" ? (
                <div key={m.id} className="flex items-center justify-center gap-2 py-1">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f4f5fb] px-3 py-1 text-[12px] text-[#6a769c]">
                    <Phone className="h-3 w-3 text-[#12a15f]" />
                    <span className="font-medium text-[#000533]">{m.author}</span>
                    {m.body}
                    <span className="text-[#a3a9c9]">
                      · {new Date(m.at).toLocaleString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </span>
                  {m.delivery === "failed" ? (
                    <button
                      type="button"
                      onClick={() =>
                        void chat
                          .retry(m.id)
                          .catch((err: unknown) => toast.error(domainErrorMessage(err)))
                      }
                      className="text-[12px] text-red-600 underline"
                    >
                      Retry entry
                    </button>
                  ) : null}
                </div>
              ) : (
                <div
                  key={m.id}
                  ref={(el) => {
                    if (el) messageRefs.current.set(m.id, el);
                    else messageRefs.current.delete(m.id);
                  }}
                  className={cn(
                    "group flex items-end gap-2.5 rounded-lg px-1 -mx-1 transition-colors hover:bg-[#faf9fe]",
                    m.authorId === user?.id && "justify-end",
                    user?.id && m.mentionedProfileIds.includes(user.id) && "bg-[#fdb412]/10",
                  )}
                >
                  {m.authorId !== user?.id ? (
                    <PersonAvatar
                      name={m.author}
                      initials={m.author.slice(0, 2).toUpperCase()}
                      src={m.avatarUrl}
                      size={30}
                    />
                  ) : null}
                  <div className="min-w-0 max-w-[82%]">
                    <div
                      className={cn(
                        "mb-1 flex items-baseline gap-2",
                        m.authorId === user?.id && "justify-end",
                      )}
                    >
                      <span className="text-[11px] font-medium text-[#675a73]">
                        {m.authorId === user?.id ? "You" : m.author}
                      </span>
                      <span className="text-[12px] text-[#757b9e]">
                        {new Date(m.at).toLocaleString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      {m.pinnedAt ? <Pin className="h-3 w-3 shrink-0 text-[#975ee2]" /> : null}
                    </div>
                    {m.body ? (
                      <MessageBody
                        body={m.body}
                        people={mentionable}
                        myId={user?.id}
                        mine={m.authorId === user?.id}
                      />
                    ) : null}
                    {m.attachment ? <ChatAttachmentView attachment={m.attachment} /> : null}
                    {m.thingReferences?.length ? <ThingReferenceList references={m.thingReferences} className="mt-1 grid gap-2" /> : null}
                    {m.delivery === "pending" ? (
                      <p className="text-[12px] text-[#8487a7]">Sending…</p>
                    ) : null}
                    {m.delivery === "failed" ? (
                      <div className="mt-1 flex items-center gap-2 text-[12px] text-red-600">
                        <span>Couldn't send.</span>
                        <button
                          type="button"
                          onClick={() =>
                            void chat
                              .retry(m.id)
                              .catch((err: unknown) => toast.error(domainErrorMessage(err)))
                          }
                          className="font-semibold underline"
                        >
                          Retry
                        </button>
                        <button
                          type="button"
                          onClick={() => chat.removeFailed(m.id)}
                          className="underline"
                        >
                          Remove
                        </button>
                      </div>
                    ) : null}
                  </div>
                  {!viewOnly ? (
                    <button
                      type="button"
                      onClick={() => void togglePin(m.id, !m.pinnedAt)}
                      title={m.pinnedAt ? "Unpin" : "Pin"}
                      aria-label={m.pinnedAt ? "Unpin message" : "Pin message"}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#8487a7] opacity-0 transition-opacity hover:bg-[#f0e9fb] hover:text-[#975ee2] group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {m.pinnedAt ? (
                        <PinOff className="h-3.5 w-3.5" />
                      ) : (
                        <Pin className="h-3.5 w-3.5" />
                      )}
                    </button>
                  ) : null}
                </div>
              ),
            )
          )}
          {!focusedResult && debouncedSearch.length >= 2 && searchQuery.hasMore ? (
            <button
              type="button"
              disabled={searchQuery.isLoadingMore}
              onClick={() => void searchQuery.loadMore()}
              className="w-full rounded-lg border border-[#ebecf7] px-3 py-2 text-xs font-medium text-[#6638ec] disabled:opacity-50"
            >
              {searchQuery.isLoadingMore ? "Loading more results…" : "Load more search results"}
            </button>
          ) : null}
        </div>
        {hasNewMessages && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="absolute bottom-2 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-[#975ee2] px-3 py-1.5 text-[12px] font-medium text-white katalist-elevation-card transition hover:brightness-95"
          >
            New messages
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {viewOnly ? (
        <p className="mx-5 mb-4 rounded-[8px] bg-[#f6f8fd] p-2.5 text-center text-[12px] text-[#6a769c]">
          View-only members can observe the conversation.
        </p>
      ) : (
        <div className="relative mx-4 mb-4 mt-2">
          {stagedAttachment ? (
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-[#ebecf7] px-3 py-2 text-xs text-[#3d3f74]">
              <Paperclip className="h-3.5 w-3.5" />
              <span className="min-w-0 flex-1 truncate">{stagedAttachment.name} ready to send</span>
              <button
                type="button"
                onClick={() => draft.write(msg, [], selectedMentions)}
                aria-label="Remove attachment"
                className="text-[#8487a7] hover:text-red-600"
              >
                Remove
              </button>
            </div>
          ) : null}
          <ThingReferenceDraftTray references={referenceDraft.references} onRemove={referenceDraft.remove} />
          {mentionTrigger && mentionMatches.length > 0 ? (
            <MentionMenu
              id="list-chat-mention-menu"
              people={mentionMatches}
              activeIndex={activeMentionIndex}
              onSelect={insertMention}
              onHover={setMentionIndex}
            />
          ) : null}
          <form
            className="flex items-center gap-2 rounded-[18px] border border-[#e7e1ee] bg-[#faf8fc] px-3 py-2 shadow-[0_3px_12px_rgba(45,28,68,0.05)] transition focus-within:border-[#a77ae2] focus-within:bg-white"
            onSubmit={(e) => {
              e.preventDefault();
              const trimmed = msg.trim();
              const stagedReferences = referenceDraft.references;
              if ((!trimmed && !stagedAttachment && stagedReferences.length === 0) || chat.send.isPending) return;
              const mentionedProfileIds = [
                ...new Set(
                  selectedMentions
                    .filter(
                      (mention) =>
                        trimmed.slice(mention.start, mention.end) === mention.label &&
                        mentionable.some((person) => person.id === mention.id),
                    )
                    .map((mention) => mention.id),
                ),
              ];
              draft.clear();
              referenceDraft.clear();
              const draftRevision = getDraftRevision(qc, "list-chat", listId);
              void chat.send
                .mutateAsync({
                  body: trimmed,
                  attachment: stagedAttachment,
                  mentionedProfileIds,
                  thingReferences: stagedReferences,
                  draftRevision,
                })
                .catch((err) => toast.error(domainErrorMessage(err)));
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => void handleFile(e.target.files?.[0])}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || Boolean(stagedAttachment)}
              className="cursor-pointer rounded text-[#8487a7] transition-colors hover:text-[#000533] disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Attach file"
              title="Attach a file"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <input
              ref={msgInputRef}
              value={msg}
              onChange={onMsgChange}
              onPaste={referenceDraft.onPaste}
              role="combobox"
              aria-expanded={Boolean(mentionTrigger && mentionMatches.length > 0)}
              aria-controls="list-chat-mention-menu"
              aria-activedescendant={mentionTrigger && mentionMatches.length > 0 ? `list-chat-mention-menu-option-${activeMentionIndex}` : undefined}
              onKeyDown={(e) => {
                if (!mentionTrigger) return;
                handleMentionKey(
                  e,
                  { count: mentionMatches.length, activeIndex: activeMentionIndex },
                  {
                    setActiveIndex: setMentionIndex,
                    select: (index) => {
                      const person = mentionMatches[index];
                      if (person) insertMention(person);
                    },
                    close: () => setMentionTrigger(null),
                  },
                );
              }}
              placeholder={uploading ? "Uploading file…" : "Write a message…"}
              className="min-w-0 flex-1 bg-transparent text-[13px] text-[#000533] outline-none placeholder:text-[#6a6b8e]"
            />
            <button
              type="button"
              onClick={() => {
                const caret = msgInputRef.current?.selectionStart ?? msg.length;
                const next = `${msg.slice(0, caret)}@${msg.slice(caret)}`;
                setMsg(next);
                setMentionTrigger({ start: caret, query: "" });
                requestAnimationFrame(() => msgInputRef.current?.focus());
              }}
              disabled={mentionable.length === 0}
              className="cursor-pointer rounded text-[#8487a7] transition-colors hover:text-[#000533] disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Mention someone"
              title="Mention someone"
            >
              <AtSign className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="cursor-pointer rounded text-[#8487a7] transition-colors hover:text-[#000533] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Emoji"
              title="Emoji"
            >
              <Smile className="h-4 w-4" />
            </button>
            <button
              type="submit"
              disabled={(!msg.trim() && !stagedAttachment && referenceDraft.references.length === 0) || chat.send.isPending || uploading}
              aria-label="Send message"
              className="inline-flex h-[34px] w-[34px] cursor-pointer items-center justify-center rounded-full bg-[#7046d9] text-white transition hover:bg-[#6036c5] disabled:opacity-40"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
            </button>
          </form>
        </div>
      )}
    </div>
  );
});
