import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { format, formatDistanceToNowStrict } from "date-fns";
import {
  ChevronDown,
  ArrowUpRight,
  FileText,
  List as ListIcon,
  MoreVertical,
  Plus,
  Search,
} from "lucide-react";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Thing } from "@/domain/thing";
import type { ListRow } from "@/features/lists/fixtures";
import { useListThings } from "@/features/lists/use-list-things";
import { cn } from "@/lib/utils";
import type { BucketItem } from "./fetch-bucket-items";

type StatusKey = "todo" | "waiting" | "progress" | "done" | "cancelled";

const STATUS_STYLE: Record<StatusKey, { label: string; bg: string; text: string; dot: string }> = {
  todo: { label: "Todo", bg: "#eff1f8", text: "#596382", dot: "#8b92b3" },
  waiting: { label: "Waiting", bg: "#fff3dc", text: "#996000", dot: "#ff9600" },
  progress: { label: "In progress", bg: "#e5eeff", text: "#1264cc", dot: "#007bff" },
  done: { label: "Done", bg: "#e0fbee", text: "#087d51", dot: "#04bd74" },
  cancelled: { label: "Cancelled", bg: "#ffe5ea", text: "#c72746", dot: "#ff304e" },
};

const STATUS_FILTERS: { id: StatusKey | "all"; label: string }[] = [
  { id: "all", label: "All status" },
  { id: "todo", label: "Todo" },
  { id: "waiting", label: "Waiting" },
  { id: "progress", label: "In progress" },
  { id: "done", label: "Done" },
  { id: "cancelled", label: "Cancelled" },
];

function thingStatus(t: Thing): StatusKey {
  if (t.workStatus === "cancelled") return "cancelled";
  if (t.workStatus === "sorted") return "done";
  if (t.workStatus === "under_progress") return "progress";
  if (t.acknowledgement === "waiting_for_catch") return "waiting";
  return "todo";
}

function listStatus(l: ListRow): StatusKey {
  if (l.thingCount > 0 && l.doneCount >= l.thingCount) return "done";
  if (l.inProgressCount > 0) return "progress";
  return "todo";
}

function formatDue(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : format(d, "MMM d, yyyy");
}

