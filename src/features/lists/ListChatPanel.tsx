import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Search, MessageSquare, Paperclip, AtSign, Smile, Download, FileText, Phone, Pin, PinOff } from "lucide-react";
import { toast } from "sonner";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { ChatMessagesSkeleton } from "@/components/katalist/ScreenSkeletons";
import { useListMessages, type ChatAttachment } from "@/features/lists/use-list-messages";
import { useConversation, type ConversationParticipant } from "@/features/hub/use-conversations";
import { useSession } from "@/hooks/useSession";
import { formatFileSize } from "@/lib/file-utils";
import { domainErrorMessage } from "@/lib/domain-error";
import { cn } from "@/lib/utils";

const MAX_CHAT_FILE_BYTES = 50 * 1024 * 1024;

/** Finds the "@partial-name" being typed right at the caret, if any — a
 *  space or the start of the string ends the trigger. */
function findMentionTrigger(text: string, caret: number): { start: number; query: string } | null {
  const upTo = text.slice(0, caret);
  const at = upTo.lastIndexOf("@");
  if (at === -1) return null;
  const between = upTo.slice(at + 1);
  if (/\s/.test(between)) return null;
  return { start: at, query: between };
}

/** Resolved at send time (not tracked incrementally) so edits/deletions to
 *  the text are always reflected correctly — matches "@Name" as a whole
 *  word against the conversation's actual members. */
function resolveMentions(text: string, people: ConversationParticipant[]): string[] {
  const ids: string[] = [];
  for (const p of people) {
    const escaped = p.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`@${escaped}(?!\\w)`, "i").test(text)) ids.push(p.id);
  }
  return ids;
}

/** Renders a message body with any "@Name" mention of an actual member
 *  highlighted — bold + tinted, more strongly if it's you. */
