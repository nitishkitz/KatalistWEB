import { useEffect, useRef, useState } from "react";
import { Search, MessageSquare, Paperclip, AtSign, Smile, Download, FileText, Phone } from "lucide-react";
import { toast } from "sonner";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { useListMessages, type ChatAttachment } from "@/features/lists/use-list-messages";
import { formatFileSize } from "@/lib/file-utils";
import { domainErrorMessage } from "@/lib/domain-error";
import { cn } from "@/lib/utils";

const MAX_CHAT_FILE_BYTES = 50 * 1024 * 1024;

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

/**
 * Self-contained List/conversation chat: message timeline + composer, backed by
 * `useListMessages`. Reused by the Team hub and available to the List detail page.
 */
export function ListChatPanel({
  listId,
  placeholderName,
  viewOnly = false,
  className,
}: {
  listId: string;
  placeholderName?: string;
  viewOnly?: boolean;
  className?: string;
}) {
  const chat = useListMessages(listId);
  const [msg, setMsg] = useState("");
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

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

      <div ref={scrollRef} className="mt-3 min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-2">
        {filtered.length === 0 ? (
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
              <div key={m.id} className="flex items-start gap-3">
                <PersonAvatar name={m.author} initials={m.author.slice(0, 2).toUpperCase()} src={m.avatarUrl} size={34} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[12.5px] font-medium text-[#000533]">{m.author}</span>
                    <span className="text-[11px] text-[#757b9e]">
                      {new Date(m.at).toLocaleString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  {m.body ? <p className="mt-0.5 text-[12px] text-[#1a2345]">{m.body}</p> : null}
                  {m.attachment ? <ChatAttachmentView attachment={m.attachment} /> : null}
                </div>
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
        <form
          className="mx-5 mb-4 mt-2 flex items-center gap-2 rounded-[8px] border border-[#e5e7f6] bg-white px-3 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!msg.trim()) return;
            void chat.send.mutateAsync(msg.trim()).then(
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
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            placeholder={uploading ? "Uploading file…" : `Message ${placeholderName ?? "the conversation"}…`}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-[#000533] outline-none placeholder:text-[#6a6b8e]"
          />
          <button type="button" className="cursor-pointer text-[#8487a7] transition-colors hover:text-[#000533]" aria-label="Mention">
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
      )}
    </div>
  );
}
