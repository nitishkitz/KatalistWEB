import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Search,
  Filter,
  Plus,
  Briefcase,
  Home,
  Users,
  Folder,
  Eye,
  Clock,
  CheckCircle2,
  MoreHorizontal,
  X,
  ChevronDown,
  Copy,
  ExternalLink,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { type ListRow, type ListMember } from "@/features/lists/fixtures";
import { useLocalVersion } from "@/features/things/use-local-version";
import { useAppContext } from "@/features/context/use-app-context";
import { useLists } from "@/features/lists/use-lists";
import { domainErrorMessage } from "@/lib/domain-error";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/lists/")({
  head: () => ({
    meta: [
      { title: "Lists — Katalist" },
      { name: "description", content: "Shared collaboration rooms for your things." },
    ],
  }),
  component: ListsPage,
});

type RoleFilter = "all" | "owner" | "collaborator" | "view_only";
type ContextFilter = "all" | "work" | "home";
type SortOption = "recent" | "name" | "things" | "progress";

const SQUIRCLE_COLORS = [
  "bg-violet-600",
  "bg-sky-500",
  "bg-amber-500",
  "bg-emerald-600",
  "bg-rose-500",
  "bg-indigo-600",
  "bg-teal-500",
];

function getListColor(name: string, fallbackColor?: string) {
  if (fallbackColor && fallbackColor.startsWith("bg-")) return fallbackColor;
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % SQUIRCLE_COLORS.length;
  return SQUIRCLE_COLORS[index];
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="flex min-w-[120px] flex-col gap-1.5">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/80">
        <div
          className="h-full rounded-full bg-primary transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[11px] font-medium text-muted-foreground">
        {done} done • {Math.max(0, total - done)} open
      </span>
    </div>
  );
}

function MemberStack({ members, count }: { members: ListRow["members"]; count: number }) {
  const shown = members.slice(0, 3);
  const extra = Math.max(0, count - shown.length);
  return (
    <div className="flex items-center">
      <div className="flex -space-x-2">
        {shown.map((m) => (
          <PersonAvatar
            key={m.name + (m.profileId || m.actorId || "")}
            name={m.name}
            initials={m.initials}
            src={m.avatarUrl}
            size={24}
            className="ring-2 ring-white"
          />
        ))}
      </div>
      {extra > 0 ? (
        <span className="ml-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1 text-[10px] font-semibold text-muted-foreground">
          +{extra}
        </span>
      ) : null}
    </div>
  );
}

