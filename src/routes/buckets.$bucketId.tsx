import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";
import {
  ArrowDownUp,
  Briefcase,
  Calendar,
  ChevronDown,
  Clock,
  FileText,
  Filter,
  Home,
  Info,
  List as ListIcon,
  Lock,
  MoreHorizontal,
  Plus,
  Search,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { useBucket } from "@/features/buckets/use-buckets";
import {
  useAccessibleLists,
  useAccessibleThings,
  useBucketItems,
  type BucketItem,
} from "@/features/buckets/use-bucket-items";
import { bucketItemsSurface } from "@/features/buckets/bucket-items-surface";
import { InlineThingDetailWorkspace } from "@/features/things/InlineThingDetailWorkspace";
import { useThing } from "@/features/things/use-thing";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { domainErrorMessage } from "@/lib/domain-error";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Thing } from "@/domain/thing";
import type { ListRow } from "@/features/lists/fixtures";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/buckets/$bucketId")({
  component: BucketDetailPage,
});

function matchesQuery(q: string, thing?: Thing, list?: ListRow) {
  if (!q) return true;
  const n = q.toLowerCase();
  if (thing) {
    return (
      thing.title.toLowerCase().includes(n) ||
      thing.assignee.name.toLowerCase().includes(n) ||
      (thing.listName ?? "").toLowerCase().includes(n)
    );
  }
  if (list) {
    return list.name.toLowerCase().includes(n) || list.ownerLine.toLowerCase().includes(n);
  }
  return false;
}

function BucketThingCardRow({
  thing,
  isSelected,
  onOpen,
  onRemove,
}: {
  thing: Thing;
  isSelected?: boolean;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const isWaiting = thing.acknowledgement === "waiting_for_catch";

  const importanceBadge =
    thing.ownerImportance === "now" ? (
      <span className="rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-[10.5px] font-bold text-red-600">
        NOW
      </span>
    ) : thing.ownerImportance === "next" ? (
      <span className="rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10.5px] font-semibold text-blue-600">
        NEXT
      </span>
    ) : (
      <span className="rounded-md border border-purple-200 bg-purple-50 px-2 py-0.5 text-[10.5px] font-semibold text-purple-600">
        LATER
      </span>
    );

  const statusBadge = isWaiting ? (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-orange-200 bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-700">
      <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
      Waiting for catch
    </span>
  ) : thing.workStatus === "sorted" ? (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      Completed
    </span>
  ) : thing.workStatus === "under_progress" ? (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
      <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
      Under progress
    </span>
  ) : thing.workStatus === "cancelled" ? (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700">
      <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />
      Cancelled
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
      Not started
    </span>
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "group flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 rounded-2xl border border-border/70 bg-white p-4 shadow-2xs hover:bg-muted/20 transition-all duration-200 cursor-pointer",
        isSelected && "border-l-4 border-l-primary bg-primary/5 font-semibold",
      )}
    >
      <div className="min-w-0 flex-1">
        <h4 className="text-[13.5px] font-bold text-foreground group-hover:text-primary transition-colors truncate">
          {thing.title}
        </h4>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {importanceBadge}
          {statusBadge}
          <span className="rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">
            {thing.listName ?? "Standalone"}
          </span>
          <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-foreground">
            <PersonAvatar
              name={thing.assignee.name}
              src={thing.assignee.avatarUrl}
              initials={thing.assignee.initials}
              size={18}
            />
            <span>{thing.assignee.name}</span>
          </div>
          {thing.dueAt ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground font-medium">
              <Calendar className="h-3 w-3" />
              {format(new Date(thing.dueAt), "MMM d, yyyy")}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex items-center justify-end shrink-0">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="text-[12.5px] font-semibold text-primary hover:underline cursor-pointer"
        >
          Remove
        </button>
      </div>
    </div>
  );
}

