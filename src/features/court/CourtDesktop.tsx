import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  Clock,
  FolderPlus,
  GripVertical,
  RotateCw,
  Sparkles,
} from "lucide-react";
import type { Thing } from "@/domain/thing";
import { laneOf, theirStateFor } from "@/domain/thing";
import { useCatchup } from "@/features/catchup/use-catchup";
import { CatchUpBanner } from "@/features/catchup/CatchUpBanner";
import { CatchUpOverlay } from "@/features/catchup/CatchUpOverlay";
import { cn } from "@/lib/utils";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { matchProfile, useProfileDirectory } from "@/features/people/directory";
import { MagicBox } from "./MagicBox";
import { InlineThingDetailWorkspace } from "@/features/things/InlineThingDetailWorkspace";
import { ThingDetailContent } from "@/features/things/ThingDetailContent";
import type { CourtLaneStackHandle } from "./CourtLaneStack";
import { CourtWorkspace } from "./CourtWorkspace";
import { CourtBucketsSidePanel } from "./CourtBucketsSidePanel";
import { CourtWithOthersSidebar } from "./CourtWithOthersSidebar";
import { CourtDetailModal } from "./CourtDetailModal";
import type { CourtFocusSelection } from "./court-stack-model";
import type { FocusViewTabId } from "./court-stack-model";
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

