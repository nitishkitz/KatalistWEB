import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftRight,
  CalendarCheck,
  ChevronRight,
  Clock,
  FileText,
  FolderPlus,
  GripVertical,
  RotateCw,
  Sparkles,
  Zap,
} from "lucide-react";
import type { Thing } from "@/domain/thing";
import { theirStateFor } from "@/domain/thing";
import { cn } from "@/lib/utils";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { matchProfile, useProfileDirectory } from "@/features/people/directory";
import { MagicBox } from "./MagicBox";
import { InlineThingDetailWorkspace } from "@/features/things/InlineThingDetailWorkspace";
import { ThingDetailContent } from "@/features/things/ThingDetailContent";
import type { CourtLaneStackHandle } from "./CourtLaneStack";
import { CourtWorkspace } from "./CourtWorkspace";
import { CourtBucketsSidePanel } from "./CourtBucketsSidePanel";
import type { CourtFocusSelection } from "./court-stack-model";
import { KatalistIcon } from "./KatalistIcon";
import {
  DEFAULT_COURT_FILTERS,
  applyCourtView,
  toggleTheirsFocus,
  type CourtAcknowledgementFilter,
  type CourtDueFilter,
  type CourtFilterState,
  type CourtLaneId,
  type CourtQuickFilter,
  type CourtSort,
  type CourtWorkStatusFilter,
  type TheirsFocus,
} from "./court-view-model";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type CourtDesktopProps = {
  now: Thing[];
  next: Thing[];
  later: Thing[];
  theirs: Thing[];
  completedCount?: number;
  isLoading: boolean;
  error: Error | null;
  refetch: () => unknown;
  myActorId: string | null;
  onSelect: (thing: Thing) => void;
};

const quickFilters: Array<[CourtQuickFilter, string]> = [
  ["all", "All"],
  ["due", "Due"],
  ["waiting", "Waiting"],
  ["progress", "In Progress"],
];

const sortLabels: Record<CourtSort, string> = {
  due: "Due soon",
  updated: "Recently updated",
  importance: "Owner importance",
  pace: "My pace",
};

