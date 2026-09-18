import { useMemo, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Search, MessageCircle, List as ListIcon, Plus, Users } from "lucide-react";
import { toast } from "sonner";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { usePresence } from "@/features/people/presence";
import { cn } from "@/lib/utils";
import { useConversations, type Conversation } from "@/features/hub/use-conversations";
import { useLists } from "@/features/lists/use-lists";
import { useTeam } from "@/features/people/use-team";
import { isUuid } from "@/features/things/rpc";
import { rpcGetOrCreateDm } from "@/features/hub/rpc";
import { domainErrorMessage } from "@/lib/domain-error";
import { useHub } from "@/features/hub/hub-context";
import { NewGroupDialog } from "./NewGroupDialog";

type RailView = "conversations" | "lists";

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const min = Math.floor((Date.now() - then) / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const d = Math.floor(h / 24);
  if (d === 1) return "Yesterday";
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" });
}

function GroupAvatars({ conversation, size = 36 }: { conversation: Conversation; size?: number }) {
  const shown = conversation.others.slice(0, 2);
  return (
    <span className="relative inline-flex" style={{ width: size, height: size }}>
      {shown.map((p, i) => (
        <PersonAvatar
          key={p.id}
          name={p.name}
          initials={p.initials}
          src={p.avatarUrl}
          size={size * 0.72}
          className={cn("absolute ring-2 ring-white", i === 0 ? "left-0 top-0 z-10" : "bottom-0 right-0")}
        />
      ))}
    </span>
  );
}

