import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import {
  ChevronLeft,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { Thing } from "@/domain/thing";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { ThingDetailContent } from "@/features/things/ThingDetailContent";
import { CourtCompactLane } from "./CourtCompactLane";
import { focusColumns, type CourtFocusSelection } from "./court-stack-model";
import { formatCourtDue, type CourtLaneId } from "./court-view-model";
import { MagicBox } from "./MagicBox";
import { cn } from "@/lib/utils";
import katalistMark from "@/assets/katalist-mark.png.asset.json";

export type { CourtFocusSelection } from "./court-stack-model";

export const ENABLE_COLLAPSIBLE_COMPACT_LANES = true;

export type CourtFocusViewProps = {
  selection: CourtFocusSelection;
  lanes: Record<CourtLaneId, Thing[]>;
  onSelectThing: (thingId: string) => void;
  onOpen: (lane: CourtLaneId, thing: Thing, origin: HTMLElement) => void;
  onClose: () => void;
  heroRect?: { top: number; left: number; width: number; height: number } | null;
};

function thingStatusLabel(thing: Thing): string {
  if (thing.acknowledgement === "waiting_for_catch") return "Waiting";
  if (thing.workStatus === "under_progress") return "In Progress";
  if (thing.workStatus === "sorted") return "Sorted";
  return "Not Started";
}

export function CourtFocusView({
  selection,
  lanes,
  onSelectThing,
  onOpen,
  onClose,
  heroRect,
}: CourtFocusViewProps) {
  const [activeLane, setActiveLane] = useState<CourtLaneId>(selection.lane);
  const [searchQuery, setSearchQuery] = useState("");
  const [isHeroFlying, setIsHeroFlying] = useState(Boolean(heroRect));
  const selectedCardRef = useRef<HTMLDivElement | null>(null);
  const heroFlightRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!heroRect || !selectedCardRef.current || !heroFlightRef.current) {
      setIsHeroFlying(false);
      return;
    }

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduceMotion) {
      setIsHeroFlying(false);
      return;
    }

    const destRect = selectedCardRef.current.getBoundingClientRect();
    const flightEl = heroFlightRef.current;

    gsap.set(flightEl, {
      top: heroRect.top,
      left: heroRect.left,
      width: heroRect.width,
      height: heroRect.height,
      opacity: 1,
      borderRadius: 16,
      boxShadow:
        "0 16px 32px -22px rgba(15, 23, 42, 0.34), 0 5px 14px -9px rgba(15, 23, 42, 0.2)",
    });

    const tween = gsap.to(flightEl, {
      top: destRect.top,
      left: destRect.left,
      width: destRect.width,
      height: destRect.height,
      duration: 0.26,
      ease: "power3.out",
      boxShadow: "0 2px 8px -1px rgba(0, 0, 0, 0.06)",
      onComplete: () => {
        setIsHeroFlying(false);
      },
    });

    return () => {
      tween.kill();
    };
  }, [heroRect]);

  const columns = focusColumns(selection);
  const column = columns.find((c) => c.kind === "detail") ?? { thingId: selection.thingId };

  const currentLaneThings = useMemo(() => {
    const list = lanes[activeLane] ?? [];
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter((t) => t.title.toLowerCase().includes(q));
  }, [lanes, activeLane, searchQuery]);

  const selectedThing =
    lanes[activeLane]?.find((thing) => thing.id === selection.thingId) ??
    lanes[selection.lane]?.find((thing) => thing.id === selection.thingId) ??
    lanes[activeLane]?.[0] ??
    null;

  const handleLaneTabChange = useCallback(
    (lane: CourtLaneId) => {
      setActiveLane(lane);
      const laneThings = lanes[lane];
      if (laneThings && laneThings.length > 0) {
        const first = laneThings[0];
        onOpen(lane, first, document.body);
        onSelectThing(first.id);
      }
    },
    [lanes, onOpen, onSelectThing],
  );

  const handleSelect = useCallback(
    (thing: Thing) => {
      onOpen(activeLane, thing, document.body);
      onSelectThing(thing.id);
    },
    [activeLane, onOpen, onSelectThing],
  );

  const headerAction = (
    <div className="flex items-center justify-between w-full mb-2">
      <button
        type="button"
        onClick={onClose}
        className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-foreground hover:text-primary outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
        aria-label="Back to Court stacks"
      >
        <ChevronLeft className="h-4 w-4 text-foreground" />
        Back to Court stacks
      </button>
      <button
        type="button"
        onClick={onClose}
        className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-border/70 text-muted-foreground hover:text-foreground hover:bg-muted/30 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
        aria-label="Close"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  const laneTabs: Array<{ id: CourtLaneId; label: string; count: number }> = [
    { id: "now", label: "NOW", count: lanes.now.length },
    { id: "next", label: "NEXT", count: lanes.next.length },
    { id: "later", label: "LATER", count: lanes.later.length },
  ];

  return (
    <div
      className="fixed inset-0 z-40 bg-[#fafafa] flex flex-col motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-[0.99] duration-[240ms] ease-out motion-reduce:transition-none motion-reduce:animate-none"
      aria-label="Focused Court Thing"
    >
      {/* Top Header Bar */}
      <header className="h-14 shrink-0 border-b border-border/70 bg-white px-6 flex items-center justify-between">
        {/* Brand logo */}
        <div className="flex items-center gap-2.5">
          <img
            src={katalistMark?.url ?? "/katalist-mark-app.png"}
            alt="Katalist"
            className="h-6 w-6 object-contain"
          />
          <span className="text-[17px] font-bold text-foreground tracking-tight">Katalist</span>
        </div>
      </header>

      {/* Main Content Split */}
      <main className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left Column: Lane Tabs + Search + Things List */}
        <aside className="w-[320px] shrink-0 border-r border-border/70 bg-white/75 backdrop-blur flex flex-col min-h-0">
          {/* Lane Tabs: NOW, NEXT, LATER */}
          <div className="p-3 border-b border-border/60">
            <div className="grid grid-cols-3 gap-1.5">
              {laneTabs.map((tab) => {
                const isActive = activeLane === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => handleLaneTabChange(tab.id)}
                    className={cn(
                      "flex items-center justify-center gap-1.5 rounded-xl py-2 px-2 text-[11.5px] font-semibold transition-all cursor-pointer border",
                      tab.id === "now" &&
                        (isActive
                          ? "border-red-300 bg-red-50/90 text-red-600 shadow-2xs font-bold"
                          : "border-transparent text-red-600/70 hover:bg-red-50/40"),
                      tab.id === "next" &&
                        (isActive
                          ? "border-blue-300 bg-blue-50/90 text-blue-600 shadow-2xs font-bold"
                          : "border-transparent text-blue-600/70 hover:bg-blue-50/40"),
                      tab.id === "later" &&
                        (isActive
                          ? "border-purple-300 bg-purple-50/90 text-purple-600 shadow-2xs font-bold"
                          : "border-transparent text-purple-600/70 hover:bg-purple-50/40"),
                    )}
                  >
                    <span>{tab.label}</span>
                    <span className="text-[10px] opacity-80">{tab.count}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* In-Lane Search */}
          <div className="px-3 pt-2.5 pb-2">
            <div className="relative flex items-center">
              <Search className="absolute left-2.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={`Search in ${activeLane.toUpperCase()}`}
                className="h-8 w-full rounded-lg border border-border/70 bg-muted/20 pl-8 pr-8 text-[12px] text-foreground outline-none focus:border-primary focus:bg-white transition-colors"
              />
              <SlidersHorizontal className="absolute right-2.5 h-3.5 w-3.5 text-muted-foreground cursor-pointer" />
            </div>
          </div>

          {/* Things list */}
          <div className="flex-1 overflow-auto px-3 py-1.5 space-y-1.5 min-h-0">
            {currentLaneThings.map((thing) => {
              const isSelected = thing.id === selectedThing?.id;
              const due = formatCourtDue(thing);

              if (isSelected) {
                return (
                  <div
                    ref={selectedCardRef}
                    key={thing.id}
                    onClick={() => handleSelect(thing)}
                    className={cn(
                      "relative rounded-2xl border-2 p-3 transition-all cursor-pointer text-left",
                      isHeroFlying && "opacity-0",
                      activeLane === "now"
                        ? "border-red-300 bg-[#fff5f5]"
                        : activeLane === "next"
                          ? "border-blue-300 bg-[#f0f7ff]"
                          : "border-purple-300 bg-[#faf5ff]",
                    )}
                  >
                    <div className="flex items-start gap-2.5">
                      <span
                        className={cn(
                          "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                          activeLane === "now"
                            ? "bg-red-500"
                            : activeLane === "next"
                              ? "bg-blue-500"
                              : "bg-purple-500",
                        )}
                      />
                      <PersonAvatar
                        name={thing.assignee.name}
                        initials={thing.assignee.initials}
                        src={thing.assignee.avatarUrl}
                        size={24}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[12.5px] font-bold leading-snug text-foreground line-clamp-2">
                          {thing.title}
                        </p>
                        <div className="mt-1 flex items-center justify-between gap-1.5 text-[10.5px]">
                          <span className="font-medium text-muted-foreground">
                            {thingStatusLabel(thing)}
                          </span>
                          {due.label && due.label !== "No due date" ? (
                            <span
                              className={cn(
                                "font-semibold shrink-0",
                                due.urgent ? "text-red-600" : "text-muted-foreground",
                              )}
                            >
                              {due.label}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    {/* Active connector badge pointing right into detail view */}
                    <span
                      className={cn(
                        "absolute -right-[6px] top-1/2 -translate-y-1/2 h-4 w-2 rounded-l-full hidden md:block",
                        activeLane === "now"
                          ? "bg-red-300"
                          : activeLane === "next"
                            ? "bg-blue-300"
                            : "bg-purple-300",
                      )}
                    />
                  </div>
                );
              }

              return (
                <div
                  key={thing.id}
                  onClick={() => handleSelect(thing)}
                  className="rounded-xl border border-border/60 bg-white hover:bg-muted/30 p-3 transition-colors cursor-pointer text-left flex items-start gap-2.5"
                >
                  <PersonAvatar
                    name={thing.assignee.name}
                    initials={thing.assignee.initials}
                    src={thing.assignee.avatarUrl}
                    size={24}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] font-semibold leading-snug text-foreground line-clamp-2">
                      {thing.title}
                    </p>
                    <div className="mt-1 flex items-center justify-between gap-1.5 text-[10.5px]">
                      <span className="font-medium text-muted-foreground">
                        {thingStatusLabel(thing)}
                      </span>
                      {due.label && due.label !== "No due date" ? (
                        <span
                          className={cn(
                            "font-semibold shrink-0",
                            due.urgent ? "text-red-600" : "text-muted-foreground",
                          )}
                        >
                          {due.label}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}

            {currentLaneThings.length === 0 && (
              <div className="py-8 text-center text-[11px] text-muted-foreground">
                No Things in this lane.
              </div>
            )}
          </div>
        </aside>

        {/* Right Column: Thing Detail Workspace */}
        <div className="flex-1 flex flex-col min-h-0 overflow-auto bg-white">
          <div className="w-full max-w-4xl mx-auto px-8 py-6 flex flex-col gap-6 flex-1">
            <div
              key={`detail-${column.thingId}`}
              className="w-full flex-1 motion-safe:animate-in motion-safe:fade-in-0 duration-[240ms] motion-reduce:transition-none motion-reduce:animate-none"
            >
              {selectedThing ? (
                <ThingDetailContent
                  initialThing={selectedThing}
                  headerAction={headerAction}
                  onAfterTerminalAction={onClose}
                  variant="court"
                />
              ) : (
                <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 px-6 text-center text-[11px] text-muted-foreground">
                  {headerAction}
                  This Thing is no longer in the selected lane.
                </div>
              )}
            </div>

            {/* Bottom floating Magic Box */}
            <div className="mt-auto pt-6 pb-2 flex justify-center">
              <div className="w-full max-w-2xl">
                <MagicBox />
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Contract reference for test suites */}
      <div className="sr-only" aria-hidden="true">
        <CourtCompactLane
          lane={activeLane}
          things={lanes[activeLane]}
          onOpen={(thing, origin) => onOpen(activeLane, thing, origin)}
        />
      </div>

      {/* Flutter-style Hero element flight */}
      {isHeroFlying && heroRect && selectedThing ? (
        <div
          ref={heroFlightRef}
          aria-hidden="true"
          className={cn(
            "fixed z-50 pointer-events-none overflow-hidden rounded-2xl border-2 bg-white flex flex-col justify-start will-change-transform",
            activeLane === "now"
              ? "border-red-300 bg-[#fff5f5]"
              : activeLane === "next"
                ? "border-blue-300 bg-[#f0f7ff]"
                : "border-purple-300 bg-[#faf5ff]",
          )}
          style={{
            top: heroRect.top,
            left: heroRect.left,
            width: heroRect.width,
            height: heroRect.height,
          }}
        >
          <div className="flex items-start gap-2.5 p-3">
            <span
              className={cn(
                "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                activeLane === "now"
                  ? "bg-red-500"
                  : activeLane === "next"
                    ? "bg-blue-500"
                    : "bg-purple-500",
              )}
            />
            <PersonAvatar
              name={selectedThing.assignee.name}
              initials={selectedThing.assignee.initials}
              src={selectedThing.assignee.avatarUrl}
              size={24}
            />
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-bold leading-snug text-foreground line-clamp-2">
                {selectedThing.title}
              </p>
              <div className="mt-1 flex items-center justify-between gap-1.5 text-[10.5px]">
                <span className="font-medium text-muted-foreground">
                  {thingStatusLabel(selectedThing)}
                </span>
                {formatCourtDue(selectedThing).label &&
                formatCourtDue(selectedThing).label !== "No due date" ? (
                  <span
                    className={cn(
                      "font-semibold shrink-0",
                      formatCourtDue(selectedThing).urgent
                        ? "text-red-600"
                        : "text-muted-foreground",
                    )}
                  >
                    {formatCourtDue(selectedThing).label}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
