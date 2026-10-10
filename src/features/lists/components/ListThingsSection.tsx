import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { format } from "date-fns";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { MagicBox } from "@/features/court/MagicBox";
import { PDFViewer, type ThingFile } from "@/features/things/PDFViewer";
import { ThingDetailContent } from "@/features/things/ThingDetailContent";
import { formatCourtDue } from "@/features/court/court-view-model";
import type { Thing } from "@/domain/thing";
import type { ListRow } from "@/features/lists/fixtures";
import type { ListThingFilter } from "@/features/lists/use-list-things-filter";
import { cn } from "@/lib/utils";

export type ListLaneId = "now" | "next" | "later";

export interface ListLaneTab {
  id: ListLaneId;
  label: string;
  color: string;
}

interface ListThingsSectionProps {
  list: ListRow;
  viewOnly: boolean;
  laneTabs: ListLaneTab[];
  navLane: ListLaneId;
  onSelectLane: (lane: ListLaneId) => void;
  laneCounts: Record<ListLaneId, number>;
  navSearch: string;
  onNavSearchChange: (value: string) => void;
  thingsFilter: ListThingFilter;
  onThingsFilterChange: (value: ListThingFilter) => void;
  laneThings: Thing[];
  selectedId: string | null;
  selected: Thing | null;
  selectedIsVisible: boolean;
  activeThing: Thing | null;
  selTint: { bg: string; border: string };
  onSelectThing: (thingId: string) => void;
  onCloseSelected: () => void;
  onClearFilters: () => void;
  selectedFile: ThingFile | null;
  onFileSelect: (file: ThingFile | null) => void;
}

/**
 * Presentational Things tab for List detail (T11-03). Pure extraction from
 * the route's original inline JSX: all derived state (grouped/laneThings/
 * activeThing/selTint/selectedIsVisible), the quick-filter value itself
 * (owned by useListThingsFilter) and Thing selection stay owned by the
 * route -- this component only renders them and dispatches the route's
 * callbacks. Selected-ID stability, the filtered-out/unavailable
 * distinction and keyboard row activation are preserved exactly as they
 * were before extraction.
 */