function ListTable({ rows }: { rows: ListRow[] }) {
  const navigate = useNavigate();
  if (rows.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-white shadow-2xs">
      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-left">
          <thead>
            <tr className="border-b border-border/60 bg-muted/20 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              <th className="w-[32%] px-5 py-3 font-semibold">LIST</th>
              <th className="w-[18%] px-3 py-3 font-semibold">MEMBERS</th>
              <th className="w-[10%] px-3 py-3 font-semibold">THINGS</th>
              <th className="w-[18%] px-3 py-3 font-semibold">PROGRESS</th>
              <th className="w-[8%] px-3 py-3 font-semibold">UNREAD</th>
              <th className="w-[18%] px-3 py-3 font-semibold">LATEST ACTIVITY</th>
              <th className="w-[6%] py-3 pr-4 text-right" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60 text-[13px]">
            {rows.map((row) => {
              const colorClass = getListColor(row.name, row.color);
              return (
                <tr
                  key={row.id}
                  className="group cursor-pointer transition-colors hover:bg-muted/35"
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("[data-stop-nav]")) return;
                    void navigate({ to: "/lists/$listId", params: { listId: row.id } });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      void navigate({ to: "/lists/$listId", params: { listId: row.id } });
                    }
                  }}
                  role="link"
                  tabIndex={0}
                >
                  {/* List Info */}
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <span
                        className={cn(
                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[13px] font-bold text-white shadow-2xs",
                          colorClass,
                        )}
                      >
                        {row.name.trim().slice(0, 1).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[13.5px] font-bold text-foreground">
                            {row.name}
                          </span>
                          <span className="inline-flex items-center rounded-md bg-purple-50 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700 capitalize">
                            {row.context}
                          </span>
                        </div>
                        <p className="text-[11.5px] text-muted-foreground">{row.ownerLine}</p>
                      </div>
                    </div>
                  </td>

                  {/* Members */}
                  <td className="px-3 py-3.5">
                    <MemberStack members={row.members} count={row.memberCount} />
                  </td>

                  {/* Things Count */}
                  <td className="px-3 py-3.5 text-[13px] font-medium text-foreground">
                    {row.thingCount}
                  </td>

                  {/* Progress Bar */}
                  <td className="px-3 py-3.5">
                    <ProgressBar done={row.doneCount} total={row.thingCount} />
                  </td>

                  {/* Unread */}
                  <td className="px-3 py-3.5">
                    {row.unread > 0 ? (
                      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground">
                        {row.unread}
                      </span>
                    ) : (
                      <span className="text-[13px] text-muted-foreground">—</span>
                    )}
                  </td>

                  {/* Latest Activity */}
                  <td className="px-3 py-3.5">
                    <p className="truncate text-[12px] font-medium text-foreground">
                      {row.latestActivity}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{row.updatedAt}</p>
                  </td>

                  {/* Row Actions Menu */}
                  <td className="py-3.5 pr-4 text-right">
                    <div data-stop-nav>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground opacity-60 transition-all hover:bg-muted hover:text-foreground hover:opacity-100 group-hover:opacity-100"
                            aria-label="List actions"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44 bg-white">
                          <DropdownMenuItem
                            onClick={() =>
                              void navigate({ to: "/lists/$listId", params: { listId: row.id } })
                            }
                            className="text-[12.5px] cursor-pointer"
                          >
                            <ExternalLink className="mr-2 h-3.5 w-3.5" />
                            Open List
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              void navigator.clipboard.writeText(
                                `${window.location.origin}/lists/${row.id}`,
                              );
                              toast.success("List link copied to clipboard");
                            }}
                            className="text-[12.5px] cursor-pointer"
                          >
                            <Copy className="mr-2 h-3.5 w-3.5" />
                            Copy Link
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GroupSection({
  title,
  count,
  rows,
}: {
  title: string;
  count: number;
  rows: ListRow[];
}) {
  if (rows.length === 0) return null;
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 px-1">
        <h2 className="text-[14px] font-bold text-foreground">{title}</h2>
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-purple-100/80 px-2 text-[11px] font-bold text-purple-700">
          {count}
        </span>
      </div>
      <ListTable rows={rows} />
    </section>
  );
}