function MessageBody({ body, people, myId }: { body: string; people: ConversationParticipant[]; myId: string | undefined }) {
  const mentionNames = people.map((p) => p.name).filter(Boolean);
  if (mentionNames.length === 0) return <p className="mt-0.5 text-[12px] text-[#1a2345]">{body}</p>;
  const pattern = mentionNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const parts = body.split(new RegExp(`(@(?:${pattern})(?!\\w))`, "gi"));
  return (
    <p className="mt-0.5 text-[12px] text-[#1a2345]">
      {parts.map((part, i) => {
        const person = people.find((p) => part.toLowerCase() === `@${p.name.toLowerCase()}`);
        if (!person) return <span key={i}>{part}</span>;
        return (
          <span
            key={i}
            className={cn(
              "rounded px-1 font-medium",
              person.id === myId ? "bg-[#fdb412]/30 text-[#7a5200]" : "bg-[#f0e9fb] text-[#6638ec]",
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
        <span className="block truncate text-[12px] font-medium text-[#000533]">{attachment.name}</span>
        {sizeLabel ? <span className="block text-[10.5px] text-[#8487a7]">{sizeLabel}</span> : null}
      </span>
      <Download className="h-3.5 w-3.5 shrink-0 text-[#8487a7]" />
    </a>
  );
}

export type ListChatPanelHandle = {
  /** Scrolls a message into view — used by the combined Chat+Files search
   *  in ConversationWorkspace to jump to a result after switching tabs. */
  scrollToMessage: (id: string) => void;
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
    viewOnly?: boolean;
    className?: string;
  }
>(function ListChatPanel({ listId, placeholderName, viewOnly = false, className }, forwardedRef) {
  const chat = useListMessages(listId);
  const { user } = useSession();
  const { conversation } = useConversation(listId);
  const mentionable = useMemo(() => conversation?.others ?? [], [conversation]);
  const [msg, setMsg] = useState("");
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [mentionTrigger, setMentionTrigger] = useState<{ start: number; query: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const msgInputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const mentionMatches = useMemo(() => {
    if (!mentionTrigger) return [];
    const q = mentionTrigger.query.toLowerCase();
    return mentionable.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 6);
  }, [mentionTrigger, mentionable]);

  const insertMention = (person: ConversationParticipant) => {
    if (!mentionTrigger) return;
    const before = msg.slice(0, mentionTrigger.start);
    const after = msg.slice(mentionTrigger.start + 1 + mentionTrigger.query.length);
    const next = `${before}@${person.name} ${after}`;
    setMsg(next);
    setMentionTrigger(null);
    requestAnimationFrame(() => msgInputRef.current?.focus());
  };

  const onMsgChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setMsg(value);
    const caret = e.target.selectionStart ?? value.length;
    setMentionTrigger(findMentionTrigger(value, caret));
  };

  const scrollToMessage = (id: string) => {
    messageRefs.current.get(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  useImperativeHandle(forwardedRef, () => ({ scrollToMessage }), []);

  const togglePin = async (messageId: string, pinned: boolean) => {
    try {
      await chat.pin.mutateAsync({ messageId, pinned });
    } catch (err) {
      toast.error(domainErrorMessage(err));
    }
  };

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [chat.messages.length]);

  const q = search.trim().toLowerCase();
  const filtered = q
    ? chat.messages.filter((m) => m.kind === "system" || m.body.toLowerCase().includes(q) || m.author.toLowerCase().includes(q))
    : chat.messages;

  const handleFile = async (file?: File) => {
    if (!file) return;
    if (file.size > MAX_CHAT_FILE_BYTES) {
      toast.error("Files must be 50 MB or smaller.");
      return;
    }
    setUploading(true);
    try {
      const attachment = await chat.uploadAttachment(file);
      await chat.send.mutateAsync({ body: "", attachment });
    } catch (err) {
      toast.error(domainErrorMessage(err));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col bg-white", className)}>
      <div className="flex items-center justify-end px-5 pt-3">
        <button
          type="button"
          onClick={() =>
            setSearchOpen((o) => {
              if (o) setSearch("");
              return !o;
            })
          }
          title="Search messages"
          aria-label="Search messages"
          aria-pressed={searchOpen}
          className={cn(
            "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors",
            searchOpen ? "bg-[#f0e9fb] text-[#975ee2]" : "text-[#8487a7] hover:bg-[#f4f5fb]",
          )}
        >
          <Search className="h-4 w-4" />
        </button>
      </div>

      {searchOpen && (
        <div className="px-5 pt-1">
          <div className="relative flex items-center">
            <Search className="pointer-events-none absolute left-3 h-4 w-4 text-[#8487a7]" />
            <input
              autoFocus
              value={search}
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
        </div>
      )}

      {chat.pinnedMessages.length > 0 && (
        <div className="mx-5 mt-2 space-y-1 rounded-[10px] border border-[#ebecf7] bg-[#f9f9fe] px-3 py-2">
          {chat.pinnedMessages.map((m) => (
            <div key={m.id} className="flex items-center gap-2">
              <Pin className="h-3 w-3 shrink-0 text-[#975ee2]" />
              <button
                type="button"
                onClick={() => scrollToMessage(m.id)}
                className="min-w-0 flex-1 truncate text-left text-[11.5px] text-[#3d3f74] hover:text-[#000533]"
              >
                <span className="font-medium">{m.author}:</span> {m.body || "📎 attachment"}
              </button>
              {!viewOnly ? (
                <button
                  type="button"
                  onClick={() => void togglePin(m.id, false)}
                  title="Unpin"
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[#8487a7] hover:bg-[#f0e9fb] hover:text-[#975ee2]"
                >
                  <PinOff className="h-3 w-3" />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <div ref={scrollRef} className="mt-3 min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-2">
        {chat.isLoading ? (
          <ChatMessagesSkeleton />
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center">
            <MessageSquare className="mx-auto mb-1.5 h-7 w-7 text-[#c5cae0]" />
            <p className="text-[12.5px] font-medium text-[#000533]">No messages yet</p>
            <p className="mt-0.5 text-[11px] text-[#6a769c]">
              {viewOnly ? "There are no messages here." : "Start the conversation below."}
            </p>
          </div>
        ) : (
          filtered.map((m) =>
            m.kind === "system" ? (
              <div key={m.id} className="flex items-center justify-center gap-2 py-1">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f4f5fb] px-3 py-1 text-[11px] text-[#6a769c]">
                  <Phone className="h-3 w-3 text-[#12a15f]" />
                  <span className="font-medium text-[#000533]">{m.author}</span>
                  {m.body}
                  <span className="text-[#a3a9c9]">
                    · {new Date(m.at).toLocaleString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </span>
              </div>
            ) : (
              <div
                key={m.id}
                ref={(el) => {
                  if (el) messageRefs.current.set(m.id, el);
                  else messageRefs.current.delete(m.id);
                }}
                className={cn(
                  "group flex items-start gap-3 rounded-lg px-1 -mx-1 transition-colors hover:bg-[#faf9fe]",
                  user?.id && m.mentionedProfileIds.includes(user.id) && "bg-[#fdb412]/10",
                )}
              >
                <PersonAvatar name={m.author} initials={m.author.slice(0, 2).toUpperCase()} src={m.avatarUrl} size={34} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[12.5px] font-medium text-[#000533]">{m.author}</span>
                    <span className="text-[11px] text-[#757b9e]">
                      {new Date(m.at).toLocaleString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    {m.pinnedAt ? <Pin className="h-3 w-3 shrink-0 text-[#975ee2]" /> : null}
                  </div>
                  {m.body ? <MessageBody body={m.body} people={mentionable} myId={user?.id} /> : null}
                  {m.attachment ? <ChatAttachmentView attachment={m.attachment} /> : null}
                </div>
                {!viewOnly ? (
                  <button
                    type="button"
                    onClick={() => void togglePin(m.id, !m.pinnedAt)}
                    title={m.pinnedAt ? "Unpin" : "Pin"}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#8487a7] opacity-0 transition-opacity hover:bg-[#f0e9fb] hover:text-[#975ee2] group-hover:opacity-100"
                  >
                    {m.pinnedAt ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                  </button>
                ) : null}
              </div>
            ),
          )
        )}
      </div>

      {viewOnly ? (
        <p className="mx-5 mb-4 rounded-[8px] bg-[#f6f8fd] p-2.5 text-center text-[11.5px] text-[#6a769c]">
          View-only members can observe the conversation.
        </p>
      ) : (
        <div className="relative mx-5 mb-4 mt-2">
          {mentionTrigger && mentionMatches.length > 0 ? (
            <div className="absolute bottom-full left-0 z-10 mb-1 w-56 overflow-hidden rounded-[10px] border border-[#ebecf7] bg-white shadow-lg">
              {mentionMatches.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => insertMention(p)}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-[#f6f7fc]"
                >
                  <PersonAvatar name={p.name} initials={p.initials} src={p.avatarUrl} size={22} />
                  <span className="truncate text-[12px] font-medium text-[#000533]">{p.name}</span>
                </button>
              ))}
            </div>
          ) : null}
          <form
            className="flex items-center gap-2 rounded-[8px] border border-[#e5e7f6] bg-white px-3 py-2"
            onSubmit={(e) => {
              e.preventDefault();
              const trimmed = msg.trim();
              if (!trimmed) return;
              const mentionedProfileIds = resolveMentions(trimmed, mentionable);
              void chat.send.mutateAsync({ body: trimmed, mentionedProfileIds }).then(
                () => setMsg(""),
                (err) => toast.error(domainErrorMessage(err)),
              );
            }}
          >
            <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => void handleFile(e.target.files?.[0])} />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="cursor-pointer text-[#8487a7] transition-colors hover:text-[#000533] disabled:opacity-40"
              aria-label="Attach file"
              title="Attach a file"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <input
              ref={msgInputRef}
              value={msg}
              onChange={onMsgChange}
              onKeyDown={(e) => {
                if (e.key === "Escape") setMentionTrigger(null);
              }}
              placeholder={uploading ? "Uploading file…" : `Message ${placeholderName ?? "the conversation"}…`}
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
              className="cursor-pointer text-[#8487a7] transition-colors hover:text-[#000533] disabled:opacity-40"
              aria-label="Mention someone"
              title="Mention someone"
            >
              <AtSign className="h-4 w-4" />
            </button>
            <button type="button" className="cursor-pointer text-[#8487a7] transition-colors hover:text-[#000533]" aria-label="Emoji">
              <Smile className="h-4 w-4" />
            </button>
            <button
              type="submit"
              disabled={!msg.trim()}
              className="inline-flex h-[34px] cursor-pointer items-center rounded-[6px] bg-[#975ee2] px-4 text-[13px] font-medium text-white transition hover:brightness-95 disabled:opacity-40"
            >
              Send
            </button>
          </form>
        </div>
      )}
    </div>
  );
});
