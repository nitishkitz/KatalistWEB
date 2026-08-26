import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Thing } from "@/domain/thing";
import { theirStateFor } from "@/domain/thing";
import { cn } from "@/lib/utils";
import { MagicBox } from "./MagicBox";
import { CourtFocusView, type CourtFocusSelection } from "./CourtFocusView";
import { CourtLaneStack, type CourtLaneStackHandle } from "./CourtLaneStack";
import { CourtThingCard } from "./CourtThingCard";
import { KatalistIcon, type KatalistIconName } from "./KatalistIcon";
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
  icon: KatalistIconName;
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
        "flex min-h-[112px] items-center gap-3 rounded-xl border bg-white px-4 text-left outline-none transition-[border-color] duration-200 focus-visible:ring-2 focus-visible:ring-ring",
        active ? "border-primary" : "border-border hover:border-primary/45",
      )}
    >
      <span
        className={cn(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-current/30",
          tone,
        )}
      >
        <KatalistIcon name={icon} className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-semibold text-foreground">{label}</span>
        <span className="mt-0.5 block truncate text-[10.5px] text-muted-foreground">
          {description}
        </span>
      </span>
      <span className="text-xl font-semibold text-foreground">{count}</span>
      <KatalistIcon
        name={active ? "chevron-down" : "chevron-right"}
        className="h-4 w-4 text-muted-foreground"
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
  const laneRefs = useRef<Partial<Record<CourtLaneId, CourtLaneStackHandle | null>>>({});
  const originRef = useRef<{
    lane: CourtLaneId;
    thingId: string;
    element: HTMLElement;
  } | null>(null);
  const savedPositionsRef = useRef<
    Partial<Record<CourtLaneId, { activeIndex: number; activeThingId: string | null }>>
  >({});
  const focusIndexRef = useRef(0);

  const view = useMemo(
    () => applyCourtView({ now, next, later, theirs }, filters, query, sort),
    [now, next, later, theirs, filters, query, sort],
  );

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

  const closeFocus = useCallback(() => {
    const origin = originRef.current;
    setFocusSelection(null);
    if (!origin) return;

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
    originRef.current = { lane, thingId: thing.id, element };
    focusIndexRef.current = view[lane].findIndex((candidate) => candidate.id === thing.id);
    setFocusSelection({ lane, thingId: thing.id });
  };

  if (error) {
    return (
      <div className="hidden lg:block">
        <MagicBox desktop />
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
    <div className="hidden lg:block">
      <MagicBox desktop />

      {isLoading ? (
        <p className="mb-3 text-[11px] text-muted-foreground" aria-live="polite">
          Loading your Court…
        </p>
      ) : null}

      <div className="mb-5 flex items-center gap-3">
        <div className="flex items-center gap-1">
          {quickFilters.map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={filters.quick === id}
              onClick={() => setDetailedFilter("quick", id)}
              className={cn(
                "inline-flex h-8 items-center rounded-full border px-3 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
                filters.quick === id
                  ? "border-primary text-primary"
                  : "border-border bg-white text-muted-foreground hover:border-primary/45 hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <label className="flex h-9 w-52 items-center gap-2 rounded-lg border border-border bg-white px-3 focus-within:border-primary focus-within:ring-2 focus-within:ring-ring">
            <KatalistIcon name="search" className="h-4 w-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              className="min-w-0 flex-1 bg-transparent text-[11.5px] outline-none placeholder:text-muted-foreground"
              aria-label="Search Court"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Clear search"
                title="Clear search"
              >
                <KatalistIcon name="clear-input" className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </label>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex h-9 min-w-[164px] items-center gap-2 rounded-lg border border-border bg-white px-3 text-[11px] outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Sort Court: ${sortLabels[sort]}`}
              >
                <KatalistIcon name="sort" className="h-4 w-4 text-muted-foreground" />
                <span>Sort: {sortLabels[sort]}</span>
                <KatalistIcon
                  name="chevron-down"
                  className="ml-auto h-3.5 w-3.5 text-muted-foreground"
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
                  "inline-flex h-9 items-center gap-2 rounded-lg border bg-white px-3 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  detailedFilterCount ? "border-primary text-primary" : "border-border",
                )}
                aria-label={
                  detailedFilterCount
                    ? `Filter Court (${detailedFilterCount} active)`
                    : "Filter Court"
                }
              >
                <KatalistIcon name="filter" className="h-4 w-4" />
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

      {focusSelection ? (
        <CourtFocusView
          selection={focusSelection}
          lanes={{ now: view.now, next: view.next, later: view.later }}
          onSelectThing={(thingId) =>
            setFocusSelection((current) => (current ? { lane: current.lane, thingId } : current))
          }
          onClose={closeFocus}
        />
      ) : (
        <div className="grid min-w-0 grid-cols-3 items-start gap-3 overflow-hidden">
          {(["now", "next", "later"] as const).map((lane) => (
            <CourtLaneStack
              key={lane}
              ref={(handle) => {
                laneRefs.current[lane] = handle;
              }}
              lane={lane}
              things={view[lane]}
              myActorId={myActorId}
              initialPosition={savedPositionsRef.current[lane]}
              onOpen={(thing, origin) => handleOpen(lane, thing, origin)}
              onRefresh={refetch}
            />
          ))}
        </div>
      )}

      <section
        className="mt-8 border-t border-border/70 bg-white pt-4"
        aria-labelledby="theirs-title"
      >
        <div className="mb-3 flex items-baseline gap-2 px-1">
          <KatalistIcon name="at-person" className="h-4 w-4 text-foreground" />
          <h2 id="theirs-title" className="text-[12px] font-semibold tracking-[0.08em]">
            WITH OTHERS
          </h2>
          <span className="text-[11px] text-muted-foreground">{view.counts.theirs}</span>
        </div>
        <p className="mb-3 px-1 text-[11px] text-muted-foreground">
          Things you own that currently sit with someone else
        </p>
        <div className="grid grid-cols-3 gap-3">
          <TheirSummaryCard
            active={theirFocus === "waiting_for_catch"}
            icon="waiting"
            label="Waiting for Catch"
            description="Others still need to Catch"
            count={theirGroups.waiting_for_catch.length}
            tone="text-status-waiting"
            onClick={() =>
              setTheirFocus((current) => toggleTheirsFocus(current, "waiting_for_catch"))
            }
          />
          <TheirSummaryCard
            active={theirFocus === "moving"}
            icon="under-progress"
            label="Moving"
            description="Others are making progress"
            count={theirGroups.moving.length}
            tone="text-status-next"
            onClick={() => setTheirFocus((current) => toggleTheirsFocus(current, "moving"))}
          />
          <TheirSummaryCard
            active={theirFocus === "needs_attention"}
            icon="urgent"
            label="Needs Attention"
            description="No movement or due risk"
            count={theirGroups.needs_attention.length}
            tone="text-status-now"
            onClick={() =>
              setTheirFocus((current) => toggleTheirsFocus(current, "needs_attention"))
            }
          />
        </div>

        {theirFocus ? (
          <div className="mt-3 border-t border-border pt-3">
            <div className="mb-2 flex items-center gap-2 px-1">
              <span className="text-[11px] font-semibold text-foreground">
                {theirFocus === "waiting_for_catch"
                  ? "Waiting for Catch"
                  : theirFocus === "moving"
                    ? "Moving"
                    : "Needs Attention"}
              </span>
              <span className="text-[10px] text-muted-foreground">Things in this group</span>
            </div>
            {theirGroups[theirFocus].length ? (
              <div className="grid grid-cols-2 gap-x-4">
                {theirGroups[theirFocus].map((thing) => (
                  <CourtThingCard
                    key={thing.id}
                    thing={thing}
                    density="overview"
                    onSelect={onSelect}
                  />
                ))}
              </div>
            ) : (
              <div className="flex min-h-[96px] items-center justify-center border-b border-dashed border-border/70 bg-white text-[11px] text-muted-foreground">
                No Things match this group.
              </div>
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}