function ListsPage() {
  useLocalVersion();
  const { lists, create } = useLists();
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [contextFilter, setContextFilter] = useState<ContextFilter>("all");
  const [selectedMember, setSelectedMember] = useState<string | null>(null);
  const [sortOption, setSortOption] = useState<SortOption>("recent");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [createContext, setCreateContext] = useState<"work" | "home">("work");

  // Extract all unique members across all lists
  const allUniqueMembers = useMemo(() => {
    const map = new Map<string, ListMember>();
    for (const list of lists) {
      for (const member of list.members) {
        const key = member.name.toLowerCase();
        if (!map.has(key)) {
          map.set(key, member);
        }
      }
    }
    return Array.from(map.values());
  }, [lists]);

  // Overall metric counts across all lists
  const metrics = useMemo(() => {
    const ownedCount = lists.filter((l) => l.role === "owner").length;
    const collabCount = lists.filter((l) => l.role === "collaborator").length;
    const viewOnlyCount = lists.filter((l) => l.role === "view_only").length;
    let totalThings = 0;
    let totalDone = 0;
    for (const l of lists) {
      totalThings += l.thingCount;
      totalDone += l.doneCount;
    }
    return {
      owned: ownedCount,
      collab: collabCount,
      viewOnly: viewOnlyCount,
      openThings: Math.max(0, totalThings - totalDone),
      completedThings: totalDone,
    };
  }, [lists]);

  // Filtered & Sorted Lists
  const filteredAndSorted = useMemo(() => {
    const q = query.trim().toLowerCase();

    const filtered = lists.filter((l) => {
      // Search query filter
      if (q) {
        const matchName = l.name.toLowerCase().includes(q);
        const matchOwner = l.ownerLine.toLowerCase().includes(q);
        const matchMembers = l.members.some((m) => m.name.toLowerCase().includes(q));
        if (!matchName && !matchOwner && !matchMembers) return false;
      }

      // Role filter
      if (roleFilter !== "all" && l.role !== roleFilter) return false;

      // Context filter
      if (contextFilter !== "all" && l.context !== contextFilter) return false;

      // Member avatar filter
      if (selectedMember) {
        const hasMember = l.members.some(
          (m) => m.name.toLowerCase() === selectedMember.toLowerCase(),
        );
        if (!hasMember) return false;
      }

      return true;
    });

    // Sorting
    return filtered.sort((a, b) => {
      if (sortOption === "name") {
        return a.name.localeCompare(b.name);
      }
      if (sortOption === "things") {
        return b.thingCount - a.thingCount;
      }
      if (sortOption === "progress") {
        const pctA = a.thingCount ? a.doneCount / a.thingCount : 0;
        const pctB = b.thingCount ? b.doneCount / b.thingCount : 0;
        return pctB - pctA;
      }
      // Default: recent activity
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }, [lists, query, roleFilter, contextFilter, selectedMember, sortOption]);

  const owned = filteredAndSorted.filter((l) => l.role === "owner");
  const collab = filteredAndSorted.filter((l) => l.role === "collaborator");
  const viewOnly = filteredAndSorted.filter((l) => l.role === "view_only");

  const sortLabels: Record<SortOption, string> = {
    recent: "Recent activity",
    name: "Name (A to Z)",
    things: "Things count",
    progress: "Progress",
  };

  return (
    <AppShell
      title="Lists"
      subtitle="Shared collaboration rooms"
      actions={
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground shadow-xs transition-all hover:bg-primary/90 active:scale-[0.98]"
        >
          <Plus className="h-4 w-4 stroke-[2.5]" />
          New List
        </button>
      }
    >
      <div className="space-y-4">
        {/* Row 1: Search & Filter bar */}
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex h-9 flex-1 min-w-[240px] max-w-sm items-center gap-2 rounded-xl border border-border/80 bg-white px-3 shadow-2xs focus-within:border-primary focus-within:ring-2 focus-within:ring-ring">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search lists..."
              className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </label>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-xl border bg-white px-3 text-[12.5px] font-medium shadow-2xs transition-colors hover:bg-muted/40",
                  roleFilter !== "all" || contextFilter !== "all" || selectedMember
                    ? "border-primary text-primary"
                    : "border-border/80 text-foreground",
                )}
              >
                <Filter className="h-3.5 w-3.5" />
                Filters
                {roleFilter !== "all" || contextFilter !== "all" || selectedMember ? (
                  <span className="h-2 w-2 rounded-full bg-primary" />
                ) : null}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52 bg-white">
              <DropdownMenuLabel className="text-[11px] text-muted-foreground">
                Role
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={roleFilter}
                onValueChange={(val) => setRoleFilter(val as RoleFilter)}
              >
                <DropdownMenuRadioItem value="all" className="text-[12.5px]">
                  All Roles
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="owner" className="text-[12.5px]">
                  Owned by me
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="collaborator" className="text-[12.5px]">
                  Collaborating
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="view_only" className="text-[12.5px]">
                  View only
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>

              <DropdownMenuSeparator />

              <DropdownMenuLabel className="text-[11px] text-muted-foreground">
                Context
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={contextFilter}
                onValueChange={(val) => setContextFilter(val as ContextFilter)}
              >
                <DropdownMenuRadioItem value="all" className="text-[12.5px]">
                  All Contexts
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="work" className="text-[12.5px]">
                  Work
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="home" className="text-[12.5px]">
                  Home
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>

              {(roleFilter !== "all" || contextFilter !== "all" || selectedMember) && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => {
                      setRoleFilter("all");
                      setContextFilter("all");
                      setSelectedMember(null);
                    }}
                    className="text-[12px] font-semibold text-primary"
                  >
                    Reset all filters
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Row 2: Filter Pills & Helpers + Sort Dropdown */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Role Pills */}
            <button
              type="button"
              onClick={() => setRoleFilter("all")}
              className={cn(
                "inline-flex h-8 items-center rounded-full border px-3.5 text-[11.5px] font-medium transition-all duration-200",
                roleFilter === "all"
                  ? "border-primary bg-primary/10 font-semibold text-primary shadow-2xs"
                  : "border-border/80 bg-white text-muted-foreground hover:border-primary/50 hover:text-foreground",
              )}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setRoleFilter(roleFilter === "owner" ? "all" : "owner")}
              className={cn(
                "inline-flex h-8 items-center rounded-full border px-3.5 text-[11.5px] font-medium transition-all duration-200",
                roleFilter === "owner"
                  ? "border-primary bg-primary/10 font-semibold text-primary shadow-2xs"
                  : "border-border/80 bg-white text-muted-foreground hover:border-primary/50 hover:text-foreground",
              )}
            >
              Owned by me
            </button>
            <button
              type="button"
              onClick={() => setRoleFilter(roleFilter === "collaborator" ? "all" : "collaborator")}
              className={cn(
                "inline-flex h-8 items-center rounded-full border px-3.5 text-[11.5px] font-medium transition-all duration-200",
                roleFilter === "collaborator"
                  ? "border-primary bg-primary/10 font-semibold text-primary shadow-2xs"
                  : "border-border/80 bg-white text-muted-foreground hover:border-primary/50 hover:text-foreground",
              )}
            >
              Collaborating
            </button>
            <button
              type="button"
              onClick={() => setRoleFilter(roleFilter === "view_only" ? "all" : "view_only")}
              className={cn(
                "inline-flex h-8 items-center rounded-full border px-3.5 text-[11.5px] font-medium transition-all duration-200",
                roleFilter === "view_only"
                  ? "border-primary bg-primary/10 font-semibold text-primary shadow-2xs"
                  : "border-border/80 bg-white text-muted-foreground hover:border-primary/50 hover:text-foreground",
              )}
            >
              View only
            </button>

            <span className="mx-1 h-4 w-px bg-border" />

            {/* Context Pills */}
            <button
              type="button"
              onClick={() => setContextFilter(contextFilter === "work" ? "all" : "work")}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[11.5px] font-medium transition-all duration-200",
                contextFilter === "work"
                  ? "border-purple-300 bg-purple-50 font-semibold text-purple-700 shadow-2xs"
                  : "border-border/80 bg-white text-muted-foreground hover:border-primary/50 hover:text-foreground",
              )}
            >
              <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
              Work
            </button>
            <button
              type="button"
              onClick={() => setContextFilter(contextFilter === "home" ? "all" : "home")}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[11.5px] font-medium transition-all duration-200",
                contextFilter === "home"
                  ? "border-blue-300 bg-blue-50 font-semibold text-blue-700 shadow-2xs"
                  : "border-border/80 bg-white text-muted-foreground hover:border-primary/50 hover:text-foreground",
              )}
            >
              <Home className="h-3.5 w-3.5 text-muted-foreground" />
              Home
            </button>
          </div>

          {/* Sort Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex h-8 items-center gap-2 rounded-xl border border-border/80 bg-white px-3 text-[11.5px] font-medium text-foreground shadow-2xs hover:bg-muted/40"
              >
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                <span>{sortLabels[sortOption]}</span>
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 bg-white">
              <DropdownMenuLabel className="text-[11px] text-muted-foreground">
                Sort lists by
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={sortOption}
                onValueChange={(val) => setSortOption(val as SortOption)}
              >
                {(Object.entries(sortLabels) as Array<[SortOption, string]>).map(([key, label]) => (
                  <DropdownMenuRadioItem key={key} value={key} className="text-[12.5px]">
                    {label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Row 3: Member Avatar Filter */}
        {allUniqueMembers.length > 0 ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedMember(null)}
              className={cn(
                "inline-flex h-7.5 items-center gap-1.5 rounded-full border px-3 text-[11px] font-medium transition-all duration-200",
                selectedMember === null
                  ? "border-primary bg-primary/10 font-semibold text-primary"
                  : "border-border/80 bg-white text-muted-foreground hover:text-foreground",
              )}
            >
              <Users className="h-3.5 w-3.5" />
              All members
            </button>

            <div className="flex items-center gap-1.5 pl-1">
              {allUniqueMembers.slice(0, 5).map((member) => {
                const isActive = selectedMember?.toLowerCase() === member.name.toLowerCase();
                return (
                  <button
                    key={member.name}
                    type="button"
                    title={
                      isActive
                        ? `Clear filter for ${member.name}`
                        : `Filter lists with ${member.name}`
                    }
                    onClick={() =>
                      setSelectedMember(isActive ? null : member.name)
                    }
                    className={cn(
                      "relative rounded-full transition-all duration-200 outline-none cursor-pointer",
                      isActive
                        ? "ring-2 ring-primary ring-offset-2 scale-110 shadow-xs"
                        : "opacity-75 hover:opacity-100 hover:scale-105",
                    )}
                  >
                    <PersonAvatar
                      name={member.name}
                      initials={member.initials}
                      src={member.avatarUrl}
                      size={24}
                    />
                    {isActive ? (
                      <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary ring-2 ring-white" />
                    ) : null}
                  </button>
                );
              })}

              {allUniqueMembers.length > 5 ? (
                <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-muted px-1.5 text-[10px] font-bold text-muted-foreground">
                  +{allUniqueMembers.length - 5}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Row 4: 5 Metric Summary Cards */}
        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-5">
          {/* 1. Owned by Me */}
          <button
            type="button"
            onClick={() => setRoleFilter(roleFilter === "owner" ? "all" : "owner")}
            className={cn(
              "flex items-center gap-3 rounded-2xl border bg-white p-3.5 text-left shadow-2xs transition-all hover:border-purple-300 hover:shadow-xs",
              roleFilter === "owner" ? "border-purple-300 ring-2 ring-purple-200/50 bg-purple-50/30" : "border-border/70",
            )}
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-purple-100 bg-purple-50 text-purple-600">
              <Folder className="h-5 w-5" />
            </div>
            <div>
              <span className="text-2xl font-bold leading-none text-foreground">
                {metrics.owned}
              </span>
              <span className="block text-[11px] font-medium text-muted-foreground mt-0.5">
                Owned by me
              </span>
            </div>
          </button>

          {/* 2. Collaborating */}
          <button
            type="button"
            onClick={() => setRoleFilter(roleFilter === "collaborator" ? "all" : "collaborator")}
            className={cn(
              "flex items-center gap-3 rounded-2xl border bg-white p-3.5 text-left shadow-2xs transition-all hover:border-blue-300 hover:shadow-xs",
              roleFilter === "collaborator" ? "border-blue-300 ring-2 ring-blue-200/50 bg-blue-50/30" : "border-border/70",
            )}
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-blue-600">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <span className="text-2xl font-bold leading-none text-foreground">
                {metrics.collab}
              </span>
              <span className="block text-[11px] font-medium text-muted-foreground mt-0.5">
                Collaborating
              </span>
            </div>
          </button>

          {/* 3. View only */}
          <button
            type="button"
            onClick={() => setRoleFilter(roleFilter === "view_only" ? "all" : "view_only")}
            className={cn(
              "flex items-center gap-3 rounded-2xl border bg-white p-3.5 text-left shadow-2xs transition-all hover:border-emerald-300 hover:shadow-xs",
              roleFilter === "view_only" ? "border-emerald-300 ring-2 ring-emerald-200/50 bg-emerald-50/30" : "border-border/70",
            )}
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-600">
              <Eye className="h-5 w-5" />
            </div>
            <div>
              <span className="text-2xl font-bold leading-none text-foreground">
                {metrics.viewOnly}
              </span>
              <span className="block text-[11px] font-medium text-muted-foreground mt-0.5">
                View only
              </span>
            </div>
          </button>

          {/* 4. Open things */}
          <div className="flex items-center gap-3 rounded-2xl border border-border/70 bg-white p-3.5 text-left shadow-2xs">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-orange-100 bg-orange-50 text-orange-600">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <span className="text-2xl font-bold leading-none text-foreground">
                {metrics.openThings}
              </span>
              <span className="block text-[11px] font-medium text-muted-foreground mt-0.5">
                Open things
              </span>
            </div>
          </div>

          {/* 5. Completed things */}
          <div className="flex items-center gap-3 rounded-2xl border border-border/70 bg-white p-3.5 text-left shadow-2xs">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <span className="text-2xl font-bold leading-none text-foreground">
                {metrics.completedThings}
              </span>
              <span className="block text-[11px] font-medium text-muted-foreground mt-0.5">
                Completed things
              </span>
            </div>
          </div>
        </div>

        {/* Categorized Lists Sections */}
        <div className="space-y-6 pt-2">
          {filteredAndSorted.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/80 bg-white p-12 text-center">
              <p className="text-[14px] font-semibold text-foreground">No lists match your criteria</p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Try changing your search keywords or resetting filters.
              </p>
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setRoleFilter("all");
                  setContextFilter("all");
                  setSelectedMember(null);
                }}
                className="mt-4 inline-flex h-8 items-center rounded-lg border border-border px-3 text-[12px] font-medium text-primary hover:bg-muted/50"
              >
                Clear all filters
              </button>
            </div>
          ) : (
            <>
              <GroupSection title="Owned by Me" count={owned.length} rows={owned} />
              <GroupSection title="Collaborating" count={collab.length} rows={collab} />
              <GroupSection title="View Only" count={viewOnly.length} rows={viewOnly} />
            </>
          )}
        </div>
      </div>

      {/* New List Modal */}
      {creating ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <form
            className="w-full max-w-md rounded-2xl border border-border bg-white p-6 shadow-xl animate-in fade-in zoom-in-95"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              void create.mutateAsync(name.trim()).then(
                () => {
                  toast.success("List created successfully.");
                  setName("");
                  setCreating(false);
                },
                (err) => toast.error(domainErrorMessage(err)),
              );
            }}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-[16px] font-bold text-foreground">Create New List</h2>
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="rounded-lg p-1 text-muted-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Create a shared collaboration room for your tasks and team.
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-[12px] font-semibold text-foreground mb-1">
                  List Name
                </label>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Q3 Marketing Plan"
                  className="h-10 w-full rounded-xl border border-border px-3.5 text-[13px] outline-none focus:border-primary focus:ring-2 focus:ring-ring"
                />
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-foreground mb-1.5">
                  Context
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setCreateContext("work")}
                    className={cn(
                      "flex items-center justify-center gap-2 rounded-xl border py-2 text-[12.5px] font-medium transition-all",
                      createContext === "work"
                        ? "border-primary bg-primary/10 font-semibold text-primary"
                        : "border-border/80 bg-white text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Briefcase className="h-4 w-4" />
                    Work
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreateContext("home")}
                    className={cn(
                      "flex items-center justify-center gap-2 rounded-xl border py-2 text-[12.5px] font-medium transition-all",
                      createContext === "home"
                        ? "border-primary bg-primary/10 font-semibold text-primary"
                        : "border-border/80 bg-white text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Home className="h-4 w-4" />
                    Home
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                className="h-9 rounded-xl border border-border px-4 text-[13px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => setCreating(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!name.trim()}
                className="h-9 rounded-xl bg-primary px-4 text-[13px] font-semibold text-primary-foreground shadow-xs transition-all hover:bg-primary/90 disabled:opacity-50"
              >
                Create List
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </AppShell>
  );
}
