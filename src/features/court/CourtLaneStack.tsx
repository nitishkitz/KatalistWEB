import { ArrowUp } from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { toast } from "sonner";

import { getThingCapabilities } from "@/domain/capabilities";
import type { Thing } from "@/domain/thing";
import { rpcCatchThing, rpcSetPersonalPace, rpcSortThing } from "@/features/things/rpc";
import { domainErrorMessage } from "@/lib/domain-error";
import { cn } from "@/lib/utils";
import { reconcileStackIndex, stepStackIndex } from "./court-stack-model";
import { formatCourtDue, type CourtLaneId } from "./court-view-model";
import { KatalistIcon, type KatalistIconName } from "./KatalistIcon";
import { ThingStackCard, type CourtStackAction } from "./ThingStackCard";
import { useStackGesture } from "./use-stack-gesture";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";

export type CourtLaneStackHandle = {
  getPosition: () => { activeIndex: number; activeThingId: string | null };
  focusThing: (thingId: string | null) => void;
};

export type CourtLaneStackProps = {
  lane: CourtLaneId;
  things: Thing[];
  myActorId: string | null;
  initialPosition?: { activeIndex: number; activeThingId: string | null };
  onOpen: (thing: Thing, origin: HTMLElement) => void;
  onRefresh: () => unknown;
};

export const courtLaneContent: Record<
  CourtLaneId,
  {
    label: string;
    descriptor: string;
    icon: KatalistIconName;
    tone: string;
    headerTone: string;
    bgTone: string;
    borderTone: string;
  }
> = {
  now: {
    label: "NOW",
    descriptor: "Needs you now",
    icon: "now-smash",
    tone: "text-status-now",
    headerTone: "bg-transparent",
    bgTone: "bg-[#fff8f7]",
    borderTone: "border-red-100/70",
  },
  next: {
    label: "NEXT",
    descriptor: "On deck soon",
    icon: "next-rally",
    tone: "text-status-next",
    headerTone: "bg-transparent",
    bgTone: "bg-[#f4f8ff]",
    borderTone: "border-blue-100/70",
  },
  later: {
    label: "LATER",
    descriptor: "When time opens up",
    icon: "later-lob",
    tone: "text-status-later",
    headerTone: "bg-transparent",
    bgTone: "bg-[#f9f7ff]",
    borderTone: "border-purple-100/70",
  },
};

// ─── Cinematic animation system ───────────────────────────────────────────────
//
// 3 phases per navigation:
//   "idle"  → positions SET, no CSS transition yet (one double-RAF paint)
//   "exit"  → outgoing card flies out; incoming hides below/above
//   "enter" → incoming card springs in with overshoot spring curve
//
type AnimPhase = "idle" | "exit" | "enter";

type StackAnim = {
  outgoing: Thing;
  direction: 1 | -1; // 1 = next (forward), -1 = previous (backward)
  phase: AnimPhase;
};

function outgoingStyle(anim: StackAnim): CSSProperties {
  if (anim.phase === "idle") {
    return { opacity: 1, transform: "translate3d(0,0,0) scale(1)", filter: "blur(0px)" };
  }
  const yOut = anim.direction === 1 ? -120 : 120;
  return {
    opacity: 0,
    transform: `translate3d(0, ${yOut}px, 0) scale(0.84)`,
    filter: "blur(4px)",
    pointerEvents: "none",
  };
}

function incomingStyle(anim: StackAnim | null, offset: { x: number; y: number }): CSSProperties {
  if (!anim) return { transform: `translate3d(${offset.x}px, ${offset.y}px, 0)` };
  if (anim.phase === "idle" || anim.phase === "exit") {
    const yStart = anim.direction === 1 ? 88 : -88;
    return {
      opacity: 0,
      transform: `translate3d(0, ${yStart}px, 0) scale(0.9)`,
      filter: "blur(3px)",
    };
  }
  return { opacity: 1, transform: "translate3d(0, 0, 0) scale(1)", filter: "blur(0px)" };
}