export function ListThingsSection({
  list,
  viewOnly,
  laneTabs,
  navLane,
  onSelectLane,
  laneCounts,
  navSearch,
  onNavSearchChange,
  thingsFilter,
  onThingsFilterChange,
  laneThings,
  selectedId,
  selected,
  selectedIsVisible,
  activeThing,
  selTint,
  onSelectThing,
  onCloseSelected,
  onClearFilters,
  selectedFile,
  onFileSelect,
}: ListThingsSectionProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  return (
    <div data-list-things className="flex flex-col min-h-0 gap-3 h-[calc(100vh-9.5rem)]">
      <div className="flex min-h-0 flex-1 gap-3">
        {/* Navigator card */}
        <aside className="flex w-[340px] shrink-0 flex-col min-h-0 overflow-hidden rounded-[10px] bg-white">
          <div className="flex items-center gap-5 border-b border-[#e2e4f5] px-4 pt-2">
            {laneTabs.map((lt) => {
              const active = navLane === lt.id;
              return (
                <button
                  key={lt.id}
                  type="button"
                  onClick={() => onSelectLane(lt.id)}
                  style={{ color: lt.color }}
                  className={cn(
                    "relative pb-2.5 text-[15px] whitespace-nowrap transition-all cursor-pointer",
                    active ? "font-medium" : "font-normal opacity-90 hover:opacity-100",
                  )}
                >
                  <span>
                    {lt.label} <span className="text-[12.5px]">{laneCounts[lt.id]}</span>
                  </span>
                  {active && (
                    <span
                      className="absolute -bottom-px left-0 right-0 h-0.5 rounded-full"
                      style={{ backgroundColor: lt.id === "now" ? "#fe0734" : lt.color }}
                    />
                  )}
                </button>
              );
            })}
            <button
              type="button"
              aria-label={searchOpen ? "Close Thing search" : "Search Things"}
              aria-expanded={searchOpen}
              onClick={() => setSearchOpen((open) => !open)}
              className="ml-auto mb-2.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#6a769c] transition-colors hover:bg-[#f4f5fb] hover:text-[#000533] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#975ee2] focus-visible:ring-offset-2"
            >
              {searchOpen ? <X className="h-4 w-4" /> : <Search className="h-4 w-4" />}
            </button>
          </div>

          <div className="px-4 pt-3 pb-2">
            {searchOpen && (
              <div className="relative flex items-center">
                <Search className="pointer-events-none absolute left-3 h-4 w-4 text-[#8487a7]" />
                <input
                  ref={searchInputRef}
                  type="search"
                  aria-label="Search Things"
                  value={navSearch}
                  onChange={(e) => onNavSearchChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setSearchOpen(false);
                  }}
                  placeholder="Search Things..."
                  className="h-[40px] w-full rounded-[10px] border border-[#ebecf7] bg-[#f9f9fe] pl-9 pr-3 text-[12px] text-[#000533] placeholder:text-[#8487a7] outline-none transition-colors focus:border-[#975ee2] focus-visible:ring-2 focus-visible:ring-[#975ee2]/30"
                />
              </div>
            )}
            {/* G02: thingsFilter already drove filteredThings/grouped/
                laneThings, but had no control to actually change it --
                "all" (every Thing, including sorted/cancelled) stays
                the default for compatibility with existing behavior. */}
            <div
              role="tablist"
              aria-label="Filter Things by status"
              className={cn(
                "flex items-center gap-1 rounded-[9px] bg-[#f4f5fb] p-1",
                searchOpen && "mt-2",
              )}
            >
              {(
                [
                  ["active", "Active"],
                  ["all", "All"],
                  ["completed", "Completed"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={thingsFilter === id}
                  onClick={() => onThingsFilterChange(id)}
                  className={cn(
                    "flex-1 rounded-[7px] py-1.5 text-[12px] font-medium transition-colors",
                    thingsFilter === id
                      ? "bg-white text-[#000533] "
                      : "text-[#6a769c] hover:text-[#000533]",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-auto min-h-0 p-2">
            {laneThings.map((thing) => {
              const isSelected = thing.id === activeThing?.id;
              const due = formatCourtDue(thing);
              const isSorted = thing.workStatus === "sorted";
              const inProgress =
                !isSorted &&
                thing.workStatus !== "cancelled" &&
                (thing.workStatus === "under_progress" || thing.acknowledgement === "caught");
              const isWaiting = thing.acknowledgement === "waiting_for_catch";
              return (
                <div
                  key={thing.id}
                  data-thing-id={thing.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectThing(thing.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectThing(thing.id);
                    }
                  }}
                  style={
                    isSelected
                      ? { backgroundColor: selTint.bg, borderColor: selTint.border }
                      : undefined
                  }
                  className={cn(
                    "relative flex items-start justify-between gap-2.5 rounded-[10px] p-3 transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    isSelected
                      ? "border-l-[3px]"
                      : "border-l-[3px] border-transparent hover:bg-[#f9f9fe]",
                  )}
                >
                  <div className="flex min-w-0 flex-1 items-start gap-2.5">
                    <PersonAvatar
                      name={thing.assignee.name}
                      initials={thing.assignee.initials}
                      src={thing.assignee.avatarUrl}
                      size={24}
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "truncate text-[12.5px] font-medium leading-snug text-[#000533]",
                          isSorted && "line-through",
                        )}
                      >
                        {thing.title}
                      </p>
                      <div className="mt-1 flex flex-col gap-0.5 text-[12px]">
                        {due.label && due.label !== "No due date" ? (
                          <span
                            className="font-medium"
                            style={{ color: due.urgent ? "#fe1e26" : "#525d87" }}
                          >
                            {due.label}
                          </span>
                        ) : null}
                        {(thing.unreadCommentCount ?? 0) > 0 ? (
                          <span className="font-medium text-[#0242f5]">
                            {thing.unreadCommentCount} new{" "}
                            {thing.unreadCommentCount === 1 ? "comment" : "comments"}
                          </span>
                        ) : (thing.commentCount ?? 0) > 0 ? (
                          <span className="font-medium text-[#8487a7]">
                            {thing.commentCount}{" "}
                            {thing.commentCount === 1 ? "comment" : "comments"}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0 pt-0.5">
                    <span className="inline-flex items-center gap-1.5 text-[12px] text-[#8186a5]">
                      <span
                        className="h-3 w-3 rounded-full border-2 bg-white"
                        style={{
                          borderColor: isSorted
                            ? "#12a15f"
                            : inProgress
                              ? "#247cfc"
                              : isWaiting
                                ? "#f59e0b"
                                : "#626d96",
                        }}
                      />
                      <span>
                        {isWaiting
                          ? "Waiting"
                          : inProgress
                            ? "Under Progress"
                            : isSorted
                              ? "Sorted"
                              : "Not Started"}
                      </span>
                    </span>
                  </div>
                </div>
              );
            })}
            {laneThings.length === 0 && (
              <div className="py-8 text-center text-[12px] text-muted-foreground">
                No Things in this lane.
              </div>
            )}
          </div>
        </aside>

        {/* Right: detail | preview */}
        <div className="flex flex-1 flex-col min-h-0 overflow-hidden rounded-[10px] bg-white">
          <div className="flex flex-1 flex-row min-h-0 overflow-hidden">
            <div className="list-thing-detail flex-1 min-h-0 overflow-auto bg-[#fefdfd] p-4">
              <div className="w-full">
                {selectedId && selected && !selectedIsVisible ? (
                  <div role="status" className="flex min-h-[320px] flex-col items-center justify-center text-center">
                    <p className="text-[14px] font-semibold text-[#000533]">This Thing is hidden by your filters.</p>
                    <p className="mt-1 text-[12px] text-[#6a769c]">Clear the filters to return to the selected Thing.</p>
                    <div className="mt-4 flex gap-2">
                      <button
                        type="button"
                        onClick={onClearFilters}
                        className="rounded-lg bg-[#975ee2] px-3 py-2 text-[12px] font-semibold text-white"
                      >
                        Clear filters
                      </button>
                      <button type="button" onClick={onCloseSelected} className="rounded-lg border px-3 py-2 text-[12px] font-semibold">
                        Close
                      </button>
                    </div>
                  </div>
                ) : selectedId && !selected ? (
                  <div role="alert" className="flex min-h-[320px] flex-col items-center justify-center text-center">
                    <p className="text-[14px] font-semibold text-[#000533]">This Thing is no longer available.</p>
                    <p className="mt-1 text-[12px] text-[#6a769c]">Your access may have changed, or the Thing may have been removed.</p>
                    <button type="button" onClick={onCloseSelected} className="mt-4 rounded-lg border px-3 py-2 text-[12px] font-semibold">
                      Close
                    </button>
                  </div>
                ) : activeThing ? (
                  <ThingDetailContent
                    key={activeThing.id}
                    initialThing={activeThing}
                    headerAction={null}
                    onAfterTerminalAction={onCloseSelected}
                    variant="court"
                    viewOnly={viewOnly}
                    onFileSelect={(file) => onFileSelect(file)}
                  />
                ) : (
                  <div className="flex min-h-[320px] items-center justify-center text-[12px] text-muted-foreground">
                    No Things in this list yet.
                  </div>
                )}
              </div>
            </div>
            {selectedFile && (
              <PDFViewer
                file={selectedFile}
                addedByName={activeThing?.creator.name}
                addedLabel={
                  activeThing?.updatedAt
                    ? format(new Date(activeThing.updatedAt), "MMM d, h:mm a")
                    : undefined
                }
              />
            )}
          </div>
        </div>
      </div>

      {/* Toss composer — outside the detail container */}
      {!viewOnly && (
        <div className="flex shrink-0 justify-center">
          <div className="w-full max-w-2xl">
            <MagicBox
              listId={list.id}
              listName={list.name}
              desktop
              extraPeople={list.members.map((m) => ({
                id: m.actorId || m.profileId || m.name,
                name: m.name,
                initials: m.initials,
                avatarUrl: m.avatarUrl,
                actorId: m.actorId,
                profileId: m.profileId,
              }))}
            />
          </div>
        </div>
      )}
    </div>
  );
}
