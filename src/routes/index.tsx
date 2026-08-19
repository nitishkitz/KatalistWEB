import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  Filter,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { MagicBox } from "@/features/court/MagicBox";
import { useCourt } from "@/features/court/use-court";
import { ThingRow, ThingTableHeader } from "@/components/katalist/ThingRow";
import type { Thing } from "@/domain/thing";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Court — Katalist" },
      { name: "description", content: "What needs your attention." },
    ],
  }),
  component: CourtPage,
});

type QuickFilter = "all" | "due" | "waiting" | "progress";

function matchesFilter(t: Thing, f: QuickFilter, q: string) {
  if (q && !t.title.toLowerCase().includes(q.toLowerCase())) return false;
  if (f === "due") return Boolean(t.dueAt);
  if (f === "waiting") return t.acknowledgement === "waiting_for_catch";
  if (f === "progress") return t.workStatus === "under_progress";
  return true;
}

function Lane({
  title,
  count,
  things,
  defaultOpen,
  preview,
  meta,
}: {
  title: string;
  count: number;
  things: Thing[];
  defaultOpen: boolean;
  preview: number;
  meta?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? things : things.slice(0, preview);
  const hidden = Math.max(0, things.length - visible.length);

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <span className="text-[13px] font-semibold tracking-wide text-foreground">{title}</span>
        <span className="text-[13px] text-muted-foreground">· {count}</span>
        {open ? meta : null}
        <span className="ml-auto text-[12px] text-muted-foreground">
          {showAll || hidden === 0
            ? title === "LATER"
              ? `View all ${count}`
              : title === "NEXT"
                ? `View all ${count}`
                : "Show 15 more"
            : `Show ${hidden} more`}
        </span>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      {open && things.length > 0 ? (
        <div className="px-1 pb-2">
          <table className="w-full table-fixed">
            <colgroup>
              <col className="w-[26%]" />
              <col className="w-[12%]" />
              <col className="w-[10%]" />
              <col className="w-[10%]" />
              <col className="w-[13%]" />
              <col className="w-[12%]" />
              <col className="w-[10%]" />
              <col className="w-[7%]" />
            </colgroup>
            <ThingTableHeader />
            <tbody>
              {visible.map((t) => (
                <ThingRow key={t.id} thing={t} />
              ))}
            </tbody>
          </table>
          {hidden > 0 && !showAll ? (
            <button
              type="button"
              className="px-4 py-2 text-[12px] text-muted-foreground hover:text-foreground"
              onClick={() => setShowAll(true)}
            >
              Show {hidden} more
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function TheirCard({
  icon,
  label,
  count,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      className="flex items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3 text-left hover:bg-muted/40"
    >
      {icon}
      <span className="flex-1 text-[13px] font-medium">{label}</span>
      <span className="text-[15px] font-semibold">{count}</span>
      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
    </button>
  );
}

function CourtPage() {
  const { now, next, later, theirGroups, isLoading } = useCourt();
  const [filter, setFilter] = useState<QuickFilter>("all");
  const [query, setQuery] = useState("");

  const fNow = useMemo(() => now.filter((t) => matchesFilter(t, filter, query)), [now, filter, query]);
  const fNext = useMemo(() => next.filter((t) => matchesFilter(t, filter, query)), [next, filter, query]);
  const fLater = useMemo(
    () => later.filter((t) => matchesFilter(t, filter, query)),
    [later, filter, query],
  );

  const dueToday = now.filter(
    (t) => t.dueAt && new Date(t.dueAt).toDateString() === new Date().toDateString(),
  ).length;
  const waiting = now.filter((t) => t.acknowledgement === "waiting_for_catch").length;
  const progress = now.filter((t) => t.workStatus === "under_progress").length;
  const empty = now.length + next.length + later.length === 0;

  return (
    <AppShell title="Court" subtitle="What needs your attention">
      <MagicBox />

      <p className="mb-3 flex items-center gap-2 text-[13px] text-muted-foreground">
        <img src="/katalist-mark-app.png" alt="" className="h-4 w-4 opacity-70" />
        {empty && !isLoading
          ? "Your Court is clear. Toss something when you’re ready."
          : "Coey here — your lanes are ready."}
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-lg border border-border bg-card p-0.5">
          {(
            [
              ["all", "All"],
              ["due", "Due"],
              ["waiting", "Waiting"],
              ["progress", "In Progress"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={cn(
                "rounded-md px-3 py-1.5 text-[12.5px] font-medium",
                filter === id ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
          <button type="button" className="px-2 text-muted-foreground" aria-label="More filters">
            ···
          </button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <label className="flex h-8 items-center gap-2 rounded-lg border border-border bg-card px-2.5">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search things"
              className="w-36 bg-transparent text-[12.5px] outline-none"
            />
          </label>
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-[12.5px] text-foreground"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Sort: Due soon
          </button>
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-[12.5px] text-foreground"
          >
            <Filter className="h-3.5 w-3.5" />
            Filter
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <Lane
          title="NOW"
          count={now.length}
          things={fNow}
          defaultOpen
          preview={5}
          meta={
            <span className="hidden items-center gap-3 text-[12px] text-muted-foreground sm:flex">
              <span className="text-status-now">● {dueToday} due today</span>
              <span>● {waiting} waiting</span>
              <span className="text-status-next">● {progress} under progress</span>
            </span>
          }
        />
        <Lane
          title="NEXT"
          count={next.length}
          things={fNext}
          defaultOpen
          preview={3}
          meta={
            <span className="hidden text-[12px] text-muted-foreground sm:inline">
              · {next.filter((t) => t.dueAt).length} due this week ·{" "}
              {next.filter((t) => t.acknowledgement === "waiting_for_catch").length} waiting ·{" "}
              {next.filter((t) => t.workStatus === "under_progress").length} under progress
            </span>
          }
        />
        <Lane title="LATER" count={later.length} things={fLater} defaultOpen={false} preview={0} />

        <section className="rounded-xl border border-border bg-card">
          <div className="flex items-center gap-3 px-4 py-2.5">
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[13px] font-semibold tracking-wide">THEIRS</span>
            <span className="text-[13px] text-muted-foreground">
              ·{" "}
              {theirGroups.waiting_for_catch.length +
                theirGroups.moving.length +
                theirGroups.needs_attention.length}
            </span>
            <span className="ml-auto text-[12px] text-muted-foreground">View all</span>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <div className="grid gap-3 px-4 pb-4 md:grid-cols-3">
            <TheirCard
              icon={<Clock className="h-4 w-4 text-status-waiting" />}
              label="Waiting for Catch"
              count={theirGroups.waiting_for_catch.length}
            />
            <TheirCard
              icon={
                <span className="flex h-4 w-4 items-center justify-center rounded-full border border-status-next text-[9px] text-status-next">
                  ○
                </span>
              }
              label="Moving"
              count={theirGroups.moving.length}
            />
            <TheirCard
              icon={<AlertCircle className="h-4 w-4 text-status-now" />}
              label="Needs Attention"
              count={theirGroups.needs_attention.length}
            />
          </div>
        </section>
      </div>

      <p className="mt-8 flex items-center justify-center gap-2 text-[12px] text-muted-foreground">
        <img src="/katalist-mark-app.png" alt="" className="h-3.5 w-3.5 opacity-60" />
        Movement, not Storage.
      </p>
    </AppShell>
  );
}