function depthCardStyle(depth: number, animating: boolean): CSSProperties {
  const yBase = depth * -6;
  const scaleBase = 1 - depth * 0.018;
  return {
    transform: animating
      ? `translateY(${yBase + 3}px) scale(${scaleBase + 0.006})`
      : `translateY(${yBase}px) scale(${scaleBase})`,
    opacity: animating ? 1 - depth * 0.14 : 1 - depth * 0.18,
    transition: "transform 440ms cubic-bezier(0.34,1.56,0.64,1), opacity 320ms ease",
  };
}

export const CourtLaneStack = forwardRef<CourtLaneStackHandle, CourtLaneStackProps>(
  function CourtLaneStack({ lane, things, myActorId, initialPosition, onOpen, onRefresh }, ref) {
    const initialIndex = reconcileStackIndex(
      initialPosition?.activeIndex ?? 0,
      initialPosition?.activeThingId ?? null,
      things,
    );
    const [activeIndex, setActiveIndex] = useState(initialIndex);
    const [pendingAction, setPendingAction] = useState<CourtStackAction | null>(null);
    const [announcement, setAnnouncement] = useState("");
    const [anim, setAnim] = useState<StackAnim | null>(null);
    const [isDragTarget, setIsDragTarget] = useState(false);
    const activeThingIdRef = useRef<string | null>(things[initialIndex]?.id ?? null);
    const activeButtonRef = useRef<HTMLButtonElement | null>(null);
    const headingRef = useRef<HTMLHeadingElement | null>(null);
    const rafRef = useRef<number | null>(null);
    const wheelThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const content = courtLaneContent[lane];
    const renderIndex = reconcileStackIndex(activeIndex, activeThingIdRef.current, things);
    const activeThing = things[renderIndex] ?? null;
    const capabilities = activeThing
      ? getThingCapabilities(activeThing, myActorId)
      : { canCatch: false, canSetPace: false, canSort: false };

    useEffect(() => {
      setActiveIndex((prev) => {
        const next = reconcileStackIndex(prev, activeThingIdRef.current, things);
        activeThingIdRef.current = things[next]?.id ?? null;
        return next;
      });
    }, [things]);

    useEffect(
      () => () => {
        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
        if (wheelThrottleRef.current !== null) clearTimeout(wheelThrottleRef.current);
      },
      [],
    );

    const startNavigation = useCallback(
      (direction: 1 | -1) => {
        if (!activeThing || things.length <= 1 || pendingAction) return;
        const nextIndex = stepStackIndex(renderIndex, things.length, direction);
        const nextThing = things[nextIndex];

        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);

        // Phase 1: set start positions (no transition)
        setAnim({ outgoing: activeThing, direction, phase: "idle" });

        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = requestAnimationFrame(() => {
            setActiveIndex(nextIndex);
            activeThingIdRef.current = nextThing.id;
            setAnnouncement(`Now viewing ${nextThing.title}.`);
            // Phase 2: outgoing exits
            setAnim({ outgoing: activeThing, direction, phase: "exit" });

            // Phase 3: incoming springs in
            rafRef.current = requestAnimationFrame(() => {
              rafRef.current = requestAnimationFrame(() => {
                setAnim((cur) => (cur ? { ...cur, phase: "enter" } : null));
              });
            });
          });
        });
      },
      [activeThing, pendingAction, renderIndex, things],
    );

    // Scroll wheel → card navigation (one card per 600ms throttle window)
    const handleWheel = useCallback(
      (e: React.WheelEvent<HTMLElement>) => {
        if (things.length <= 1) return;
        e.preventDefault();
        e.stopPropagation();
        if (wheelThrottleRef.current !== null) return; // mid-animation, ignore
        const direction: 1 | -1 = e.deltaY > 0 ? 1 : -1;
        startNavigation(direction);
        wheelThrottleRef.current = setTimeout(() => {
          wheelThrottleRef.current = null;
        }, 600);
      },
      [things.length, startNavigation],
    );

    const runAction = useCallback(
      async (action: CourtStackAction) => {
        if (!activeThing || pendingAction) return;
        setPendingAction(action);
        try {
          if (action === "catch") await rpcCatchThing(activeThing.id);
          if (action === "later") await rpcSetPersonalPace(activeThing.id, "later");
          if (action === "sort") await rpcSortThing(activeThing.id);
          toast.success(
            action === "catch" ? "Caught." : action === "later" ? "Snoozed." : "Nicely sorted.",
          );
          await onRefresh();
          setAnnouncement(`${activeThing.title} updated in ${content.label}.`);
        } catch (error) {
          toast.error(domainErrorMessage(error));
        } finally {
          setPendingAction(null);
        }
      },
      [activeThing, content.label, onRefresh, pendingAction],
    );

    const gesture = useStackGesture({
      canSort: capabilities.canSort,
      canMoveLater: capabilities.canSetPace && lane !== "later",
      horizontalDisabled: capabilities.canCatch,
      interactionDisabled: pendingAction !== null,
      onSort: () => void runAction("sort"),
      onLater: () => void runAction("later"),
      onStep: startNavigation,
    });

    useImperativeHandle(
      ref,
      () => ({
        getPosition: () => ({ activeIndex: renderIndex, activeThingId: activeThing?.id ?? null }),
        focusThing: (thingId) => {
          const nextIndex = reconcileStackIndex(renderIndex, thingId, things);
          setActiveIndex(nextIndex);
          activeThingIdRef.current = things[nextIndex]?.id ?? null;
          requestAnimationFrame(() => {
            (activeButtonRef.current ?? headingRef.current)?.focus();
          });
        },
      }),
      [activeThing?.id, renderIndex, things],
    );

    const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      startNavigation(event.key === "ArrowDown" ? 1 : -1);
    };

    const depthCount = Math.min(2, Math.max(0, things.length - 1));
    const isAnimating = anim !== null;

    return (
      <section
        className={cn(
          "relative flex min-w-0 flex-col overflow-hidden rounded-2xl border shadow-xs transition-colors",
          content.bgTone,
          content.borderTone,
        )}
        aria-labelledby={`court-${lane}-title`}
        onWheel={handleWheel}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("application/katalist-thing")) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (!isDragTarget) setIsDragTarget(true);
          }
        }}
        onDragEnter={(e) => {
          if (e.dataTransfer.types.includes("application/katalist-thing")) {
            e.preventDefault();
            setIsDragTarget(true);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setIsDragTarget(false);
          }
        }}
        onDrop={async (e) => {
          e.preventDefault();
          setIsDragTarget(false);
          try {
            const raw = e.dataTransfer.getData("application/katalist-thing");
            if (!raw) return;
            const data = JSON.parse(raw) as { thingId: string; fromLane: CourtLaneId; title: string };
            if (data.fromLane === lane) return;

            await rpcSetPersonalPace(data.thingId, lane);
            toast.success(`Moved "${data.title}" to ${content.label}`);
            await onRefresh();
          } catch (err: any) {
            toast.error(domainErrorMessage(err));
          }
        }}
      >
        {isDragTarget && (
          <div
            className={cn(
              "absolute inset-0 z-40 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed backdrop-blur-xs transition-all pointer-events-none animate-in fade-in-50 duration-150",
              lane === "now"
                ? "border-red-400 bg-red-50/90 text-red-700"
                : lane === "next"
                  ? "border-blue-400 bg-blue-50/90 text-blue-700"
                  : "border-purple-400 bg-purple-50/90 text-purple-700",
            )}
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white shadow-sm border border-border/40">
              <KatalistIcon name={content.icon} className="h-5 w-5 fill-current" />
            </div>
            <span className="text-[13px] font-bold tracking-tight">
              Drop to pace as {content.label}
            </span>
          </div>
        )}

        <div className="flex items-center justify-between px-3.5 pt-2.5 pb-1.5 shrink-0">
          <div className="flex items-center gap-1.5">
            <span className={cn("text-base", content.tone)}>⚡</span>
            <h2
              ref={headingRef}
              id={`court-${lane}-title`}
              tabIndex={-1}
              className={cn(
                "text-[13.5px] font-black tracking-wider uppercase outline-none focus-visible:ring-2 focus-visible:ring-ring",
                content.tone,
              )}
            >
              {content.label}
            </h2>
            <span className={cn("text-[13px] font-bold ml-1", content.tone)}>{things.length}</span>
          </div>
          <div className="text-right">
            <span className="flex items-center justify-end text-[10.5px] font-semibold text-slate-700 hover:text-foreground cursor-pointer transition-colors">
              View all <KatalistIcon name="chevron-right" className="h-3 w-3 ml-0.5" />
            </span>
          </div>
        </div>

        {activeThing ? (
          <div className="flex-1 px-3 pb-3 pt-1 space-y-2.5">
            {/* Stack arena */}
            <div
              className="relative"
              onKeyDown={onKeyDown}
              style={{ perspective: "1000px", perspectiveOrigin: "50% 0%" }}
            >
              {/* Background depth cards */}
              {Array.from({ length: depthCount }, (_, i) => {
                const depth = depthCount - i;
                return (
                  <div
                    key={depth}
                    aria-hidden="true"
                    className={cn(
                      "pointer-events-none absolute inset-x-2 top-0 min-h-[145px] rounded-2xl border bg-white/60 shadow-2xs",
                      lane === "now"
                        ? "border-red-100/80"
                        : lane === "next"
                          ? "border-blue-100/80"
                          : "border-purple-100/80",
                    )}
                    style={depthCardStyle(depth, isAnimating)}
                  />
                );
              })}

              {/* Outgoing card ghost */}
              {anim && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 top-0 z-30"
                  style={{
                    willChange: "transform, opacity, filter",
                    transition:
                      anim.phase === "idle"
                        ? "none"
                        : "transform 340ms cubic-bezier(0.55,0,0.45,1), opacity 300ms ease, filter 300ms ease",
                    ...outgoingStyle(anim),
                  }}
                >
                  <div className="min-h-[145px] rounded-2xl border border-border bg-white px-4 pt-4 shadow-sm">
                    <span className="block line-clamp-2 text-[14.5px] font-bold leading-snug text-foreground">
                      {anim.outgoing.title}
                    </span>
                  </div>
                </div>
              )}

              {/* Gesture hint overlays */}
              {gesture.dragging && gesture.offset.x < -8 && capabilities.canSetPace && lane !== "later" && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 z-[15] flex min-h-[145px] items-center justify-end rounded-2xl bg-status-later/95 px-5 transition-opacity duration-150"
                  style={{ opacity: Math.min(1, Math.abs(gesture.offset.x) / 72) }}
                >
                  <div className="flex flex-col items-center gap-1 text-white">
                    <KatalistIcon name="arrow-left" className="h-5 w-5" />
                    <span className="text-[12px] font-semibold">Later</span>
                    <span className="text-[9.5px] opacity-80">Moves to LATER</span>
                  </div>
                </div>
              )}
              {gesture.dragging && gesture.offset.x > 8 && capabilities.canSort && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 z-[15] flex min-h-[145px] items-center justify-start rounded-2xl bg-emerald-500/95 px-5 transition-opacity duration-150"
                  style={{ opacity: Math.min(1, Math.abs(gesture.offset.x) / 72) }}
                >
                  <div className="flex flex-col items-center gap-1 text-white">
                    <KatalistIcon name="arrow-right" className="h-5 w-5" />
                    <span className="text-[12px] font-semibold">Sorted</span>
                    <span className="text-[9.5px] opacity-80">Move to DONE</span>
                  </div>
                </div>
              )}

              {/* Incoming / active card — spring up from stack depth */}
              <div
                {...gesture.gestureProps}
                className={cn(
                  "relative z-20 touch-pan-y select-none motion-reduce:!transform-none motion-reduce:!opacity-100 motion-reduce:transition-none",
                  gesture.dragging && "transition-none",
                )}
                style={{
                  willChange: "transform, opacity, filter",
                  transition: gesture.dragging
                    ? "none"
                    : anim?.phase === "enter"
                      ? "transform 520ms cubic-bezier(0.34,1.56,0.64,1), opacity 400ms ease, filter 400ms ease"
                      : anim?.phase === "exit" || anim?.phase === "idle"
                        ? "none"
                        : "transform 240ms cubic-bezier(0.2,0.8,0.2,1), opacity 200ms ease",
                  ...incomingStyle(anim, gesture.offset),
                }}
                onTransitionEnd={(e) => {
                  if (e.target === e.currentTarget && anim?.phase === "enter") {
                    setAnim(null);
                  }
                }}
              >
                <ThingStackCard
                  ref={activeButtonRef}
                  thing={activeThing}
                  lane={lane}
                  myActorId={myActorId}
                  pendingAction={pendingAction}
                  suppressClickRef={gesture.suppressClickRef}
                  onOpen={onOpen}
                  onAction={(action) => void runAction(action)}
                />
              </div>
            </div>

            {/* Subsequent cards list */}
            {things.length > 1 && (
              <div className="space-y-2 pt-0.5">
                {things
                  .filter((_, index) => index !== renderIndex)
                  .slice(0, 2)
                  .map((thingItem) => {
                    const due = formatCourtDue(thingItem);
                    const isProgress = thingItem.workStatus === "under_progress";
                    const isWaiting = thingItem.acknowledgement === "waiting_for_catch";
                    const canPaceItem = getThingCapabilities(thingItem, myActorId).canSetPace;
                    return (
                      <div
                        key={thingItem.id}
                        draggable={canPaceItem}
                        onDragStart={(e) => {
                          e.dataTransfer.setData(
                            "application/katalist-thing",
                            JSON.stringify({ thingId: thingItem.id, fromLane: lane, title: thingItem.title }),
                          );
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onClick={(e) => onOpen(thingItem, e.currentTarget)}
                        className={cn(
                          "group flex items-center justify-between gap-3 rounded-xl border bg-white/90 hover:bg-white p-3 text-left shadow-2xs transition-all duration-150 hover:shadow-xs cursor-pointer",
                          canPaceItem && "cursor-grab active:cursor-grabbing",
                          lane === "now"
                            ? "border-red-100/80 hover:border-red-200"
                            : lane === "next"
                              ? "border-blue-100/80 hover:border-blue-200"
                              : "border-purple-100/80 hover:border-purple-200",
                        )}
                      >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <PersonAvatar
                            name={thingItem.assignee.name}
                            initials={thingItem.assignee.initials}
                            src={thingItem.assignee.avatarUrl}
                            size={24}
                          />
                          <div className="min-w-0 flex-1">
                            <span className="block truncate text-[12.5px] font-bold text-slate-900 group-hover:text-primary transition-colors">
                              {thingItem.title}
                            </span>
                            <div className="mt-0.5 flex items-center gap-1.5 text-[10px]">
                              {due.label && due.label !== "No due date" ? (
                                <span className={cn("font-semibold", due.urgent ? "text-red-600" : "text-slate-500")}>
                                  Due {due.label}
                                </span>
                              ) : (
                                <span className="text-slate-400">No due date</span>
                              )}
                              <span className="text-slate-200">·</span>
                              <span
                                className={cn(
                                  "font-medium",
                                  isWaiting ? "text-orange-500 font-semibold" : isProgress ? "text-blue-600" : "text-slate-400",
                                )}
                              >
                                {isWaiting ? "Waiting for Catch" : isProgress ? "Under Progress" : "Not Started"}
                              </span>
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const idx = things.findIndex((t) => t.id === thingItem.id);
                            if (idx >= 0) {
                              startNavigation(idx > renderIndex ? 1 : -1);
                              setActiveIndex(idx);
                              activeThingIdRef.current = thingItem.id;
                            }
                          }}
                          title="Bring to top"
                          className="shrink-0 p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors opacity-0 group-hover:opacity-100"
                          aria-label="Bring to top of stack"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                {things.length > 3 && (
                  <button
                    type="button"
                    onClick={() => startNavigation(1)}
                    className="flex w-full items-center justify-center gap-1 pt-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900 outline-none transition-colors cursor-pointer"
                  >
                    <KatalistIcon name="chevron-down" className="h-3 w-3" />
                    Scroll for more
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex min-h-[160px] items-center justify-center px-3 text-center text-[11px] text-muted-foreground">
            No Things match this view.
          </div>
        )}

        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {announcement}
        </div>
      </section>
    );
  },
);
