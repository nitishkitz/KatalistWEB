import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
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
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { MagicBox } from "@/features/court/MagicBox";
import { InlineThingDetailWorkspace } from "@/features/things/InlineThingDetailWorkspace";
import { useListThings } from "@/features/lists/use-list-things";
import { useList } from "@/features/lists/use-lists";
import { useLocalVersion } from "@/features/things/use-local-version";
import { useListMessages } from "@/features/lists/use-list-messages";
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

function ListDetailPage() {
  const { listId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  useLocalVersion();
  const { list, isLoading, error } = useList(listId);
  const chat = useListMessages(listId);
  const { things: listThings, myActorId } = useListThings(listId);
  const assignablePeople = useAssignablePeople();

  const [tab, setTab] = useState<TabType>("things");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Things tab filters & search
  const [thingsFilter, setThingsFilter] = useState<QuickFilterType>("all");
  const [dueFilter, setDueFilter] = useState<DueFilterType>("all");
  const [personFilter, setPersonFilter] = useState<string | null>(null);
  const [sortOption, setSortOption] = useState<SortOption>("due");

  // Chat tab state
  const [chatSearch, setChatSearch] = useState("");
  const [msg, setMsg] = useState("");

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

  // Chat search & filter
  const filteredChatMessages = useMemo(() => {
    if (!chatSearch.trim()) return chat.messages;
    const query = chatSearch.toLowerCase();
    return chat.messages.filter(
      (m) => m.body.toLowerCase().includes(query) || m.author.toLowerCase().includes(query),
    );
  }, [chat.messages, chatSearch]);

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

  if (isLoading) {
    return (
      <AppShell title="List" subtitle="Loading">
        <p className="text-sm text-muted-foreground">Opening this List…</p>
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

  return (
    <AppShell
      title={list.name}
      subtitle={
        <span className="flex items-center gap-2">
          <span className="capitalize">{list.context}</span>
          <span>•</span>
          <span>{list.ownerLine}</span>
          <span className="inline-flex items-center rounded-full border border-purple-200/80 bg-purple-50 px-2 py-0.5 text-[10.5px] font-semibold text-purple-700">
            {roleBadgeLabel}
          </span>
        </span>
      }
    >
      <div className="space-y-4 pb-20">
        {/* Top Navigation Tabs with Clean Underlines */}
        <div className="border-b border-border/80">
          <div className="flex items-center gap-6">
            <button
              type="button"
              onClick={() => setTab("things")}
              className={cn(
                "relative pb-3 text-[13.5px] font-semibold transition-colors outline-none",
                tab === "things"
                  ? "text-primary border-b-2 border-primary font-bold -mb-px"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Things
            </button>
            <button
              type="button"
              onClick={() => setTab("chat")}
              className={cn(
                "relative pb-3 text-[13.5px] font-semibold transition-colors outline-none",
                tab === "chat"
                  ? "text-primary border-b-2 border-primary font-bold -mb-px"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Chat
            </button>
            <button
              type="button"
              onClick={() => setTab("members")}
              className={cn(
                "relative pb-3 text-[13.5px] font-semibold transition-colors outline-none",
                tab === "members"
                  ? "text-primary border-b-2 border-primary font-bold -mb-px"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Members & Permissions
            </button>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* TAB 1: THINGS */}
        {/* ========================================================================= */}
        {tab === "things" && (
          <>
            {/* Top 5-Item Dynamic Summary Ribbon */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 divide-x divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-white shadow-xs">
              {/* 1. Total Things */}
              <div className="flex items-center gap-3 p-2.5 px-3.5">
                <span className="text-2xl font-black text-foreground tabular-nums leading-none shrink-0 min-w-[24px]">
                  {thingsMetrics.total}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 leading-none">
                    <FileText className="h-3.5 w-3.5 shrink-0 text-purple-600" />
                    <span className="text-[10.5px] font-black text-purple-600 uppercase tracking-wide">TOTAL</span>
                  </div>
                  <span className="mt-1 block truncate text-[10.5px] text-muted-foreground font-medium">All Things</span>
                </div>
              </div>

              {/* 2. Waiting for catch */}
              <div className="flex items-center gap-3 p-2.5 px-3.5">
                <span className="text-2xl font-black text-foreground tabular-nums leading-none shrink-0 min-w-[24px]">
                  {thingsMetrics.waiting}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 leading-none">
                    <Clock className="h-3.5 w-3.5 shrink-0 text-orange-500" />
                    <span className="text-[10.5px] font-black text-orange-600 uppercase tracking-wide">WAITING</span>
                  </div>
                  <span className="mt-1 block truncate text-[10.5px] text-muted-foreground font-medium">For catch</span>
                </div>
              </div>

              {/* 3. In progress */}
              <div className="flex items-center gap-3 p-2.5 px-3.5">
                <span className="text-2xl font-black text-foreground tabular-nums leading-none shrink-0 min-w-[24px]">
                  {thingsMetrics.inProgress}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 leading-none">
                    <RefreshCw className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                    <span className="text-[10.5px] font-black text-blue-600 uppercase tracking-wide">IN PROGRESS</span>
                  </div>
                  <span className="mt-1 block truncate text-[10.5px] text-muted-foreground font-medium">Moving</span>
                </div>
              </div>

              {/* 4. Completed */}
              <div className="flex items-center gap-3 p-2.5 px-3.5">
                <span className="text-2xl font-black text-foreground tabular-nums leading-none shrink-0 min-w-[24px]">
                  {thingsMetrics.completed}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 leading-none">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    <span className="text-[10.5px] font-black text-emerald-600 uppercase tracking-wide">COMPLETED</span>
                  </div>
                  <span className="mt-1 block truncate text-[10.5px] text-muted-foreground font-medium">Sorted & done</span>
                </div>
              </div>

              {/* 5. Collaborators */}
              <div className="flex items-center gap-3 p-2.5 px-3.5">
                <span className="text-2xl font-black text-foreground tabular-nums leading-none shrink-0 min-w-[24px]">
                  {thingsMetrics.collaboratorsCount}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 leading-none">
                    <Users className="h-3.5 w-3.5 shrink-0 text-slate-600" />
                    <span className="text-[10.5px] font-black text-slate-600 uppercase tracking-wide">MEMBERS</span>
                  </div>
                  <span className="mt-1 block truncate text-[10.5px] text-muted-foreground font-medium">Collaborators</span>
                </div>
              </div>
            </div>

            {/* Quick Status Filter Pills & Views */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    ["all", "All"],
                    ["mine", "Mine"],
                    ["theirs", "Theirs"],
                    ["waiting", "Waiting"],
                    ["progress", "In Progress"],
                    ["completed", "Completed"],
                    ["cancelled", "Cancelled"],
                    ["sorted", "● Sorted"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setThingsFilter(id)}
                    className={cn(
                      "inline-flex h-8 items-center rounded-full border px-3 text-[11.5px] font-medium transition-all duration-200",
                      thingsFilter === id
                        ? "border-primary bg-primary/10 font-semibold text-primary shadow-2xs"
                        : "border-border/80 bg-white text-muted-foreground hover:border-primary/40 hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-border/80 bg-white px-3 text-[11.5px] font-medium text-foreground shadow-2xs hover:bg-muted/40"
                    >
                      <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>
                        Sort: {sortOption === "due" ? "Due date" : sortOption === "importance" ? "Importance" : sortOption === "title" ? "Title (A-Z)" : "Updated"}
                      </span>
                      <ChevronDown className="h-3 w-3 text-muted-foreground" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44 bg-white">
                    <DropdownMenuRadioGroup
                      value={sortOption}
                      onValueChange={(v) => setSortOption(v as SortOption)}
                    >
                      <DropdownMenuRadioItem value="due" className="text-[12px]">
                        Due date
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="importance" className="text-[12px]">
                        Importance
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="title" className="text-[12px]">
                        Title (A–Z)
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="updated" className="text-[12px]">
                        Recently updated
                      </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* People & Due Date Sub-Filter Row */}
            <div className="flex flex-wrap items-center gap-6 rounded-xl border border-border/60 bg-muted/20 px-4 py-2 text-[11.5px]">
              {/* People filter */}
              <div className="flex items-center gap-2">
                <span className="font-semibold text-muted-foreground">People</span>
                <button
                  type="button"
                  onClick={() => setPersonFilter(null)}
                  className={cn(
                    "rounded-full px-2.5 py-0.5 font-medium transition-colors",
                    personFilter === null
                      ? "bg-purple-100 font-semibold text-purple-700"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  All
                </button>
                <div className="flex items-center -space-x-1 pl-1">
                  {listCollaborators.map((person) => {
                    const active =
                      personFilter !== null &&
                      (personFilter.toLowerCase() === person.name.toLowerCase() ||
                        person.ids.has(personFilter));
                    return (
                      <button
                        key={person.name}
                        type="button"
                        title={person.name}
                        onClick={() => setPersonFilter(active ? null : person.name)}
                        className={cn(
                          "relative rounded-full transition-all outline-none cursor-pointer",
                          active ? "ring-2 ring-primary ring-offset-1 scale-110" : "opacity-80 hover:opacity-100",
                        )}
                      >
                        <PersonAvatar
                          name={person.name}
                          initials={person.initials}
                          src={person.avatarUrl}
                          size={22}
                          className="ring-2 ring-white"
                        />
                      </button>
                    );
                  })}
                </div>
              </div>

              <span className="h-4 w-px bg-border/80" />

              {/* Due filter */}
              <div className="flex items-center gap-2">
                <span className="font-semibold text-muted-foreground">Due</span>
                <button
                  type="button"
                  onClick={() => setDueFilter(dueFilter === "today" ? "all" : "today")}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-medium transition-colors",
                    dueFilter === "today"
                      ? "border-purple-300 bg-purple-50 text-purple-700 font-semibold"
                      : "border-border/80 bg-white text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Calendar className="h-3 w-3" />
                  Due today
                </button>
                <button
                  type="button"
                  onClick={() => setDueFilter(dueFilter === "overdue" ? "all" : "overdue")}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-medium transition-colors",
                    dueFilter === "overdue"
                      ? "border-red-300 bg-red-50 text-red-700 font-semibold"
                      : "border-border/80 bg-white text-red-600/80 hover:text-red-700",
                  )}
                >
                  <Calendar className="h-3 w-3" />
                  Overdue
                </button>
                <button
                  type="button"
                  onClick={() => setDueFilter(dueFilter === "no_due" ? "all" : "no_due")}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-medium transition-colors",
                    dueFilter === "no_due"
                      ? "border-purple-300 bg-purple-50 text-purple-700 font-semibold"
                      : "border-border/80 bg-white text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Calendar className="h-3 w-3" />
                  No due date
                </button>
              </div>
            </div>

            {/* Things Table with Inline Detail Workspace */}
            <InlineThingDetailWorkspace
              thing={selected}
              onClose={() => setSelectedId(null)}
              viewOnly={viewOnly}
              backLabel={list.name}
              items={filteredThings}
              onSelectThing={(id) => setSelectedId(id)}
              navTitle={list.name}
            >
              <div className="overflow-hidden rounded-2xl border border-border/70 bg-white shadow-2xs">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left">
                  <thead>
                    <tr className="border-b border-border/60 bg-muted/20 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                      <th className="px-4 py-3 font-semibold whitespace-nowrap">Thing</th>
                      <th className="px-3 py-3 font-semibold whitespace-nowrap">Owner Importance</th>
                      <th className="px-3 py-3 font-semibold whitespace-nowrap">My Pace</th>
                      <th className="px-3 py-3 font-semibold whitespace-nowrap">With</th>
                      <th className="px-3 py-3 font-semibold whitespace-nowrap">Ack</th>
                      <th className="px-3 py-3 font-semibold whitespace-nowrap">Status</th>
                      <th className="px-3 py-3 font-semibold whitespace-nowrap">Due</th>
                      <th className="px-3 py-3 font-semibold whitespace-nowrap">From</th>
                      <th className="py-3 pr-4 text-right whitespace-nowrap" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60 text-[12.5px]">
                    {filteredThings.map((thing) => {
                      const isWaiting = thing.acknowledgement === "waiting_for_catch";
                      const importanceColor =
                        thing.ownerImportance === "now"
                          ? "text-red-600 font-bold"
                          : thing.ownerImportance === "next"
                            ? "text-blue-600 font-semibold"
                            : "text-purple-600 font-semibold";
                      const paceColor =
                        thing.personalPace === "now"
                          ? "text-red-600 font-bold"
                          : thing.personalPace === "next"
                            ? "text-blue-600 font-semibold"
                            : thing.personalPace === "later"
                              ? "text-purple-600 font-semibold"
                              : "text-muted-foreground";

                      const statusLabel =
                        thing.workStatus === "sorted"
                          ? "Sorted"
                          : thing.workStatus === "cancelled"
                            ? "Cancelled"
                            : thing.workStatus === "under_progress"
                              ? "Under progress"
                              : "Not started";
                      const statusDotColor =
                        thing.workStatus === "sorted"
                          ? "bg-emerald-500"
                          : thing.workStatus === "under_progress"
                            ? "bg-blue-500"
                            : "bg-muted-foreground/60";

                      const isSelected = selectedId === thing.id;

                      return (
                        <tr
                          key={thing.id}
                          className={cn(
                            "group cursor-pointer transition-colors hover:bg-muted/30",
                            isSelected && "bg-primary/10 font-semibold border-l-4 border-l-primary",
                          )}
                          onClick={() => setSelectedId(thing.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setSelectedId(thing.id);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                        >
                          {/* Title + Star */}
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toast.success(thing.starred ? "Unstarred" : "Starred");
                                }}
                                className="text-muted-foreground hover:text-amber-500"
                              >
                                <Star
                                  className={cn(
                                    "h-4 w-4",
                                    thing.starred ? "fill-amber-400 text-amber-400" : "text-muted-foreground/50",
                                  )}
                                />
                              </button>
                              <span className="font-medium text-foreground truncate max-w-[220px]">
                                {thing.title}
                              </span>
                            </div>
                          </td>

                          {/* Owner Importance */}
                          <td className="px-3 py-3 whitespace-nowrap">
                            <span className={cn("uppercase text-[11px]", importanceColor)}>
                              {thing.ownerImportance}
                            </span>
                          </td>

                          {/* My Pace */}
                          <td className="px-3 py-3 whitespace-nowrap">
                            <span className={cn("uppercase text-[11px]", paceColor)}>
                              {thing.personalPace || "—"}
                            </span>
                          </td>

                          {/* With */}
                          <td className="px-3 py-3 whitespace-nowrap">
                            <PersonAvatar
                              name={thing.assignee.name}
                              initials={thing.assignee.initials}
                              src={thing.assignee.avatarUrl}
                              size={22}
                            />
                          </td>

                          {/* Ack */}
                          <td className="px-3 py-3 whitespace-nowrap">
                            {isWaiting ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-orange-600">
                                <Clock className="h-3.5 w-3.5 text-orange-500" />
                                Waiting for catch
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                                <Check className="h-3.5 w-3.5 text-emerald-500" />
                                Caught
                              </span>
                            )}
                          </td>

                          {/* Status */}
                          <td className="px-3 py-3 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-foreground">
                              <span className={cn("h-1.5 w-1.5 rounded-full", statusDotColor)} />
                              {statusLabel}
                            </span>
                          </td>

                          {/* Due */}
                          <td className="px-3 py-3 text-[11.5px] text-muted-foreground whitespace-nowrap">
                            {thing.dueAt ? (
                              <span className="inline-flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {new Date(thing.dueAt).toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                })}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                —
                              </span>
                            )}
                          </td>

                          {/* From */}
                          <td className="px-3 py-3 text-[11.5px] text-muted-foreground whitespace-nowrap">
                            {list.name}
                          </td>

                          {/* Actions */}
                          <td className="py-3 pr-4 text-right whitespace-nowrap">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  type="button"
                                  onClick={(e) => e.stopPropagation()}
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground opacity-60 hover:bg-muted hover:opacity-100"
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-40 bg-white">
                                <DropdownMenuItem onClick={() => setSelectedId(thing.id)}>
                                  View Details
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {filteredThings.length === 0 ? (
                <div className="py-12 text-center text-[13px] text-muted-foreground">
                  No things found matching this filter.
                </div>
              ) : null}

              {/* Table Footer */}
              <div className="flex items-center justify-between border-t border-border/60 px-5 py-3 text-[12px] text-muted-foreground">
                <span>
                  Showing 1–{filteredThings.length} of {listThings.length} things
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled
                    className="flex h-7 w-7 items-center justify-center rounded border border-border bg-white text-muted-foreground opacity-50"
                  >
                    &lt;
                  </button>
                  <span className="flex h-7 min-w-7 items-center justify-center rounded bg-primary px-2 text-[11px] font-bold text-primary-foreground">
                    1
                  </span>
                  <button
                    type="button"
                    disabled
                    className="flex h-7 w-7 items-center justify-center rounded border border-border bg-white text-muted-foreground opacity-50"
                  >
                    &gt;
                  </button>
                </div>
              </div>
            </div>

            </InlineThingDetailWorkspace>
            {!viewOnly && !selectedId && <MagicBox listId={list.id} listName={list.name} desktop />}
          </>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: CHAT */}
        {/* ========================================================================= */}
        {tab === "chat" && (
          <div className="space-y-3">
            {/* Compact Chat Meta Ribbon */}
            <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-border/70 bg-white px-3.5 py-2 shadow-2xs">
              <div className="flex items-center gap-3 text-[12px]">
                <span className="flex items-center gap-1.5 font-bold text-foreground">
                  <MessageSquare className="h-3.5 w-3.5 text-primary" />
                  <span>{chat.messages.length} messages</span>
                </span>
                <span className="text-muted-foreground/50">•</span>
                <span className="flex items-center gap-1.5 text-muted-foreground font-medium">
                  <Users className="h-3.5 w-3.5 text-blue-500" />
                  <span>{list.members.length} members</span>
                </span>
                <span className="text-muted-foreground/50">•</span>
                <span className="inline-flex items-center rounded-full bg-purple-50 border border-purple-200/60 px-2 py-0.5 text-[10.5px] font-semibold text-purple-700 capitalize">
                  {list.role.replace("_", " ")}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Pin className="h-3 w-3 text-purple-600" />
                  <span>List Chat is room conversation</span>
                </span>
              </div>
            </div>

            {/* Chat 2-Column Grid */}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              {/* Left Column: Chat Stream */}
              <div className="flex flex-col justify-between rounded-xl border border-border/70 bg-white p-3.5 shadow-2xs lg:col-span-2 min-h-[440px]">
                <div>
                  {/* Top Bar with Filter */}
                  <div className="mb-3 flex items-center justify-between gap-3 border-b border-border/50 pb-2.5">
                    <span className="text-[12.5px] font-bold text-foreground">Room Conversation</span>

                    <label className="flex h-7.5 w-48 items-center gap-1.5 rounded-lg border border-border bg-white px-2 focus-within:border-primary">
                      <Search className="h-3 w-3 text-muted-foreground" />
                      <input
                        value={chatSearch}
                        onChange={(e) => setChatSearch(e.target.value)}
                        placeholder="Search messages..."
                        className="min-w-0 flex-1 bg-transparent text-[11px] outline-none"
                      />
                    </label>
                  </div>

                  {/* Dynamic Message Thread */}
                  <div className="space-y-3 max-h-[340px] overflow-y-auto pr-1.5">
                    {filteredChatMessages.length === 0 ? (
                      <div className="py-12 text-center">
                        <MessageSquare className="mx-auto h-7 w-7 text-muted-foreground/30 mb-1.5" />
                        <p className="text-[12.5px] font-semibold text-foreground">No messages yet</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {viewOnly
                            ? "There are no messages in this room."
                            : "Start the conversation with your team below."}
                        </p>
                      </div>
                    ) : (
                      filteredChatMessages.map((m) => (
                        <div key={m.id} className="flex items-start gap-2.5">
                          <PersonAvatar
                            name={m.author}
                            initials={m.author.slice(0, 2).toUpperCase()}
                            size={26}
                          />
                          <div className="space-y-0.5 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[11.5px] font-bold text-foreground">{m.author}</span>
                              <span className="text-[10px] text-muted-foreground">
                                {new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                              </span>
                            </div>
                            <div className="rounded-xl rounded-tl-xs bg-muted/40 px-3 py-1.5 text-[12.5px] text-foreground inline-block">
                              {m.body}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Floating Bottom Input Bar */}
                {viewOnly ? (
                  <p className="mt-3 rounded-xl bg-muted/30 p-2.5 text-center text-[11.5px] text-muted-foreground">
                    View Only members can observe conversation and comment on Things.
                  </p>
                ) : (
                  <form
                    className="mt-3 flex items-center gap-2 rounded-xl border border-border bg-muted/20 p-1 focus-within:border-primary focus-within:bg-white focus-within:ring-2 focus-within:ring-ring"
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
                      value={msg}
                      onChange={(e) => setMsg(e.target.value)}
                      placeholder={`Message ${list.name}...`}
                      className="min-w-0 flex-1 bg-transparent px-2.5 text-[12.5px] outline-none placeholder:text-muted-foreground"
                    />
                    <button
                      type="submit"
                      disabled={!msg.trim()}
                      className="flex h-7.5 w-7.5 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-2xs transition-transform hover:scale-105 active:scale-95 disabled:opacity-40"
                    >
                      <Send className="h-3.5 w-3.5" />
                    </button>
                  </form>
                )}
              </div>

              {/* Right Column: Dynamic Room Collaborators & Guidelines */}
              <div className="space-y-3">
                {/* 1. Room Collaborators */}
                <div className="rounded-xl border border-border/70 bg-white p-3.5 shadow-2xs">
                  <div className="flex items-center justify-between mb-2.5">
                    <div className="flex items-center gap-1.5 font-bold text-[12px] text-foreground">
                      <Users className="h-3.5 w-3.5 text-primary" />
                      <span>Room Members ({list.members.length})</span>
                    </div>
                  </div>
                  <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1">
                    {list.members.map((m) => (
                      <div
                        key={m.profileId || m.actorId || m.name}
                        className="flex items-center justify-between rounded-lg border border-border/50 p-2 hover:bg-muted/20"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <PersonAvatar name={m.name} initials={m.initials} src={m.avatarUrl} size={24} />
                          <div className="truncate">
                            <span className="font-semibold text-[11.5px] block truncate leading-tight">{m.name}</span>
                            <span className="text-[10px] text-muted-foreground capitalize">
                              {m.role ? m.role.replace("_", " ") : "Collaborator"}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 2. Room Guidelines */}
                <div className="rounded-xl border border-purple-100 bg-purple-50/50 p-3">
                  <div className="flex items-start gap-2">
                    <Shield className="h-3.5 w-3.5 text-purple-700 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-[11.5px] font-bold text-purple-950">Room Privacy & Rules</h4>
                      <p className="mt-0.5 text-[10.5px] text-purple-800/80 leading-relaxed">
                        Messages are visible to list members. Thing comments stay attached to individual Things.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: MEMBERS & PERMISSIONS */}
        {/* ========================================================================= */}
        {tab === "members" && (
          <div className="space-y-4">
            {/* Top 5 Members Metrics (Purely Dynamic) */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <div className="flex items-center gap-3 rounded-2xl border border-border/70 bg-white p-3.5 shadow-2xs">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-purple-100 bg-purple-50 text-purple-600">
                  <UserPlus className="h-5 w-5" />
                </div>
                <div>
                  <span className="text-2xl font-bold leading-none text-foreground">
                    {list.members.length}
                  </span>
                  <span className="block text-[11px] font-medium text-muted-foreground mt-0.5">
                    Total members
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3 rounded-2xl border border-border/70 bg-white p-3.5 shadow-2xs">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-orange-100 bg-orange-50 text-orange-600">
                  <Crown className="h-5 w-5" />
                </div>
                <div>
                  <span className="text-2xl font-bold leading-none text-foreground">
                    {list.members.filter((m) => m.role === "owner").length}
                  </span>
                  <span className="block text-[11px] font-medium text-muted-foreground mt-0.5">
                    Owner
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3 rounded-2xl border border-border/70 bg-white p-3.5 shadow-2xs">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-blue-600">
                  <Users className="h-5 w-5" />
                </div>
                <div>
                  <span className="text-2xl font-bold leading-none text-foreground">
                    {list.members.filter((m) => m.role === "collaborator" || (!m.role && m.role !== "owner" && m.role !== "view_only")).length}
                  </span>
                  <span className="block text-[11px] font-medium text-muted-foreground mt-0.5">
                    Collaborators
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3 rounded-2xl border border-border/70 bg-white p-3.5 shadow-2xs">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-600">
                  <Eye className="h-5 w-5" />
                </div>
                <div>
                  <span className="text-2xl font-bold leading-none text-foreground">
                    {list.members.filter((m) => m.role === "view_only").length}
                  </span>
                  <span className="block text-[11px] font-medium text-muted-foreground mt-0.5">
                    View only
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3 rounded-2xl border border-border/70 bg-white p-3.5 shadow-2xs">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-purple-100 bg-purple-50 text-purple-600">
                  <Shield className="h-5 w-5" />
                </div>
                <div>
                  <span className="text-2xl font-bold leading-none text-foreground capitalize">
                    {list.role.replace("_", " ")}
                  </span>
                  <span className="block text-[11px] font-medium text-muted-foreground mt-0.5">
                    Your Permission
                  </span>
                </div>
              </div>
            </div>

            {/* Main 2-Column Section */}
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
              {/* Left Column: Dynamic Member Lists */}
              <div className="space-y-4 lg:col-span-7">
                {/* Search & Invite Bar */}
                <div className="flex flex-wrap items-center gap-2.5">
                  <label className="flex h-9 flex-1 min-w-[200px] items-center gap-2 rounded-xl border border-border/80 bg-white px-3 shadow-2xs focus-within:border-primary">
                    <Search className="h-4 w-4 text-muted-foreground" />
                    <input
                      value={memberSearch}
                      onChange={(e) => setMemberSearch(e.target.value)}
                      placeholder="Search members..."
                      className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-muted-foreground"
                    />
                  </label>

                  {list.role === "owner" && (
                    <button
                      type="button"
                      onClick={() => setInviting(true)}
                      className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-[12.5px] font-semibold text-primary-foreground shadow-xs hover:bg-primary/90"
                    >
                      <UserPlus className="h-4 w-4" />
                      Invite member
                    </button>
                  )}

                  <div className="flex items-center gap-1">
                    {(["all", "owner", "collaborator", "view_only"] as const).map((rf) => (
                      <button
                        key={rf}
                        type="button"
                        onClick={() => setMemberRoleFilter(rf)}
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-[11px] font-medium capitalize transition-colors",
                          memberRoleFilter === rf
                            ? "border-primary bg-primary/10 font-semibold text-primary"
                            : "border-border/80 bg-white text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {rf === "view_only" ? "View only" : rf}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Member Cards List */}
                <div className="space-y-4 rounded-2xl border border-border/70 bg-white p-4 shadow-2xs">
                  {/* 1. Owner Section */}
                  {ownerMembers.length > 0 && (
                    <div className="space-y-2">
                      <span className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                        <Crown className="h-3.5 w-3.5 text-amber-500" />
                        Owner
                      </span>
                      {ownerMembers.map((m) => (
                        <div
                          key={m.profileId || m.actorId || m.name}
                          className="flex items-center justify-between rounded-xl border border-border/60 p-3 hover:bg-muted/20"
                        >
                          <div className="flex items-center gap-3">
                            <PersonAvatar name={m.name} initials={m.initials} src={m.avatarUrl} size={32} />
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-[13px]">{m.name}</span>
                                <span className="rounded-full bg-purple-100 px-2 py-0.2 text-[10px] font-bold text-purple-700">
                                  Owner
                                </span>
                              </div>
                              <p className="text-[11px] text-muted-foreground">Full access & list management</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <button type="button" className="text-muted-foreground hover:text-foreground">
                              <MoreHorizontal className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 2. Collaborators Section */}
                  {collaboratorMembers.length > 0 && (
                    <div className="space-y-2 pt-2 border-t border-border/60">
                      <span className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                        <Users className="h-3.5 w-3.5 text-blue-500" />
                        Collaborators
                      </span>
                      <div className="space-y-2">
                        {collaboratorMembers.map((m) => (
                          <div
                            key={m.profileId || m.actorId || m.name}
                            className="flex items-center justify-between rounded-xl border border-border/60 p-3 hover:bg-muted/20"
                          >
                            <div className="flex items-center gap-3">
                              <PersonAvatar name={m.name} initials={m.initials} src={m.avatarUrl} size={32} />
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-[13px]">{m.name}</span>
                                  <span className="rounded-full bg-blue-100 px-2 py-0.2 text-[10px] font-bold text-blue-700">
                                    Collaborator
                                  </span>
                                </div>
                                <p className="text-[11px] text-muted-foreground">Can add, edit, and pace Things</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              {list.role === "owner" && (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <button
                                      type="button"
                                      className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted/60 hover:text-foreground cursor-pointer transition-colors"
                                    >
                                      <MoreHorizontal className="h-4 w-4" />
                                    </button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="w-44">
                                    <DropdownMenuItem
                                      onClick={async () => {
                                        try {
                                          await rpcChangeListRole(list.id, m.profileId || m.actorId || m.name, "view_only");
                                          toast.success(`Updated ${m.name}'s role to View only`);
                                          await qc.invalidateQueries({ queryKey: ["list", listId] });
                                          await qc.invalidateQueries({ queryKey: ["lists"] });
                                        } catch (err: any) {
                                          toast.error(err?.message || "Failed to update role");
                                        }
                                      }}
                                    >
                                      <Eye className="mr-2 h-3.5 w-3.5 text-emerald-500" />
                                      Make View only
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      className="text-destructive focus:text-destructive"
                                      onClick={async () => {
                                        try {
                                          await rpcRemoveListMember(list.id, m.profileId || m.actorId || m.name);
                                          toast.success(`Removed ${m.name} from list`);
                                          await qc.invalidateQueries({ queryKey: ["list", listId] });
                                          await qc.invalidateQueries({ queryKey: ["lists"] });
                                          await qc.invalidateQueries({ queryKey: ["assignable-people"] });
                                        } catch (err: any) {
                                          toast.error(err?.message || "Failed to remove member");
                                        }
                                      }}
                                    >
                                      <X className="mr-2 h-3.5 w-3.5 text-destructive" />
                                      Remove from list
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 3. View only Section */}
                  {viewOnlyMembers.length > 0 && (
                    <div className="space-y-2 pt-2 border-t border-border/60">
                      <span className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                        <Eye className="h-3.5 w-3.5 text-emerald-500" />
                        View only
                      </span>
                      <div className="space-y-2">
                        {viewOnlyMembers.map((m) => (
                          <div
                            key={m.profileId || m.actorId || m.name}
                            className="flex items-center justify-between rounded-xl border border-border/60 p-3 hover:bg-muted/20"
                          >
                            <div className="flex items-center gap-3">
                              <PersonAvatar name={m.name} initials={m.initials} src={m.avatarUrl} size={32} />
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-[13px]">{m.name}</span>
                                  <span className="rounded-full bg-emerald-100 px-2 py-0.2 text-[10px] font-bold text-emerald-700">
                                    View only
                                  </span>
                                </div>
                                <p className="text-[11px] text-muted-foreground">Can view list and Things only</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              {list.role === "owner" && (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <button
                                      type="button"
                                      className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted/60 hover:text-foreground cursor-pointer transition-colors"
                                    >
                                      <MoreHorizontal className="h-4 w-4" />
                                    </button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="w-44">
                                    <DropdownMenuItem
                                      onClick={async () => {
                                        try {
                                          await rpcChangeListRole(list.id, m.profileId || m.actorId || m.name, "collaborator");
                                          toast.success(`Updated ${m.name}'s role to Collaborator`);
                                          await qc.invalidateQueries({ queryKey: ["list", listId] });
                                          await qc.invalidateQueries({ queryKey: ["lists"] });
                                        } catch (err: any) {
                                          toast.error(err?.message || "Failed to update role");
                                        }
                                      }}
                                    >
                                      <Users className="mr-2 h-3.5 w-3.5 text-blue-500" />
                                      Make Collaborator
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      className="text-destructive focus:text-destructive"
                                      onClick={async () => {
                                        try {
                                          await rpcRemoveListMember(list.id, m.profileId || m.actorId || m.name);
                                          toast.success(`Removed ${m.name} from list`);
                                          await qc.invalidateQueries({ queryKey: ["list", listId] });
                                          await qc.invalidateQueries({ queryKey: ["lists"] });
                                          await qc.invalidateQueries({ queryKey: ["assignable-people"] });
                                        } catch (err: any) {
                                          toast.error(err?.message || "Failed to remove member");
                                        }
                                      }}
                                    >
                                      <X className="mr-2 h-3.5 w-3.5 text-destructive" />
                                      Remove from list
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {filteredMembers.length === 0 ? (
                    <div className="py-8 text-center text-[12.5px] text-muted-foreground">
                      No members found matching this filter.
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Right Column: Permission Matrix & Info Card */}
              <div className="space-y-4 lg:col-span-5">
                {/* Permission Matrix Table */}
                <div className="overflow-hidden rounded-2xl border border-border/80 bg-white p-5 shadow-2xs">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-100 text-purple-700">
                        <ShieldCheck className="h-4 w-4" />
                      </div>
                      <div>
                        <h3 className="font-bold text-[13.5px] text-foreground leading-none">
                          Permission Matrix
                        </h3>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          Capabilities and access rights by role
                        </p>
                      </div>
                    </div>
                    <span className="rounded-full bg-purple-50 border border-purple-200/60 px-2.5 py-0.5 text-[10.5px] font-semibold text-purple-700">
                      3 Roles
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-center text-[11.5px] border-collapse">
                      <thead>
                        <tr className="border-b border-border/60 text-muted-foreground pb-2">
                          <th className="pb-3 text-left font-semibold text-[11px] uppercase tracking-wider text-muted-foreground">
                            Role
                          </th>
                          <th className="pb-3 px-1.5 font-medium" title="View Things">
                            <span className="flex flex-col items-center gap-1">
                              <Eye className="h-3.5 w-3.5 text-muted-foreground/80" />
                              <span className="text-[10px] font-semibold text-muted-foreground">View</span>
                            </span>
                          </th>
                          <th className="pb-3 px-1.5 font-medium" title="Add Things">
                            <span className="flex flex-col items-center gap-1">
                              <PlusCircle className="h-3.5 w-3.5 text-muted-foreground/80" />
                              <span className="text-[10px] font-semibold text-muted-foreground">Add</span>
                            </span>
                          </th>
                          <th className="pb-3 px-1.5 font-medium" title="Edit Things">
                            <span className="flex flex-col items-center gap-1">
                              <Pencil className="h-3.5 w-3.5 text-muted-foreground/80" />
                              <span className="text-[10px] font-semibold text-muted-foreground">Edit</span>
                            </span>
                          </th>
                          <th className="pb-3 px-1.5 font-medium" title="Assign Things">
                            <span className="flex flex-col items-center gap-1">
                              <UserCheck className="h-3.5 w-3.5 text-muted-foreground/80" />
                              <span className="text-[10px] font-semibold text-muted-foreground">Assign</span>
                            </span>
                          </th>
                          <th className="pb-3 px-1.5 font-medium" title="Reassign Things">
                            <span className="flex flex-col items-center gap-1">
                              <RefreshCw className="h-3.5 w-3.5 text-muted-foreground/80" />
                              <span className="text-[10px] font-semibold text-muted-foreground">Reassign</span>
                            </span>
                          </th>
                          <th className="pb-3 px-1.5 font-medium" title="Manage Members & List">
                            <span className="flex flex-col items-center gap-1">
                              <Users className="h-3.5 w-3.5 text-muted-foreground/80" />
                              <span className="text-[10px] font-semibold text-muted-foreground">Manage</span>
                            </span>
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {/* 1. Owner */}
                        <tr className="hover:bg-purple-50/20 transition-colors">
                          <td className="py-3 text-left">
                            <div className="flex items-center gap-2">
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-purple-100 text-purple-700">
                                <Crown className="h-3.5 w-3.5" />
                              </span>
                              <div>
                                <span className="font-bold text-[12.5px] text-foreground">Owner</span>
                                <span className="block text-[10px] text-muted-foreground">Full control</span>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-1.5">
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200/60 shadow-2xs">
                              <Check className="h-3 w-3 stroke-[2.5]" />
                            </span>
                          </td>
                          <td className="py-3 px-1.5">
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200/60 shadow-2xs">
                              <Check className="h-3 w-3 stroke-[2.5]" />
                            </span>
                          </td>
                          <td className="py-3 px-1.5">
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200/60 shadow-2xs">
                              <Check className="h-3 w-3 stroke-[2.5]" />
                            </span>
                          </td>
                          <td className="py-3 px-1.5">
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200/60 shadow-2xs">
                              <Check className="h-3 w-3 stroke-[2.5]" />
                            </span>
                          </td>
                          <td className="py-3 px-1.5">
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200/60 shadow-2xs">
                              <Check className="h-3 w-3 stroke-[2.5]" />
                            </span>
                          </td>
                          <td className="py-3 px-1.5">
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200/60 shadow-2xs">
                              <Check className="h-3 w-3 stroke-[2.5]" />
                            </span>
                          </td>
                        </tr>

                        {/* 2. Collaborator */}
                        <tr className="hover:bg-blue-50/20 transition-colors">
                          <td className="py-3 text-left">
                            <div className="flex items-center gap-2">
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
                                <Users className="h-3.5 w-3.5" />
                              </span>
                              <div>
                                <span className="font-bold text-[12.5px] text-foreground">Collaborator</span>
                                <span className="block text-[10px] text-muted-foreground">Work & pace</span>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-1.5">
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200/60 shadow-2xs">
                              <Check className="h-3 w-3 stroke-[2.5]" />
                            </span>
                          </td>
                          <td className="py-3 px-1.5">
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200/60 shadow-2xs">
                              <Check className="h-3 w-3 stroke-[2.5]" />
                            </span>
                          </td>
                          <td className="py-3 px-1.5">
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200/60 shadow-2xs">
                              <Check className="h-3 w-3 stroke-[2.5]" />
                            </span>
                          </td>
                          <td className="py-3 px-1.5">
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200/60 shadow-2xs">
                              <Check className="h-3 w-3 stroke-[2.5]" />
                            </span>
                          </td>
                          <td className="py-3 px-1.5">
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200/60 shadow-2xs">
                              <Check className="h-3 w-3 stroke-[2.5]" />
                            </span>
                          </td>
                          <td className="py-3 px-1.5">
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted/40 text-muted-foreground/40">
                              <Minus className="h-2.5 w-2.5 stroke-[2]" />
                            </span>
                          </td>
                        </tr>

                        {/* 3. View only */}
                        <tr className="hover:bg-emerald-50/20 transition-colors">
                          <td className="py-3 text-left">
                            <div className="flex items-center gap-2">
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                                <Eye className="h-3.5 w-3.5" />
                              </span>
                              <div>
                                <span className="font-bold text-[12.5px] text-foreground">View only</span>
                                <span className="block text-[10px] text-muted-foreground">Read & comment</span>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-1.5">
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200/60 shadow-2xs">
                              <Check className="h-3 w-3 stroke-[2.5]" />
                            </span>
                          </td>
                          <td className="py-3 px-1.5">
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted/40 text-muted-foreground/40">
                              <Minus className="h-2.5 w-2.5 stroke-[2]" />
                            </span>
                          </td>
                          <td className="py-3 px-1.5">
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted/40 text-muted-foreground/40">
                              <Minus className="h-2.5 w-2.5 stroke-[2]" />
                            </span>
                          </td>
                          <td className="py-3 px-1.5">
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted/40 text-muted-foreground/40">
                              <Minus className="h-2.5 w-2.5 stroke-[2]" />
                            </span>
                          </td>
                          <td className="py-3 px-1.5">
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted/40 text-muted-foreground/40">
                              <Minus className="h-2.5 w-2.5 stroke-[2]" />
                            </span>
                          </td>
                          <td className="py-3 px-1.5">
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted/40 text-muted-foreground/40">
                              <Minus className="h-2.5 w-2.5 stroke-[2]" />
                            </span>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Owner Governance Shield Banner */}
                <div className="flex items-start gap-3 rounded-2xl border border-purple-200/70 bg-gradient-to-r from-purple-50/80 to-indigo-50/40 p-4 shadow-2xs">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-purple-100 text-purple-700">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="text-[13px] font-bold text-purple-950">
                      Owner Governance
                    </h4>
                    <p className="mt-0.5 text-[11.5px] text-purple-900/80 leading-relaxed">
                      Only list owners can invite members, remove members, or reassign permission roles. Collaborators can create, edit, catch, and pace Things.
                    </p>
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
    </AppShell>
  );
}