function BucketListCardRow({
  list,
  onRemove,
}: {
  list: ListRow;
  onRemove: () => void;
}) {
  const navigate = useNavigate();
  const letter = list.name.slice(0, 1).toUpperCase();
  const pastelStyles = [
    { bg: "bg-purple-100", text: "text-purple-800" },
    { bg: "bg-sky-100", text: "text-sky-800" },
    { bg: "bg-emerald-100", text: "text-emerald-800" },
    { bg: "bg-amber-100", text: "text-amber-800" },
  ];
  const charCode = (list.name.charCodeAt(0) || 0) % pastelStyles.length;
  const { bg, text } = pastelStyles[charCode]!;

  return (
    <div className="group flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 rounded-2xl border border-border/70 bg-white p-4 shadow-2xs hover:bg-muted/20 transition-all duration-200">
      <div className="flex items-center gap-3.5 min-w-0">
        <span
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[15px] font-bold",
            bg,
            text,
          )}
        >
          {letter}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-[13.5px] font-bold text-foreground truncate">{list.name}</h4>
            <span className="rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium capitalize text-muted-foreground">
              {list.context}
            </span>
          </div>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            {list.ownerLine} · {list.thingCount} Things · {list.doneCount} done
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4 justify-end shrink-0">
        <button
          type="button"
          onClick={() => void navigate({ to: "/lists/$listId", params: { listId: list.id } })}
          className="text-[12.5px] font-semibold text-primary hover:underline cursor-pointer"
        >
          Open list
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="text-[12.5px] font-semibold text-primary hover:underline cursor-pointer"
        >
          Remove
        </button>
      </div>
    </div>
  );
}

