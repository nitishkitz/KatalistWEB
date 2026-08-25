import { format } from "date-fns";
import { toast } from "sonner";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { domainErrorMessage } from "@/lib/domain-error";
import type { ReturnTypeUseListMessages } from "./use-list-messages";

export function ListChatPanel({ chat, message, onMessage }: { chat: ReturnTypeUseListMessages; message: string; onMessage: (value: string) => void }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <p className="mb-3 text-[12px] text-muted-foreground">List Chat is shared room conversation. Thing comments stay on each Thing.</p>
      <div className="mb-3 max-h-[28rem] space-y-2 overflow-y-auto">
        {chat.messages.length === 0 ? <p className="text-[13px] text-muted-foreground">No messages yet.</p> : chat.messages.map((message) => (
          <div key={message.id} className="flex gap-2 rounded-lg bg-muted/40 px-3 py-2">
            <PersonAvatar name={message.author} initials={message.initials} src={message.avatarUrl} size={28} />
            <div className="min-w-0"><div className="flex items-baseline gap-2"><span className="text-[12px] font-semibold">{message.author}</span><time className="text-[10px] text-muted-foreground">{format(new Date(message.at), "MMM d · h:mm a")}</time></div><p className="text-[13px] leading-relaxed">{message.body}</p></div>
          </div>
        ))}
      </div>
      <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); if (!message.trim() || chat.send.isPending) return; void chat.send.mutateAsync(message.trim()).then(() => onMessage(""), (error) => toast.error(domainErrorMessage(error))); }}>
        <input value={message} onChange={(event) => onMessage(event.target.value)} placeholder="Message the List" className="h-9 flex-1 rounded-lg border border-border bg-background px-3 text-[13px]" />
        <button type="submit" disabled={chat.send.isPending || !message.trim()} className="rounded-lg bg-primary px-4 text-[13px] text-primary-foreground disabled:opacity-50">Send</button>
      </form>
    </section>
  );
}
