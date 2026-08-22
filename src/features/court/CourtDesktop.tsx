import { useEffect, useMemo, useRef, useState } from "react";
import type { Thing } from "@/domain/thing";
import { theirStateFor } from "@/domain/thing";
import { cn } from "@/lib/utils";
import { MagicBox } from "./MagicBox";
import { CourtThingCard } from "./CourtThingCard";
import { KatalistIcon, type KatalistIconName } from "./KatalistIcon";
import {
  DEFAULT_COURT_FILTERS,
  applyCourtView,
  cardDensityForLane,
  toggleLaneFocus,
  toggleTheirsFocus,
  type CourtAcknowledgementFilter,
  type CourtDueFilter,
  type CourtFilterState,
  type CourtLaneId,
  type CourtQuickFilter,
  type CourtSort,
  type CourtViewMode,
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
  onSelect: (thing: Thing) => void;
};

const laneContent: Record<
  CourtLaneId,
  { label: string; descriptor: string; icon: KatalistIconName; tone: string; headerTone: string }
> = {
  now: {
    label: "NOW",
    descriptor: "Needs you now",
    icon: "now-smash",
    tone: "text-status-now",
    headerTone: "bg-status-now/5",
  },
  next: {
    label: "NEXT",
    descriptor: "On deck soon",
    icon: "next-rally",
    tone: "text-status-next",
    headerTone: "bg-status-next/5",
  },
  later: {
    label: "LATER",
    descriptor: "When time opens up",
    icon: "later-lob",
    tone: "text-status-later",
    headerTone: "bg-status-later/5",
  },
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

function CourtLane({
  lane,
  things,
  focus,
  showAll,
  buttonRef,
  onToggleFocus,
  onViewAll,
  onSelect,
}: {
  lane: CourtLaneId;
  things: Thing[];
  focus: CourtViewMode;
  showAll: boolean;
  buttonRef: (node: HTMLButtonElement | null) => void;
  onToggleFocus: () => void;
  onViewAll: () => void;
  onSelect: (thing: Thing) => void;
}) {
  const density = cardDensityForLane(focus, lane);
  const visible = showAll ? things : things.slice(0, 6);
  const content = laneContent[lane];
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border/70 bg-white transition-[opacity,border-color] duration-[220ms] ease-out motion-reduce:transition-none",
        focus === lane && "border-primary/60",
        focus && focus !== lane && "opacity-80",
      )}
      aria-label={`${content.label} lane`}
    >
      <div
        className={cn(
          "flex min-h-[54px] items-center gap-2 border-b border-border/70 px-4",
          content.headerTone,
        )}
      >
        <button
          ref={buttonRef}
          type="button"
          aria-pressed={focus === lane}
          onClick={onToggleFocus}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <KatalistIcon name={content.icon} className={cn("h-4 w-4 shrink-0", content.tone)} />
          <span className={cn("text-[12px] font-semibold tracking-[0.08em]", content.tone)}>
            {content.label}
          </span>
          <span
            className={cn(
              "rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] font-semibold",
              content.tone,
            )}
          >
            {things.length}
          </span>
          {density !== "peek" ? (
            <span className="truncate text-[11px] text-muted-foreground">{content.descriptor}</span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={onViewAll}
          className="inline-flex h-9 shrink-0 items-center gap-1 rounded-md px-1.5 text-[10px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`View all ${content.label} Things`}
        >
          {showAll ? "Collapse" : "View all"}
          <KatalistIcon
            name={showAll ? "chevron-down" : "chevron-right"}
            className={cn("h-3.5 w-3.5", showAll && "rotate-180")}
          />
        </button>
      </div>

      <div
        className={cn(
          "space-y-0 px-0",
          showAll && "max-h-[calc(100vh-20rem)] overflow-y-auto overscroll-contain",
        )}
      >
        {visible.length ? (
          visible.map((thing) => (
            <CourtThingCard
              key={thing.id}
              thing={thing}
              density={density}
              lane={lane}
              muted={lane === "later"}
              onSelect={onSelect}
            />
          ))
        ) : (
          <div className="flex min-h-[96px] items-center justify-center bg-white px-3 text-center text-[11px] text-muted-foreground">
            No Things match this view.
          </div>
        )}
      </div>

      {!showAll && things.length > 6 ? (
        <button
          type="button"
          onClick={onViewAll}
          className="mt-auto flex h-9 items-center justify-center gap-1 border-b border-border/70 text-[10.5px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          View all {things.length}
          <KatalistIcon name="chevron-right" className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </section>
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
  onSelect,
}: CourtDesktopProps) {
  const [filters, setFilters] = useState<CourtFilterState>(DEFAULT_COURT_FILTERS);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<CourtSort>("due");
  const [laneFocus, setLaneFocus] = useState<CourtViewMode>(null);
  const [showAllLane, setShowAllLane] = useState<CourtLaneId | null>(null);
  const [theirFocus, setTheirFocus] = useState<TheirsFocus | null>(null);
  const laneButtons = useRef<Partial<Record<CourtLaneId, HTMLButtonElement | null>>>({});

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

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || !laneFocus) return;
      const previous = laneFocus;
      setLaneFocus(null);
      setShowAllLane(null);
      window.requestAnimationFrame(() => laneButtons.current[previous]?.focus());
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [laneFocus]);

  const detailedFilterCount =
    Number(filters.due !== "any") +
    Number(filters.acknowledgement !== "any") +
    Number(filters.workStatus !== "any") +
    Number(filters.starredOnly);

  const gridTemplateColumns = !laneFocus
    ? "repeat(3, minmax(0, 1fr))"
    : laneFocus === "now"
      ? "minmax(0, 7fr) minmax(120px, 1.5fr) minmax(120px, 1.5fr)"
      : laneFocus === "next"
        ? "minmax(120px, 1.5fr) minmax(0, 7fr) minmax(120px, 1.5fr)"
        : "minmax(120px, 1.5fr) minmax(120px, 1.5fr) minmax(0, 7fr)";

  const setDetailedFilter = <K extends keyof CourtFilterState>(
    key: K,
    value: CourtFilterState[K],
  ) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const handleLaneFocus = (lane: CourtLaneId) => {
    setLaneFocus((current) => {
      const nextFocus = toggleLaneFocus(current, lane);
      if (!nextFocus) setShowAllLane(null);
      return nextFocus;
    });
  };

  const handleViewAll = (lane: CourtLaneId) => {
    if (showAllLane === lane) {
      setShowAllLane(null);
      return;
    }
    setLaneFocus(lane);
    setShowAllLane(lane);
    window.requestAnimationFrame(() => laneButtons.current[lane]?.focus());
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
          {laneFocus ? (
            <button
              type="button"
              onClick={() => {
                const previous = laneFocus;
                setLaneFocus(null);
                setShowAllLane(null);
                if (previous)
                  window.requestAnimationFrame(() => laneButtons.current[previous]?.focus());
              }}
              className="inline-flex h-8 items-center rounded-full border border-border bg-white px-3 text-[11px] font-medium text-muted-foreground outline-none hover:border-primary/45 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              All lanes
            </button>
          ) : null}
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

      <div
        className="grid items-start gap-3 transition-[grid-template-columns] duration-[220ms] ease-out motion-reduce:transition-none"
        style={{ gridTemplateColumns }}
      >
        {(["now", "next", "later"] as const).map((lane) => (
          <CourtLane
            key={lane}
            lane={lane}
            things={view[lane]}
            focus={laneFocus}
            showAll={showAllLane === lane}
            buttonRef={(node) => {
              laneButtons.current[lane] = node;
            }}
            onToggleFocus={() => handleLaneFocus(lane)}
            onViewAll={() => handleViewAll(lane)}
            onSelect={onSelect}
          />
        ))}
      </div>

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