function FilterRadioSection<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<[T, string]>;
  onChange: (value: T) => void;
}) {
  return (
    <>
      <DropdownMenuLabel className="px-2 pb-1 pt-2 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </DropdownMenuLabel>
      <DropdownMenuRadioGroup value={value} onValueChange={(next) => onChange(next as T)}>
        {options.map(([id, optionLabel]) => (
          <DropdownMenuRadioItem
            key={id}
            value={id}
            className="text-[12px] focus:ring-2 focus:ring-inset focus:ring-ring"
          >
            {optionLabel}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </>
  );
}

function TheirSummaryCard({
  active,
  icon,
  label,
  description,
  count,
  tone,
  onClick,
}: {
  active: boolean;
  icon: "waiting" | "moving" | "needs_attention";
  label: string;
  description: string;
  count: number;
  tone: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex min-h-[50px] items-center gap-2.5 rounded-xl border bg-white px-3 py-2 text-left shadow-2xs outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-primary ring-1 ring-primary/40 bg-primary/[0.02]"
          : "border-border/70 hover:border-primary/45 hover:shadow-xs",
      )}
    >
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
          tone,
        )}
      >
        {icon === "waiting" ? (
          <Clock className="h-4 w-4" />
        ) : icon === "moving" ? (
          <RotateCw className="h-4 w-4" />
        ) : (
          <Sparkles className="h-4 w-4" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[11.5px] font-bold text-foreground">{label}</span>
          <span className="text-[11.5px] font-bold text-foreground ml-1">{count}</span>
        </div>
        <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
          {description}
        </span>
      </div>
      <ChevronRight
        className={cn(
          "h-3.5 w-3.5 text-muted-foreground/60 transition-transform",
          active && "rotate-90 text-primary",
        )}
      />
    </button>
  );
}

export function CourtDesktop({
  now,
  next,
  later,
  isLoading,
  theirs,
  completedCount,
  error,
  refetch,
  myActorId,
  onSelect,
}: CourtDesktopProps) {
  const [filters, setFilters] = useState<CourtFilterState>(DEFAULT_COURT_FILTERS);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<CourtSort>("due");
  const [focusSelection, setFocusSelection] = useState<CourtFocusSelection | null>(null);
  const [theirFocus, setTheirFocus] = useState<TheirsFocus | null>(null);
  const [theirSelectedId, setTheirSelectedId] = useState<string | null>(null);
  const [heroRect, setHeroRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const directory = useProfileDirectory();
  const laneRefs = useRef<Partial<Record<CourtLaneId, CourtLaneStackHandle | null>>>({});
  const originRef = useRef<{
    lane: CourtLaneId;
    thingId: string;
    element: HTMLElement;
    restoreFocus: boolean;
  } | null>(null);
  const savedPositionsRef = useRef<
    Partial<Record<CourtLaneId, { activeIndex: number; activeThingId: string | null }>>
  >({});
  const focusIndexRef = useRef(0);

  const view = useMemo(
    () => applyCourtView({ now, next, later, theirs }, filters, query, sort),
    [now, next, later, theirs, filters, query, sort],
  );

  const collaborators = useMemo(() => {
    const allThings = [...now, ...next, ...later, ...theirs];
    const map = new Map<string, Thing["assignee"]>();
    for (const t of allThings) {
      if (t.assignee && t.assignee.id && !map.has(t.assignee.id)) {
        map.set(t.assignee.id, t.assignee);
      }
      if (t.owner && t.owner.id && !map.has(t.owner.id)) {
        map.set(t.owner.id, t.owner);
      }
      if (t.creator && t.creator.id && !map.has(t.creator.id)) {
        map.set(t.creator.id, t.creator);
      }
    }
    const all = Array.from(map.values());
    const named = all.filter((p) => p.name && p.name.toLowerCase() !== "someone");
    return named.length > 0 ? named : all;
  }, [now, next, later, theirs]);

  const theirGroups = useMemo(
    () => ({
      waiting_for_catch: view.theirs.filter(
        (thing) => theirStateFor(thing) === "waiting_for_catch",
      ),
      moving: view.theirs.filter((thing) => theirStateFor(thing) === "moving"),
      needs_attention: view.theirs.filter((thing) => theirStateFor(thing) === "needs_attention"),
    }),
    [view.theirs],
  );
  const theirSelectedThing = view.theirs.find((thing) => thing.id === theirSelectedId) ?? null;

  const closeFocus = useCallback(() => {
    setHeroRect(null);
    const origin = originRef.current;
    setFocusSelection(null);
    if (!origin?.restoreFocus) return;

    window.requestAnimationFrame(() => {
      laneRefs.current[origin.lane]?.focusThing(origin.thingId);
      window.requestAnimationFrame(() => {
        if (origin.element.isConnected) {
          origin.element.focus();
          return;
        }
        laneRefs.current[origin.lane]?.focusThing(origin.thingId);
      });
    });
  }, []);

  const handleViewAll = useCallback(
    (lane: CourtLaneId) => {
      setHeroRect(null);
      const laneThings = view[lane];
      const activePosition = savedPositionsRef.current[lane];
      const activeId = activePosition?.activeThingId ?? laneThings[0]?.id;
      if (activeId) {
        setFocusSelection({ lane, thingId: activeId });
      }
    },
    [view],
  );

  const selectedLaneThings = focusSelection ? view[focusSelection.lane] : null;

  useEffect(() => {
    if (!focusSelection || !selectedLaneThings) return;
    const identityIndex = selectedLaneThings.findIndex(
      (thing) => thing.id === focusSelection.thingId,
    );
    if (identityIndex >= 0) {
      focusIndexRef.current = identityIndex;
      return;
    }
    if (selectedLaneThings.length === 0) {
      closeFocus();
      return;
    }

    const nextIndex = Math.max(0, Math.min(focusIndexRef.current, selectedLaneThings.length - 1));
    focusIndexRef.current = nextIndex;
    const nextThingId = selectedLaneThings[nextIndex].id;
    setFocusSelection((current) =>
      current && current.lane === focusSelection.lane
        ? { lane: current.lane, thingId: nextThingId }
        : current,
    );
  }, [closeFocus, focusSelection, selectedLaneThings]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || !focusSelection) return;
      closeFocus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeFocus, focusSelection]);

  const detailedFilterCount =
    Number(filters.due !== "any") +
    Number(filters.acknowledgement !== "any") +
    Number(filters.workStatus !== "any") +
    Number(filters.starredOnly);

  const setDetailedFilter = <K extends keyof CourtFilterState>(
    key: K,
    value: CourtFilterState[K],
  ) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const handleOpen = (lane: CourtLaneId, thing: Thing, element: HTMLElement) => {
    const savedPositions: Partial<
      Record<CourtLaneId, { activeIndex: number; activeThingId: string | null }>
    > = {};
    for (const laneId of ["now", "next", "later"] as const) {
      const position = laneRefs.current[laneId]?.getPosition();
      if (position) savedPositions[laneId] = position;
    }
    savedPositionsRef.current = savedPositions;
    originRef.current = {
      lane,
      thingId: thing.id,
      element,
      restoreFocus: element.matches(":focus-visible"),
    };
    focusIndexRef.current = view[lane].findIndex((candidate) => candidate.id === thing.id);
    const cardEl = element?.closest ? (element.closest("article") ?? element) : element;
    if (cardEl?.getBoundingClientRect) {
      const rect = cardEl.getBoundingClientRect();
      setHeroRect({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      });
    } else {
      setHeroRect(null);
    }
    setFocusSelection({ lane, thingId: thing.id });
  };

  const [showBucketsPanel, setShowBucketsPanel] = useState(false);

  useEffect(() => {
    const handleDragStart = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("application/katalist-thing") || e.dataTransfer?.types.includes("text/plain")) {
        setShowBucketsPanel(true);
      }
    };

    const handleDragEnter = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("application/katalist-thing")) {
        setShowBucketsPanel(true);
      }
    };

    const handleDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("application/katalist-thing")) {
        setShowBucketsPanel(true);
      }
    };

    const handleDragEnd = () => {
      setShowBucketsPanel(false);
    };

    const handleDrop = () => {
      setTimeout(() => setShowBucketsPanel(false), 100);
    };

    window.addEventListener("dragstart", handleDragStart);
    window.addEventListener("dragenter", handleDragEnter);
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("dragend", handleDragEnd);
    window.addEventListener("drop", handleDrop);

    return () => {
      window.removeEventListener("dragstart", handleDragStart);
      window.removeEventListener("dragenter", handleDragEnter);
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("dragend", handleDragEnd);
      window.removeEventListener("drop", handleDrop);
    };
  }, []);

  if (error) {
    return (
      <div className="hidden lg:block">
        <section className="flex min-h-[320px] flex-col items-center justify-center rounded-xl border border-border bg-white px-8 text-center">
          <KatalistIcon name="stuck" className="h-7 w-7 text-status-now" />
          <h2 className="mt-3 text-sm font-semibold">The Court could not be loaded.</h2>
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
        </section>
      </div>
    );
  }

  return (
    <div className="hidden lg:block max-w-[1380px] mx-auto">
      <MagicBox desktop />

      {isLoading ? (
        <p className="mb-2 text-[11px] text-muted-foreground" aria-live="polite">
          Loading your Court…
        </p>
      ) : null}

      {/* Top 5-Item Summary Ribbon */}
      <div className="mb-3.5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 divide-x divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-white shadow-xs">
        {/* NOW */}
        <div className="flex items-center gap-3 p-2.5 px-3.5">
          <span className="text-2xl font-black text-foreground tabular-nums leading-none shrink-0 min-w-[24px]">
            {view.counts.now}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 leading-none">
              <Zap className="h-3.5 w-3.5 shrink-0 text-red-500 fill-red-500/20" />
              <span className="text-[10.5px] font-black text-red-600 uppercase tracking-wide">NOW</span>
            </div>
            <span className="mt-1 block truncate text-[10.5px] text-muted-foreground font-medium">
              Needs you now
            </span>
          </div>
        </div>

        {/* NEXT */}
        <div className="flex items-center gap-3 p-2.5 px-3.5">
          <span className="text-2xl font-black text-foreground tabular-nums leading-none shrink-0 min-w-[24px]">
            {view.counts.next}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 leading-none">
              <ArrowLeftRight className="h-3.5 w-3.5 shrink-0 text-blue-500" />
              <span className="text-[10.5px] font-black text-blue-600 uppercase tracking-wide">NEXT</span>
            </div>
            <span className="mt-1 block truncate text-[10.5px] text-muted-foreground font-medium">
              On deck soon
            </span>
          </div>
        </div>

        {/* LATER */}
        <div className="flex items-center gap-3 p-2.5 px-3.5">
          <span className="text-2xl font-black text-foreground tabular-nums leading-none shrink-0 min-w-[24px]">
            {view.counts.later}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 leading-none">
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-purple-500" />
              <span className="text-[10.5px] font-black text-purple-600 uppercase tracking-wide">LATER</span>
            </div>
            <span className="mt-1 block truncate text-[10.5px] text-muted-foreground font-medium">
              When time opens up
            </span>
          </div>
        </div>

        {/* COMPLETED */}
        <div className="flex items-center gap-3 p-2.5 px-3.5">
          <span className="text-2xl font-black text-foreground tabular-nums leading-none shrink-0 min-w-[24px]">
            {completedCount ?? 0}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 leading-none">
              <CalendarCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
              <span className="text-[10.5px] font-black text-emerald-600 uppercase tracking-wide">COMPLETED</span>
            </div>
            <span className="mt-1 block truncate text-[10.5px] text-muted-foreground font-medium">
              Done
            </span>
          </div>
        </div>

        {/* WAITING */}
        <div className="flex items-center gap-3 p-2.5 px-3.5">
          <span className="text-2xl font-black text-foreground tabular-nums leading-none shrink-0 min-w-[24px]">
            {view.counts.theirs}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 leading-none">
              <FileText className="h-3.5 w-3.5 shrink-0 text-orange-500" />
              <span className="text-[10.5px] font-black text-orange-600 uppercase tracking-wide">WAITING</span>
            </div>
            <span className="mt-1 block truncate text-[10.5px] text-muted-foreground font-medium">
              On others
            </span>
          </div>
        </div>
      </div>

      <div className="mb-3.5 flex items-center gap-2.5">
        <div className="flex items-center gap-1.5">
          {quickFilters.map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={filters.quick === id}
              onClick={() => setDetailedFilter("quick", id)}
              className={cn(
                "inline-flex h-7.5 items-center rounded-full border px-3 text-[11px] font-medium outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-ring",
                filters.quick === id
                  ? "border-purple-300 text-purple-700 bg-purple-50/60 font-semibold"
                  : "border-border/80 bg-white text-muted-foreground hover:border-primary/45 hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}

          {collaborators.length > 0 ? (
            <div className="ml-2 flex items-center gap-1">
              {collaborators.map((person) => {
                const isActive = filters.personId === person.id;
                return (
                  <button
                    key={person.id}
                    type="button"
                    title={isActive ? `Clear filter for ${person.name}` : `Filter by ${person.name}`}
                    aria-label={`Filter by ${person.name}`}
                    aria-pressed={isActive}
                    onClick={() => {
                      setFilters((current) => ({
                        ...current,
                        personId: current.personId === person.id ? null : person.id,
                      }));
                    }}
                    className={cn(
                      "relative rounded-full transition-all duration-200 outline-none cursor-pointer",
                      isActive
                        ? "ring-2 ring-primary ring-offset-2 scale-110 shadow-xs"
                        : "opacity-75 hover:opacity-100 hover:scale-105",
                    )}
                  >
                    <PersonAvatar
                      name={person.name}
                      initials={person.initials}
                      src={person.avatarUrl}
                      size={24}
                    />
                    {isActive ? (
                      <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-white" />
                    ) : null}
                  </button>
                );
              })}
              {filters.personId ? (
                <button
                  type="button"
                  onClick={() => setFilters((current) => ({ ...current, personId: null }))}
                  className="ml-1 inline-flex h-5 items-center rounded-full bg-primary/10 px-1.5 text-[9.5px] font-semibold text-primary hover:bg-primary/20 transition-colors cursor-pointer"
                  title="Clear person filter"
                >
                  ✕ Clear
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <label className="flex h-8 w-48 items-center gap-2 rounded-lg border border-border bg-white px-2.5 focus-within:border-primary focus-within:ring-2 focus-within:ring-ring">
            <KatalistIcon name="search" className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              className="min-w-0 flex-1 bg-transparent text-[11px] outline-none placeholder:text-muted-foreground"
              aria-label="Search Court"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Clear search"
                title="Clear search"
              >
                <KatalistIcon name="clear-input" className="h-3 w-3" />
              </button>
            ) : null}
          </label>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex h-8 min-w-[150px] items-center gap-2 rounded-lg border border-border bg-white px-2.5 text-[11px] outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Sort Court: ${sortLabels[sort]}`}
              >
                <KatalistIcon name="sort" className="h-3.5 w-3.5 text-muted-foreground" />
                <span>Sort: {sortLabels[sort]}</span>
                <KatalistIcon
                  name="chevron-down"
                  className="ml-auto h-3 w-3 text-muted-foreground"
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52 bg-white">
              <DropdownMenuLabel className="text-[11px] text-muted-foreground">
                Sort within each lane
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={sort}
                onValueChange={(value) => setSort(value as CourtSort)}
              >
                {(Object.entries(sortLabels) as Array<[CourtSort, string]>).map(([id, label]) => (
                  <DropdownMenuRadioItem
                    key={id}
                    value={id}
                    className="text-[12px] focus:ring-2 focus:ring-inset focus:ring-ring"
                  >
                    {label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-lg border bg-white px-2.5 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  detailedFilterCount ? "border-primary text-primary" : "border-border",
                )}
                aria-label={
                  detailedFilterCount
                    ? `Filter Court (${detailedFilterCount} active)`
                    : "Filter Court"
                }
              >
                <KatalistIcon name="filter" className="h-3.5 w-3.5" />
                Filter{detailedFilterCount ? ` (${detailedFilterCount})` : ""}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 bg-white">
              <FilterRadioSection<CourtDueFilter>
                label="Due"
                value={filters.due}
                options={[
                  ["any", "Any due state"],
                  ["overdue", "Overdue"],
                  ["today", "Today"],
                  ["this_week", "This week"],
                  ["no_due", "No due date"],
                ]}
                onChange={(value) => setDetailedFilter("due", value)}
              />
              <DropdownMenuSeparator className="border-t border-border bg-transparent" />
              <FilterRadioSection<CourtAcknowledgementFilter>
                label="Acknowledgement"
                value={filters.acknowledgement}
                options={[
                  ["any", "Any acknowledgement"],
                  ["waiting_for_catch", "Waiting for Catch"],
                  ["caught", "Caught"],
                ]}
                onChange={(value) => setDetailedFilter("acknowledgement", value)}
              />
              <DropdownMenuSeparator className="border-t border-border bg-transparent" />
              <FilterRadioSection<CourtWorkStatusFilter>
                label="Work status"
                value={filters.workStatus}
                options={[
                  ["any", "Any work status"],
                  ["not_started", "Not Started"],
                  ["under_progress", "Under Progress"],
                ]}
                onChange={(value) => setDetailedFilter("workStatus", value)}
              />
              <DropdownMenuSeparator className="border-t border-border bg-transparent" />
              <DropdownMenuCheckboxItem
                checked={filters.starredOnly}
                onCheckedChange={(checked) => setDetailedFilter("starredOnly", checked === true)}
                className="text-[12px] focus:ring-2 focus:ring-inset focus:ring-ring"
              >
                Starred only
              </DropdownMenuCheckboxItem>
              <DropdownMenuItem
                disabled={detailedFilterCount === 0}
                onSelect={() =>
                  setFilters((current) => ({ ...DEFAULT_COURT_FILTERS, quick: current.quick }))
                }
                className="mt-1 border-t border-border pt-2 text-[12px] text-primary focus:ring-2 focus:ring-inset focus:ring-ring"
              >
                Clear detailed filters
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <button
            type="button"
            onClick={() => setShowBucketsPanel((v) => !v)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11.5px] font-bold outline-none transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-ring",
              showBucketsPanel
                ? "border-primary bg-primary/10 text-primary shadow-2xs"
                : "border-border bg-white text-slate-700 hover:text-foreground hover:border-slate-300",
            )}
            title="Toggle Buckets side panel"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            <span>Buckets</span>
          </button>
        </div>
      </div>

      <div className="flex min-w-0 items-start gap-4">
        <div className="min-w-0 flex-1">
          <CourtWorkspace
            selection={focusSelection}
            lanes={{ now: view.now, next: view.next, later: view.later }}
            myActorId={myActorId}
            initialPositions={savedPositionsRef.current}
            laneRefs={laneRefs}
            heroRect={heroRect}
            onOpen={handleOpen}
            onSelectThing={(thingId) =>
              setFocusSelection((current) => (current ? { lane: current.lane, thingId } : current))
            }
            onClose={closeFocus}
            onRefresh={refetch}
            onViewAll={handleViewAll}
          />
        </div>

        {showBucketsPanel && (
          <CourtBucketsSidePanel onClose={() => setShowBucketsPanel(false)} />
        )}
      </div>

      <section
        className="mt-8 border-t border-border/70 pt-5 pb-6"
        aria-labelledby="theirs-title"
      >
        <div className="mb-3 flex items-center justify-between px-1">
          <h2 id="theirs-title" className="text-[11.5px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
            WITH OTHERS
          </h2>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <TheirSummaryCard
            active={theirFocus === "waiting_for_catch"}
            icon="waiting"
            label="Waiting for Catch"
            description="Tasks waiting for others"
            count={theirGroups.waiting_for_catch.length}
            tone="bg-orange-50 text-orange-500 border border-orange-100"
            onClick={() =>
              setTheirFocus((current) => toggleTheirsFocus(current, "waiting_for_catch"))
            }
          />
          <TheirSummaryCard
            active={theirFocus === "moving"}
            icon="moving"
            label="Moving"
            description="Tasks in motion"
            count={theirGroups.moving.length}
            tone="bg-blue-50 text-blue-500 border border-blue-100"
            onClick={() => setTheirFocus((current) => toggleTheirsFocus(current, "moving"))}
          />
          <TheirSummaryCard
            active={theirFocus === "needs_attention"}
            icon="needs_attention"
            label="Needs Attention"
            description="Tasks need attention"
            count={theirGroups.needs_attention.length}
            tone="bg-purple-50 text-purple-500 border border-purple-100"
            onClick={() =>
              setTheirFocus((current) => toggleTheirsFocus(current, "needs_attention"))
            }
          />
        </div>

        {/* Selected / Highlighted Tasks List under With Others with spacious padding */}
        <InlineThingDetailWorkspace
          thing={theirSelectedThing}
          onClose={() => setTheirSelectedId(null)}
          className="mt-5"
        >
          <div className="space-y-3 max-h-[560px] overflow-y-auto px-1.5 py-2 pr-2">
            {(theirFocus ? theirGroups[theirFocus] : view.theirs).map((thing) => {
              const isSelected = theirSelectedId === thing.id;
              const creatorAvatar = thing.creator.avatarUrl || matchProfile(directory, thing.creator.name)?.avatar_url;
              const assigneeAvatar = thing.assignee.avatarUrl || matchProfile(directory, thing.assignee.name)?.avatar_url;
              const state = theirStateFor(thing);
              const isWaiting = state === "waiting_for_catch";

              if (theirSelectedThing) {
                // Compact Card style when detail panel is open on the right
                return (
                  <div
                    key={thing.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      const selectedThing = thing;
                      if (isSelected) {
                        setTheirSelectedId(null);
                      } else {
                        setTheirSelectedId(selectedThing.id);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        const selectedThing = thing;
                        if (isSelected) {
                          setTheirSelectedId(null);
                        } else {
                          setTheirSelectedId(selectedThing.id);
                        }
                      }
                    }}
                    className={cn(
                      "w-full rounded-2xl p-4 text-left shadow-2xs outline-none transition-all duration-200 cursor-pointer",
                      isSelected
                        ? "border-2 border-primary bg-primary/5 ring-1 ring-primary/30 shadow-xs"
                        : "border border-border/60 bg-white hover:border-border",
                    )}
                  >
                    <span className="block line-clamp-2 text-[13.5px] font-bold leading-snug text-foreground">
                      {thing.title}
                    </span>
                    <div className="mt-3 flex items-center justify-between gap-2 text-[11px]">
                      <div className="flex items-center gap-2 min-w-0">
                        <PersonAvatar
                          name={thing.assignee.name}
                          initials={thing.assignee.initials}
                          src={assigneeAvatar}
                          size={22}
                        />
                        <span className="truncate font-semibold text-foreground max-w-[110px]">
                          {thing.assignee.name}
                        </span>
                      </div>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 shrink-0 font-medium",
                          isWaiting ? "text-orange-600" : state === "moving" ? "text-blue-600" : "text-red-600",
                        )}
                      >
                        <span
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            isWaiting ? "bg-orange-500" : state === "moving" ? "bg-blue-500" : "bg-red-500",
                          )}
                        />
                        {isWaiting ? "Waiting for Catch" : state === "moving" ? "Moving" : "Needs Attention"}
                      </span>
                    </div>
                  </div>
                );
              }

              // Full Width Row style when detail panel is closed
              return (
                <div
                  key={thing.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setTheirSelectedId(thing.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setTheirSelectedId(thing.id);
                    }
                  }}
                  className="flex items-center justify-between gap-4 rounded-2xl border border-border/60 bg-white px-5 py-3.5 shadow-2xs transition-all duration-200 hover:border-border hover:shadow-xs cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                >
                  {/* Left: People Flow */}
                  <div className="flex items-center gap-2.5 min-w-[200px] shrink-0">
                    <PersonAvatar
                      name={thing.creator.name}
                      initials={thing.creator.initials}
                      src={creatorAvatar}
                      size={26}
                    />
                    <span className="text-[12.5px] font-semibold text-foreground truncate max-w-[80px]">
                      {thing.creator.name}
                    </span>
                    <span className="text-muted-foreground/60 text-xs">→</span>
                    <PersonAvatar
                      name={thing.assignee.name}
                      initials={thing.assignee.initials}
                      src={assigneeAvatar}
                      size={26}
                    />
                    <span className="text-[12.5px] font-semibold text-foreground truncate max-w-[80px]">
                      {thing.assignee.name}
                    </span>
                  </div>

                  {/* Center: Title */}
                  <span className="flex-1 text-[13.5px] font-medium text-foreground px-4 truncate">
                    {thing.title}
                  </span>

                  {/* Right: Status badge & Drag handle */}
                  <div className="flex items-center gap-3 shrink-0">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium border",
                        isWaiting
                          ? "bg-orange-50 text-orange-600 border-orange-200/60"
                          : state === "moving"
                            ? "bg-blue-50 text-blue-600 border-blue-200/60"
                            : "bg-purple-50 text-purple-600 border-purple-200/60",
                      )}
                    >
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          isWaiting ? "bg-orange-500" : state === "moving" ? "bg-blue-500" : "bg-purple-500",
                        )}
                      />
                      {isWaiting ? "Waiting for Catch" : state === "moving" ? "Moving" : "Needs Attention"}
                    </span>
                    <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40" />
                  </div>
                </div>
              );
            })}
            {view.theirs.length === 0 ? (
              <div className="flex min-h-[80px] items-center justify-center rounded-xl border border-dashed border-border/70 bg-white text-[11.5px] text-muted-foreground">
                No Things with others.
              </div>
            ) : null}
          </div>
        </InlineThingDetailWorkspace>
      </section>
    </div>
  );
}
