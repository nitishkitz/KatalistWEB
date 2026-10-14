import { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowRight, ChevronDown, Pin, Sparkles } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { requestCatchupOpen } from "./catchup-entry";
import { cn } from "@/lib/utils";
import coeyAvatar from "@/assets/coey-catchup.png";
import { useAppContext } from "@/features/context/use-app-context";
import type { Thing } from "@/domain/thing";
import { CourtDetailModal } from "@/features/court/CourtDetailModal";
import { useMotionPreference } from "@/hooks/use-motion-preference";
import { useCatchup, type CatchUpMoment } from "./use-catchup";
import { reasonLabelFor, type CatchUpMomentKind } from "./catchup-logic";
import "./capsule-motion.css";

const SEVERITY: Record<CatchUpMomentKind, { label: string; dot: string; text: string }> = {
  nudge: { label: "High", dot: "bg-[#f04438]", text: "text-[#d92d20]" },
  follow_up: { label: "Medium", dot: "bg-[#f79009]", text: "text-[#b54708]" },
  ghost: { label: "Medium", dot: "bg-[#975ee2]", text: "text-[#6941c6]" },
  snooze_ended: { label: "Low", dot: "bg-[#1570ef]", text: "text-[#175cd3]" },
};

function severityFor(kind: CatchUpMomentKind | undefined) {
  return kind ? SEVERITY[kind] : null;
}

function momentLabel(moment: CatchUpMoment) {
  return moment.kind === "nudge"
    ? moment.actor?.name ? `${moment.actor.name} nudged you` : "Someone nudged you"
    : reasonLabelFor(moment.kind, moment.reason);
}

