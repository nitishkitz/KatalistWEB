import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { format, formatDistanceToNowStrict, isToday } from "date-fns";
import {
  ArrowLeft,
  ChevronDown,
  FileText,
  Lock,
  MessageSquare,
  MoreVertical,
  Paperclip,
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
import { ListDetailSkeleton } from "@/components/katalist/ScreenSkeletons";
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

function BucketDetailPage() {
  const { bucketId } = Route.useParams();
  const navigate = useNavigate();
  const { bucket, isLoading, error, rename, remove: deleteBucket } = useBucket(bucketId);
  const { items, add, remove, isLoading: itemsLoading, error: itemsError } = useBucketItems(bucketId);
  const things = useAccessibleThings();
  const lists = useAccessibleLists();

  const [q, setQ] = useState("");
  const [personFilter] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<"things" | "lists" | "notes">("things");
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

  const collaborators = useMemo(() => {
    const map = new Map<string, { id: string; name: string; ids: Set<string> }>();
    const record = (person?: { id?: string; name?: string }) => {
      if (!person?.name || person.name === "Someone" || person.name.trim() === "") return;
      const key = person.name.trim().toLowerCase();
      const existing = map.get(key);
      if (existing) {
        if (person.id) existing.ids.add(person.id);
      } else {
        map.set(key, { id: person.id || key, name: person.name.trim(), ids: new Set(person.id ? [person.id] : []) });
      }
    };
    for (const it of thingItemsAll) {
      record(it.thing.assignee);
      record(it.thing.owner);
    }
    return Array.from(map.values());
  }, [thingItemsAll]);

  const visible = useMemo(() => {
    return items.filter((item) => {
      if (item.kind === "thing") {
        if (!matchesQuery(q, item.thing)) return false;
        if (personFilter) {
          const collab = collaborators.find(
            (c) => c.name.toLowerCase() === personFilter.toLowerCase() || c.ids.has(personFilter),
          );
          const matchesAssignee =
            item.thing.assignee &&
            (item.thing.assignee.name.toLowerCase() === personFilter.toLowerCase() ||
              (collab?.ids && collab.ids.has(item.thing.assignee.id)));
          if (!matchesAssignee) return false;
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
        return matchesQuery(q, undefined, item.list);
      }
      return true;
    });
  }, [items, q, personFilter, statusFilter, collaborators]);

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
      <AppShell noPadding>
        <ListDetailSkeleton />
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

  const itemsSurface = bucketItemsSurface({ itemsLoading, itemsError, itemCount: items.length });

  const bucketInitials =
    bucket.name
      .split(" ")
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "B";

  const sortedThingItems = [...thingItems].sort((a, b) =>
    sortOption === "title"
      ? a.thing.title.localeCompare(b.thing.title)
      : new Date(b.thing.updatedAt).getTime() - new Date(a.thing.updatedAt).getTime(),
  );

  // "New Thing" adds a reference to an existing Thing/List (Buckets never own or
  // create Things — they are private reference groupings).
  const addReference = (
    <Popover open={addOpen} onOpenChange={setAddOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-[42px] items-center gap-2 rounded-[9px] bg-[#975ee2] px-4 text-[14px] font-medium text-white transition hover:brightness-95"
        >
          <Plus className="h-4 w-4" />
          <span>New Thing</span>
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
        <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[#8487a7]">
          Linked Lists - {listItems.length}
        </h3>
        <div className="divide-y divide-[#f2f3f9]">
          {listItems.map((item) => {
            const l = item.list;
            const open = Math.max(0, l.thingCount - l.doneCount);
            const pct = l.thingCount ? Math.round((l.doneCount / l.thingCount) * 100) : 0;
            const owner = l.members?.find((m) => m.role === "owner");
            return (
              <div
                key={item.listId}
                className="grid grid-cols-1 items-center gap-3 py-3 sm:grid-cols-[minmax(0,1.6fr)_1fr_0.7fr_1.4fr_auto] sm:gap-4"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[#efeafe] text-[13px] font-semibold text-[#6638ec]">
                    {l.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-[#000533]">{l.name}</div>
                    {l.description ? (
                      <div className="truncate text-[11.5px] text-[#6a769c]">{l.description}</div>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {owner ? (
                    <PersonAvatar name={owner.name} src={owner.avatarUrl} initials={owner.initials} size={24} />
                  ) : null}
                  <div className="leading-tight">
                    <div className="text-[12px] font-medium text-[#000533]">{owner?.name ?? l.ownerLine}</div>
                    <div className="text-[11px] text-[#8487a7]">Owner</div>
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
                  <span className="whitespace-nowrap text-[11.5px] text-[#6a769c]">
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
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[#8487a7]">
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
              <tr className="border-b border-[#eef0f6] text-[11px] font-semibold uppercase tracking-wide text-[#8487a7]">
                <th className="px-3 py-2.5 font-semibold">Thing</th>
                <th className="px-3 py-2.5 font-semibold">Assignee</th>
                <th className="px-3 py-2.5 font-semibold">Status</th>
                <th className="px-3 py-2.5 font-semibold">Due</th>
                <th className="px-3 py-2.5 font-semibold">Comments</th>
                <th className="px-3 py-2.5 font-semibold">Files</th>
                <th className="px-3 py-2.5 font-semibold">Updated</th>
                <th className="py-2.5 pr-2" />
              </tr>
            </thead>
            <tbody>
              {sortedThingItems.map((item) => {
                const t = item.thing;
                const st = thingStatusMeta(t);
                const comments = t.commentCount ?? t.unreadCommentCount ?? 0;
                const files = t.attachmentCount ?? t.files?.length ?? 0;
                return (
                  <tr key={item.thingId} className="border-b border-[#f2f3f9] last:border-0 hover:bg-[#faf9fe]">
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        onClick={() => setSelectedId(item.thingId)}
                        className="flex items-center gap-2 text-left"
                      >
                        <FileText className="h-4 w-4 shrink-0 text-[#8487a7]" />
                        <span className="text-[13px] font-medium text-[#000533] hover:text-[#975ee2]">{t.title}</span>
                      </button>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <PersonAvatar name={t.assignee.name} src={t.assignee.avatarUrl} initials={t.assignee.initials} size={24} />
                        <span className="text-[12.5px] text-[#3d3f74]">{t.assignee.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium" style={{ color: st.color }}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: st.color }} />
                        {st.label}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-[12.5px] text-[#3d3f74]">{formatDue(t.dueAt)}</td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center gap-1.5 text-[12.5px] text-[#6a769c]">
                        <MessageSquare className="h-3.5 w-3.5" />
                        {comments}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center gap-1.5 text-[12.5px] text-[#6a769c]">
                        <Paperclip className="h-3.5 w-3.5" />
                        {files}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-[12.5px] text-[#6a769c]">{relativeUpdated(t.updatedAt)}</td>
                    <td className="py-3 pr-2 text-right">
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
                          <DropdownMenuItem className="text-[12.5px] cursor-pointer" onSelect={() => setSelectedId(item.thingId)}>
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
    <AppShell noPadding>
      <div className="min-h-screen space-y-3 bg-[#edf2fe] px-4 py-3 pb-20">
        {/* Sub-header + tabs card */}
        <div className="rounded-[10px] bg-white">
          <div className="flex flex-wrap items-center justify-between gap-4 px-5 pt-4 pb-3">
            <div className="flex flex-wrap items-center gap-4">
              <Link
                to="/buckets"
                className="inline-flex items-center gap-2 rounded-full text-[12.5px] font-medium text-[#6a769c] transition-colors hover:text-[#000533]"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>Back to Bucket</span>
              </Link>
              <div className="h-8 w-px bg-[#eef0f6]" />
              <div className="flex items-center gap-2.5">
                <span className="flex h-11 w-11 items-center justify-center rounded-[6px] bg-[#fee19c] text-[12px] font-medium text-black">
                  {bucketInitials}
                </span>
                <div className="min-w-0">
                  <div className="max-w-[240px] truncate text-[15px] font-medium leading-tight text-black">
                    {bucket.name}
                  </div>
                  <div className="flex items-center gap-1 text-[12px] text-[#6a769c]">
                    <Lock className="h-3 w-3" />
                    Private Bucket • Only visible to you
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {addReference}
              {settingsMenu}
            </div>
          </div>
          <div className="flex items-center gap-8 border-t border-[#eef0f6] px-5">
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
                  "relative -mb-px border-b-2 py-3 text-[13px] font-medium transition-colors",
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
          {/* Toolbar */}
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
            <label className="relative inline-flex h-10 items-center gap-1.5 rounded-[10px] border border-[#ebecf7] bg-white px-3 text-[12.5px] text-[#3d3f74]">
              <select
                value={sortOption}
                onChange={(e) => setSortOption(e.target.value as "recent" | "title")}
                className="appearance-none bg-transparent pr-5 outline-none"
                aria-label="Sort"
              >
                <option value="recent">Recently updated</option>
                <option value="title">Title</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-[#8487a7]" />
            </label>
            <label className="relative inline-flex h-10 items-center gap-1.5 rounded-[10px] border border-[#ebecf7] bg-white px-3 text-[12.5px] text-[#3d3f74]">
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
          </div>

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
            ) : detailTab === "notes" ? (
              <div className="flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed border-[#e3e5ef] text-center">
                <FileText className="h-8 w-8 text-[#c5cae0]" />
                <p className="mt-2 text-[13px] font-semibold text-[#000533]">No notes yet</p>
                <p className="mt-1 text-[11.5px] text-[#6a769c]">Notes for this bucket will appear here.</p>
              </div>
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
          </InlineThingDetailWorkspace>
        </div>
      </div>

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
