import { useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { format, formatDistanceToNowStrict, isToday } from "date-fns";
import {
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  FileText,
  Lock,
  Loader2,
  MessageSquare,
  MoreVertical,
  Paperclip,
  Plus,
  Search,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { ThingStatusCapsule } from "@/features/catchup/ThingStatusCapsule";
import { useCourt } from "@/features/court/use-court";
import { useBucket } from "@/features/buckets/use-buckets";
import { useBucketNotes } from "@/features/buckets/use-bucket-notes";
import {
  useAccessibleLists,
  useAccessibleThings,
  useBucketItems,
  type BucketItem,
} from "@/features/buckets/use-bucket-items";
import { bucketItemsSurface } from "@/features/buckets/bucket-items-surface";
import { BucketNotesWorkspace } from "@/features/buckets/BucketNotesWorkspace";
import { CourtDetailModal } from "@/features/court/CourtDetailModal";
import { ListDetailSkeleton, Shimmer } from "@/components/katalist/ScreenSkeletons";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { domainErrorMessage } from "@/lib/domain-error";
import { classifyAsyncError } from "@/lib/query-policy";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { laneOf, type Thing } from "@/domain/thing";
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

/** Status label + colour for a Thing, matching the bucket-detail table design. */
function thingStatusMeta(t: Thing): { label: string; color: string } {
  if (t.workStatus === "cancelled") return { label: "Cancelled", color: "#8487a7" };
  if (t.workStatus === "sorted") return { label: "Sorted", color: "#12a15f" };
  if (t.acknowledgement === "waiting_for_catch") return { label: "Waiting for catch", color: "#e0a422" };
  if (t.workStatus === "under_progress") return { label: "Under Progress", color: "#7c33fd" };
  return { label: "Not Started", color: "#8487a7" };
}

function formatDue(dueAt: string | null): string {
  if (!dueAt) return "—";
  const d = new Date(dueAt);
  return isToday(d) ? "Today" : format(d, "d MMM");
}

function relativeUpdated(iso: string): string {
  try {
    return `${formatDistanceToNowStrict(new Date(iso))} ago`;
  } catch {
    return "—";
  }
}

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

function BucketItemsShimmer({ view }: { view: "things" | "lists" }) {
  if (view === "lists") {
    return (
      <div aria-label="Loading bucket Lists" className="animate-in fade-in">
        <Shimmer className="mb-4 h-3 w-24" />
        <div className="divide-y divide-[#f2f3f9]">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="grid grid-cols-1 items-center gap-3 py-3 sm:grid-cols-[minmax(0,1.6fr)_1fr_0.7fr_1.4fr_auto] sm:gap-4"
            >
              <div className="flex items-center gap-3">
                <Shimmer className="h-9 w-9 shrink-0 rounded-[8px]" />
                <div className="flex-1 space-y-2">
                  <Shimmer className="h-3.5 w-3/5" />
                  <Shimmer className="h-3 w-2/5" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Shimmer className="h-6 w-6 rounded-full" />
                <Shimmer className="h-3 w-24" />
              </div>
              <Shimmer className="h-3 w-16" />
              <div className="flex items-center gap-2">
                <Shimmer className="h-1.5 w-24 rounded-full" />
                <Shimmer className="h-3 w-20" />
              </div>
              <Shimmer className="h-3 w-14" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div aria-label="Loading bucket Things" className="animate-in fade-in">
      <Shimmer className="mb-4 h-3 w-24" />
      <div className="mb-2 grid grid-cols-[2fr_1fr_1fr_0.65fr_0.55fr_0.45fr_0.8fr_36px] gap-4 border-b border-[#eef0f6] px-3 pb-2">
        {Array.from({ length: 8 }).map((_, index) => (
          <Shimmer key={index} className="h-2.5 w-3/4" />
        ))}
      </div>
      <div className="divide-y divide-[#f2f3f9]">
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            key={index}
            className="grid grid-cols-[2fr_1fr_1fr_0.65fr_0.55fr_0.45fr_0.8fr_36px] items-center gap-4 px-3 py-3"
          >
            <div className="flex items-center gap-2">
              <Shimmer className="h-4 w-4 shrink-0" />
              <Shimmer className="h-3.5 w-4/5" />
            </div>
            <div className="flex items-center gap-2">
              <Shimmer className="h-6 w-6 rounded-full" />
              <Shimmer className="h-3 w-16" />
            </div>
            <Shimmer className="h-5 w-20 rounded-full" />
            <Shimmer className="h-3 w-12" />
            <Shimmer className="h-3 w-8" />
            <Shimmer className="h-3 w-8" />
            <Shimmer className="h-3 w-16" />
            <Shimmer className="h-8 w-8 rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}

function BucketDetailPage() {
  const { bucketId } = Route.useParams();
  const navigate = useNavigate();
  const { bucket, isLoading, error, rename, remove: deleteBucket, refetch: refetchBucket } = useBucket(bucketId);
  const { myActorId } = useCourt();
  const { items, add, remove, isLoading: itemsLoading, error: itemsError, refetch: refetchItems } = useBucketItems(bucketId);
  const things = useAccessibleThings();
  const lists = useAccessibleLists();

  const [q, setQ] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<"things" | "lists" | "notes">("things");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [addTab, setAddTab] = useState<"things" | "lists">("things");
  const [addQ, setAddQ] = useState("");
  const [pendingReference, setPendingReference] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectionOriginRef = useRef<HTMLElement | null>(null);
  const openThing = (thingId: string, origin?: HTMLElement | null) => {
    selectionOriginRef.current = origin ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setSelectedId(thingId);
  };
  const closeThing = () => {
    setSelectedId(null);
    const origin = selectionOriginRef.current;
    selectionOriginRef.current = null;
    requestAnimationFrame(() => {
      if (origin?.isConnected && document.activeElement === document.body) origin.focus();
    });
  };
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);

  const notesApi = useBucketNotes(bucketId);

  const thingItemsAll = items.filter(
    (i): i is Extract<BucketItem, { kind: "thing"; availability: "available" }> =>
      i.kind === "thing" && i.availability === "available",
  );
  const listItemsAll = items.filter(
    (i): i is Extract<BucketItem, { kind: "list"; availability: "available" }> =>
      i.kind === "list" && i.availability === "available",
  );
  const selectedThing = thingItemsAll.find((i) => i.thingId === selectedId)?.thing ?? things.find((thing) => thing.id === selectedId) ?? null;

  const referencedThingIds = new Set(thingItemsAll.map((i) => i.thingId));
  const referencedListIds = new Set(listItemsAll.map((i) => i.listId));

  // Unique assignees (shown as avatar filter chips in the toolbar).
  const assignees = useMemo(() => {
    const map = new Map<string, { name: string; avatarUrl?: string | null; initials: string }>();
    for (const it of thingItemsAll) {
      const a = it.thing.assignee;
      if (!a?.name || a.name === "Someone" || a.name.trim() === "") continue;
      const key = a.name.trim().toLowerCase();
      if (!map.has(key)) {
        map.set(key, {
          name: a.name.trim(),
          avatarUrl: a.avatarUrl,
          initials: a.initials || a.name.trim().slice(0, 2).toUpperCase(),
        });
      }
    }
    return Array.from(map.values());
  }, [thingItemsAll]);

  const visible = useMemo(() => {
    return items.filter((item) => {
      if (item.kind === "thing") {
        if (item.availability === "unavailable") {
          return !assigneeFilter && !statusFilter && (!q || "unavailable thing".includes(q.toLowerCase()));
        }
        if (!matchesQuery(q, item.thing)) return false;
        if (assigneeFilter) {
          if (!item.thing.assignee || item.thing.assignee.name.toLowerCase() !== assigneeFilter.toLowerCase())
            return false;
        }
        if (statusFilter) {
          if (statusFilter === "waiting_for_catch" && item.thing.acknowledgement !== "waiting_for_catch")
            return false;
          if (statusFilter === "under_progress" && item.thing.workStatus !== "under_progress") return false;
          if (statusFilter === "completed" && item.thing.workStatus !== "sorted") return false;
          if (statusFilter === "cancelled" && item.thing.workStatus !== "cancelled") return false;
        }
        return true;
      }
      if (item.kind === "list") {
        if (statusFilter) return false;
        if (item.availability === "unavailable") return !q || "unavailable list".includes(q.toLowerCase());
        return matchesQuery(q, undefined, item.list);
      }
      return true;
    });
  }, [items, q, assigneeFilter, statusFilter]);

  const thingItems = visible.filter((i): i is Extract<BucketItem, { kind: "thing" }> => i.kind === "thing");
  const listItems = visible.filter((i): i is Extract<BucketItem, { kind: "list" }> => i.kind === "list");
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
      <AppShell noPadding hideTopNav hideBottomNav>
        <ListDetailSkeleton />
      </AppShell>
    );
  }

  if (error) {
    // B-03/C-06: only a genuinely transient failure implies Retry might
    // help. A confirmed access-loss kind (revoked private-Bucket access,
    // deleted Bucket) is not a fetch failure to retry -- it correctly
    // reflects that this identity can no longer see this Bucket.
    const kind = classifyAsyncError(error);
    const accessLost = kind === "forbidden" || kind === "unauthenticated" || kind === "not-found";
    return (
      <AppShell title="Bucket" subtitle={accessLost ? "No longer available" : "Couldn’t load"} hideTopNav hideBottomNav>
        <p className="text-sm text-muted-foreground">
          {accessLost
            ? "You no longer have access to this Bucket, or it no longer exists."
            : domainErrorMessage(error)}
        </p>
        {accessLost ? (
          <Link to="/buckets" className="mt-3 inline-block text-sm font-semibold text-primary">
            Back to Buckets
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => void refetchBucket()}
            className="mt-3 inline-flex h-8 items-center rounded-md border border-border px-3 text-[12.5px] font-medium hover:bg-muted"
          >
            Retry
          </button>
        )}
      </AppShell>
    );
  }

  if (!bucket) {
    return (
      <AppShell title="Bucket" subtitle="Not found" hideTopNav hideBottomNav>
        <p className="text-sm text-muted-foreground">Bucket not found.</p>
        <Link to="/buckets" className="mt-2 inline-block text-sm font-semibold text-primary">
          Back to Buckets
        </Link>
      </AppShell>
    );
  }

  const itemsSurface = bucketItemsSurface({ itemsLoading, itemsError, itemCount: items.length });

  const bucketInitials =
    bucket.name
      .split(" ")
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "B";

  const sortedThingItems = [...thingItems].sort((a, b) => {
    if (a.availability !== b.availability) return a.availability === "available" ? -1 : 1;
    if (a.availability === "unavailable" || b.availability === "unavailable") {
      return a.thingId.localeCompare(b.thingId);
    }
    return new Date(b.thing.updatedAt).getTime() - new Date(a.thing.updatedAt).getTime();
  });

  const addBucketReference = async (input: { thingId?: string; listId?: string }, label: string) => {
    if (pendingReference) return;
    const key = input.thingId ? `thing:${input.thingId}` : `list:${input.listId}`;
    setPendingReference(key);
    try {
      await add.mutateAsync(input);
      toast.success(label);
      setAddOpen(false);
    } catch (err) {
      toast.error(domainErrorMessage(err));
    } finally {
      setPendingReference(null);
    }
  };

  // Buckets are private reference groupings; this picker never creates or
  // changes the source Thing/List's permissions.
  const addReference = (
    <Popover open={addOpen} onOpenChange={(next) => { if (!pendingReference) setAddOpen(next); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#975ee2] px-3 text-[12.5px] font-medium text-white transition hover:brightness-95"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Add reference</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-1.5rem))] rounded-2xl border border-border/80 bg-white p-3 shadow-[0_18px_48px_-20px_rgba(37,24,84,0.28)]">
        <div className="mb-2.5 flex gap-1 rounded-xl bg-muted p-1">
          <button
            type="button"
            className={cn(
              "flex-1 rounded-lg px-2.5 py-1 text-[12px] font-medium transition-colors",
              addTab === "things" ? "bg-white text-foreground font-semibold" : "text-muted-foreground",
            )}
            disabled={Boolean(pendingReference)}
            onClick={() => setAddTab("things")}
          >
            Things
          </button>
          <button
            type="button"
            className={cn(
              "flex-1 rounded-lg px-2.5 py-1 text-[12px] font-medium transition-colors",
              addTab === "lists" ? "bg-white text-foreground font-semibold" : "text-muted-foreground",
            )}
            disabled={Boolean(pendingReference)}
            onClick={() => setAddTab("lists")}
          >
            Lists
          </button>
        </div>
        <input
          value={addQ}
          onChange={(e) => setAddQ(e.target.value)}
          disabled={Boolean(pendingReference)}
          placeholder={addTab === "things" ? "Search Things…" : "Search Lists…"}
          className="mb-2 h-8.5 w-full rounded-lg border border-border bg-background px-2.5 text-[12.5px] outline-none focus:ring-2 focus:ring-ring"
        />
        {pendingReference ? <p role="status" className="mb-2 flex items-center gap-1.5 rounded-lg bg-[#f7f3ff] px-2.5 py-2 text-[12px] font-medium text-[#6638ec]"><Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />Adding reference…</p> : null}
        <ul className="max-h-72 space-y-0.5 overflow-y-auto pr-0.5" aria-busy={Boolean(pendingReference)}>
          {addTab === "things"
            ? addThings.slice(0, 40).map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    disabled={Boolean(pendingReference)}
                    className="group relative flex w-full items-center gap-2.5 overflow-hidden rounded-xl px-2.5 py-2 text-left hover:bg-[#f7f3ff] focus-visible:bg-[#f7f3ff] focus-visible:outline-2 focus-visible:outline-[#975ee2] motion-safe:transition-[background-color,box-shadow] motion-safe:duration-200 hover:shadow-[inset_0_0_0_1px_#e7d8ff] cursor-pointer disabled:cursor-wait disabled:opacity-60"
                    onClick={() => void addBucketReference({ thingId: t.id }, "Referenced. The Thing itself did not change.")}
                  >
                    <span className="min-w-0 flex-1 motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out group-hover:motion-safe:translate-x-0.5 group-focus-visible:motion-safe:translate-x-0.5">
                      <span className="block line-clamp-2 text-[12.5px] font-medium leading-4.5 text-[#11163b]">{t.title}</span>
                      <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-[#7883a5]">
                        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", laneOf(t) === "now" ? "bg-[#ff4747]" : laneOf(t) === "next" ? "bg-[#0661f9]" : "bg-[#7c33fd]")} />
                        <span className="capitalize">{laneOf(t)}</span>
                        <span aria-hidden="true">·</span>
                        <PersonAvatar name={t.assignee.name} src={t.assignee.avatarUrl} initials={t.assignee.initials} size={18} />
                        <span className="truncate">{t.assignee.name}</span>
                        {t.dueAt ? <span className="ml-auto flex shrink-0 items-center gap-1"><CalendarDays className="h-3 w-3" />{formatDue(t.dueAt)}</span> : null}
                      </span>
                    </span>
                    {pendingReference === `thing:${t.id}` ? <Loader2 aria-label="Adding reference" className="h-4 w-4 shrink-0 animate-spin text-[#975ee2] motion-reduce:animate-none" /> : <Plus aria-hidden="true" className="h-4 w-4 shrink-0 text-[#975ee2] opacity-0 motion-safe:scale-75 motion-safe:transition-[opacity,transform] motion-safe:duration-200 group-hover:opacity-100 group-hover:motion-safe:scale-100 group-focus-visible:opacity-100 group-focus-visible:motion-safe:scale-100" />}
                  </button>
                </li>
              ))
            : addLists.map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    disabled={Boolean(pendingReference)}
                    className="group relative flex w-full items-center gap-2.5 overflow-hidden rounded-xl px-2.5 py-2 text-left hover:bg-[#f7f3ff] focus-visible:bg-[#f7f3ff] focus-visible:outline-2 focus-visible:outline-[#975ee2] motion-safe:transition-[background-color,box-shadow] motion-safe:duration-200 hover:shadow-[inset_0_0_0_1px_#e7d8ff] cursor-pointer disabled:cursor-wait disabled:opacity-60"
                    onClick={() => void addBucketReference({ listId: l.id }, "List referenced. Ownership unchanged.")}
                  >
                    <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-[9px] bg-[#efeafe] text-[#6638ec] shadow-sm">
                      {l.coverUrl ? <img src={l.coverUrl} alt="" className="h-full w-full object-cover motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out group-hover:motion-safe:scale-110 group-focus-visible:motion-safe:scale-110" /> : <span className="flex h-full w-full items-center justify-center text-[14px] font-semibold">{l.name.slice(0, 1).toUpperCase()}</span>}
                    </span>
                    <span className="min-w-0 flex-1 motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out group-hover:motion-safe:translate-x-0.5 group-focus-visible:motion-safe:translate-x-0.5">
                      <span className="block truncate text-[12.5px] font-semibold text-[#11163b]">{l.name}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-[#7883a5]">{l.thingCount} {l.thingCount === 1 ? "Thing" : "Things"} · {l.ownerLine}</span>
                    </span>
                    {pendingReference === `list:${l.id}` ? <Loader2 aria-label="Adding reference" className="h-4 w-4 shrink-0 animate-spin text-[#975ee2] motion-reduce:animate-none" /> : <Plus aria-hidden="true" className="h-4 w-4 shrink-0 text-[#975ee2] opacity-0 motion-safe:scale-75 motion-safe:transition-[opacity,transform] motion-safe:duration-200 group-hover:opacity-100 group-hover:motion-safe:scale-100 group-focus-visible:opacity-100 group-focus-visible:motion-safe:scale-100" />}
                  </button>
                </li>
              ))}
          {(addTab === "things" ? addThings : addLists).length === 0 ? (
            <li className="px-2 py-4 text-center text-[12px] text-muted-foreground">Nothing else to add.</li>
          ) : null}
        </ul>
      </PopoverContent>
    </Popover>
  );

  const settingsMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Bucket settings"
          className="flex h-[42px] w-[42px] items-center justify-center rounded-[9px] border border-[#ebecf7] bg-white text-[#8487a7] hover:bg-muted hover:text-foreground"
        >
          <MoreVertical className="h-4 w-4" />
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
  );

  const linkedListsSection =
    listItems.length > 0 ? (
      <section>
        <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-[#8487a7]">
          Linked Lists - {listItems.length}
        </h3>
        <div className="divide-y divide-[#f2f3f9]">
          {listItems.map((item) => {
            if (item.availability === "unavailable") {
              return (
                <div key={item.listId} className="flex items-center justify-between gap-3 py-4">
                  <div>
                    <p className="text-[13px] font-semibold text-[#000533]">Unavailable List</p>
                    <p className="text-[12px] text-[#6a769c]">This reference is retained, but its source is no longer accessible.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void remove.mutateAsync({ listId: item.listId }).then(
                      () => toast.success("Reference removed. The source List is unchanged."),
                      (err) => toast.error(domainErrorMessage(err)),
                    )}
                    className="text-[12px] font-semibold text-destructive hover:underline"
                  >
                    Remove reference
                  </button>
                </div>
              );
            }
            const l = item.list;
            const open = Math.max(0, l.thingCount - l.doneCount);
            const pct = l.thingCount ? Math.round((l.doneCount / l.thingCount) * 100) : 0;
            const owner = l.members?.find((m) => m.role === "owner");
            return (
              <div
                key={item.listId}
                className="grid min-w-0 grid-cols-1 items-center gap-3 py-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(80px,0.9fr)_minmax(65px,0.6fr)_minmax(120px,1.2fr)_auto] sm:gap-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  {l.coverUrl ? (
                    <img
                      src={l.coverUrl}
                      alt=""
                      className="h-9 w-9 shrink-0 rounded-[8px] object-cover"
                    />
                  ) : (
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[#efeafe] text-[13px] font-semibold text-[#6638ec]">
                      {l.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-[#000533]">{l.name}</div>
                    {l.description ? (
                      <div className="truncate text-[12px] text-[#6a769c]">{l.description}</div>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {owner ? (
                    <PersonAvatar name={owner.name} src={owner.avatarUrl} initials={owner.initials} size={24} />
                  ) : null}
                  <div className="leading-tight">
                    <div className="text-[12px] font-medium text-[#000533]">{owner?.name ?? l.ownerLine}</div>
                    <div className="text-[12px] text-[#8487a7]">Owner</div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-[12px] text-[#3d3f74]">
                  <FileText className="h-3.5 w-3.5 text-[#8487a7]" />
                  <span>{l.thingCount} Things</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[#eef0f6]">
                    <div className="h-full rounded-full bg-[#7c33fd]" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="whitespace-nowrap text-[12px] text-[#6a769c]">
                    {l.doneCount} done • {open} open
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void navigate({ to: "/lists/$listId", params: { listId: l.id } })}
                  className="justify-self-start text-[12.5px] font-semibold text-[#975ee2] hover:underline sm:justify-self-end"
                >
                  Open List
                </button>
              </div>
            );
          })}
        </div>
      </section>
    ) : detailTab === "lists" ? (
      <p className="py-8 text-center text-[12.5px] text-[#6a769c]">No Lists linked to this bucket.</p>
    ) : null;

  const thingsSection = (
    <section>
      <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-[#8487a7]">
        Things - {sortedThingItems.length}
      </h3>
      {sortedThingItems.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#e3e5ef] py-10 text-center text-[12.5px] text-[#6a769c]">
          No Things in this bucket yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left">
            <thead>
              <tr className="border-b border-[#eef0f6] text-[12px] font-semibold uppercase tracking-wide text-[#8487a7]">
                <th className="px-3 py-1.5 font-semibold">Thing</th>
                <th className="px-3 py-1.5 font-semibold">Assignee</th>
                <th className="px-3 py-1.5 font-semibold">Status</th>
                <th className="px-3 py-1.5 font-semibold">Due</th>
                <th className="px-3 py-1.5 font-semibold">Comments</th>
                <th className="px-3 py-1.5 font-semibold">Files</th>
                <th className="px-3 py-1.5 font-semibold">Updated</th>
                <th className="py-2 pr-2" />
              </tr>
            </thead>
            <tbody>
              {sortedThingItems.map((item) => {
                if (item.availability === "unavailable") {
                  return (
                    <tr key={item.thingId} className="border-b border-[#f2f3f9] last:border-0">
                      <td className="px-3 py-3" colSpan={7}>
                        <p className="text-[13px] font-semibold text-[#000533]">Unavailable Thing</p>
                        <p className="text-[12px] text-[#6a769c]">This reference is retained, but its source is no longer accessible.</p>
                      </td>
                      <td className="py-3 pr-2 text-right">
                        <button
                          type="button"
                          onClick={() => void remove.mutateAsync({ thingId: item.thingId }).then(
                            () => toast.success("Reference removed. The source Thing is unchanged."),
                            (err) => toast.error(domainErrorMessage(err)),
                          )}
                          className="text-[12px] font-semibold text-destructive hover:underline"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                }
                const t = item.thing;
                const st = thingStatusMeta(t);
                const comments = t.commentCount ?? t.unreadCommentCount ?? 0;
                const files = t.attachmentCount ?? t.files?.length ?? 0;
                return (
                  <tr key={item.thingId} className="border-b border-[#f2f3f9] last:border-0 hover:bg-[#faf9fe]">
                    <td className="px-3 py-1.5">
                      <button
                        type="button"
                        onClick={(event) => openThing(item.thingId, event.currentTarget)}
                        title={t.title}
                        className="flex max-w-[420px] items-center gap-2 text-left"
                      >
                        <FileText className="h-4 w-4 shrink-0 text-[#8487a7]" />
                        <span
                          className={cn(
                            "truncate text-[13px] font-medium text-[#000533] hover:text-[#975ee2]",
                            t.workStatus === "sorted" && "line-through",
                          )}
                        >
                          {t.title}
                        </span>
                      </button>
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-2">
                        <PersonAvatar name={t.assignee.name} src={t.assignee.avatarUrl} initials={t.assignee.initials} size={24} />
                        <span className="text-[12.5px] text-[#3d3f74]">{t.assignee.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-1.5">
                      <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium" style={{ color: st.color }}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: st.color }} />
                        {st.label}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-[12.5px] text-[#3d3f74]">{formatDue(t.dueAt)}</td>
                    <td className="px-3 py-1.5">
                      <span className="inline-flex items-center gap-1.5 text-[12.5px] text-[#6a769c]">
                        <MessageSquare className="h-3.5 w-3.5" />
                        {comments}
                      </span>
                    </td>
                    <td className="px-3 py-1.5">
                      <span className="inline-flex items-center gap-1.5 text-[12.5px] text-[#6a769c]">
                        <Paperclip className="h-3.5 w-3.5" />
                        {files}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-[12.5px] text-[#6a769c]">{relativeUpdated(t.updatedAt)}</td>
                    <td className="py-1.5 pr-2 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#8487a7] hover:bg-muted"
                            aria-label="Thing actions"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44 bg-white">
                          <DropdownMenuItem className="text-[12.5px] cursor-pointer" onSelect={() => openThing(item.thingId)}>
                            Open
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-[12.5px] cursor-pointer"
                            onSelect={() =>
                              void remove.mutateAsync({ thingId: item.thingId }).then(
                                () => toast.success("Removed from this Bucket. The Thing is unchanged."),
                                (err) => toast.error(domainErrorMessage(err)),
                              )
                            }
                          >
                            Remove from bucket
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
      )}
    </section>
  );

  return (
    <AppShell noPadding hideTopNav hideBottomNav>
      <div className="min-h-screen space-y-3 bg-[#edf2fe] px-4 py-3 pb-20">
        {/* Sub-header + tabs card */}
        <div className="rounded-[10px] bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <Link
                to="/buckets"
                className="inline-flex items-center gap-2 rounded-full text-[12.5px] font-medium text-[#6a769c] transition-colors hover:text-[#000533]"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>Back to Bucket</span>
              </Link>
              <div className="h-7 w-px bg-[#eef0f6]" />
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] bg-[#fee19c] text-[12px] font-medium text-black">
                  {bucketInitials}
                </span>
                <div className="min-w-0">
                  <div className="max-w-[240px] truncate text-[14px] font-semibold leading-tight text-black">
                    {bucket.name}
                  </div>
                  <div className="flex items-center gap-1 text-[11px] text-[#6a769c]">
                    <Lock className="h-3 w-3" />
                    Private · shared item permissions stay unchanged
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {addReference}
              {settingsMenu}
            </div>
          </div>
          <div className="flex items-center gap-6 border-t border-[#eef0f6] px-4">
            {(
              [
                ["things", "Things"],
                ["lists", "Lists"],
                ["notes", "Notes"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setDetailTab(id)}
                className={cn(
                  "relative -mb-px border-b-2 py-2 text-[13px] font-medium transition-colors",
                  detailTab === id
                    ? "border-[#975ee2] text-[#000533]"
                    : "border-transparent text-[#6a769c] hover:text-[#000533]",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Content card */}
        <div className="rounded-[10px] bg-white p-5">
          {/* Toolbar (not shown on the Notes tab) */}
          {detailTab !== "notes" ? (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <label className="flex h-10 w-full max-w-[320px] items-center gap-2 rounded-[10px] border border-[#ebecf7] bg-[#f9f9fe] px-3 focus-within:border-[#975ee2]">
                <Search className="h-4 w-4 text-[#8487a7]" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search messages"
                  className="min-w-0 flex-1 bg-transparent text-[12.5px] text-[#000533] outline-none placeholder:text-[#8487a7]"
                />
              </label>
              <label className="relative inline-flex h-10 items-center gap-1.5 rounded-[10px] border border-[#ebecf7] bg-white px-3 text-[12.5px] text-[#3d3f74] focus-within:border-[#975ee2] focus-within:ring-2 focus-within:ring-ring">
                <select
                  value={statusFilter ?? "all"}
                  onChange={(e) => setStatusFilter(e.target.value === "all" ? null : e.target.value)}
                  className="appearance-none bg-transparent pr-5 outline-none"
                  aria-label="Status"
                >
                  <option value="all">All statuses</option>
                  <option value="waiting_for_catch">Waiting for catch</option>
                  <option value="under_progress">Under Progress</option>
                  <option value="completed">Sorted</option>
                  <option value="cancelled">Cancelled</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-[#8487a7]" />
              </label>

              <ThingStatusCapsule
                scopeKey={bucketId}
                scopeLabel="Bucket"
                scopeName={bucket.name}
                things={thingItemsAll.map((item) => item.thing)}
                myActorId={myActorId}
                onOpenThing={(thing) => { setDetailTab("things"); setQ(""); setStatusFilter(null); setAssigneeFilter(null); openThing(thing.id); }}
              />

              {/* Assignee avatar filters */}
              {assignees.length > 0 ? (
                <div className="ml-auto flex items-center -space-x-1.5">
                  {assignees.map((a) => {
                    const active = assigneeFilter?.toLowerCase() === a.name.toLowerCase();
                    return (
                      <button
                        key={a.name}
                        type="button"
                        title={a.name}
                        onClick={() => setAssigneeFilter(active ? null : a.name)}
                        className={cn(
                          "rounded-full ring-2 transition-transform hover:z-10 hover:-translate-y-0.5",
                          active ? "z-10 ring-[#975ee2]" : "ring-white",
                        )}
                      >
                        <PersonAvatar name={a.name} src={a.avatarUrl} initials={a.initials} size={28} />
                      </button>
                    );
                  })}
                  {assigneeFilter ? (
                    <button
                      type="button"
                      onClick={() => setAssigneeFilter(null)}
                      className="ml-3 text-[12px] font-medium text-[#975ee2] hover:underline"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {itemsSurface === "loading" ? (
              <BucketItemsShimmer view={detailTab === "lists" ? "lists" : "things"} />
            ) : itemsSurface === "error" ? (
              <div role="alert" className="rounded-xl border border-destructive/30 p-5 text-center">
                <p className="text-sm text-muted-foreground">{domainErrorMessage(itemsError)}</p>
                <button type="button" onClick={() => void refetchItems()} className="mt-3 rounded-lg border px-3 py-2 text-[12px] font-semibold">
                  Retry
                </button>
              </div>
            ) : detailTab === "notes" ? (
              <BucketNotesWorkspace
                context={bucket.context}
                myActorId={myActorId ?? ""}
                notesApi={notesApi}
                addThingToBucket={(thingId) => add.mutateAsync({ thingId })}
                onOpenThing={(thing) => openThing(thing.id)}
              />
            ) : itemsSurface === "empty" ? (
              <div className="rounded-2xl border border-dashed border-[#e3e5ef] px-5 py-12 text-center">
                <p className="text-[15px] font-bold text-[#000533]">This Bucket is empty.</p>
                <p className="mt-1 text-[13px] text-[#6a769c]">Add a Thing or List you already have access to.</p>
                <button
                  type="button"
                  className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#975ee2] px-3.5 text-[13px] font-medium text-white"
                  onClick={() => setAddOpen(true)}
                >
                  <Plus className="h-4 w-4" />
                  Add reference
                </button>
              </div>
            ) : (
              <div className="space-y-8">
                {detailTab === "lists" && linkedListsSection}
                {detailTab === "things" && thingsSection}
              </div>
            )}
        </div>
      </div>
      <CourtDetailModal
        thing={selectedThing}
        isOpen={Boolean(selectedThing)}
        onClose={closeThing}
      />

      {/* Rename Dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="rounded-2xl bg-white p-5 sm:max-w-md">
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
        <DialogContent className="rounded-2xl bg-white p-5 sm:max-w-md">
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