export function HubSidebar() {
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { conversationId?: string };
  const activeId = params.conversationId;
  const online = usePresence();
  const { conversations } = useConversations();
  const { lists } = useLists();
  const { members } = useTeam();
  const { openContacts } = useHub();
  const [view, setView] = useState<RailView>("conversations");
  const [query, setQuery] = useState("");
  const [groupOpen, setGroupOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const q = query.trim().toLowerCase();

  const filteredConversations = useMemo(
    () =>
      !q
        ? conversations
        : conversations.filter((c) => c.title.toLowerCase().includes(q) || (c.lastMessage ?? "").toLowerCase().includes(q)),
    [conversations, q],
  );

  const filteredLists = useMemo(
    () => (!q ? lists : lists.filter((l) => l.name.toLowerCase().includes(q))),
    [lists, q],
  );

  // "Search anyone and message": people matching the query who can be DMed.
  const peopleResults = useMemo(() => {
    if (!q) return [];
    return members.filter((m) => isUuid(m.id) && (m.name.toLowerCase().includes(q) || (m.role ?? "").toLowerCase().includes(q)));
  }, [members, q]);

  const openDm = async (personId: string) => {
    if (!isUuid(personId)) return;
    setBusyId(personId);
    try {
      const dm = await rpcGetOrCreateDm(personId);
      setQuery("");
      navigate({ to: "/team/$conversationId", params: { conversationId: dm.id } });
    } catch (err) {
      toast.error(domainErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <aside className="flex w-full shrink-0 flex-col border-r border-[#eef0f6] bg-white md:w-[300px]">
      {/* Search */}
      <div className="p-3">
        <label className="flex h-10 items-center gap-2 rounded-[10px] border border-[#ebecf7] bg-[#f9f9fe] px-3 focus-within:border-[#975ee2]">
          <Search className="h-4 w-4 text-[#8487a7]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people, lists..."
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-[#000533] outline-none placeholder:text-[#8487a7]"
          />
        </label>
      </div>

      {/* View toggle: Conversations / Lists */}
      <div className="mx-3 mb-2 flex items-center gap-1 rounded-[10px] bg-[#f6f7fc] p-1">
        {(["conversations", "lists"] as RailView[]).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-[8px] px-2 py-1.5 text-[12.5px] font-medium capitalize transition-colors",
              view === v ? "bg-white text-[#6638ec] shadow-2xs" : "text-[#6a769c] hover:text-[#000533]",
            )}
          >
            {v === "conversations" ? <MessageCircle className="h-3.5 w-3.5" /> : <ListIcon className="h-3.5 w-3.5" />}
            {v}
          </button>
        ))}
      </div>

      {/* Actions */}
      <div className="flex gap-2 px-3 pb-2">
        <button
          type="button"
          onClick={() => setGroupOpen(true)}
          className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-[#975ee2] text-[12.5px] font-semibold text-white transition hover:brightness-95"
        >
          <Plus className="h-4 w-4" />
          New group
        </button>
        <button
          type="button"
          onClick={openContacts}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[10px] border border-[#ebecf7] px-3 text-[12.5px] font-medium text-[#3d3f74] transition hover:border-[#975ee2]"
        >
          <Users className="h-4 w-4" />
          Contacts
        </button>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {/* People search results (message anyone) */}
        {q && peopleResults.length > 0 && (
          <div className="pb-2">
            <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-[#8487a7]">People</p>
            {peopleResults.map((m) => (
              <button
                key={m.id}
                type="button"
                disabled={busyId === m.id}
                onClick={() => void openDm(m.id)}
                className="flex w-full items-center gap-2.5 rounded-[10px] px-2 py-2 text-left transition-colors hover:bg-[#f6f7fc] disabled:opacity-50"
              >
                <span className="relative shrink-0">
                  <PersonAvatar name={m.name} initials={m.initials} src={m.avatarUrl} size={36} />
                  {online.has(m.id) ? (
                    <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#12a15f]" />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-[#000533]">{m.name}</span>
                  <span className="block truncate text-[11.5px] text-[#6a769c]">{m.role ?? "Message"}</span>
                </span>
                <MessageCircle className="h-4 w-4 shrink-0 text-[#975ee2]" />
              </button>
            ))}
          </div>
        )}

        {/* Conversations view */}
        {view === "conversations" && (
          <>
            <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-[#8487a7]">Conversations</p>
            {filteredConversations.length === 0 ? (
              <p className="px-2 py-6 text-center text-[12px] text-[#6a769c]">
                No conversations yet. Search a name above or open Contacts to start one.
              </p>
            ) : (
              filteredConversations.map((c) => {
                const isOnline = c.kind === "dm" && c.others[0] ? online.has(c.others[0].id) : false;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => navigate({ to: "/team/$conversationId", params: { conversationId: c.id } })}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-[10px] px-2 py-2 text-left transition-colors",
                      activeId === c.id ? "bg-[#f0e9fb]" : "hover:bg-[#f6f7fc]",
                    )}
                  >
                    <span className="relative shrink-0">
                      {c.kind === "dm" ? <PersonAvatar name={c.title} src={c.avatarUrl} size={36} /> : <GroupAvatars conversation={c} />}
                      {isOnline ? (
                        <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#12a15f]" />
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13px] font-semibold text-[#000533]">{c.title}</span>
                        <span className="shrink-0 text-[10.5px] text-[#8487a7]">{relativeTime(c.lastAt)}</span>
                      </span>
                      <span className="block truncate text-[11.5px] text-[#6a769c]">
                        {c.lastMessage || (c.kind === "group" ? `${c.memberCount} members` : "Say hello")}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </>
        )}

        {/* Lists view */}
        {view === "lists" && (
          <>
            <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-[#8487a7]">Lists</p>
            {filteredLists.length === 0 ? (
              <p className="px-2 py-6 text-center text-[12px] text-[#6a769c]">No lists in this mode.</p>
            ) : (
              filteredLists.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => navigate({ to: "/team/$conversationId", params: { conversationId: l.id } })}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-[10px] px-2 py-2 text-left transition-colors",
                    activeId === l.id ? "bg-[#f0e9fb]" : "hover:bg-[#f6f7fc]",
                  )}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[9px] bg-[#f0e9fb] text-[#6638ec]">
                    {l.coverUrl ? <img src={l.coverUrl} alt="" className="h-full w-full object-cover" /> : <ListIcon className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-[#000533]">{l.name}</span>
                    <span className="block truncate text-[11.5px] text-[#6a769c]">
                      {l.memberCount} {l.memberCount === 1 ? "member" : "members"}
                    </span>
                  </span>
                </button>
              ))
            )}
          </>
        )}
      </div>

      <NewGroupDialog open={groupOpen} onOpenChange={setGroupOpen} />
    </aside>
  );
}
