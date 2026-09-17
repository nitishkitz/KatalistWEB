import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Search,
  Plus,
  Briefcase,
  Home,
  Clock,
  MoreHorizontal,
  X,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  ImagePlus,
  Pencil,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { ListsSkeleton } from "@/components/katalist/ScreenSkeletons";
import { supabase } from "@/integrations/supabase/client";
import { rpcSetListCover, rpcSetListDescription } from "@/features/things/rpc";
import { isPreviewMode } from "@/lib/session-mode";
import { type ListRow } from "@/features/lists/fixtures";
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
      <div className="h-[9px] w-full overflow-hidden rounded-full bg-[#e8eaef]">
        <div
          className="h-full rounded-full bg-[#6f52ea] transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[11px] font-medium text-[#1d1d1d]">
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

function ListTable({ rows, onEdit }: { rows: ListRow[]; onEdit?: (list: ListRow) => void }) {
  const navigate = useNavigate();
  if (rows.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-2xl border border-[#ebedf1] bg-white" style={{ boxShadow: "0 1px 2px rgba(11,12,41,0.04)" }}>
      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-left">
          <thead>
            <tr className="border-b border-[#ebedf1] bg-[#fafbfd] text-[11px] font-semibold tracking-wider text-[#6f7d94] uppercase">
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
                      {row.coverUrl ? (
                        <img
                          src={row.coverUrl}
                          alt=""
                          className="h-10 w-10 shrink-0 rounded-full object-cover"
                        />
                      ) : (
                        <span
                          className={cn(
                            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold text-white",
                            colorClass,
                          )}
                        >
                          {row.name.trim().slice(0, 1).toUpperCase()}
                        </span>
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[13.5px] font-bold text-foreground">
                            {row.name}
                          </span>
                        </div>
                        {row.description ? (
                          <p className="truncate text-[11.5px] text-muted-foreground">{row.description}</p>
                        ) : (
                          <p className="text-[11.5px] text-muted-foreground">{row.ownerLine}</p>
                        )}
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
                          {row.role === "owner" && onEdit ? (
                            <DropdownMenuItem
                              onClick={() => onEdit(row)}
                              className="text-[12.5px] cursor-pointer"
                            >
                              <Pencil className="mr-2 h-3.5 w-3.5" />
                              Edit details
                            </DropdownMenuItem>
                          ) : null}
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
  hint,
  rows,
  onEdit,
}: {
  title: string;
  count: number;
  hint: string;
  rows: ListRow[];
  onEdit?: (list: ListRow) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-2">
          <h2 className="text-[17px] font-semibold text-[#000533]">{title}</h2>
          <span className="inline-flex h-[25px] min-w-[25px] items-center justify-center rounded-full bg-[#f1ecff] px-2 text-[13px] font-semibold text-[#6638ec]">
            {count}
          </span>
        </div>
        <div className="flex items-center gap-1 text-[#6f7d94]">
          <span className="text-[12px] font-medium">{hint}</span>
          <ChevronRight className="h-4 w-4" />
        </div>
      </div>
      <ListTable rows={rows} onEdit={onEdit} />
    </section>
  );
}

function ListsPage() {
  useLocalVersion();
  const { lists, create, refetch: refetchLists, isLoading } = useLists();
  const { context: appContext } = useAppContext();
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [contextFilter, setContextFilter] = useState<ContextFilter>("all");
  const [selectedMember, setSelectedMember] = useState<string | null>(null);
  const [sortOption, setSortOption] = useState<SortOption>("recent");
  const [creating, setCreating] = useState(false);
  const [editingList, setEditingList] = useState<ListRow | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isEditing = editingList !== null;

  const closeDialog = () => {
    resetCreateForm();
    setCreating(false);
    setEditingList(null);
  };

  const openEditList = (list: ListRow) => {
    resetCreateForm();
    setName(list.name);
    setDescription(list.description ?? "");
    setCoverPreview(list.coverUrl ?? null);
    setEditingList(list);
  };

  const resetCreateForm = () => {
    setName("");
    setDescription("");
    setCoverFile(null);
    if (coverPreview?.startsWith("blob:")) URL.revokeObjectURL(coverPreview);
    setCoverPreview(null);
  };

  const onPickCover = (file: File | null) => {
    if (coverPreview?.startsWith("blob:")) URL.revokeObjectURL(coverPreview);
    if (!file) {
      setCoverFile(null);
      setCoverPreview(null);
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be under 5 MB.");
      return;
    }
    setCoverFile(file);
    setCoverPreview(URL.createObjectURL(file));
  };

  // Upload a cover file under `<listId>/<file>` and attach it. Live sessions only.
  const uploadAndAttachCover = async (listId: string) => {
    if (!coverFile || isPreviewMode()) return;
    try {
      const ext = coverFile.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${listId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("list-covers")
        .upload(path, coverFile, { cacheControl: "3600", upsert: false, contentType: coverFile.type });
      if (upErr) throw upErr;
      await rpcSetListCover(listId, path);
    } catch {
      // The cover is optional — never fail the whole flow on an upload issue.
      toast("Saved, but the cover image could not be uploaded.");
    }
  };

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      if (editingList) {
        // Edit an existing owned List: description and/or a new cover image.
        await rpcSetListDescription(editingList.id, description.trim() || null);
        await uploadAndAttachCover(editingList.id);
        await refetchLists();
        toast.success("List updated.");
      } else {
        // Create the List first — the cover path must contain the new List id,
        // so the cover can only be attached afterwards.
        const created = await create.mutateAsync({
          name: trimmed,
          description: description.trim() || null,
        });
        if (created?.id) {
          await uploadAndAttachCover(created.id);
          await refetchLists();
        }
        toast.success("List created successfully.");
      }
      closeDialog();
    } catch (err) {
      toast.error(domainErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

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

  if (isLoading) {
    return (
      <AppShell>
        <ListsSkeleton />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-4">
        {/* Toolbar: search, filters, role pills, sort, New List — single row */}
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex h-9 w-full items-center gap-2 rounded-xl border border-border/80 bg-white px-3 shadow-2xs focus-within:border-primary focus-within:ring-2 focus-within:ring-ring sm:w-56">
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

          <button
            type="button"
            onClick={() => setCreating(true)}
            className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.98]"
            style={{ boxShadow: "0 1px 2px rgba(11,12,41,0.08)" }}
          >
            <Plus className="h-4 w-4 stroke-[2.5]" />
            New List
          </button>
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
              <GroupSection title="Owned by Me" count={owned.length} hint="Lists you own and manage" rows={owned} onEdit={openEditList} />
              <GroupSection title="Collaborating" count={collab.length} hint="Lists you’re collaborating on" rows={collab} />
              <GroupSection title="View Only" count={viewOnly.length} hint="Lists you can view" rows={viewOnly} />
            </>
          )}
        </div>
      </div>

      {/* New List Modal */}
      {creating || isEditing ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <form
            className="w-full max-w-md rounded-2xl border border-border bg-white p-6 shadow-xl animate-in fade-in zoom-in-95"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSubmit();
            }}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-[16px] font-bold text-foreground">
                {isEditing ? "Edit List" : "Create New List"}
              </h2>
              <button
                type="button"
                onClick={closeDialog}
                className="rounded-lg p-1 text-muted-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <p className="text-[12px] text-muted-foreground">
                {isEditing
                  ? "Update the description and cover image for this list."
                  : "Create a shared collaboration room for your tasks and team."}
              </p>
            </div>
            {!isEditing ? (
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
                {appContext === "home" ? <Home className="h-3.5 w-3.5" /> : <Briefcase className="h-3.5 w-3.5" />}
                Creating in {appContext === "home" ? "Home" : "Work"} mode
              </div>
            ) : null}

            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-[12px] font-semibold text-foreground mb-1">
                  List Name
                </label>
                <input
                  autoFocus={!isEditing}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={isEditing}
                  placeholder="e.g. Q3 Marketing Plan"
                  className="h-10 w-full rounded-xl border border-border px-3.5 text-[13px] outline-none focus:border-primary focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:bg-muted/40 disabled:text-muted-foreground"
                />
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-foreground mb-1">
                  Description <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  placeholder="What is this list for?"
                  className="w-full resize-none rounded-xl border border-border px-3.5 py-2.5 text-[13px] outline-none focus:border-primary focus:ring-2 focus:ring-ring"
                />
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-foreground mb-1">
                  Cover image <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                {coverPreview ? (
                  <div className="relative overflow-hidden rounded-xl border border-border">
                    <img src={coverPreview} alt="Cover preview" className="h-28 w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => onPickCover(null)}
                      aria-label="Remove cover image"
                      className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white transition-colors hover:bg-black/70"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <label className="flex h-28 w-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border bg-muted/30 text-muted-foreground transition-colors hover:border-primary hover:text-primary">
                    <ImagePlus className="h-5 w-5" />
                    <span className="text-[12px] font-medium">Upload an image</span>
                    <span className="text-[10.5px]">PNG or JPG, up to 5 MB</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => onPickCover(e.target.files?.[0] ?? null)}
                    />
                  </label>
                )}
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                className="h-9 rounded-xl border border-border px-4 text-[13px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={closeDialog}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!name.trim() || submitting}
                className="h-9 rounded-xl bg-primary px-4 text-[13px] font-semibold text-primary-foreground shadow-xs transition-all hover:bg-primary/90 disabled:opacity-50"
              >
                {isEditing
                  ? submitting
                    ? "Saving…"
                    : "Save Changes"
                  : submitting
                    ? "Creating…"
                    : "Create List"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </AppShell>
  );
}
