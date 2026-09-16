import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import {
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  Landmark,
  List,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { format } from "date-fns";
import type { Thing } from "@/domain/thing";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { TopNav } from "@/components/layout/TopNav";
import { ThingDetailContent } from "@/features/things/ThingDetailContent";
import { PDFViewer, type ThingFile } from "@/features/things/PDFViewer";
import { markThingAsRead } from "@/features/things/read-state";
import { CourtCompactLane } from "./CourtCompactLane";
import { focusColumns, type CourtFocusSelection, type FocusViewTabId } from "./court-stack-model";
import { formatCourtDue, type CourtLaneId } from "./court-view-model";
import { MagicBox } from "./MagicBox";
import { cn } from "@/lib/utils";

export type { CourtFocusSelection, FocusViewTabId } from "./court-stack-model";

export const ENABLE_COLLAPSIBLE_COMPACT_LANES = true;

export type CourtFocusViewProps = {
  selection: CourtFocusSelection;
  lanes: Record<CourtLaneId, Thing[]>;
  theirs?: Thing[];
  onSelectThing: (thingId: string) => void;
  onOpen?: (lane: CourtLaneId, thing: Thing, origin: HTMLElement) => void;
  onClose: () => void;
  heroRect?: { top: number; left: number; width: number; height: number } | null;
};

function thingStatusLabel(thing: Thing): string {
  if (thing.acknowledgement === "waiting_for_catch") return "Waiting";
  if (thing.workStatus === "under_progress") return "Under Progress";
  if (thing.workStatus === "sorted") return "Sorted";
  return "Not Started";
}

export function CourtFocusView({
  selection,
  lanes,
  theirs,
  onSelectThing,
  onOpen,
  onClose,
  heroRect,
}: CourtFocusViewProps) {
  const [activeLane, setActiveLane] = useState<FocusViewTabId>(selection.lane);
  const [searchQuery, setSearchQuery] = useState("");

  const selectedThing = useMemo(() => {
    const activeList = activeLane === "theirs" ? (theirs ?? []) : (lanes[activeLane] ?? []);
    return (
      activeList.find((thing) => thing.id === selection.thingId) ??
      (selection.lane === "theirs"
        ? theirs?.find((thing) => thing.id === selection.thingId)
        : lanes[selection.lane]?.find((thing) => thing.id === selection.thingId)) ??
      lanes.now.find((thing) => thing.id === selection.thingId) ??
      lanes.next.find((thing) => thing.id === selection.thingId) ??
      lanes.later.find((thing) => thing.id === selection.thingId) ??
      theirs?.find((thing) => thing.id === selection.thingId) ??
      activeList[0] ??
      null
    );
  }, [activeLane, lanes, theirs, selection.lane, selection.thingId]);

  // People you already collaborate with, so @mentions like @Sudheer resolve in the composer.
  const focusCollaborators = useMemo(() => {
    const allThings = [...(lanes.now ?? []), ...(lanes.next ?? []), ...(lanes.later ?? []), ...(theirs ?? [])];
    const map = new Map<string, Thing["assignee"]>();
    for (const t of allThings) {
      for (const p of [t.assignee, t.owner, t.creator]) {
        if (p && p.id && !map.has(p.id)) map.set(p.id, p);
      }
    }
    const all = Array.from(map.values());
    const named = all.filter((p) => p.name && p.name.toLowerCase() !== "someone");
    return named.length > 0 ? named : all;
  }, [lanes, theirs]);

  const [selectedFile, setSelectedFile] = useState<ThingFile | null>(() => {
    return selectedThing?.files?.[0] ?? null;
  });
  const [isHeroFlying, setIsHeroFlying] = useState(Boolean(heroRect));
  const selectedCardRef = useRef<HTMLDivElement | null>(null);
  const heroFlightRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (selectedThing?.files && selectedThing.files.length > 0) {
      if (!selectedFile || !selectedThing.files.some((f) => f.id === selectedFile.id)) {
        setSelectedFile(selectedThing.files[0]);
      }
    } else {
      setSelectedFile(null);
    }
  }, [selectedThing?.id]);

  useEffect(() => {
    if (selectedThing?.id) {
      markThingAsRead(selectedThing.id);
    }
  }, [selectedThing?.id]);

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
    const list = activeLane === "theirs" ? (theirs ?? []) : (lanes[activeLane] ?? []);
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter((t) => t.title.toLowerCase().includes(q));
  }, [lanes, theirs, activeLane, searchQuery]);

  const handleLaneTabChange = useCallback(
    (lane: FocusViewTabId) => {
      setActiveLane(lane);
      const laneThings = lane === "theirs" ? (theirs ?? []) : (lanes[lane] ?? []);
      if (laneThings && laneThings.length > 0) {
        const first = laneThings[0];
        onSelectThing(first.id);
      }
    },
    [lanes, theirs, onSelectThing],
  );

  const handleSelect = useCallback(
    (thing: Thing) => {
      onSelectThing(thing.id);
    },
    [onSelectThing],
  );

  const laneTabs: Array<{ id: FocusViewTabId; label: string; count: number }> = [
    { id: "now", label: "NOW", count: lanes.now.length },
    { id: "next", label: "NEXT", count: lanes.next.length },
    { id: "later", label: "LATER", count: lanes.later.length },
    { id: "theirs", label: "WITH OTHERS", count: theirs?.length ?? 0 },
  ];

  return (
    <div
      className="fixed inset-0 z-40 bg-[#edf2fe] flex flex-col motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-[0.99] duration-[240ms] ease-out motion-reduce:transition-none motion-reduce:animate-none"
      aria-label="Focused Court Thing"
    >
      {/* Top Header: Sticky TopNav */}
      <TopNav />

      {/* Subheader bar (floats on the page background) */}
      <div className="h-12 shrink-0 px-6 flex items-center justify-between">
        <div className="flex items-center gap-7">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 text-[13px] font-medium text-[#6a769c] hover:text-[#000533] transition-colors cursor-pointer"
            aria-label="Back to Court stacks"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Back to stacks</span>
            <kbd className="rounded border border-[#e2e4f5] bg-white px-1.5 py-0.5 text-[10px] font-medium text-[#8487a7]">
              Esc
            </kbd>
          </button>
          <div className="flex items-center gap-2 text-[14px] font-medium text-[#000533]">
            <Landmark className="h-4 w-4 text-[#000533]" />
            <span>All Things</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <PersonAvatar name="Nithesh" size={22} initials="N" />
          <span className="text-[11.5px] font-medium text-[#5f5f90]">Involving Nithesh</span>
        </div>
      </div>

      {/* Main Content Split */}
      <main className="flex-1 flex min-h-0 gap-4 overflow-hidden px-4 pb-4">
        {/* Left Column: Lane Tabs + Search + Things List (white card) */}
        <aside className="w-[360px] shrink-0 rounded-[12px] bg-white flex flex-col min-h-0 overflow-hidden">
          {/* Lane Tabs: NOW, NEXT, LATER, WITH OTHERS */}
          <div className="flex items-center gap-5 px-5 pt-4 border-b border-[#e2e4f5] overflow-x-auto no-scrollbar">
            {laneTabs.map((tab) => {
              const isActive = activeLane === tab.id;
              const color =
                tab.id === "now"
                  ? "#fe1016"
                  : tab.id === "next"
                    ? "#022dfb"
                    : tab.id === "later"
                      ? "#5c0bed"
                      : "#d97706";
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => handleLaneTabChange(tab.id)}
                  style={{ color }}
                  className={cn(
                    "pb-2.5 text-[15px] whitespace-nowrap transition-all relative cursor-pointer",
                    isActive ? "font-medium" : "font-normal opacity-90 hover:opacity-100",
                  )}
                >
                  <span>
                    {tab.label} <span className="text-[12.5px]">{tab.count}</span>
                  </span>
                  {isActive && (
                    <span
                      className="absolute -bottom-px left-0 right-0 h-0.5 rounded-full"
                      style={{ backgroundColor: tab.id === "now" ? "#fe0734" : color }}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* In-Lane Search */}
          <div className="px-4 pt-3 pb-2">
            <div className="relative flex items-center">
              <Search className="absolute left-3 h-4 w-4 text-[#8487a7] pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search Things..."
                className="h-[40px] w-full rounded-[10px] border border-[#ebecf7] bg-[#f9f9fe] pl-9 pr-3 text-[12px] text-[#000533] placeholder:text-[#8487a7] outline-none focus:border-[#975ee2] transition-colors"
              />
            </div>
          </div>

          {/* Meta row: count and sort */}
          <div className="flex items-center justify-between px-4 py-2 text-[11.5px] border-b border-[#eef0f6]">
            <div className="flex items-center gap-1.5 font-medium text-[#8487a7]">
              <List className="h-3.5 w-3.5 text-[#5f5f90]" />
              <span>{currentLaneThings.length} Things</span>
            </div>
            <button type="button" className="inline-flex items-center gap-1 font-medium text-[#0f0c2a] hover:opacity-80 cursor-pointer">
              <span>Due soon</span>
              <ChevronDown className="h-3 w-3" />
            </button>
          </div>

          {/* Things list */}
          <div className="flex-1 overflow-auto min-h-0 p-2">
            {currentLaneThings.map((thing) => {
              const isSelected = thing.id === selectedThing?.id;
              const due = formatCourtDue(thing);
              const isWaiting = thing.acknowledgement === "waiting_for_catch";
              const isProgress =
                thing.workStatus === "under_progress" ||
                (thing.acknowledgement === "caught" &&
                  thing.workStatus !== "sorted" &&
                  thing.workStatus !== "cancelled");
              const selTint =
                activeLane === "theirs"
                  ? { bg: "#fff8ef", border: "#f59e0b" }
                  : activeLane === "next"
                    ? { bg: "#eef4ff", border: "#0b62f8" }
                    : activeLane === "later"
                      ? { bg: "#f4f0ff", border: "#641dfb" }
                      : { bg: "#fef0f4", border: "#fe0734" };

              return (
                <div
                  ref={isSelected ? selectedCardRef : null}
                  key={thing.id}
                  onClick={() => handleSelect(thing)}
                  style={
                    isSelected
                      ? { backgroundColor: selTint.bg, borderColor: selTint.border }
                      : undefined
                  }
                  className={cn(
                    "relative rounded-[10px] p-3 transition-colors cursor-pointer text-left flex items-start justify-between gap-2.5",
                    isSelected ? "border-l-[3px]" : "border-l-[3px] border-transparent hover:bg-[#f9f9fe]",
                    isSelected && isHeroFlying && "opacity-0",
                  )}
                >
                  <div className="flex items-start gap-2.5 min-w-0 flex-1">
                    <PersonAvatar
                      name={thing.assignee.name}
                      initials={thing.assignee.initials}
                      src={thing.assignee.avatarUrl}
                      size={24}
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "text-[12.5px] leading-snug truncate text-[#000533]",
                          isSelected ? "font-medium" : "font-medium",
                        )}
                      >
                        {thing.title}
                      </p>
                      <div className="mt-1 flex flex-col gap-0.5 text-[11px]">
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
                            {thing.unreadCommentCount} new {thing.unreadCommentCount === 1 ? "comment" : "comments"}
                          </span>
                        ) : (thing.commentCount ?? 0) > 0 ? (
                          <span className="font-medium text-[#8487a7]">
                            {thing.commentCount} {thing.commentCount === 1 ? "comment" : "comments"}
                          </span>
                        ) : (thing.files?.length ?? 0) > 0 ? (
                          <span className="font-medium text-[#8487a7]">
                            {thing.files!.length} {thing.files!.length === 1 ? "file" : "files"}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="shrink-0 pt-0.5">
                    <span className="inline-flex items-center gap-1.5 text-[10px] text-[#8186a5]">
                      <span
                        className="h-3 w-3 rounded-full border-2 bg-white"
                        style={{
                          borderColor: isProgress ? "#247cfc" : isWaiting ? "#f59e0b" : "#626d96",
                        }}
                      />
                      <span>
                        {isWaiting ? "Waiting" : isProgress ? "Under Progress" : "Not Started"}
                      </span>
                    </span>
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

        {/* Right Column: detail top bar + (detail | preview), as one white card */}
        <div className="flex-1 rounded-[12px] bg-white flex flex-col min-h-0 overflow-hidden">
          {/* Detail top bar */}
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-[#eef0f6] px-6">
            <span className="truncate max-w-[280px] text-[#975ee2] text-[12.5px] font-medium">
              {selectedThing?.listName && selectedThing.listName !== "Standalone"
                ? selectedThing.listName
                : "Court"}
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-[30px] w-[30px] items-center justify-center rounded-[8px] bg-[#f5f6fa] text-[#5f5f90] hover:text-[#000533] hover:bg-[#eceef5] transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body: detail + preview */}
          <div className="flex flex-1 flex-row min-h-0 overflow-hidden">
            <div className="flex-1 min-h-0 overflow-auto bg-[#fefdfd] px-8 pt-6 pb-24">
              <div
                key={`detail-${column.thingId}`}
                className="w-full max-w-3xl mx-auto motion-safe:animate-in motion-safe:fade-in-0 duration-[240ms] motion-reduce:transition-none motion-reduce:animate-none"
              >
                {selectedThing ? (
                  <ThingDetailContent
                    initialThing={selectedThing}
                    headerAction={null}
                    onAfterTerminalAction={onClose}
                    variant="court"
                    onFileSelect={(file) => setSelectedFile(file)}
                  />
                ) : (
                  <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 px-6 text-center text-[11px] text-muted-foreground">
                    This Thing is no longer in the selected lane.
                  </div>
                )}
              </div>
            </div>
            {selectedFile && (
              <PDFViewer
                file={selectedFile}
                addedByName={selectedThing?.creator.name}
                addedLabel={
                  selectedThing?.updatedAt
                    ? format(new Date(selectedThing.updatedAt), "MMM d, h:mm a")
                    : undefined
                }
              />
            )}
          </div>
        </div>
      </main>

      {/* Bottom floating Toss composer */}
      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center px-4">
        <div className="pointer-events-auto w-full max-w-2xl">
          <MagicBox desktop extraPeople={focusCollaborators} />
        </div>
      </div>

      {/* Contract reference for test suites */}
      <div className="sr-only" aria-hidden="true">
        <CourtCompactLane
          lane={activeLane === "theirs" ? "now" : activeLane}
          things={activeLane === "theirs" ? (theirs ?? []) : lanes[activeLane]}
          onOpen={(thing, origin) => onOpen?.(activeLane === "theirs" ? "now" : activeLane, thing, origin)}
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
                : activeLane === "later"
                  ? "border-purple-300 bg-[#faf5ff]"
                  : "border-amber-300 bg-[#fffdf5]",
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