// Supported quick filter presets: "All", "Due", "Waiting", "In Progress"
const quickFilters: Array<[CourtQuickFilter, string]> = [
  ["all", "All"],
  ["due", "Due"],
  ["progress", "In progress"],
  ["unread_comments", "Unread comments"],
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
  const [modalSelection, setModalSelection] = useState<{ lane: FocusViewTabId; thing: Thing } | null>(null);
  const [theirFocus, setTheirFocus] = useState<TheirsFocus | null>(null);
  const [theirSelectedId, setTheirSelectedId] = useState<string | null>(null);
  const [heroRect, setHeroRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [catchUpOpen, setCatchUpOpen] = useState(false);
  const catchup = useCatchup();
  const directory = useProfileDirectory();
  const laneRefs = useRef<Partial<Record<CourtLaneId, CourtLaneStackHandle | null>>>({});
  const originRef = useRef<{
    lane: FocusViewTabId;
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
      window.requestAnimationFrame(() => {
        if (!origin.element.isConnected) return;
        if (origin.element.matches(":focus-visible")) return;
        if (origin.element.tabIndex >= 0) {
          origin.element.focus();
          return;
        }
        if (origin.lane !== "theirs") {
          laneRefs.current[origin.lane]?.focusThing(origin.thingId);
        }
      });
    });
  }, []);

  const handleViewAll = useCallback(
    (lane: FocusViewTabId) => {
      setHeroRect(null);
      const laneThings = lane === "theirs" ? view.theirs : view[lane];
      const activePosition = lane === "theirs" ? undefined : savedPositionsRef.current[lane];
      const activeId = activePosition?.activeThingId ?? laneThings[0]?.id;
      if (activeId) {
        setFocusSelection({ lane, thingId: activeId });
      } else {
        setFocusSelection({ lane, thingId: "" });
      }
    },
    [view],
  );

  const selectedLaneThings = focusSelection
    ? focusSelection.lane === "theirs"
      ? view.theirs
      : view[focusSelection.lane]
    : null;

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

  const handleOpen = (lane: FocusViewTabId, thing: Thing, element: HTMLElement) => {
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
      restoreFocus: element?.matches ? element.matches(":focus-visible") : false,
    };
    const list = lane === "theirs" ? view.theirs : view[lane];
    focusIndexRef.current = list.findIndex((candidate) => candidate.id === thing.id);
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
    setModalSelection({ lane, thing });
  };

  // Open a Thing from the Catch Up overlay. Closes the overlay and opens the
  // usual detail modal; no hero animation (the origin card lives in the overlay).
  const openCatchUpThing = (thing: Thing) => {
    setCatchUpOpen(false);
    setHeroRect(null);
    const lane: FocusViewTabId = thing.assignee.id === myActorId ? laneOf(thing) : "theirs";
    setModalSelection({ lane, thing });
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
    <div className="hidden lg:block w-full min-w-0 px-6 py-3">
      {isLoading ? (
        <p className="mb-2 text-[11px] text-muted-foreground" aria-live="polite">
          Loading your Court…
        </p>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-3.5 border-r border-border/70 pr-4">
            {quickFilters.map(([id, label]) => {
              const isActive = filters.quick === id;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => setDetailedFilter("quick", id)}
                  className={cn(
                    "rounded-full px-3 py-1 text-[13px] transition-colors outline-none cursor-pointer",
                    isActive
                      ? "bg-[#ece7fe] text-[#503188] font-medium"
                      : "text-[#1d1d1d] hover:text-[#503188] font-normal",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>

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
                      "flex items-center gap-1.5 rounded-full border px-2 py-1 !rounded-full h-7 transition-all duration-200 outline-none cursor-pointer",
                      isActive
                        ? "border-primary bg-primary/10 ring-2 ring-primary ring-offset-2 scale-110 shadow-xs"
                        : "border-border/80 hover:border-primary/45 opacity-75 hover:opacity-100 hover:scale-105",
                    )}
                  >
                    <PersonAvatar
                      name={person.name}
                      initials={person.initials}
                      src={person.avatarUrl}
                      size={20}
                    />
                    <span className="text-[11px] font-medium pr-0.5">{person.name.split(' ')[0]}</span>
                    {isActive ? (
                      <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-white hidden" />
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

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex h-8 w-48 items-center gap-2 rounded-lg border border-border bg-white px-2.5 focus-within:border-primary focus-within:ring-2 focus-within:ring-ring">
            <KatalistIcon name="search" className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search Court"
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
                <span>Order: {sortLabels[sort]}</span>
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
        </div>
      </div>

      {!focusSelection && catchup.count > 0 ? (
        <CatchUpBanner moments={catchup.moments} onReview={() => setCatchUpOpen(true)} />
      ) : null}

      <div className="flex w-full min-w-0 items-start gap-4">
        {/* Lanes */}
        <div className="min-w-0 flex-1 flex flex-col h-[calc(100vh-8rem)]">
          <CourtWorkspace
            selection={focusSelection}
            lanes={{ now: view.now, next: view.next, later: view.later }}
            theirs={view.theirs}
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
          {!focusSelection && (
            <div className="z-30 flex shrink-0 justify-center w-full mt-3 pt-1">
              <div className="w-full max-w-2xl">
                <MagicBox desktop extraPeople={collaborators} />
              </div>
            </div>
          )}
        </div>

        {/* Buckets side panel shown while dragging */}
        {showBucketsPanel && (
          <CourtBucketsSidePanel onClose={() => setShowBucketsPanel(false)} />
        )}

        {/* WITH OTHERS permanent right sidebar — hidden while buckets panel is open
            Section groups: "Needs Attention", "Waiting for Catch", "Moving"
            Selected detail renders InlineThingDetailWorkspace with theirSelectedId / setTheirSelectedId(selectedThing.id) */}
        {!showBucketsPanel && (
          <CourtWithOthersSidebar
            theirGroups={theirGroups}
            theirFocus={theirFocus}
            setTheirFocus={setTheirFocus}
            theirs={view.theirs}
            onOpenThing={(thing, origin) => handleOpen("theirs", thing, origin)}
            onViewAllTheirs={() => handleViewAll("theirs")}
            theirSelectedId={theirSelectedId}
            setTheirSelectedId={setTheirSelectedId}
            directory={directory}
          />
        )}
      </div>

      {modalSelection && (
        <CourtDetailModal
          thing={modalSelection.thing}
          lane={modalSelection.lane}
          isOpen={Boolean(modalSelection)}
          onClose={() => setModalSelection(null)}
          onOpenFullView={() => {
            const { lane, thing } = modalSelection;
            setModalSelection(null);
            setFocusSelection({ lane, thingId: thing.id });
          }}
          onRefresh={refetch}
        />
      )}

      <CatchUpOverlay
        open={catchUpOpen}
        onClose={() => setCatchUpOpen(false)}
        moments={catchup.moments}
        myActorId={myActorId}
        surfaceMoment={catchup.surfaceMoment}
        onOpenThing={openCatchUpThing}
        onRefresh={() => {
          refetch();
          catchup.refresh();
        }}
      />
    </div>
  );
}
