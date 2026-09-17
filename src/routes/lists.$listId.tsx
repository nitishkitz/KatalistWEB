import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  List,
  FileText,
  Clock,
  RefreshCw,
  CheckCircle2,
  Users,
  Search,
  Filter,
  ArrowUpDown,
  Calendar,
  Sparkles,
  MoreHorizontal,
  Star,
  Plus,
  Mic,
  MessageSquare,
  Mail,
  Pin,
  Send,
  Paperclip,
  AtSign,
  Smile,
  Download,
  FileSpreadsheet,
  FileCode,
  Check,
  Minus,
  Shield,
  ShieldCheck,
  Crown,
  UserPlus,
  UserCheck,
  Pencil,
  PlusCircle,
  Eye,
  X,
  ExternalLink,
  ChevronDown,
  Phone,
  PhoneOff,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { useListCall } from "@/features/calls/use-list-call";
import { ListCallPanel } from "@/features/calls/ListCallPanel";
import { announceCall, getDeviceId } from "@/features/calls/call-lobby";
import { consumeAutojoin, onAutojoin } from "@/features/calls/autojoin-signal";
import { ListDetailSkeleton } from "@/components/katalist/ScreenSkeletons";
import { useSession } from "@/hooks/useSession";
import { supabase } from "@/integrations/supabase/client";
import { MagicBox } from "@/features/court/MagicBox";
import { InlineThingDetailWorkspace } from "@/features/things/InlineThingDetailWorkspace";
import { ThingDetailContent } from "@/features/things/ThingDetailContent";
import { PDFViewer, type ThingFile } from "@/features/things/PDFViewer";
import { formatCourtDue } from "@/features/court/court-view-model";
import { laneOf } from "@/domain/thing";
import { format } from "date-fns";
import { useListThings } from "@/features/lists/use-list-things";
import { useList } from "@/features/lists/use-lists";
import { useLocalVersion } from "@/features/things/use-local-version";
import { useListMessages, type ChatAttachment } from "@/features/lists/use-list-messages";
import { formatFileSize } from "@/lib/file-utils";
import { domainErrorMessage } from "@/lib/domain-error";
import { toast } from "sonner";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { matchAvatarByName } from "@/features/people/directory";
import { useAssignablePeople } from "@/features/people/use-assignable";
import { rpcAddListMember, rpcChangeListRole, rpcRemoveListMember } from "@/features/things/rpc";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/lists/$listId")({
  component: ListDetailPage,
});

type TabType = "things" | "chat" | "members";
type QuickFilterType =
  | "all"
  | "mine"
  | "theirs"
  | "waiting"
  | "progress"
  | "completed"
  | "cancelled"
  | "sorted";
type DueFilterType = "all" | "today" | "overdue" | "no_due";
type SortOption = "due" | "updated" | "importance" | "title";

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