export function CatchUpNavCapsule() {
  const navigate = useNavigate();
  const { context } = useAppContext();
  const catchup = useCatchup();
  const { reduceMotion } = useMotionPreference();
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [hasFocus, setHasFocus] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [autoExpanded, setAutoExpanded] = useState(false);
  const [selectedThing, setSelectedThing] = useState<Thing | null>(null);
  const [expandedHeight, setExpandedHeight] = useState(44);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const detailsRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const previousMomentsRef = useRef<{ context: string; keys: Set<string> } | null>(null);
  const expansionTimerRef = useRef<number | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const leaveTimerRef = useRef<number | null>(null);

  const count = catchup.count;
  const isChecking = catchup.isLoading && !catchup.hasFetchedOnce;
  const activeMoment = catchup.moments[activeIndex] ?? catchup.moments[0] ?? null;
  const severity = severityFor(activeMoment?.kind);
  const isExpanded = isHovered || hasFocus || isPinned || autoExpanded;

  // Fluid height measurement tracking actual content
  useEffect(() => {
    const details = detailsRef.current;
    if (!details) return;
    const measure = () => {
      const detailsH = details.getBoundingClientRect().height;
      setExpandedHeight(Math.ceil(46 + detailsH));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(details);
    return () => observer.disconnect();
  }, [catchup.moments, count, isChecking]);

  useEffect(() => {
    setActiveIndex((current) => (count > 0 ? Math.min(current, count - 1) : 0));
  }, [count]);

  // Gentle auto-expansion when a new moment arrives
  useEffect(() => {
    if (!catchup.hasFetchedOnce) return;
    const keys = new Set(catchup.moments.map((moment) => moment.momentKey));
    const previous = previousMomentsRef.current;
    if (previous?.context === context) {
      const addedIndex = catchup.moments.findIndex((moment) => !previous.keys.has(moment.momentKey));
      if (addedIndex >= 0) {
        setActiveIndex(addedIndex);
        setAutoExpanded(true);
        if (expansionTimerRef.current !== null) window.clearTimeout(expansionTimerRef.current);
        expansionTimerRef.current = window.setTimeout(() => {
          setAutoExpanded(false);
          expansionTimerRef.current = null;
        }, 4200);
      }
    }
    previousMomentsRef.current = { context, keys };
  }, [catchup.hasFetchedOnce, catchup.moments, context]);

  // Auto-cycle through moments when idle
  useEffect(() => {
    if (reduceMotion || isPaused || isExpanded || count < 2) return;
    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % count);
    }, 4200);
    return () => window.clearInterval(timer);
  }, [count, isExpanded, isPaused, reduceMotion]);

  // Clean timer cleanup on unmount
  useEffect(() => () => {
    if (expansionTimerRef.current !== null) window.clearTimeout(expansionTimerRef.current);
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
    if (leaveTimerRef.current !== null) window.clearTimeout(leaveTimerRef.current);
  }, []);

  // Hover intent (120ms): prevents accidental opening when cursor crosses the navigation bar
  const handleMouseEnter = () => {
    if (leaveTimerRef.current !== null) {
      window.clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
    setIsPaused(true);
    if (isExpanded) {
      setIsHovered(true);
      return;
    }
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(() => {
      setIsHovered(true);
      hoverTimerRef.current = null;
    }, 120);
  };

  // Leave grace (220ms): forgiving boundary crossing so user doesn't lose the popover
  const handleMouseLeave = () => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setIsPaused(false);
    if (leaveTimerRef.current !== null) window.clearTimeout(leaveTimerRef.current);
    leaveTimerRef.current = window.setTimeout(() => {
      setIsHovered(false);
      setAutoExpanded(false);
      leaveTimerRef.current = null;
    }, 220);
  };

  // Outside click listener to cleanly dismiss when pinned/expanded
  useEffect(() => {
    if (!isExpanded) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsHovered(false);
        setHasFocus(false);
        setIsPinned(false);
        setAutoExpanded(false);
        if (leaveTimerRef.current !== null) {
          window.clearTimeout(leaveTimerRef.current);
          leaveTimerRef.current = null;
        }
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [isExpanded]);

  // Escape key support
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape" && isExpanded) {
      event.preventDefault();
      setIsHovered(false);
      setHasFocus(false);
      setIsPinned(false);
      setAutoExpanded(false);
      triggerRef.current?.focus();
    }
  };

  const openThing = (thing: Thing) => {
    setIsPinned(false);
    setAutoExpanded(false);
    setIsHovered(false);
    setSelectedThing(thing);
  };

  return (
    <>
      <div
        ref={containerRef}
        className="group/catchup relative h-11 w-[224px] shrink-0 md:w-[236px] lg:w-[292px]"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onFocusCapture={() => {
          if (leaveTimerRef.current !== null) {
            window.clearTimeout(leaveTimerRef.current);
            leaveTimerRef.current = null;
          }
          setHasFocus(true);
          setIsPaused(true);
        }}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setHasFocus(false);
            setIsPaused(false);
            setIsPinned(false);
          }
        }}
        onKeyDown={handleKeyDown}
      >
        <div
          data-expanded={isExpanded}
          style={{ height: isExpanded ? expandedHeight : 44 }}
          className="capsule-nav-shell"
        >
          <button
            ref={triggerRef}
            data-brief-anchor
            type="button"
            onClick={() => setIsPinned((current) => !current)}
            aria-expanded={isExpanded}
            aria-controls="catchup-island-details"
            aria-label={
              isChecking
                ? "Checking Catch Up"
                : count && activeMoment
                  ? `Catch Up, ${activeIndex + 1} of ${count}: ${momentLabel(activeMoment)} about ${activeMoment.thing.title}`
                  : "All caught up"
            }
            className={cn(
              "capsule-trigger-btn h-[44px] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#8b5cf6]",
              count > 0 && !isExpanded && "bg-[linear-gradient(110deg,#fbf9ff_0%,#f4edff_52%,#fff9f3_100%)]",
            )}
          >
            <span
              data-brief-origin-avatar
              className={cn(
                "relative inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/90 bg-[#eee5ff] shadow-xs transition-transform duration-300 group-hover/catchup:scale-105",
                count > 0 && "ring-2 ring-[#e7d9ff] ring-offset-1 ring-offset-[#faf8ff]",
              )}
            >
              <img src={coeyAvatar} alt="" className="h-full w-full object-cover" aria-hidden="true" />
              {count > 0 ? (
                <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full border-2 border-white bg-[#f04438]" aria-hidden="true" />
              ) : null}
            </span>

            <span className="min-w-0 flex-1 overflow-hidden">
              <span className="flex min-w-0 items-center gap-1.5 capsule-eyebrow">
                <Sparkles className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="truncate">
                  {isChecking
                    ? "Checking"
                    : activeMoment?.kind === "nudge"
                      ? "New nudge"
                      : count > 0
                        ? "Catch Up"
                        : "All caught up"}
                </span>
                {count > 0 ? (
                  <span className="capsule-count-badge">
                    {count}
                  </span>
                ) : null}
              </span>
              <span
                key={activeMoment?.momentKey ?? (isChecking ? "checking" : "empty")}
                className="capsule-headline-text motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-300"
              >
                {isChecking ? "Looking for moments…" : activeMoment ? activeMoment.thing.title : "Nothing needs you"}
              </span>
            </span>

            {count > 0 && activeMoment ? (
              <span className={cn("capsule-severity-pill", severity?.text)}>
                <span className={cn("h-1.5 w-1.5 rounded-full", severity?.dot)} aria-hidden="true" />
                {severity?.label}
              </span>
            ) : !isChecking ? (
              <AlertCircle className="mr-1 h-3.5 w-3.5 shrink-0 text-[#98a2b3]" aria-hidden="true" />
            ) : null}

            <ChevronDown className="capsule-chevron-icon h-3.5 w-3.5" aria-hidden="true" />
          </button>

          <div
            id="catchup-island-details"
            aria-hidden={!isExpanded}
            inert={!isExpanded}
            className="capsule-details-reveal"
          >
            <div ref={detailsRef} className="border-t border-[#f0ebfa] px-4 pb-4 pt-3">
              <div className="mb-2.5 flex items-center justify-between">
                <p className="capsule-section-title flex items-center">
                  {isChecking
                    ? "Checking your Court"
                    : count > 0
                      ? `${count} ${count === 1 ? "moment" : "moments"} need you`
                      : "You’re all caught up"}
                </p>
                <button
                  type="button"
                  data-pinned={isPinned}
                  onClick={() => {
                    setIsPinned(false);
                    setAutoExpanded(false);
                    requestCatchupOpen();
                    void navigate({ to: "/" });
                  }}
                  className="capsule-pin-btn"
                  aria-label={`Open Morning Brief, ${count} ${count === 1 ? "moment" : "moments"}`}
                  title="Morning Brief"
                >
                  <Pin className={cn("h-3.5 w-3.5 shrink-0 transition-transform duration-200", isPinned && "rotate-45 text-[#6941c6]")} aria-hidden="true" />
                  <span className="text-xs font-semibold tabular-nums" aria-hidden="true">
                    {count}
                  </span>
                </button>
              </div>

              {isChecking ? (
                <p className="py-2 text-xs text-slate-500">Looking for updates…</p>
              ) : count === 0 ? (
                <p className="py-2 text-xs leading-relaxed text-slate-600">
                  No nudges, snoozes, or follow-ups need your attention right now.
                </p>
              ) : (
                <div className="max-h-[300px] space-y-2 overflow-y-auto pr-0.5">
                  {catchup.moments.map((moment) => {
                    const level = severityFor(moment.kind);
                    const isActive = moment.momentKey === activeMoment?.momentKey;
                    return (
                      <div
                        key={moment.momentKey}
                        className={cn(
                          "capsule-moment-item rounded-xl border p-3",
                          isActive
                            ? "border-[#d9c5fa] bg-[#f6f0ff] shadow-2xs"
                            : "border-[#f0ecf6] bg-[#faf8fe] hover:border-[#e2d5f8] hover:bg-[#f6f1fd]",
                        )}
                      >
                        <div className="flex items-start gap-2.5">
                          <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", level?.dot)} aria-hidden="true" />
                          <div className="min-w-0 flex-1">
                            <p className="capsule-moment-tag">
                              {momentLabel(moment)}
                            </p>
                            <p className="capsule-moment-title">
                              {moment.thing.title}
                            </p>
                            <div className="mt-2.5 flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => openThing(moment.thing)}
                                className="capsule-action-btn"
                              >
                                <span>Open Thing</span>
                                <ArrowRight className="h-3 w-3" aria-hidden="true" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <CourtDetailModal thing={selectedThing} isOpen={Boolean(selectedThing)} onClose={() => setSelectedThing(null)} />
    </>
  );
}
