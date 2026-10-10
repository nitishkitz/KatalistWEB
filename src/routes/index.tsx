import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useThing } from "@/features/things/use-thing";
import { isThingId, THING_PERMALINK_PARAM } from "@/features/thing-references/thing-reference";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { CourtSkeleton } from "@/components/katalist/ScreenSkeletons";
import { MagicBox } from "@/features/court/MagicBox";
import { CourtDesktop } from "@/features/court/CourtDesktop";
import { useCourt } from "@/features/court/use-court";
import { ThingRow, ThingTableHeader } from "@/components/katalist/ThingRow";
import { ThingCard } from "@/features/court/ThingCard";
import { InlineThingDetailWorkspace } from "@/features/things/InlineThingDetailWorkspace";
import type { Thing } from "@/domain/thing";
import { cn } from "@/lib/utils";
import { logTelemetryEvent } from "@/lib/telemetry";
import { useCatchup } from "@/features/catchup/use-catchup";
import { useMorningBrief } from "@/features/catchup/use-morning-brief";
import { CatchUpOverlay } from "@/features/catchup/CatchUpOverlay";
import { consumeCatchupOpen, CATCHUP_OPEN_EVENT } from "@/features/catchup/catchup-entry";

const DESKTOP_BREAKPOINT_QUERY = "(min-width: 1024px)";