function ListDetailPage() {
  const { listId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  useLocalVersion();
  const { list, isLoading, error } = useList(listId);
  const chat = useListMessages(listId);
  const { things: listThings, myActorId } = useListThings(listId);
  const { user } = useSession();
  // Unique per-device call identity. Using only user.id collides when the same
  // account is open on two devices, so each side would filter the other out as
  // "self" and never connect. A per-session suffix keeps every device distinct.
  const sessionSuffix = useMemo(
    () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10)),
    [],
  );
  const selfId = `${user?.id || myActorId || "anon"}:${sessionSuffix}`;
  const selfName =
    list?.members?.find((m) => m.actorId === myActorId)?.name ||
    (user?.user_metadata?.display_name as string | undefined) ||
    user?.email?.split("@")[0] ||
    "You";
  const call = useListCall(listId, selfId, selfName);

  // Start (or leave) a call. Starting also rings the list's other members.
  const startOrJoinCall = async () => {
    if (call.joined) {
      call.leave();
      return;
    }
    const ok = await call.join();
    if (!ok) return;
    const memberIds = (list?.members ?? [])
      .map((m) => m.profileId)
      .filter((x): x is string => Boolean(x));
    void announceCall({
      listId,
      listName: list?.name ?? "a list",
      fromDeviceId: getDeviceId(),
      fromName: selfName,
      memberIds,
    });
    // Record a call-history entry that renders inline in the chat timeline.
    chat.sendSystem.mutate("started a call");
    // Also push to members who don't have the app open (best-effort).
    try {
      const { data: sess } = await supabase.auth.getSession();
      const at = sess.session?.access_token;
      if (at) {
        void fetch("/api/calls/ring", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${at}` },
          body: JSON.stringify({ listId }),
        });
      }
    } catch {
      // push is best-effort
    }
  };

  // Auto-join when arriving from an incoming-call ring: either the in-app ring
  // (sessionStorage handoff) or a push-notification click (?call=1 in the URL).
  useEffect(() => {
    // Wait until the session identity is ready so the call joins with a real
    // selfId (not "anon"); this effect retries when user?.id arrives.
    const ready = Boolean(user?.id || myActorId);
    if (!ready || call.joined || call.connecting) return;

    let wanted = consumeAutojoin(listId);
    try {
      if (sessionStorage.getItem(`katalist.autojoin.${listId}`)) {
        sessionStorage.removeItem(`katalist.autojoin.${listId}`);
        wanted = true;
      }
    } catch {
      /* ignore */
    }
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("call") === "1") {
      wanted = true;
    }
    if (wanted) void call.join();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listId, user?.id, myActorId, call.joined, call.connecting]);

  // Live delivery: when the ring banner's "Join" is tapped while this list is
  // already open, join immediately (navigating to the same route would not
  // remount the page, so we cannot rely on the effect above).
  useEffect(() => {
    const off = onAutojoin((id) => {
      if (id !== listId) return;
      consumeAutojoin(listId);
      if (!call.joined && !call.connecting) void call.join();
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listId, call.joined, call.connecting]);
  const assignablePeople = useAssignablePeople();

  const [tab, setTab] = useState<TabType>("things");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [navLane, setNavLane] = useState<"now" | "next" | "later">("now");
  const [navSearch, setNavSearch] = useState("");
  const [selectedFile, setSelectedFile] = useState<ThingFile | null>(null);

  // Things tab filters & search
  const [thingsFilter, setThingsFilter] = useState<QuickFilterType>("all");
  const [dueFilter, setDueFilter] = useState<DueFilterType>("all");
  const [personFilter, setPersonFilter] = useState<string | null>(null);
  const [sortOption, setSortOption] = useState<SortOption>("due");

  // Chat tab state
  const [chatSearch, setChatSearch] = useState("");
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const [uploadingFile, setUploadingFile] = useState(false);
  const chatFileInputRef = useRef<HTMLInputElement | null>(null);

  // Members tab state
  const [memberRoleFilter, setMemberRoleFilter] = useState<"all" | "owner" | "collaborator" | "view_only">("all");
  const [memberSearch, setMemberSearch] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteSearch, setInviteSearch] = useState("");
  const [inviteRole, setInviteRole] = useState<"collaborator" | "view_only">("collaborator");
  const [addingPersonId, setAddingPersonId] = useState<string | null>(null);

  const viewOnly = list?.role === "view_only";
  const selected = listThings.find((t) => t.id === selectedId) ?? null;

  // Unique collaborators in this list (deduped by normalized name)
  const listCollaborators = useMemo(() => {
    const map = new Map<string, { id: string; name: string; initials: string; avatarUrl?: string | null; ids: Set<string> }>();

    const recordPerson = (p?: { id?: string; name?: string; initials?: string; avatarUrl?: string | null }) => {
      if (!p || !p.name || p.name === "Someone" || p.name.trim() === "") return;
      const normName = p.name.trim().toLowerCase();
      const existing = map.get(normName);
      if (existing) {
        if (p.id) existing.ids.add(p.id);
        if (!existing.avatarUrl && p.avatarUrl) existing.avatarUrl = p.avatarUrl;
      } else {
        map.set(normName, {
          id: p.id || normName,
          name: p.name.trim(),
          initials: p.initials || p.name.trim().slice(0, 2).toUpperCase(),
          avatarUrl: p.avatarUrl || matchAvatarByName(p.name.trim()),
          ids: new Set(p.id ? [p.id] : []),
        });
      }
    };

    if (list?.members) {
      for (const m of list.members) {
        recordPerson({
          id: m.actorId || m.profileId,
          name: m.name,
          initials: m.initials,
          avatarUrl: m.avatarUrl,
        });
      }
    }
    for (const t of listThings) {
      recordPerson(t.assignee);
      recordPerson(t.owner);
    }
    return Array.from(map.values());
  }, [listThings, list]);

  // Filtered & Sorted Things
  const filteredThings = useMemo(() => {
    const list_ = listThings.filter((t) => {
      // Quick filter
      if (thingsFilter === "mine" && t.assignee.id !== myActorId) return false;
      if (thingsFilter === "theirs" && t.assignee.id === myActorId) return false;
      if (thingsFilter === "waiting" && t.acknowledgement !== "waiting_for_catch") return false;
      if (thingsFilter === "progress" && t.workStatus !== "under_progress") return false;
      if (thingsFilter === "completed" && t.workStatus !== "sorted") return false;
      if (thingsFilter === "cancelled" && t.workStatus !== "cancelled") return false;
      if (thingsFilter === "sorted" && t.workStatus !== "sorted") return false;

      // Person filter
      if (personFilter) {
        const collab = listCollaborators.find(
          (c) => c.name.toLowerCase() === personFilter.toLowerCase() || c.ids.has(personFilter),
        );
        const matchesAssignee =
          t.assignee &&
          (t.assignee.name.toLowerCase() === personFilter.toLowerCase() ||
            (collab?.ids && collab.ids.has(t.assignee.id)));
        const matchesOwner =
          t.owner &&
          (t.owner.name.toLowerCase() === personFilter.toLowerCase() ||
            (collab?.ids && collab.ids.has(t.owner.id)));
        if (!matchesAssignee && !matchesOwner) return false;
      }

      // Due filter
      if (dueFilter === "no_due" && t.dueAt != null) return false;
      if (dueFilter === "today") {
        if (!t.dueAt) return false;
        const d = new Date(t.dueAt);
        const now = new Date();
        const sameDay =
          d.getFullYear() === now.getFullYear() &&
          d.getMonth() === now.getMonth() &&
          d.getDate() === now.getDate();
        if (!sameDay) return false;
      }
      if (dueFilter === "overdue") {
        if (!t.dueAt) return false;
        if (new Date(t.dueAt).getTime() >= Date.now()) return false;
      }

      return true;
    });

    // Sorting
    return [...list_].sort((a, b) => {
      if (sortOption === "due") {
        if (!a.dueAt && !b.dueAt) return 0;
        if (!a.dueAt) return 1;
        if (!b.dueAt) return -1;
        return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
      }
      if (sortOption === "updated") {
        return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
      }
      if (sortOption === "importance") {
        const order: Record<string, number> = { now: 3, next: 2, later: 1 };
        const aVal = order[a.ownerImportance] || 0;
        const bVal = order[b.ownerImportance] || 0;
        return bVal - aVal;
      }
      if (sortOption === "title") {
        return a.title.localeCompare(b.title);
      }
      return 0;
    });
  }, [listThings, thingsFilter, dueFilter, personFilter, myActorId, sortOption, listCollaborators]);

  // Things Metrics (purely dynamic)
  const thingsMetrics = useMemo(() => {
    const total = listThings.length;
    const waiting = listThings.filter((t) => t.acknowledgement === "waiting_for_catch").length;
    const inProgress = listThings.filter((t) => t.workStatus === "under_progress").length;
    const completed = listThings.filter((t) => t.workStatus === "sorted").length;
    const collaboratorsCount = listCollaborators.length;
    return { total, waiting, inProgress, completed, collaboratorsCount };
  }, [listThings, listCollaborators]);

  // Chat search & filter (system call-history entries are always shown)
  const filteredChatMessages = useMemo(() => {
    if (!chatSearch.trim()) return chat.messages;
    const query = chatSearch.toLowerCase();
    return chat.messages.filter(
      (m) =>
        m.kind === "system" ||
        m.body.toLowerCase().includes(query) ||
        m.author.toLowerCase().includes(query),
    );
  }, [chat.messages, chatSearch]);

  // Upload a chat attachment (any file type) and post it as a message.
  const handleChatFile = async (file: File | null | undefined) => {
    if (!file) return;
    const MAX_BYTES = 50 * 1024 * 1024; // 50 MB
    if (file.size > MAX_BYTES) {
      toast.error("That file is larger than 50 MB.");
      return;
    }
    setUploadingFile(true);
    try {
      const attachment = await chat.uploadAttachment(file);
      await chat.send.mutateAsync({ body: msg.trim(), attachment });
      setMsg("");
    } catch (err) {
      toast.error(domainErrorMessage(err));
    } finally {
      setUploadingFile(false);
      if (chatFileInputRef.current) chatFileInputRef.current.value = "";
    }
  };

  // Members search & filter
  const filteredMembers = useMemo(() => {
    const rawMembers = list?.members ?? [];
    const seen = new Set<string>();
    const deduped: typeof rawMembers = [];

    for (const m of rawMembers) {
      const key = (m.name || "").toLowerCase().trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      if (m.profileId) seen.add(m.profileId);
      deduped.push(m);
    }

    return deduped.filter((m) => {
      if (memberRoleFilter !== "all" && m.role !== memberRoleFilter) return false;
      if (memberSearch.trim()) {
        const query = memberSearch.toLowerCase();
        return m.name.toLowerCase().includes(query);
      }
      return true;
    });
  }, [list?.members, memberRoleFilter, memberSearch]);

  // ── Things three-pane derived state ──────────────────────────────────────
  const grouped = useMemo(() => {
    const g: Record<"now" | "next" | "later", typeof filteredThings> = { now: [], next: [], later: [] };
    for (const t of filteredThings) g[laneOf(t)].push(t);
    return g;
  }, [filteredThings]);
  const laneTabs = [
    { id: "now" as const, label: "Now", color: "#fe1016" },
    { id: "next" as const, label: "NEXT", color: "#022dfb" },
    { id: "later" as const, label: "LATER", color: "#5c0bed" },
  ];
  const laneThings = useMemo(
    () => grouped[navLane].filter((t) => t.title.toLowerCase().includes(navSearch.trim().toLowerCase())),
    [grouped, navLane, navSearch],
  );
  const activeThing = selected ?? laneThings[0] ?? filteredThings[0] ?? null;
  const selTint =
    navLane === "next"
      ? { bg: "#eef4ff", border: "#0b62f8" }
      : navLane === "later"
        ? { bg: "#f4f0ff", border: "#641dfb" }
        : { bg: "#fef0f4", border: "#fe0734" };
  // Reset/auto-select the file preview whenever the active Thing changes so a
  // previous Thing's image never stays on screen; a Thing with files shows its
  // first file, a Thing without files shows no preview.
  const activeThingId = activeThing?.id ?? null;
  useEffect(() => {
    setSelectedFile(activeThing?.files?.[0] ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThingId]);

  if (isLoading) {
    return (
      <AppShell noPadding hideTopNav>
        <ListDetailSkeleton />
      </AppShell>
    );
  }

  if (error) {
    return (
      <AppShell title="List" subtitle="Couldn’t load">
        <p className="text-sm text-muted-foreground">{domainErrorMessage(error)}</p>
      </AppShell>
    );
  }

  if (!list) {
    return (
      <AppShell title="List" subtitle="Not found">
        <Link to="/lists" className="text-sm text-primary">
          Back to Lists
        </Link>
      </AppShell>
    );
  }

  const roleBadgeLabel =
    list.role === "owner" ? "Role: Owner" : list.role === "view_only" ? "Role: View only" : "Role: Collaborator";

  const ownerMembers = filteredMembers.filter((m) => m.role === "owner");
  const collaboratorMembers = filteredMembers.filter((m) => m.role === "collaborator" || (!m.role && m.role !== "owner" && m.role !== "view_only"));
  const viewOnlyMembers = filteredMembers.filter((m) => m.role === "view_only");

  const listInitials =
    list.name
      .split(" ")
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "L";

  return (
    <AppShell noPadding hideTopNav>
      <div className="min-h-screen bg-[#edf2fe] px-4 py-3 space-y-3 pb-20">
        {/* List sub-header + tabs card */}
        <div className="rounded-[10px] bg-white">
          <div className="flex flex-wrap items-center justify-between gap-4 px-5 pt-4 pb-3">
            <div className="flex flex-wrap items-center gap-4">
              <Link
                to="/lists"
                className="inline-flex items-center gap-2 rounded-full text-[12.5px] font-medium text-[#6a769c] hover:text-[#000533] transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>Back to List</span>
              </Link>
              <div className="h-8 w-px bg-[#eef0f6]" />
              <div className="flex items-center gap-2.5">
                {list.coverUrl ? (
                  <img
                    src={list.coverUrl}
                    alt=""
                    className="h-11 w-11 shrink-0 rounded-[6px] object-cover"
                    style={{ viewTransitionName: `list-cover-${list.id}` }}
                  />
                ) : (
                  <span
                    className="flex h-11 w-11 items-center justify-center rounded-[6px] bg-[#fee19c] text-[12px] font-medium text-black"
                    style={{ viewTransitionName: `list-cover-${list.id}` }}
                  >
                    {listInitials}
                  </span>
                )}
                <div className="min-w-0">
                  <div
                    className="text-[15px] font-medium text-black leading-tight truncate max-w-[220px]"
                    style={{ viewTransitionName: `list-title-${list.id}` }}
                  >
                    {list.name}
                  </div>
                  <div className="text-[12px] text-[#6a769c]">{list.ownerLine}</div>
                </div>
              </div>
              {listCollaborators.length > 0 && (
                <div className="flex items-center gap-3 pl-1">
                  <button
                    type="button"
                    onClick={() => setPersonFilter(null)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors cursor-pointer",
                      personFilter === null
                        ? "border-[#c9c4fc] bg-[#f5f4fe] text-black"
                        : "border-transparent text-[#6a769c] hover:text-black",
                    )}
                  >
                    <Users className="h-3.5 w-3.5 text-[#503188]" />
                    All People
                  </button>
                  {listCollaborators.slice(0, 3).map((person) => (
                    <button
                      key={person.id}
                      type="button"
                      onClick={() =>
                        setPersonFilter((cur) => (cur === person.id ? null : person.id))
                      }
                      className={cn(
                        "inline-flex items-center gap-1.5 text-[12px] font-medium transition-opacity cursor-pointer",
                        personFilter && personFilter !== person.id ? "opacity-50 hover:opacity-100" : "text-black",
                      )}
                      title={`Filter by ${person.name}`}
                    >
                      <PersonAvatar
                        name={person.name}
                        initials={person.initials}
                        src={person.avatarUrl}
                        size={24}
                      />
                      <span>{person.name.split(" ")[0]}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => void startOrJoinCall()}
              disabled={call.connecting}
              className={cn(
                "inline-flex h-[42px] items-center gap-2 rounded-[9px] px-4 text-[14px] font-medium transition cursor-pointer disabled:opacity-60",
                call.joined
                  ? "bg-[#fc404d] text-white hover:brightness-95"
                  : "border border-[#eaeffa] bg-white text-[#1d1d1d] hover:bg-muted/40",
              )}
              title={call.joined ? "Leave call" : "Start or join a call with this list"}
            >
              {call.joined ? <PhoneOff className="h-4 w-4" /> : <Phone className="h-4 w-4" />}
              <span>{call.connecting ? "Connecting…" : call.joined ? "Leave call" : "Call"}</span>
            </button>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-8 border-t border-[#eef0f6] px-5">
            {(
              [
                ["things", "Things"],
                ["chat", "Chat"],
                ["members", "Members & Permissions"],
              ] as const
            ).map(([id, label]) => {
              const active = tab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={cn(
                    "relative py-3 text-[13.5px] transition-colors outline-none cursor-pointer",
                    active ? "text-[#000533] font-medium" : "text-[#6a769c] hover:text-[#000533] font-normal",
                  )}
                >
                  {label}
                  {active && (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-[#975ee2]" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ========================================================================= */}
        {/* TAB 1: THINGS */}
        {/* ========================================================================= */}
        {tab === "things" && (
              <div className="flex flex-col min-h-0 gap-3 h-[calc(100vh-9.5rem)]">
                <div className="flex min-h-0 flex-1 gap-3">
                {/* Navigator card */}
                <aside className="flex w-[340px] shrink-0 flex-col min-h-0 overflow-hidden rounded-[10px] bg-white">
                  <div className="flex items-center gap-5 border-b border-[#e2e4f5] px-5 pt-4">
                    {laneTabs.map((lt) => {
                      const active = navLane === lt.id;
                      return (
                        <button
                          key={lt.id}
                          type="button"
                          onClick={() => {
                            setNavLane(lt.id);
                            setSelectedId(null);
                          }}
                          style={{ color: lt.color }}
                          className={cn(
                            "relative pb-2.5 text-[15px] whitespace-nowrap transition-all cursor-pointer",
                            active ? "font-medium" : "font-normal opacity-90 hover:opacity-100",
                          )}
                        >
                          <span>
                            {lt.label} <span className="text-[12.5px]">{grouped[lt.id].length}</span>
                          </span>
                          {active && (
                            <span
                              className="absolute -bottom-px left-0 right-0 h-0.5 rounded-full"
                              style={{ backgroundColor: lt.id === "now" ? "#fe0734" : lt.color }}
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>

                  <div className="px-4 pt-3 pb-2">
                    <div className="relative flex items-center">
                      <Search className="absolute left-3 h-4 w-4 text-[#8487a7] pointer-events-none" />
                      <input
                        value={navSearch}
                        onChange={(e) => setNavSearch(e.target.value)}
                        placeholder="Search Things..."
                        className="h-[40px] w-full rounded-[10px] border border-[#ebecf7] bg-[#f9f9fe] pl-9 pr-3 text-[12px] text-[#000533] placeholder:text-[#8487a7] outline-none focus:border-[#975ee2] transition-colors"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between border-b border-[#eef0f6] px-4 py-2 text-[11.5px]">
                    <div className="flex items-center gap-1.5 font-medium text-[#8487a7]">
                      <List className="h-3.5 w-3.5 text-[#5f5f90]" />
                      <span>{laneThings.length} Things</span>
                    </div>
                  </div>

                  <div className="flex-1 overflow-auto min-h-0 p-2">
                    {laneThings.map((thing) => {
                      const isSelected = thing.id === activeThing?.id;
                      const due = formatCourtDue(thing);
                      const isSorted = thing.workStatus === "sorted";
                      const inProgress =
                        !isSorted &&
                        thing.workStatus !== "cancelled" &&
                        (thing.workStatus === "under_progress" || thing.acknowledgement === "caught");
                      const isWaiting = thing.acknowledgement === "waiting_for_catch";
                      return (
                        <div
                          key={thing.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedId(thing.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setSelectedId(thing.id);
                            }
                          }}
                          style={
                            isSelected
                              ? { backgroundColor: selTint.bg, borderColor: selTint.border }
                              : undefined
                          }
                          className={cn(
                            "relative flex items-start justify-between gap-2.5 rounded-[10px] p-3 transition-colors cursor-pointer",
                            isSelected
                              ? "border-l-[3px]"
                              : "border-l-[3px] border-transparent hover:bg-[#f9f9fe]",
                          )}
                        >
                          <div className="flex min-w-0 flex-1 items-start gap-2.5">
                            <PersonAvatar
                              name={thing.assignee.name}
                              initials={thing.assignee.initials}
                              src={thing.assignee.avatarUrl}
                              size={24}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[12.5px] font-medium leading-snug text-[#000533]">
                                {thing.title}
                              </p>
                              <div className="mt-1 flex flex-col gap-0.5 text-[11px]">
                                {due.label && due.label !== "No due date" ? (
                                  <span
                                    className="font-medium"
                                    style={{ color: due.urgent ? "#fe1e26" : "#525d87" }}
                                  >
                                    {due.label}
                                  </span>
                                ) : null}
                                {(thing.unreadCommentCount ?? 0) > 0 ? (
                                  <span className="font-medium text-[#0242f5]">
                                    {thing.unreadCommentCount} new{" "}
                                    {thing.unreadCommentCount === 1 ? "comment" : "comments"}
                                  </span>
                                ) : (thing.commentCount ?? 0) > 0 ? (
                                  <span className="font-medium text-[#8487a7]">
                                    {thing.commentCount}{" "}
                                    {thing.commentCount === 1 ? "comment" : "comments"}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </div>
                          <div className="shrink-0 pt-0.5">
                            <span className="inline-flex items-center gap-1.5 text-[10px] text-[#8186a5]">
                              <span
                                className="h-3 w-3 rounded-full border-2 bg-white"
                                style={{
                                  borderColor: inProgress
                                    ? "#247cfc"
                                    : isWaiting
                                      ? "#f59e0b"
                                      : "#626d96",
                                }}
                              />
                              <span>
                                {isWaiting
                                  ? "Waiting"
                                  : inProgress
                                    ? "Under Progress"
                                    : isSorted
                                      ? "Sorted"
                                      : "Not Started"}
                              </span>
                            </span>
                          </div>
                        </div>
                      );
                    })}
                    {laneThings.length === 0 && (
                      <div className="py-8 text-center text-[11px] text-muted-foreground">
                        No Things in this lane.
                      </div>
                    )}
                  </div>
                </aside>

                {/* Right: detail | preview */}
                <div className="flex flex-1 flex-col min-h-0 overflow-hidden rounded-[10px] bg-white">
                  <div className="flex flex-1 flex-row min-h-0 overflow-hidden">
                    <div className="flex-1 min-h-0 overflow-auto bg-[#fefdfd] px-8 pt-6 pb-8">
                      <div className="mx-auto w-full max-w-3xl">
                        {activeThing ? (
                          <ThingDetailContent
                            key={activeThing.id}
                            initialThing={activeThing}
                            headerAction={null}
                            onAfterTerminalAction={() => setSelectedId(null)}
                            variant="court"
                            viewOnly={viewOnly}
                            onFileSelect={(file) => setSelectedFile(file)}
                          />
                        ) : (
                          <div className="flex min-h-[320px] items-center justify-center text-[12px] text-muted-foreground">
                            No Things in this list yet.
                          </div>
                        )}
                      </div>
                    </div>
                    {selectedFile && (
                      <PDFViewer
                        file={selectedFile}
                        addedByName={activeThing?.creator.name}
                        addedLabel={
                          activeThing?.updatedAt
                            ? format(new Date(activeThing.updatedAt), "MMM d, h:mm a")
                            : undefined
                        }
                      />
                    )}
                  </div>
                </div>
                </div>

                {/* Toss composer — outside the detail container */}
                {!viewOnly && (
                  <div className="flex shrink-0 justify-center">
                    <div className="w-full max-w-2xl">
                      <MagicBox
                        listId={list.id}
                        listName={list.name}
                        desktop
                        extraPeople={list.members.map((m) => ({
                          id: m.actorId || m.profileId || m.name,
                          name: m.name,
                          initials: m.initials,
                          avatarUrl: m.avatarUrl,
                          actorId: m.actorId,
                          profileId: m.profileId,
                        }))}
                      />
                    </div>
                  </div>
                )}
              </div>
          )}

        {/* ========================================================================= */}
        {/* TAB 2: CHAT */}
        {/* ========================================================================= */}
        {tab === "chat" && (
          <div className="flex min-h-0 flex-col gap-3 h-[calc(100vh-9.5rem)] lg:flex-row">
            {/* Left: List Chat panel */}
            <div className="flex min-h-0 flex-1 flex-col rounded-[10px] bg-white p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-[19.75px] font-medium text-[#000533]">List Chat</h2>
                  <p className="mt-1 text-[12px] text-[#6a769c]">
                    Conversation for {list.name} • {list.members.length} members
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setChatSearchOpen((o) => {
                      if (o) setChatSearch("");
                      return !o;
                    });
                  }}
                  title="Search messages"
                  aria-label="Search messages"
                  aria-pressed={chatSearchOpen}
                  className={cn(
                    "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors",
                    chatSearchOpen ? "bg-[#f0e9fb] text-[#975ee2]" : "text-[#8487a7] hover:bg-[#f4f5fb]",
                  )}
                >
                  <Search className="h-4 w-4" />
                </button>
              </div>

              {chatSearchOpen && (
                <div className="mt-3">
                  <div className="relative flex items-center">
                    <Search className="absolute left-3 h-4 w-4 text-[#8487a7] pointer-events-none" />
                    <input
                      autoFocus
                      value={chatSearch}
                      onChange={(e) => setChatSearch(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          setChatSearch("");
                          setChatSearchOpen(false);
                        }
                      }}
                      placeholder="Search messages"
                      className="h-[38px] w-full rounded-[10px] border border-[#ebecf7] bg-[#f9f9fe] pl-9 pr-3 text-[12px] text-[#000533] placeholder:text-[#8487a7] outline-none focus:border-[#975ee2] transition-colors"
                    />
                  </div>
                </div>
              )}

              <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
                {filteredChatMessages.length === 0 ? (
                  <div className="py-12 text-center">
                    <MessageSquare className="mx-auto mb-1.5 h-7 w-7 text-[#c5cae0]" />
                    <p className="text-[12.5px] font-medium text-[#000533]">No messages yet</p>
                    <p className="mt-0.5 text-[11px] text-[#6a769c]">
                      {viewOnly ? "There are no messages in this room." : "Start the conversation below."}
                    </p>
                  </div>
                ) : (
                  filteredChatMessages.map((m) =>
                    m.kind === "system" ? (
                      <div key={m.id} className="flex items-center justify-center gap-2 py-1">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f4f5fb] px-3 py-1 text-[11px] text-[#6a769c]">
                          <Phone className="h-3 w-3 text-[#12a15f]" />
                          <span className="font-medium text-[#000533]">{m.author}</span>
                          {m.body}
                          <span className="text-[#a3a9c9]">
                            ·{" "}
                            {new Date(m.at).toLocaleString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </span>
                      </div>
                    ) : (
                      <div key={m.id} className="flex items-start gap-3">
                        <PersonAvatar
                          name={m.author}
                          initials={m.author.slice(0, 2).toUpperCase()}
                          src={m.avatarUrl}
                          size={34}
                        />
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
                <p className="mt-3 rounded-[8px] bg-[#f6f8fd] p-2.5 text-center text-[11.5px] text-[#6a769c]">
                  View-only members can observe the conversation and comment on Things.
                </p>
              ) : (
                <form
                  className="mt-4 flex items-center gap-2 rounded-[8px] border border-[#e5e7f6] bg-white px-3 py-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!msg.trim()) return;
                    void chat.send.mutateAsync(msg.trim()).then(
                      () => setMsg(""),
                      (err) => toast.error(domainErrorMessage(err)),
                    );
                  }}
                >
                  <input
                    ref={chatFileInputRef}
                    type="file"
                    className="hidden"
                    onChange={(e) => void handleChatFile(e.target.files?.[0])}
                  />
                  <button
                    type="button"
                    onClick={() => chatFileInputRef.current?.click()}
                    disabled={uploadingFile}
                    className="text-[#8487a7] hover:text-[#000533] transition-colors cursor-pointer disabled:opacity-40"
                    aria-label="Attach file"
                    title="Attach a file"
                  >
                    <Paperclip className="h-4 w-4" />
                  </button>
                  <input
                    value={msg}
                    onChange={(e) => setMsg(e.target.value)}
                    placeholder={uploadingFile ? "Uploading file…" : `Message ${list.name}....`}
                    className="min-w-0 flex-1 bg-transparent text-[13px] text-[#000533] outline-none placeholder:text-[#6a6b8e]"
                  />
                  <button
                    type="button"
                    className="text-[#8487a7] hover:text-[#000533] transition-colors cursor-pointer"
                    aria-label="Mention"
                  >
                    <AtSign className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className="text-[#8487a7] hover:text-[#000533] transition-colors cursor-pointer"
                    aria-label="Emoji"
                  >
                    <Smile className="h-4 w-4" />
                  </button>
                  <button
                    type="submit"
                    disabled={!msg.trim()}
                    className="inline-flex h-[34px] items-center rounded-[6px] bg-[#975ee2] px-4 text-[13px] font-medium text-white hover:brightness-95 transition disabled:opacity-40 cursor-pointer"
                  >
                    Send
                  </button>
                </form>
              )}
            </div>

            {/* Right: List info sidebar */}
            <div className="w-full shrink-0 min-h-0 overflow-y-auto rounded-[10px] bg-white p-5 lg:w-[440px]">
              <h2 className="text-[22px] font-medium text-[#000533]">{list.name}</h2>

              <div className="mt-4 flex items-stretch">
                <div className="flex-1 pr-4">
                  <div className="text-[22px] font-medium text-[#000533]">{list.members.length}</div>
                  <div className="text-[11.5px] text-[#6a769c]">members</div>
                </div>
                <div className="flex-1 border-l border-[#eef0f6] pl-4">
                  <div className="text-[22px] font-medium text-[#000533]">{listThings.length}</div>
                  <div className="text-[11.5px] text-[#6a769c]">Things</div>
                </div>
              </div>

              <div className="mt-4 flex items-center -space-x-2">
                {list.members.slice(0, 4).map((m) => (
                  <PersonAvatar
                    key={m.profileId || m.actorId || m.name}
                    name={m.name}
                    initials={m.initials}
                    src={m.avatarUrl}
                    size={40}
                    className="ring-2 ring-white"
                  />
                ))}
                {list.members.length > 4 && (
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f0effe] text-[13px] font-medium text-[#975ee2] ring-2 ring-white">
                    +{list.members.length - 4}
                  </span>
                )}
              </div>

              {/* Members */}
              <div className="mt-6 flex items-center justify-between border-t border-[#eef0f6] pt-4">
                <span className="text-[14.5px] font-medium text-[#000128]">Members</span>
                <button
                  type="button"
                  onClick={() => setTab("members")}
                  className="text-[12.5px] font-medium text-[#975ee2] hover:opacity-80 cursor-pointer"
                >
                  See all {list.members.length}
                </button>
              </div>
              <div className="mt-3 space-y-3">
                {list.members.slice(0, 3).map((m) => (
                  <div
                    key={m.profileId || m.actorId || m.name}
                    className="flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2.5">
                      <PersonAvatar name={m.name} initials={m.initials} src={m.avatarUrl} size={32} />
                      <span className="text-[14px] font-medium text-[#000128]">{m.name}</span>
                    </div>
                    <span
                      className={cn(
                        "text-[12.5px]",
                        m.role === "owner" ? "font-medium text-[#975ee2]" : "text-[#717793]",
                      )}
                    >
                      {m.role === "owner" ? "Owner" : m.role === "view_only" ? "View only" : "Collaborator"}
                    </span>
                  </div>
                ))}
              </div>

              {/* Recent Things */}
              <div className="mt-6 flex items-center justify-between border-t border-[#eef0f6] pt-4">
                <span className="text-[14.5px] font-medium text-[#000128]">Recent Things</span>
                <button
                  type="button"
                  onClick={() => setTab("things")}
                  className="text-[12.5px] font-medium text-[#975ee2] hover:opacity-80 cursor-pointer"
                >
                  See all
                </button>
              </div>
              <div className="mt-3 space-y-2.5">
                {listThings.slice(0, 2).map((thing) => {
                  const due = formatCourtDue(thing);
                  return (
                    <button
                      key={thing.id}
                      type="button"
                      onClick={() => {
                        setTab("things");
                        setSelectedId(thing.id);
                      }}
                      className="flex w-full items-center gap-3 rounded-[11px] border border-[#f3f6fb] bg-white p-3 text-left hover:bg-[#f9f9fe] transition-colors cursor-pointer"
                    >
                      <span className="h-5 w-5 shrink-0 rounded-full border-2 border-[#cfd6e6]" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13.5px] font-medium text-[#000128]">
                          {thing.title}
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-[12px]">
                          <span className="rounded-full bg-[#e6ecfd] px-2 py-0.5 text-[#975ee2]">
                            {thing.workStatus === "sorted"
                              ? "Sorted"
                              : thing.acknowledgement === "caught" || thing.workStatus === "under_progress"
                                ? "Under Progress"
                                : "Not Started"}
                          </span>
                          {thing.dueAt && (
                            <span className="inline-flex items-center gap-1 text-[#666e94]">
                              <Calendar className="h-3 w-3" />
                              Due {due.label}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
                {listThings.length === 0 && (
                  <p className="text-[12px] text-[#6a769c]">No Things yet.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: MEMBERS & PERMISSIONS */}
        {/* ========================================================================= */}
        {tab === "members" && (
          <div>
            <div className="flex flex-col gap-3 lg:flex-row">
              {/* Left: members management card */}
              <div className="flex-1 rounded-[10px] bg-white p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-[19.75px] font-medium text-[#000533]">Members &amp; Permissions</h2>
                    <p className="mt-1 text-[12px] font-medium text-[#6a769c]">
                      Control who can see and move Things in {list.name}.
                    </p>
                  </div>
                  {list.role === "owner" && (
                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => {
                          if (typeof navigator !== "undefined" && navigator.clipboard) {
                            void navigator.clipboard.writeText(window.location.href);
                          }
                          toast.success("Invite link copied");
                        }}
                        className="inline-flex h-[42px] items-center gap-2 rounded-[10px] border border-[#ebf1fd] bg-[#f6f8fd] px-3.5 text-[12px] font-medium text-[#1b2031] hover:brightness-95 transition cursor-pointer"
                      >
                        <Paperclip className="h-3.5 w-3.5" />
                        Copy invite link
                      </button>
                      <button
                        type="button"
                        onClick={() => setInviting(true)}
                        className="inline-flex h-[42px] items-center gap-2 rounded-[10px] bg-[#1d2335] px-3.5 text-[12px] font-medium text-white hover:brightness-110 transition cursor-pointer"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Invite people
                      </button>
                    </div>
                  )}
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-2.5">
                  <label className="flex h-[42px] min-w-[220px] flex-1 items-center gap-2 rounded-[10px] border border-[#ebecf7] bg-[#f9f9fe] px-3">
                    <Search className="h-4 w-4 text-[#8487a7]" />
                    <input
                      value={memberSearch}
                      onChange={(e) => setMemberSearch(e.target.value)}
                      placeholder="Search members"
                      className="min-w-0 flex-1 bg-transparent text-[12px] text-[#000533] outline-none placeholder:text-[#8487a7]"
                    />
                  </label>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex h-[42px] items-center gap-2 rounded-[10px] border border-[#ebf1fd] bg-[#f6f8fd] px-3.5 text-[12px] font-medium text-[#2548fb] cursor-pointer"
                      >
                        {memberRoleFilter === "all"
                          ? "All Roles"
                          : memberRoleFilter === "view_only"
                            ? "View Only"
                            : memberRoleFilter === "owner"
                              ? "Owner"
                              : "Collaborator"}
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40 bg-white">
                      <DropdownMenuRadioGroup
                        value={memberRoleFilter}
                        onValueChange={(v) => setMemberRoleFilter(v as typeof memberRoleFilter)}
                      >
                        <DropdownMenuRadioItem value="all" className="text-[12px]">All Roles</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="owner" className="text-[12px]">Owner</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="collaborator" className="text-[12px]">Collaborator</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="view_only" className="text-[12px]">View Only</DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {/* Member groups */}
                <div className="mt-5 space-y-5">
                  {(
                    [
                      { key: "owner", title: `Owner (${ownerMembers.length})`, members: ownerMembers },
                      { key: "collaborator", title: `Collaborators (${collaboratorMembers.length})`, members: collaboratorMembers },
                      { key: "view_only", title: `View Only (${viewOnlyMembers.length})`, members: viewOnlyMembers },
                    ] as const
                  ).map((group) =>
                    group.members.length === 0 ? null : (
                      <div key={group.key} className="space-y-2.5">
                        <h3 className="text-[15px] font-medium text-[#000533]">{group.title}</h3>
                        {group.members.map((m) => {
                          const memberId = m.profileId || m.actorId || m.name;
                          const role = group.key;
                          const badge =
                            role === "owner"
                              ? { bg: "#edeafe", text: "#2a14a8", label: "Owner" }
                              : role === "collaborator"
                                ? { bg: "#e9f0fd", text: "#975ee2", label: "Collaborator" }
                                : { bg: "#f2f2fb", text: "#484872", label: "View Only" };
                          const capability =
                            role === "owner"
                              ? "Can manage list and members"
                              : role === "collaborator"
                                ? "Can create, edit, catch, pace and reassign Things"
                                : "Can view list and Things";
                          const rowBg =
                            role === "owner" ? "bg-[#f9f9fe]" : role === "collaborator" ? "bg-[#fdfdfe]" : "bg-white";
                          const canManage = list.role === "owner" && role !== "owner";
                          return (
                            <div
                              key={memberId}
                              className={cn(
                                "flex items-center gap-3 rounded-[11px] border border-[#f4f4fc] px-4 py-2.5",
                                rowBg,
                              )}
                            >
                              <PersonAvatar name={m.name} initials={m.initials} src={m.avatarUrl} size={40} />
                              <div className="min-w-0 flex-1">
                                <div className="text-[12.5px] font-medium text-[#000533]">{m.name}</div>
                                <div className="text-[11.4px] text-[#686c8d]">{capability}</div>
                              </div>
                              <span
                                className="hidden shrink-0 rounded-[9px] px-3 py-1.5 text-[11.4px] sm:inline-block"
                                style={{ backgroundColor: badge.bg, color: badge.text }}
                              >
                                {badge.label}
                              </span>
                              {canManage ? (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <button
                                      type="button"
                                      className="inline-flex h-[38px] w-[124px] shrink-0 items-center justify-between rounded-[6px] border border-[#e8e9f7] bg-[#fdfdfe] px-3 text-[11.4px] text-[#686c8d] cursor-pointer"
                                    >
                                      {role === "collaborator" ? "Collaborator" : "View only"}
                                      <ChevronDown className="h-3.5 w-3.5" />
                                    </button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="w-48 bg-white">
                                    <DropdownMenuItem
                                      onClick={async () => {
                                        try {
                                          await rpcChangeListRole(
                                            list.id,
                                            memberId,
                                            role === "collaborator" ? "view_only" : "collaborator",
                                          );
                                          toast.success(`Updated ${m.name}'s role`);
                                          await qc.invalidateQueries({ queryKey: ["list", listId] });
                                          await qc.invalidateQueries({ queryKey: ["lists"] });
                                        } catch (err: any) {
                                          toast.error(err?.message || "Failed to update role");
                                        }
                                      }}
                                      className="text-[12px]"
                                    >
                                      {role === "collaborator" ? (
                                        <>
                                          <Eye className="mr-2 h-3.5 w-3.5 text-emerald-500" /> Make View only
                                        </>
                                      ) : (
                                        <>
                                          <Users className="mr-2 h-3.5 w-3.5 text-blue-500" /> Make Collaborator
                                        </>
                                      )}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      className="text-[12px] text-destructive focus:text-destructive"
                                      onClick={async () => {
                                        try {
                                          await rpcRemoveListMember(list.id, memberId);
                                          toast.success(`Removed ${m.name} from list`);
                                          await qc.invalidateQueries({ queryKey: ["list", listId] });
                                          await qc.invalidateQueries({ queryKey: ["lists"] });
                                          await qc.invalidateQueries({ queryKey: ["assignable-people"] });
                                        } catch (err: any) {
                                          toast.error(err?.message || "Failed to remove member");
                                        }
                                      }}
                                    >
                                      <X className="mr-2 h-3.5 w-3.5 text-destructive" /> Remove from list
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              ) : (
                                <span className="inline-flex h-[38px] w-[124px] shrink-0 items-center gap-1.5 rounded-[6px] border border-[#eeeffb] bg-[#f6f6fd] px-3 text-[11.4px] text-[#686c8d]">
                                  <Crown className="h-3.5 w-3.5 text-[#d9a441]" />
                                  {badge.label}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ),
                  )}
                  {filteredMembers.length === 0 && (
                    <p className="py-8 text-center text-[12px] text-[#6a769c]">No members match this filter.</p>
                  )}
                </div>
              </div>

              {/* Right: Permission Guide */}
              <div className="w-full shrink-0 space-y-3 lg:w-[360px]">
                <div className="rounded-[10px] bg-white p-5">
                  <h3 className="text-[18px] font-medium text-[#000533]">Permission Guide</h3>
                  <div className="mt-4 space-y-4">
                    {[
                      {
                        icon: <Users className="h-5 w-5" />,
                        circle: "bg-[#ede8fe] text-[#975ee2]",
                        label: "Collaborator",
                        desc: "Create, edit, catch pace and reassign Things",
                      },
                      {
                        icon: <Eye className="h-5 w-5" />,
                        circle: "bg-[#e6ecfd] text-[#3b6ff5]",
                        label: "View Only",
                        desc: "Read List and Things",
                      },
                      {
                        icon: <Crown className="h-5 w-5" />,
                        circle: "bg-[#fdeede] text-[#d9822b]",
                        label: "Owner",
                        desc: "Manage members, roles and list",
                      },
                    ].map((g) => (
                      <div key={g.label} className="flex items-center gap-3">
                        <span
                          className={cn(
                            "flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
                            g.circle,
                          )}
                        >
                          {g.icon}
                        </span>
                        <div className="min-w-0">
                          <div className="text-[14px] font-medium text-[#000533]">{g.label}</div>
                          <div className="text-[11px] text-[#6a769c]">{g.desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Invite Member Modal */}
            {inviting && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
                <div className="w-full max-w-lg rounded-2xl border border-border bg-white p-6 shadow-xl animate-in fade-in zoom-in-95 max-h-[90vh] flex flex-col">
                  {/* Header */}
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-[16px] font-bold text-foreground">Invite to {list.name}</h2>
                      <p className="mt-0.5 text-[12px] text-muted-foreground">
                        Add people from your team or invite external collaborators.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setInviting(false)}
                      className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Role Selector */}
                  <div className="mt-4">
                    <label className="block text-[11.5px] font-semibold text-foreground mb-1.5">
                      Permission Role to Grant
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setInviteRole("collaborator")}
                        className={cn(
                          "flex items-center justify-center gap-2 rounded-xl border py-2 text-[12px] font-medium transition-all cursor-pointer",
                          inviteRole === "collaborator"
                            ? "border-primary bg-primary/10 font-semibold text-primary"
                            : "border-border/80 bg-white text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <Users className="h-3.5 w-3.5" />
                        Collaborator
                      </button>
                      <button
                        type="button"
                        onClick={() => setInviteRole("view_only")}
                        className={cn(
                          "flex items-center justify-center gap-2 rounded-xl border py-2 text-[12px] font-medium transition-all cursor-pointer",
                          inviteRole === "view_only"
                            ? "border-primary bg-primary/10 font-semibold text-primary"
                            : "border-border/80 bg-white text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <Eye className="h-3.5 w-3.5" />
                        View only
                      </button>
                    </div>
                  </div>

                  {/* Search Your Team */}
                  <div className="mt-4 flex-1 flex flex-col min-h-0">
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[11.5px] font-semibold text-foreground">
                        Your Team Members
                      </label>
                      <span className="text-[11px] text-muted-foreground font-medium">
                        {assignablePeople.length} contacts
                      </span>
                    </div>

                    <label className="flex h-9 items-center gap-2 rounded-xl border border-border/80 bg-muted/20 px-3 shadow-2xs focus-within:border-primary focus-within:bg-white transition-all">
                      <Search className="h-3.5 w-3.5 text-muted-foreground" />
                      <input
                        value={inviteSearch}
                        onChange={(e) => setInviteSearch(e.target.value)}
                        placeholder="Search team members by name..."
                        className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-muted-foreground"
                      />
                      {inviteSearch && (
                        <button type="button" onClick={() => setInviteSearch("")} className="text-muted-foreground hover:text-foreground">
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </label>

                    {/* Team Members List */}
                    <div className="mt-2.5 space-y-1.5 max-h-[200px] overflow-y-auto pr-1">
                      {assignablePeople
                        .filter((p) => {
                          if (!inviteSearch.trim()) return true;
                          return p.name.toLowerCase().includes(inviteSearch.toLowerCase());
                        })
                        .map((person) => {
                          const isAlreadyMember =
                            (list.members || []).some(
                              (m) =>
                                (person.profileId && m.profileId === person.profileId) ||
                                m.profileId === person.id ||
                                m.actorId === person.id ||
                                m.name.toLowerCase() === person.name.toLowerCase(),
                            ) ||
                            list.ownerActorId === person.id ||
                            (person.profileId && list.ownerActorId === person.profileId);

                          const isAdding = addingPersonId === person.id;

                          return (
                            <div
                              key={person.id}
                              className="flex items-center justify-between rounded-xl border border-border/60 bg-white p-2.5 hover:bg-muted/30 transition-colors"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <PersonAvatar
                                  name={person.name}
                                  initials={person.initials}
                                  src={person.avatarUrl}
                                  size={28}
                                />
                                <div className="min-w-0">
                                  <span className="block truncate text-[12.5px] font-bold text-foreground">
                                    {person.name}
                                  </span>
                                  <span className="block text-[10.5px] text-muted-foreground">
                                    Connected teammate
                                  </span>
                                </div>
                              </div>

                              {isAlreadyMember ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-600 border border-emerald-200/60">
                                  <Check className="h-3 w-3" />
                                  In List
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  disabled={isAdding}
                                  onClick={async () => {
                                    setAddingPersonId(person.id);
                                    try {
                                      await rpcAddListMember(list.id, person.profileId || person.id, inviteRole);
                                      toast.success(`Added ${person.name} as ${inviteRole === "collaborator" ? "Collaborator" : "View only"}`);
                                      await qc.invalidateQueries({ queryKey: ["list", listId] });
                                      await qc.invalidateQueries({ queryKey: ["lists"] });
                                      await qc.invalidateQueries({ queryKey: ["assignable-people"] });
                                    } catch (err: any) {
                                      toast.error(err?.message || "Couldn't add team member. Please try again.");
                                    } finally {
                                      setAddingPersonId(null);
                                    }
                                  }}
                                  className="inline-flex items-center gap-1 rounded-lg bg-primary/10 hover:bg-primary hover:text-white px-2.5 py-1 text-[11.5px] font-semibold text-primary transition-all disabled:opacity-50 cursor-pointer"
                                >
                                  <Plus className="h-3 w-3" />
                                  {isAdding ? "Adding..." : "Add"}
                                </button>
                              )}
                            </div>
                          );
                        })}

                      {assignablePeople.length === 0 && (
                        <div className="py-4 text-center text-[12px] text-muted-foreground">
                          No team members found in directory.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* External Email Invite Section */}
                  <form
                    className="mt-4 pt-3 border-t border-border/70"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!inviteEmail.trim()) return;
                      toast.success(`Invitation sent to ${inviteEmail.trim()}`);
                      setInviteEmail("");
                    }}
                  >
                    <label className="block text-[11.5px] font-semibold text-foreground mb-1">
                      Or invite by email address
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="email"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        placeholder="colleague@company.com"
                        className="h-9 flex-1 rounded-xl border border-border px-3 text-[12px] outline-none focus:border-primary focus:ring-2 focus:ring-ring"
                      />
                      <button
                        type="submit"
                        disabled={!inviteEmail.trim()}
                        className="h-9 rounded-xl bg-slate-900 px-3 text-[12px] font-semibold text-white shadow-xs transition-all hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                      >
                        Send Invite
                      </button>
                    </div>
                  </form>

                  {/* Modal Footer */}
                  <div className="mt-4 flex justify-end">
                    <button
                      type="button"
                      className="h-8 rounded-xl border border-border px-4 text-[12.5px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                      onClick={() => setInviting(false)}
                    >
                      Done
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <ListCallPanel call={call} selfName={selfName} listId={listId} />
    </AppShell>
  );
}