function BucketDetailPage() {
  const { bucketId } = Route.useParams();
  const navigate = useNavigate();
  const { bucket, isLoading, error, rename, remove: deleteBucket } = useBucket(bucketId);
  const { items, add, remove, isLoading: itemsLoading, error: itemsError } = useBucketItems(bucketId);
  const things = useAccessibleThings();
  const lists = useAccessibleLists();

  const [q, setQ] = useState("");
  const [personFilter, setPersonFilter] = useState<string | null>(null);
  const [viewTab, setViewTab] = useState<"all" | "things" | "lists">("all");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [sortOption, setSortOption] = useState<"recent" | "title">("recent");

  const [addOpen, setAddOpen] = useState(false);
  const [addTab, setAddTab] = useState<"things" | "lists">("things");
  const [addQ, setAddQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);

  const liveThing = useThing(selectedId);
  const thingItemsAll = items.filter((i): i is Extract<BucketItem, { kind: "thing" }> => i.kind === "thing");
  const listItemsAll = items.filter((i): i is Extract<BucketItem, { kind: "list" }> => i.kind === "list");
  const selectedThing =
    liveThing.thing ?? thingItemsAll.find((i) => i.thingId === selectedId)?.thing ?? null;

  const referencedThingIds = new Set(thingItemsAll.map((i) => i.thingId));
  const referencedListIds = new Set(listItemsAll.map((i) => i.listId));

  // Extract collaborators for person filter
  const collaborators = useMemo(() => {
    const map = new Map<string, { id: string; name: string; avatarUrl?: string | null; initials: string }>();
    for (const it of thingItemsAll) {
      if (it.thing.assignee && it.thing.assignee.name && it.thing.assignee.name !== "Someone") {
        map.set(it.thing.assignee.id, {
          id: it.thing.assignee.id,
          name: it.thing.assignee.name,
          avatarUrl: it.thing.assignee.avatarUrl,
          initials: it.thing.assignee.initials || it.thing.assignee.name.slice(0, 2).toUpperCase(),
        });
      }
      if (it.thing.owner && it.thing.owner.name && it.thing.owner.name !== "Someone") {
        map.set(it.thing.owner.id, {
          id: it.thing.owner.id,
          name: it.thing.owner.name,
          avatarUrl: it.thing.owner.avatarUrl,
          initials: it.thing.owner.initials || it.thing.owner.name.slice(0, 2).toUpperCase(),
        });
      }
    }
    for (const it of listItemsAll) {
      if (it.list.members) {
        for (const m of it.list.members) {
          const key = m.actorId || m.profileId || m.name;
          if (m.name && m.name !== "Someone" && !map.has(key)) {
            map.set(key, {
              id: key,
              name: m.name,
              avatarUrl: m.avatarUrl,
              initials: m.initials || m.name.slice(0, 2).toUpperCase(),
            });
          }
        }
      }
    }
    return Array.from(map.values());
  }, [thingItemsAll, listItemsAll]);

  const visible = useMemo(() => {
    return items.filter((item) => {
      if (item.kind === "thing") {
        if (!matchesQuery(q, item.thing)) return false;
        if (personFilter && item.thing.assignee.id !== personFilter && item.thing.owner.id !== personFilter)
          return false;
        if (statusFilter) {
          if (statusFilter === "waiting_for_catch" && item.thing.acknowledgement !== "waiting_for_catch")
            return false;
          if (statusFilter === "under_progress" && item.thing.workStatus !== "under_progress")
            return false;
          if (statusFilter === "completed" && item.thing.workStatus !== "sorted") return false;
          if (statusFilter === "cancelled" && item.thing.workStatus !== "cancelled") return false;
        }
        return true;
      }
      if (item.kind === "list") {
        if (statusFilter) return false;
        if (personFilter) return false;
        return matchesQuery(q, undefined, item.list);
      }
      return true;
    });
  }, [items, q, personFilter, statusFilter]);

  const thingItems = visible.filter((i): i is Extract<BucketItem, { kind: "thing" }> => i.kind === "thing");
  const listItems = visible.filter((i): i is Extract<BucketItem, { kind: "list" }> => i.kind === "list");
  const bucketThings = useMemo(() => thingItems.map((it) => it.thing), [thingItems]);

  const addThings = things.filter(
    (t) =>
      !referencedThingIds.has(t.id) &&
      (!addQ ||
        t.title.toLowerCase().includes(addQ.toLowerCase()) ||
        t.assignee.name.toLowerCase().includes(addQ.toLowerCase())),
  );
  const addLists = lists.filter(
    (l) => !referencedListIds.has(l.id) && (!addQ || l.name.toLowerCase().includes(addQ.toLowerCase())),
  );

  if (isLoading) {
    return (
      <AppShell title="Bucket" subtitle="Loading">
        <p className="text-sm text-muted-foreground">Opening this Bucket…</p>
      </AppShell>
    );
  }

  if (error || !bucket) {
    return (
      <AppShell title="Bucket" subtitle="Not found">
        <p className="text-sm text-muted-foreground">{error ? domainErrorMessage(error) : "Bucket not found."}</p>
        <Link to="/buckets" className="mt-2 inline-block text-sm font-semibold text-primary">
          Back to Buckets
        </Link>
      </AppShell>
    );
  }

  const itemsSurface = bucketItemsSurface({
    itemsLoading,
    itemsError,
    itemCount: items.length,
  });

  return (
    <AppShell
      title={
        <div className="flex items-center gap-2">
          <span>{bucket.name}</span>
          <Lock className="h-4 w-4 text-muted-foreground/80" />
        </div>
      }
      subtitle="Private focus space for references only"
      actions={
        <div className="flex items-center gap-2">
          <Popover open={addOpen} onOpenChange={setAddOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 shadow-2xs cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                Add reference
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 rounded-2xl border border-border/80 bg-white p-3 shadow-xl">
              <div className="mb-2.5 flex gap-1 rounded-xl bg-muted p-1">
                <button
                  type="button"
                  className={cn(
                    "flex-1 rounded-lg px-2.5 py-1 text-[12px] font-medium transition-colors",
                    addTab === "things" ? "bg-white text-foreground shadow-2xs font-semibold" : "text-muted-foreground",
                  )}
                  onClick={() => setAddTab("things")}
                >
                  Things
                </button>
                <button
                  type="button"
                  className={cn(
                    "flex-1 rounded-lg px-2.5 py-1 text-[12px] font-medium transition-colors",
                    addTab === "lists" ? "bg-white text-foreground shadow-2xs font-semibold" : "text-muted-foreground",
                  )}
                  onClick={() => setAddTab("lists")}
                >
                  Lists
                </button>
              </div>
              <input
                value={addQ}
                onChange={(e) => setAddQ(e.target.value)}
                placeholder={addTab === "things" ? "Search Things…" : "Search Lists…"}
                className="mb-2 h-8.5 w-full rounded-lg border border-border bg-background px-2.5 text-[12.5px] outline-none"
              />
              <ul className="max-h-56 space-y-1 overflow-y-auto">
                {addTab === "things"
                  ? addThings.slice(0, 40).map((t) => (
                      <li key={t.id}>
                        <button
                          type="button"
                          className="w-full rounded-lg px-2.5 py-1.5 text-left text-[12.5px] font-medium hover:bg-muted transition-colors cursor-pointer"
                          onClick={() => {
                            void add.mutateAsync({ thingId: t.id }).then(
                              () => {
                                toast.success("Referenced. The Thing itself did not change.");
                                setAddOpen(false);
                              },
                              (err) => toast.error(domainErrorMessage(err)),
                            );
                          }}
                        >
                          {t.title}
                        </button>
                      </li>
                    ))
                  : addLists.map((l) => (
                      <li key={l.id}>
                        <button
                          type="button"
                          className="w-full rounded-lg px-2.5 py-1.5 text-left text-[12.5px] font-medium hover:bg-muted transition-colors cursor-pointer"
                          onClick={() => {
                            void add.mutateAsync({ listId: l.id }).then(
                              () => {
                                toast.success("List referenced. Ownership unchanged.");
                                setAddOpen(false);
                              },
                              (err) => toast.error(domainErrorMessage(err)),
                            );
                          }}
                        >
                          {l.name}
                        </button>
                      </li>
                    ))}
                {(addTab === "things" ? addThings : addLists).length === 0 ? (
                  <li className="px-2 py-4 text-center text-[12px] text-muted-foreground">
                    Nothing else to add.
                  </li>
                ) : null}
              </ul>
            </PopoverContent>
          </Popover>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Bucket settings"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/80 bg-white text-muted-foreground hover:bg-muted hover:text-foreground shadow-2xs"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40 rounded-xl bg-white p-1">
              <DropdownMenuItem
                className="text-[12.5px] font-medium cursor-pointer"
                onSelect={() => {
                  setRenameValue(bucket.name);
                  setRenameOpen(true);
                }}
              >
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-[12.5px] font-medium text-destructive focus:text-destructive cursor-pointer"
                onSelect={() => setDeleteOpen(true)}
              >
                Delete Bucket
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      }
    >
      {/* Top Meta Ribbon */}
      <div className="mb-5 flex flex-wrap items-center gap-3 text-[12px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-white px-2 py-1 font-medium shadow-2xs">
          {bucket.context === "home" ? (
            <Home className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <span className="capitalize">{bucket.context}</span>
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-white px-2 py-1 font-medium shadow-2xs">
          <Lock className="h-3.5 w-3.5 text-muted-foreground" />
          Private
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-white px-2 py-1 font-medium shadow-2xs">
          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
          {thingItemsAll.length} Things
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-white px-2 py-1 font-medium shadow-2xs">
          <ListIcon className="h-3.5 w-3.5 text-muted-foreground" />
          {listItemsAll.length} Lists
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-white px-2 py-1 font-medium shadow-2xs">
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          Updated recently
        </span>
      </div>

      {/* Search Bar */}
      <div className="mb-4">
        <label className="flex h-9 w-full items-center gap-2 rounded-xl border border-border/80 bg-white px-3 shadow-2xs">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search in this bucket..."
            className="w-full bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
          />
        </label>
      </div>

      {/* People Filter Row */}
      <div className="mb-4 flex flex-wrap items-center gap-2 text-[12px]">
        <span className="font-semibold text-muted-foreground mr-1">People</span>
        <button
          type="button"
          onClick={() => setPersonFilter(null)}
          className={cn(
            "inline-flex h-7 items-center rounded-full border px-3 text-[11px] font-medium transition-colors cursor-pointer",
            personFilter === null
              ? "border-primary bg-primary/10 font-semibold text-primary"
              : "border-border/80 bg-white text-muted-foreground hover:text-foreground",
          )}
        >
          All
        </button>
        {collaborators.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setPersonFilter(personFilter === c.id ? null : c.id)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-colors cursor-pointer",
              personFilter === c.id
                ? "border-primary bg-primary/10 font-semibold text-primary"
                : "border-border/80 bg-white text-muted-foreground hover:text-foreground",
            )}
          >
            <PersonAvatar name={c.name} src={c.avatarUrl} initials={c.initials} size={16} />
            <span>{c.name}</span>
          </button>
        ))}
      </div>

      {/* Segmented Filter Pills & Toolbar */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Things / Lists Switch */}
          <div className="flex items-center rounded-xl border border-border/80 bg-white p-0.5 shadow-2xs">
            <button
              type="button"
              onClick={() => setViewTab("things")}
              className={cn(
                "rounded-lg px-3 py-1 text-[11.5px] font-medium transition-colors cursor-pointer",
                viewTab === "things"
                  ? "bg-primary/10 font-semibold text-primary shadow-2xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Things
            </button>
            <button
              type="button"
              onClick={() => setViewTab("lists")}
              className={cn(
                "rounded-lg px-3 py-1 text-[11.5px] font-medium transition-colors cursor-pointer",
                viewTab === "lists"
                  ? "bg-primary/10 font-semibold text-primary shadow-2xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Lists
            </button>
            <button
              type="button"
              onClick={() => setViewTab("all")}
              className={cn(
                "rounded-lg px-2.5 py-1 text-[11.5px] font-medium transition-colors cursor-pointer",
                viewTab === "all"
                  ? "bg-primary/10 font-semibold text-primary shadow-2xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              All
            </button>
          </div>

          {/* Status Pills */}
          <button
            type="button"
            onClick={() =>
              setStatusFilter(statusFilter === "waiting_for_catch" ? null : "waiting_for_catch")
            }
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[11.5px] font-medium transition-colors cursor-pointer",
              statusFilter === "waiting_for_catch"
                ? "border-orange-300 bg-orange-50 font-semibold text-orange-700"
                : "border-border/80 bg-white text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
            Waiting for catch
          </button>

          <button
            type="button"
            onClick={() =>
              setStatusFilter(statusFilter === "under_progress" ? null : "under_progress")
            }
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[11.5px] font-medium transition-colors cursor-pointer",
              statusFilter === "under_progress"
                ? "border-blue-300 bg-blue-50 font-semibold text-blue-700"
                : "border-border/80 bg-white text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
            Under progress
          </button>

          <button
            type="button"
            onClick={() =>
              setStatusFilter(statusFilter === "completed" ? null : "completed")
            }
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[11.5px] font-medium transition-colors cursor-pointer",
              statusFilter === "completed"
                ? "border-emerald-300 bg-emerald-50 font-semibold text-emerald-700"
                : "border-border/80 bg-white text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Completed
          </button>

          <button
            type="button"
            onClick={() =>
              setStatusFilter(statusFilter === "cancelled" ? null : "cancelled")
            }
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[11.5px] font-medium transition-colors cursor-pointer",
              statusFilter === "cancelled"
                ? "border-slate-300 bg-slate-50 font-semibold text-slate-700"
                : "border-border/80 bg-white text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />
            Cancelled
          </button>
        </div>

        <div className="flex items-center gap-2">
          <label className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-border/80 bg-white px-3 text-[11.5px] text-foreground shadow-2xs">
            <ArrowDownUp className="h-3 w-3 text-muted-foreground" />
            <select
              value={sortOption}
              onChange={(e) => setSortOption(e.target.value as "recent" | "title")}
              className="appearance-none bg-transparent pr-4 text-[11.5px] outline-none font-medium"
              aria-label="Sort bucket items"
            >
              <option value="recent">Sort: Recently updated</option>
              <option value="title">Sort: Title</option>
            </select>
            <ChevronDown className="pointer-events-none -ml-5 h-3 w-3 text-muted-foreground" />
          </label>
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-border/80 bg-white px-3 text-[11.5px] font-medium text-foreground shadow-2xs hover:bg-muted/40"
          >
            <Filter className="h-3 w-3 text-muted-foreground" />
            <span>Filter</span>
          </button>
        </div>
      </div>

      {/* Main Workspace (Things & Lists with Inline Detail) */}
      <InlineThingDetailWorkspace
        thing={selectedThing}
        onClose={() => setSelectedId(null)}
        backLabel={bucket.name}
        items={bucketThings}
        onSelectThing={(id) => setSelectedId(id)}
        navTitle={bucket.name}
      >
        {itemsSurface === "loading" ? (
          <p className="text-sm text-muted-foreground">Loading references…</p>
        ) : itemsSurface === "error" ? (
          <p className="text-sm text-muted-foreground">{domainErrorMessage(itemsError)}</p>
        ) : itemsSurface === "empty" ? (
          <div className="rounded-2xl border border-dashed border-border bg-white px-5 py-12 text-center shadow-2xs">
            <p className="text-[15px] font-bold text-foreground">This Bucket is empty.</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Add a Thing or List you already have access to.
            </p>
            <button
              type="button"
              className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[13px] font-medium text-primary-foreground hover:bg-primary/90"
              onClick={() => setAddOpen(true)}
            >
              <Plus className="h-4 w-4" />
              Add reference
            </button>
          </div>
        ) : (
          <div className="space-y-7">
            {/* Things Section */}
            {(viewTab === "all" || viewTab === "things") && (
              <section>
                <h3 className="mb-3 text-[14.5px] font-bold text-foreground">
                  Things ({thingItems.length})
                </h3>
                {thingItems.length > 0 ? (
                  <div className="space-y-2.5">
                    {thingItems.map((item) => (
                      <BucketThingCardRow
                        key={item.thingId}
                        thing={item.thing}
                        isSelected={selectedId === item.thingId}
                        onOpen={() => setSelectedId(item.thingId)}
                        onRemove={() =>
                          void remove.mutateAsync({ thingId: item.thingId }).then(
                            () => toast.success("Removed from this Bucket. The Thing is unchanged."),
                            (err) => toast.error(domainErrorMessage(err)),
                          )
                        }
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-[13px] text-muted-foreground">No matching Things in this bucket.</p>
                )}
              </section>
            )}

            {/* Lists Section */}
            {(viewTab === "all" || viewTab === "lists") && (
              <section>
                <h3 className="mb-3 text-[14.5px] font-bold text-foreground">
                  Lists ({listItems.length})
                </h3>
                {listItems.length > 0 ? (
                  <div className="space-y-2.5">
                    {listItems.map((item) => (
                      <BucketListCardRow
                        key={item.listId}
                        list={item.list}
                        onRemove={() =>
                          void remove.mutateAsync({ listId: item.listId }).then(
                            () => toast.success("Removed from this Bucket. The List is unchanged."),
                            (err) => toast.error(domainErrorMessage(err)),
                          )
                        }
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-[13px] text-muted-foreground">No matching Lists in this bucket.</p>
                )}
              </section>
            )}

            {/* Bottom Disclaimer Banner */}
            <div className="flex items-center gap-2.5 rounded-2xl border border-purple-100 bg-purple-50/50 p-4 text-[12.5px] text-purple-950 shadow-2xs">
              <Info className="h-4 w-4 shrink-0 text-primary" />
              <span>
                Buckets are private focus spaces. Removing an item from a Bucket does not delete the
                original Thing or List.
              </span>
            </div>
          </div>
        )}
      </InlineThingDetailWorkspace>

      {/* Rename Dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="rounded-2xl bg-white p-5 shadow-xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[15px] font-bold">Rename Bucket</DialogTitle>
            <DialogDescription className="text-[12.5px]">
              Context stays {bucket.context}. Only the name changes.
            </DialogDescription>
          </DialogHeader>
          <input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            className="mt-3.5 h-10 w-full rounded-xl border border-border px-3 text-[13px] outline-none focus:border-primary focus:ring-2 focus:ring-ring"
          />
          <DialogFooter className="mt-4 gap-2">
            <button
              type="button"
              className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-muted-foreground hover:bg-muted"
              onClick={() => setRenameOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded-lg bg-primary px-4 py-1.5 text-[13px] font-medium text-primary-foreground hover:bg-primary/90"
              onClick={() => {
                void rename.mutateAsync(renameValue).then(
                  () => {
                    toast.success("Bucket renamed.");
                    setRenameOpen(false);
                  },
                  (err) => toast.error(domainErrorMessage(err)),
                );
              }}
            >
              Save
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="rounded-2xl bg-white p-5 shadow-xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[15px] font-bold text-destructive">Delete this Bucket?</DialogTitle>
            <DialogDescription className="text-[12.5px]">
              This removes only your private grouping. The Things and Lists inside it will not be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 gap-2">
            <button
              type="button"
              className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-muted-foreground hover:bg-muted"
              onClick={() => setDeleteOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded-lg bg-destructive px-4 py-1.5 text-[13px] font-medium text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                void deleteBucket.mutateAsync().then(
                  () => {
                    toast.success("Bucket deleted. Referenced work is unchanged.");
                    setDeleteOpen(false);
                    void navigate({ to: "/buckets" });
                  },
                  (err) => toast.error(domainErrorMessage(err)),
                );
              }}
            >
              Delete Bucket
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