function relative(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${formatDistanceToNowStrict(d)} ago`;
}

const GRID = "buckets-table-grid";

type Assignee = { id: string; name: string; initials: string; avatarUrl?: string | null };

type Entry =
  | { kind: "thing"; key: string; thing: Thing; sortAt: number }
  | { kind: "list"; key: string; list: ListRow; things: Thing[]; sortAt: number };

/**
 * Lists in the bucket become group rows; Things that belong to one of those
 * lists are nested under it instead of repeating at the top level.
 */
export function buildBucketEntries(items: BucketItem[]): Entry[] {
  const lists: ListRow[] = [];
  const things: Thing[] = [];
  for (const item of items) {
    if (item.availability !== "available") continue;
    if (item.kind === "list") lists.push(item.list);
    else things.push(item.thing);
  }
  const listIds = new Set(lists.map((l) => l.id));
  const grouped = new Map<string, Thing[]>();
  const loose: Thing[] = [];
  for (const t of things) {
    if (t.listId && listIds.has(t.listId))
      grouped.set(t.listId, [...(grouped.get(t.listId) ?? []), t]);
    else loose.push(t);
  }
  const time = (iso?: string | null) => {
    const n = iso ? new Date(iso).getTime() : 0;
    return Number.isNaN(n) ? 0 : n;
  };
  const entries: Entry[] = [
    ...lists.map<Entry>((list) => ({
      kind: "list",
      key: `list:${list.id}`,
      list,
      things: grouped.get(list.id) ?? [],
      sortAt: time(list.updatedAtIso),
    })),
    ...loose.map<Entry>((thing) => ({
      kind: "thing",
      key: `thing:${thing.id}`,
      thing,
      sortAt: time(thing.updatedAt),
    })),
  ];
  return entries.sort((a, b) => b.sortAt - a.sortAt);
}

function StatusBadge({ status }: { status: StatusKey }) {
  const s = STATUS_STYLE[status];
  return (
    <span className="buckets-status" style={{ background: s.bg, color: s.text }}>
      <span className="h-[7px] w-[7px] rounded-full" style={{ background: s.dot }} />
      {s.label}
    </span>
  );
}

function AssigneeCell({ person }: { person: Assignee | null }) {
  if (!person) return <span className="text-[13px] text-[#647093]">—</span>;
  return (
    <div className="flex min-w-0 items-center gap-[10px]">
      <PersonAvatar
        name={person.name}
        src={person.avatarUrl}
        initials={person.initials}
        size={26}
      />
      <span className="truncate text-[13px] text-[#647093]">{person.name}</span>
    </div>
  );
}

function ThingRow({
  thing,
  nested,
  onOpen,
  onRemove,
  last,
}: {
  thing: Thing;
  nested?: boolean;
  onOpen: (t: Thing) => void;
  onRemove?: (t: Thing) => void;
  last?: boolean;
}) {
  const status = thingStatus(thing);
  const overdue =
    thing.dueAt &&
    status !== "done" &&
    status !== "cancelled" &&
    new Date(thing.dueAt).getTime() < Date.now();
  return (
    <div
      data-testid="bucket-thing-row"
      className={cn(GRID, "buckets-thing-row", !last && "border-b border-[#eceef5]")}
      onClick={() => onOpen(thing)}
    >
      <div className={cn("flex min-w-0 items-center gap-[16px]", nested && "pl-[31px]")}>
        <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center text-[#7a81ab]">
          <FileText className="h-[18px] w-[18px]" strokeWidth={1.6} />
        </span>
        <button
          type="button"
          className="buckets-thing-title"
          title={thing.title}
          onClick={(e) => {
            e.stopPropagation();
            onOpen(thing);
          }}
        >
          {thing.title}
        </button>
      </div>
      <AssigneeCell person={thing.assignee} />
      <div>
        <StatusBadge status={status} />
      </div>
      <span
        className="text-[13px]"
        style={{ color: status === "done" ? "#087d51" : overdue ? "#c72746" : "#647093" }}
      >
        {formatDue(thing.dueAt)}
      </span>
      <span className="text-[13px] text-[#647093]">{relative(thing.updatedAt)}</span>
      <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Actions for ${thing.title}`}
              className="buckets-row-menu"
            >
              <MoreVertical className="h-[15px] w-[15px]" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-white">
            <DropdownMenuItem className="text-[12.5px]" onSelect={() => onOpen(thing)}>
              Open thing
            </DropdownMenuItem>
            {onRemove ? (
              <DropdownMenuItem className="text-[12.5px]" onSelect={() => onRemove(thing)}>
                Remove from bucket
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function ListGroup({
  list,
  bucketThings,
  expanded,
  onToggle,
  onOpenThing,
  onRemoveThing,
  onRemoveList,
  matches,
  last,
}: {
  list: ListRow;
  bucketThings: Thing[];
  expanded: boolean;
  onToggle: () => void;
  onOpenThing: (t: Thing) => void;
  onRemoveThing?: (t: Thing) => void;
  onRemoveList?: (l: ListRow) => void;
  matches: (t: Thing) => boolean;
  last?: boolean;
}) {
  // Every Thing in the List is shown when expanded, not just the ones saved
  // into the bucket individually.
  const { things: listThings, isLoading } = useListThings(expanded ? list.id : undefined);
  const children = useMemo(() => {
    const byId = new Map<string, Thing>();
    for (const t of listThings ?? []) byId.set(t.id, t);
    for (const t of bucketThings) byId.set(t.id, t);
    return [...byId.values()].filter(matches);
  }, [listThings, bucketThings, matches]);

  const status = listStatus(list);
  const owner = list.members[0] ?? null;
  const count = Math.max(list.thingCount, bucketThings.length);

  return (
    <div className={cn(!last && !expanded && "border-b-[0.72px] border-[#e7ecf7]")}>
      <div
        data-testid="bucket-list-row"
        data-expanded={expanded}
        className={cn(GRID, "buckets-list-row")}
      >
        <button
          type="button"
          className="buckets-list-toggle"
          aria-expanded={expanded}
          onClick={onToggle}
        >
          <span className="flex h-[36px] w-[22px] shrink-0 items-center justify-center rounded-[5.76px] bg-[#eae0ff] text-[#793aff]">
            <ListIcon className="h-[18px] w-[18px]" strokeWidth={1.8} />
          </span>
          <ChevronDown
            className={cn("buckets-list-chevron", !expanded && "-rotate-90")}
            aria-hidden="true"
          />
          <span className="flex min-w-0 flex-col gap-1 text-[13px] leading-normal">
            <span className="truncate font-medium text-[#100d36]">{list.name}</span>
            <span className="text-[#647093]">
              List • {count} {count === 1 ? "thing" : "things"}
            </span>
          </span>
        </button>
        <AssigneeCell person={owner ? { id: owner.actorId ?? owner.name, ...owner } : null} />
        <div>
          <StatusBadge status={status} />
        </div>
        <span className="text-[13px] text-[#647093]">—</span>
        <span className="text-[13px] text-[#647093]">{relative(list.updatedAtIso)}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="buckets-row-menu"
              aria-label={`Actions for list ${list.name}`}
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-white">
            <DropdownMenuItem asChild>
              <Link to="/lists/$listId" params={{ listId: list.id }}>
                Open list
              </Link>
            </DropdownMenuItem>
            {onRemoveList ? (
              <DropdownMenuItem onSelect={() => onRemoveList(list)}>
                Remove list from bucket
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {expanded ? (
        <div className="relative mb-[2px] before:absolute before:bottom-[6px] before:left-[24px] before:top-0 before:w-[1.5px] before:bg-[#e4dbff] before:content-['']">
          {isLoading && children.length === 0 ? (
            <p className="px-[13px] py-[10px] pl-[55px] text-[12px] text-[#647093]">
              Loading things…
            </p>
          ) : children.length === 0 ? (
            <p className="px-[13px] py-[10px] pl-[55px] text-[12px] text-[#647093]">
              No things in this list match.
            </p>
          ) : (
            children.map((t, i) => (
              <ThingRow
                key={t.id}
                thing={t}
                nested
                last={i === children.length - 1}
                onOpen={onOpenThing}
                onRemove={bucketThings.some((b) => b.id === t.id) ? onRemoveThing : undefined}
              />
            ))
          )}
          <div className="flex items-center gap-4 px-[13px] py-[8px] pl-[55px] text-[12px]">
            <Link
              to="/lists/$listId"
              params={{ listId: list.id }}
              className="inline-flex items-center gap-1 font-medium text-[#6c2aee] hover:underline"
            >
              Open list <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type Props = {
  bucketId: string;
  items: BucketItem[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  onOpenThing: (t: Thing) => void;
  onRemoveThing?: (t: Thing) => void;
  onRemoveList?: (l: ListRow) => void;
  /** Opens the Thing/List picker for this Bucket (no separate workspace). */
  onAdd: () => void;
  /** The selected Bucket, shown as a capsule that follows the selection. */
  bucketName: string;
};

export function BucketThingsTable({
  items,
  isLoading,
  error,
  onRetry,
  onOpenThing,
  onRemoveThing,
  onRemoveList,
  onAdd,
}: Props) {
  const [query, setQuery] = useState("");
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusKey | "all">("all");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const entries = useMemo(() => buildBucketEntries(items), [items]);

  const people = useMemo(() => {
    const map = new Map<string, Assignee>();
    const add = (p: Assignee | null | undefined) => {
      if (!p || !p.name || p.name.toLowerCase() === "someone") return;
      const key = p.name.trim().toLowerCase();
      if (!map.has(key))
        map.set(key, {
          id: key,
          name: p.name.trim(),
          initials: p.initials,
          avatarUrl: p.avatarUrl,
        });
    };
    for (const e of entries) {
      if (e.kind === "thing") add(e.thing.assignee);
      else {
        add(e.list.members[0] ? { id: "", ...e.list.members[0] } : null);
        for (const t of e.things) add(t.assignee);
      }
    }
    return [...map.values()];
  }, [entries]);

  const q = query.trim().toLowerCase();
  const matchesThing = useMemo(
    () => (t: Thing) => {
      if (q && !t.title.toLowerCase().includes(q) && !t.assignee.name.toLowerCase().includes(q))
        return false;
      if (assigneeId && t.assignee.name.trim().toLowerCase() !== assigneeId) return false;
      if (statusFilter !== "all" && thingStatus(t) !== statusFilter) return false;
      return true;
    },
    [q, assigneeId, statusFilter],
  );

  const visible = entries.filter((e) => {
    if (e.kind === "thing") return matchesThing(e.thing);
    const listText = e.list.name.toLowerCase();
    const listOwner = (e.list.members[0]?.name ?? "").trim().toLowerCase();
    const listMatch =
      (!q || listText.includes(q) || listOwner.includes(q)) &&
      (!assigneeId || listOwner === assigneeId) &&
      (statusFilter === "all" || listStatus(e.list) === statusFilter);
    // A list also stays visible when any of its bucketed Things match.
    return listMatch || e.things.some(matchesThing);
  });

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const activePerson = people.find((p) => p.id === assigneeId) ?? null;
  const filtering = Boolean(q || assigneeId || statusFilter !== "all");

  return (
    <section aria-label="Things in this bucket" className="buckets-table">
      <div className="buckets-toolbar">
        <label className="buckets-search">
          <Search className="h-[17px] w-[17px] shrink-0 text-[#647093]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Things and Lists"
            aria-label="Search things in bucket"
            className="w-full bg-transparent text-[12.96px] text-[#100d36] outline-none placeholder:text-[#647093]"
          />
        </label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Filter by assignee" className="buckets-filter">
              {activePerson ? (
                <PersonAvatar
                  name={activePerson.name}
                  src={activePerson.avatarUrl}
                  initials={activePerson.initials}
                  size={25}
                />
              ) : (
                <span className="flex items-center -space-x-2">
                  {people.slice(0, 3).map((p) => (
                    <PersonAvatar
                      key={p.id}
                      name={p.name}
                      src={p.avatarUrl}
                      initials={p.initials}
                      size={25}
                      className="ring-2 ring-white"
                    />
                  ))}
                </span>
              )}
              {activePerson ? activePerson.name : "Everyone"}
              <ChevronDown className="h-[14px] w-[14px] text-[#7a81ab]" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto bg-white">
            <DropdownMenuItem className="text-[12.5px]" onSelect={() => setAssigneeId(null)}>
              Everyone
            </DropdownMenuItem>
            {people.map((p) => (
              <DropdownMenuItem
                key={p.id}
                className="gap-2 text-[12.5px]"
                onSelect={() => setAssigneeId(p.id)}
              >
                <PersonAvatar name={p.name} src={p.avatarUrl} initials={p.initials} size={20} />
                {p.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Filter by status"
              className="buckets-filter buckets-status-filter"
            >
              {STATUS_FILTERS.find((s) => s.id === statusFilter)?.label}
              <ChevronDown className="h-[14px] w-[14px] text-[#7a81ab]" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-white">
            {STATUS_FILTERS.map((s) => (
              <DropdownMenuItem
                key={s.id}
                className="text-[12.5px]"
                onSelect={() => setStatusFilter(s.id)}
              >
                {s.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <button type="button" onClick={onAdd} className="buckets-add">
          <Plus className="h-[19px] w-[19px]" strokeWidth={1.6} />
          Add reference
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="More actions" className="buckets-more">
              <MoreVertical className="h-[19px] w-[19px]" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-white">
            <DropdownMenuItem
              disabled={!filtering}
              className="text-[12.5px]"
              onSelect={() => {
                setQuery("");
                setAssigneeId(null);
                setStatusFilter("all");
              }}
            >
              Clear filters
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="buckets-table-scroll">
        <div className="buckets-table-body">
          <div className={cn(GRID, "buckets-table-head")}>
            <span>Thing</span>
            <span>Assignee</span>
            <span>Status</span>
            <span>Due</span>
            <span>Updated</span>
            <span />
          </div>

          {isLoading ? (
            <div className="space-y-2 py-2" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-[38px] animate-pulse rounded-[8px] bg-[#f3f4fa]" />
              ))}
            </div>
          ) : error ? (
            <div role="alert" className="py-10 text-center text-[13px] text-[#6a769c]">
              <p>Things in this bucket could not be loaded.</p>
              <button
                type="button"
                onClick={onRetry}
                className="mt-3 rounded-lg border border-[#e7ecf7] px-3 py-2 text-[12px] font-semibold text-[#793aff]"
              >
                Retry
              </button>
            </div>
          ) : entries.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-[14px] font-bold text-[#100d36]">This bucket is empty.</p>
              <p className="mt-1 text-[12.5px] text-[#647093]">
                Add a Thing or List you already have access to.
              </p>
            </div>
          ) : visible.length === 0 ? (
            <div className="py-10 text-center text-[12.5px] text-[#647093]">
              <p>No things match the current filters.</p>
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setAssigneeId(null);
                  setStatusFilter("all");
                }}
                className="mt-3 rounded-lg border border-[#e7ecf7] px-3 py-2 font-semibold text-[#793aff]"
              >
                Clear filters
              </button>
            </div>
          ) : (
            visible.map((e, i) =>
              e.kind === "list" ? (
                <ListGroup
                  key={e.key}
                  list={e.list}
                  bucketThings={e.things}
                  expanded={expanded.has(e.key)}
                  onToggle={() => toggle(e.key)}
                  onOpenThing={onOpenThing}
                  onRemoveThing={onRemoveThing}
                  onRemoveList={onRemoveList}
                  matches={matchesThing}
                  last={i === visible.length - 1}
                />
              ) : (
                <ThingRow
                  key={e.key}
                  thing={e.thing}
                  onOpen={onOpenThing}
                  onRemove={onRemoveThing}
                  last={i === visible.length - 1}
                />
              ),
            )
          )}
        </div>
      </div>
    </section>
  );
}