function matchesDesktopViewport() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(DESKTOP_BREAKPOINT_QUERY).matches
    : false;
}

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Court — Katalist" },
      { name: "description", content: "What needs your attention." },
    ],
  }),
  // `/?thing=<id>` is the canonical Thing permalink; malformed IDs are dropped rather than trusted.
  validateSearch: (search: Record<string, unknown>): { thing?: string } => {
    const id = search[THING_PERMALINK_PARAM];
    return isThingId(id) ? { thing: id } : {};
  },
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
  onSelect,
}: {
  title: string;
  count: number;
  things: Thing[];
  defaultOpen: boolean;
  preview: number;
  meta?: React.ReactNode;
  onSelect?: (thing: Thing) => void;
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
          <div className="space-y-2 p-2 md:hidden">
            {visible.map((t) => (
              <ThingCard key={t.id} thing={t} onSelect={onSelect} />
            ))}
          </div>
          <div className="hidden min-w-0 overflow-x-auto overscroll-x-contain md:block">
            <table className="w-full min-w-[860px] table-fixed">
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
                  <ThingRow key={t.id} thing={t} onSelect={onSelect} />
                ))}
              </tbody>
            </table>
          </div>
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
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
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
  const {
    now,
    next,
    later,
    theirs,
    theirGroups,
    isLoading,
    all,
    error,
    refetch,
    myActorId,
    completedCount,
  } = useCourt();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const navigate = useNavigate();
  const { thing: permalinkId } = Route.useSearch();
  const { thing: permalinkThing, isLoading: permalinkLoading } = useThing(permalinkId ?? null);
  const clearPermalink = useCallback(() => void navigate({ to: "/", search: {}, replace: true }), [navigate]);
  useEffect(() => {
    if (!permalinkId || permalinkLoading) return;
    if (!permalinkThing) {
      toast.error("That Thing was deleted or you no longer have access.");
      clearPermalink();
      return;
    }
    // Mobile uses ID selection; desktop receives the Thing through `permalinkThing` below.
    setSelectedId(permalinkThing.id);
  }, [permalinkId, permalinkLoading, permalinkThing, clearPermalink]);
  const { thing: fetchedSelected } = useThing(selectedId);
  const [filter, setFilter] = useState<QuickFilter>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"due" | "updated" | "importance" | "pace">("due");
  const [theirFocus, setTheirFocus] = useState<
    "waiting_for_catch" | "moving" | "needs_attention" | null
  >(null);
  // T10/mobile-entry: called exactly ONCE here, in the shared ancestor of
  // both the desktop (`CourtDesktop`, always mounted, CSS-hidden below `lg`)
  // and mobile (`lg:hidden` block below) branches, and passed down to both.
  // Two independent `useMorningBrief()` calls (one per branch) would each
  // run their own auto-claim attempt against the SAME daily scope --
  // `use-morning-brief.ts`'s attempt-token system only dedupes re-attempts
  // WITHIN one hook instance, not across two simultaneous instances, so two
  // calls really would race/duplicate-claim. Lifting to one call here keeps
  // "exactly one automatic controller" true regardless of viewport.
  const catchup = useCatchup();
  const morningBrief = useMorningBrief();
  // The desktop and compact Court trees remain mounted together for instant
  // breakpoint changes, but each tree owns a portalled dialog. Gate their
  // dialog `open` props to the active viewport so one manual Review action
  // never mounts two competing Radix dialogs/focus scopes.
  const [isDesktopViewport, setIsDesktopViewport] = useState(matchesDesktopViewport);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(DESKTOP_BREAKPOINT_QUERY);
    const update = () => setIsDesktopViewport(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const desktopMorningBrief = useMemo(
    () => ({ ...morningBrief, open: morningBrief.open && isDesktopViewport }),
    [morningBrief, isDesktopViewport],
  );
  const reopenMorningBrief = morningBrief.reopen;
  useEffect(() => {
    const openCatchup = () => {
      consumeCatchupOpen();
      reopenMorningBrief();
    };
    window.addEventListener(CATCHUP_OPEN_EVENT, openCatchup);
    if (consumeCatchupOpen()) window.setTimeout(openCatchup, 0);
    return () => window.removeEventListener(CATCHUP_OPEN_EVENT, openCatchup);
  }, [reopenMorningBrief]);
  // T10/mobile-entry: a Catch Up moment's Thing is not guaranteed to be one
  // of Court's own currently-loaded now/next/later/theirs/all Things (e.g.
  // a ghost breakthrough deliberately surfaces a Thing from the OTHER
  // context by design -- see use-catchup.ts) -- CourtDesktop's own
  // `openCatchUpThing` sidesteps this entirely by threading the moment's
  // actual Thing object straight into its detail modal instead of looking
  // it up by id. This mobile branch's selection model is ID-based instead
  // (matching the existing MagicBox-created-Thing flow below), so the
  // currently-open moments' own Things are added as a fallback lookup pool
  // -- without this, opening a Thing from the mobile Morning Brief overlay
  // that isn't already part of Court's own lists would silently show
  // nothing at all.
  const selected =
    all.find((t) => t.id === selectedId) ??
    now.concat(next, later, theirs).find((t) => t.id === selectedId) ??
    catchup.moments.map((m) => m.thing).find((t) => t.id === selectedId) ??
    (fetchedSelected?.id === selectedId ? fetchedSelected : null);

  const sortThings = useCallback(
    (list: Thing[]) => {
      return [...list].sort((a, b) => {
        if (sort === "due")
          return (
            (a.dueAt ? new Date(a.dueAt).getTime() : Infinity) -
            (b.dueAt ? new Date(b.dueAt).getTime() : Infinity)
          );
        if (sort === "updated")
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        if (sort === "importance")
          return Number(a.ownerImportance === "now") > Number(b.ownerImportance === "now")
            ? -1
            : a.ownerImportance.localeCompare(b.ownerImportance);
        return (a.personalPace ?? "next").localeCompare(b.personalPace ?? "next");
      });
    },
    [sort],
  );

  const fNow = useMemo(
    () => sortThings(now.filter((t) => matchesFilter(t, filter, query))),
    [now, filter, query, sortThings],
  );
  const fNext = useMemo(
    () => sortThings(next.filter((t) => matchesFilter(t, filter, query))),
    [next, filter, query, sortThings],
  );
  const fLater = useMemo(
    () => sortThings(later.filter((t) => matchesFilter(t, filter, query))),
    [later, filter, query, sortThings],
  );

  const dueToday = now.filter(
    (t) => t.dueAt && new Date(t.dueAt).toDateString() === new Date().toDateString(),
  ).length;
  const waiting = now.filter((t) => t.acknowledgement === "waiting_for_catch").length;
  const progress = now.filter((t) => t.workStatus === "under_progress").length;
  const emptyCourt = now.length + next.length + later.length + theirs.length === 0;
  const emptyFilter = !emptyCourt && fNow.length + fNext.length + fLater.length === 0;

  // Mobile equivalent of CourtDesktop's `openCatchUpThing`: dismiss the
  // brief as a real dismissal (same as Escape/X/backdrop) and open the
  // Thing via the mobile inline detail workspace's own selection state --
  // there is no hero-flight animation or separate detail modal on this
  // branch, `selected`/`InlineThingDetailWorkspace` already does this.
  const openCatchUpThingMobile = useCallback(
    (thing: Thing) => {
      morningBrief.dismiss();
      logTelemetryEvent({ category: "brief_action", outcome: "success", scope: "morning-brief" });
      setSelectedId(thing.id);
    },
    [morningBrief],
  );

  if (isLoading) {
    return (
      <AppShell noPadding>
        <div className="px-5 py-5">
          <CourtSkeleton />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell noPadding>
      <CourtDesktop
        now={now}
        next={next}
        later={later}
        theirs={theirs}
        completedCount={completedCount}
        isLoading={isLoading}
        error={error}
        refetch={refetch}
        myActorId={myActorId}
        onSelect={(thing) => setSelectedId(thing.id)}
        catchup={catchup}
        morningBrief={desktopMorningBrief}
        permalinkThing={isDesktopViewport ? permalinkThing : null}
        onPermalinkHandled={clearPermalink}
      />

      <div className="lg:hidden">
        {error ? (
          // Court's query settled into an error, not an empty result — the
          // mobile branch had no error handling of its own, so this used to
          // fall straight through to "Your Court is clear", a false
          // successful-empty state for what was actually a failed load.
          <div className="px-4 py-10 text-center">
            <p className="text-sm font-semibold">The Court could not be loaded.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Your Things are unchanged. Try loading the Court again.
            </p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="mt-4 h-10 rounded-lg border border-primary px-4 text-xs font-semibold text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Retry
            </button>
          </div>
        ) : (
        <InlineThingDetailWorkspace
          thing={selected}
          onClose={() => setSelectedId(null)}
          className="px-4 py-4 pb-12"
        >
          <div>
            {/* T09/E05: mobile selection is already just an ID lookup
                (`selected` above resolves it against the current lists),
                so unlike CourtDesktop's hero-flight-animated open, this
                needs no Thing-object lookup at all -- setSelectedId
                tolerates the id not being in cache yet and simply shows
                nothing until the invalidation MagicBox already triggers
                finishes refetching. */}
            <MagicBox onThingCreated={(thingId) => setSelectedId(thingId)} />

            <p className="mb-3 flex items-center gap-2 text-[13px] text-muted-foreground">
              <img src="/katalist-mark-app.png" alt="" className="h-4 w-4 opacity-70" />
              {emptyCourt && !isLoading
                ? "Your Court is clear. Toss something when you’re ready."
                : emptyFilter
                  ? "No Things match this filter."
                  : "Coey here — your lanes are ready."}
            </p>

            <div className="mb-4 flex flex-wrap items-center gap-2">
              <div className="flex items-center rounded-lg border border-border bg-card p-0.5" role="group" aria-label="Filter Court">
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
                    aria-pressed={filter === id}
                    className={cn(
                      "min-h-8 rounded-md px-3 py-1.5 text-[12.5px] font-medium",
                      filter === id
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="ml-auto flex items-center gap-2">
                <label className="flex h-8 items-center gap-2 rounded-lg border border-border bg-card px-2.5">
                  <Search className="h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search things"
                    className="h-8 w-36 bg-transparent text-[12.5px] outline-none"
                  />
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setSort((s) =>
                      s === "due"
                        ? "updated"
                        : s === "updated"
                          ? "importance"
                          : s === "importance"
                            ? "pace"
                            : "due",
                    )
                  }
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-[12.5px] text-foreground"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  Sort:{" "}
                  {sort === "due"
                    ? "Due soon"
                    : sort === "updated"
                      ? "Recently updated"
                      : sort === "importance"
                        ? "Importance"
                        : "Pace"}
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
                onSelect={(t) => setSelectedId(t.id)}
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
                onSelect={(t) => setSelectedId(t.id)}
              />
              <Lane
                title="LATER"
                count={later.length}
                things={fLater}
                defaultOpen={false}
                preview={0}
                onSelect={(t) => setSelectedId(t.id)}
              />

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
                    onClick={() => setTheirFocus("waiting_for_catch")}
                  />
                  <TheirCard
                    icon={
                      <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full border border-status-next text-[12px] text-status-next">
                        ○
                      </span>
                    }
                    label="Moving"
                    count={theirGroups.moving.length}
                    onClick={() => setTheirFocus("moving")}
                  />
                  <TheirCard
                    icon={<AlertCircle className="h-4 w-4 text-status-now" />}
                    label="Needs Attention"
                    count={theirGroups.needs_attention.length}
                    onClick={() => setTheirFocus("needs_attention")}
                  />
                </div>
                {theirFocus ? (
                  <div className="min-w-0 overflow-x-auto overscroll-x-contain px-4 pb-4">
                    <table className="w-full min-w-[860px] table-fixed">
                      <ThingTableHeader />
                      <tbody>
                        {theirGroups[theirFocus].map((t) => (
                          <ThingRow key={t.id} thing={t} onSelect={(t) => setSelectedId(t.id)} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </section>
            </div>

            <p className="mt-8 flex items-center justify-center gap-2 text-[12px] text-muted-foreground">
              <img src="/katalist-mark-app.png" alt="" className="h-3.5 w-3.5 opacity-60" />
              Movement, not Storage.
            </p>
          </div>
        </InlineThingDetailWorkspace>
        )}

        <CatchUpOverlay
          open={morningBrief.open && !isDesktopViewport}
          onClose={morningBrief.dismiss}
          moments={catchup.moments}
          myActorId={myActorId}
          surfaceMoment={catchup.surfaceMoment}
          onOpenThing={openCatchUpThingMobile}
          isLoading={catchup.isLoading}
          error={catchup.error}
          isEmpty={catchup.isEmpty}
          hasFetchedOnce={catchup.hasFetchedOnce}
          onRefresh={() => {
            refetch();
            catchup.refresh();
          }}
        />
      </div>
    </AppShell>
  );
}
