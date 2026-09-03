import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { GripVertical } from "lucide-react";
import { gsap } from "gsap";
import { Observer } from "gsap/Observer";
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

gsap.registerPlugin(Observer);

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
  onViewAll?: (lane: CourtLaneId) => void;
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

// ─── Rotating deck / peel stack animation system ─────────────────────────────
// Active card: 0°, scale 1.0, elevated shadow 12
// Card 2 (depth 1): -1.2°, scale 0.98, shadow 6
// Card 3 (depth 2): +1.5°, scale 0.96, shadow 2
// Card 4 (depth 3): -0.7°, scale 0.94
//
// Scrolling down:
// 1. Current card lifts, tilts (-2deg), translates up (-84px), fades out
// 2. Card #2 straightens to 0°, scales to 1.0, shadow elevates to shadow 12
// 3. Card #3 rotates to -1.2°, scales to 0.98
// 4. A new card enters at back of stack
// Duration: 460 ms, scrubbed by GSAP's natural power3 easing.

type StackAnim = {
  outgoing: Thing;
  direction: 1 | -1;
};

function depthCardStyle(depth: number): CSSProperties {
  const overlap = depth * -6;
  const yBase = depth === 1 ? 166 + overlap : 238 + overlap;
  const inset = depth === 1 ? 4 : 8;

  return {
    left: inset,
    right: inset,
    transform: `translate3d(0, ${yBase}px, 0)`,
    opacity: 1,
  };
}

export const CourtLaneStack = forwardRef<CourtLaneStackHandle, CourtLaneStackProps>(
  function CourtLaneStack(
    { lane, things, myActorId, initialPosition, onOpen, onRefresh, onViewAll },
    ref,
  ) {
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
    const activeCardRef = useRef<HTMLDivElement | null>(null);
    const outgoingCardRef = useRef<HTMLDivElement | null>(null);
    const headingRef = useRef<HTMLHeadingElement | null>(null);
    const sectionRef = useRef<HTMLElement | null>(null);
    const animatingRef = useRef(false);
    const lastWheelTimeRef = useRef(0);

    useLayoutEffect(() => {
      return () => {
        gsap.killTweensOf(activeCardRef.current);
        gsap.killTweensOf(outgoingCardRef.current);
      };
    }, []);

    const content = courtLaneContent[lane];
    const renderIndex = reconcileStackIndex(activeIndex, activeThingIdRef.current, things);
    const activeThing = things[renderIndex] ?? null;
    const capabilities = activeThing
      ? getThingCapabilities(activeThing, myActorId)
      : { canCatch: false, canSetPace: false, canSort: false };
    const actionCapabilities = {
      canMoveLater: capabilities.canSetPace && lane !== "later",
    };
    useEffect(() => {
      setActiveIndex((prev) => {
        const next = reconcileStackIndex(prev, activeThingIdRef.current, things);
        activeThingIdRef.current = things[next]?.id ?? null;
        return next;
      });
    }, [things]);

    const startNavigation = useCallback(
      (direction: 1 | -1) => {
        if (!activeThing || things.length <= 1 || pendingAction || animatingRef.current) return;
        const nextIndex = stepStackIndex(renderIndex, things.length, direction);
        const nextThing = things[nextIndex];
        if (!nextThing) return;

        const reduceMotion =
          typeof window !== "undefined" &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        if (reduceMotion) {
          setActiveIndex(nextIndex);
          activeThingIdRef.current = nextThing.id;
          setAnnouncement(`Now viewing ${nextThing.title}.`);
          return;
        }

        animatingRef.current = true;
        setAnim({ outgoing: activeThing, direction });
        setActiveIndex(nextIndex);
        activeThingIdRef.current = nextThing.id;
        setAnnouncement(`Now viewing ${nextThing.title}.`);
      },
      [activeThing, pendingAction, renderIndex, things],
    );
    const startNavigationRef = useRef(startNavigation);

    useLayoutEffect(() => {
      startNavigationRef.current = startNavigation;
    }, [startNavigation]);

    useLayoutEffect(() => {
      if (!anim) return;
      const activeNode = activeCardRef.current;
      const outgoingNode = outgoingCardRef.current;
      if (!activeNode) return;

      const forward = anim.direction === 1;
      const context = gsap.context(() => {
        if (outgoingNode) {
          gsap.fromTo(
            outgoingNode,
            { y: 0, opacity: 1, scale: 1 },
            {
              y: forward ? -140 : 140,
              opacity: 0,
              scale: 0.96,
              duration: 0.28,
              ease: "power2.in",
            },
          );
        }

        gsap.fromTo(
          activeNode,
          {
            y: forward ? 70 : -70,
            opacity: 0.7,
            scale: 0.98,
          },
          {
            y: 0,
            opacity: 1,
            scale: 1,
            duration: 0.36,
            ease: "power3.out",
            onComplete: () => {
              animatingRef.current = false;
              lastWheelTimeRef.current = Date.now();
              gsap.set(activeNode, { clearProps: "transform,scale,opacity" });
              setAnim(null);
            },
          },
        );
      }, sectionRef);

      return () => {
        animatingRef.current = false;
        context.revert();
      };
    }, [anim]);

    // Keep page position fixed throughout trackpad momentum, including the
    // brief frame in which Observer is refreshed after the active Thing changes.
    useEffect(() => {
      const node = sectionRef.current;
      if (!node) return;

      const holdPage = (event: WheelEvent) => {
        if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) event.preventDefault();
      };

      node.addEventListener("wheel", holdPage, { capture: true, passive: false });
      return () => node.removeEventListener("wheel", holdPage, { capture: true });
    }, []);

    // GSAP Observer owns wheel intent inside a lane. preventDefault is applied to
    // every delta (including tiny trackpad momentum), so the Court page cannot
    // drift while a user is cycling the stack.
    useEffect(() => {
      const node = sectionRef.current;
      if (!node || things.length <= 1) return;

      const observer = Observer.create({
        target: node,
        type: "wheel",
        capture: true,
        preventDefault: true,
        lockAxis: true,
        tolerance: 14,
        wheelSpeed: 0.8,
        onChangeY: (self) => {
          const now = Date.now();
          if (
            animatingRef.current ||
            now - lastWheelTimeRef.current < 260 ||
            Math.abs(self.deltaY) < 14
          ) {
            return;
          }
          lastWheelTimeRef.current = now;
          startNavigationRef.current(self.deltaY > 0 ? 1 : -1);
        },
      });

      return () => observer.kill();
    }, [things.length]);

    const runAction = useCallback(
      async (action: CourtStackAction) => {
        if (!activeThing || pendingAction) return;
        if (action === "catch" && !capabilities.canCatch) return;
        if (action === "later" && !actionCapabilities.canMoveLater) return;
        if (action === "sort" && !capabilities.canSort) return;
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
      [
        activeThing,
        actionCapabilities.canMoveLater,
        capabilities.canCatch,
        capabilities.canSort,
        content.label,
        onRefresh,
        pendingAction,
      ],
    );

    const gesture = useStackGesture({
      canSort: capabilities.canSort,
      canMoveLater: actionCapabilities.canMoveLater,
      interactionDisabled: pendingAction !== null || anim !== null,
      onSort: () => void runAction("sort"),
      onLater: () => void runAction("later"),
      onBlockedAction: (action) => {
        if (action === "later") {
          if (lane === "later") {
            toast.info("This card is already in Later. Drag it or open Details to change its pace.");
          } else if (capabilities.canCatch) {
            toast.info("Catch this task before moving it to Later.");
          }
        } else if (action === "sort") {
          if (capabilities.canCatch) {
            toast.info("Catch this task before sorting.");
          }
        }
      },
      onStep: startNavigation,
    });
    // GSAP Observer exclusively owns wheel events. Pointer handlers below are
    // only for deliberate touch/mouse swipes after the gesture axis locks.
    const { onWheel: _wheelHandledByObserver, ...swipePointerProps } = gesture.gestureProps;

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
    const swipeDistance = Math.abs(gesture.offset.x);
    const swipeCommitted = swipeDistance >= 54;
    const swipeDirection = gesture.offset.x > 0 ? "sort" : gesture.offset.x < 0 ? "later" : null;
    return (
      <section
        ref={sectionRef}
        className={cn(
          "relative flex min-w-0 flex-col overflow-hidden rounded-[22px] border shadow-[0_18px_42px_-32px_rgba(15,23,42,0.34)] transition-colors",
          content.bgTone,
          content.borderTone,
        )}
        aria-labelledby={`court-${lane}-title`}
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
            const data = JSON.parse(raw) as {
              thingId: string;
              fromLane: CourtLaneId;
              title: string;
            };
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
              "absolute inset-0 z-40 flex flex-col items-center justify-center gap-2.5 rounded-2xl border-2 border-dashed transition-all pointer-events-none animate-in fade-in-50 duration-150",
              lane === "now"
                ? "border-red-400 bg-red-50/40 text-red-700"
                : lane === "next"
                  ? "border-blue-400 bg-blue-50/40 text-blue-700"
                  : "border-purple-400 bg-purple-50/40 text-purple-700",
            )}
          >
            <div className="flex items-center gap-2 rounded-xl bg-white/95 px-4 py-2.5 shadow-lg border border-border/70 backdrop-blur-sm">
              <KatalistIcon name={content.icon} className={cn("h-4 w-4 fill-current", content.tone)} />
              <span className="text-[13px] font-bold tracking-tight text-slate-800">
                Drop to pace as {content.label}
              </span>
            </div>
          </div>
        )}

        {/* Sticky lane header */}
        <div className="sticky top-0 z-20 flex items-center justify-between px-4 pt-3.5 pb-2 bg-inherit shrink-0">
          <div className="flex items-center gap-1.5">
            <span className={cn("text-base", content.tone)}>
              {lane === "now" ? "⚡" : lane === "next" ? "⇄" : "✦"}
            </span>
            <h2
              ref={headingRef}
              id={`court-${lane}-title`}
              tabIndex={-1}
              className={cn(
                "text-[13px] font-black tracking-wider uppercase outline-none focus-visible:ring-2 focus-visible:ring-ring",
                content.tone,
              )}
            >
              {content.label}
            </h2>
            <span
              className={cn(
                "inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full text-[10px] font-bold",
                lane === "now"
                  ? "bg-red-500 text-white"
                  : lane === "next"
                    ? "bg-blue-100 text-blue-700"
                    : "bg-purple-100 text-purple-700",
              )}
            >
              {things.length}
            </span>
          </div>
          <div className="text-right">
            <button
              type="button"
              onClick={() => onViewAll?.(lane)}
              className="inline-flex items-center text-[10.5px] font-semibold text-slate-700 hover:text-foreground cursor-pointer transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring rounded px-1"
              aria-label={`View all ${things.length} in ${content.label}`}
            >
              View all <KatalistIcon name="chevron-right" className="h-3 w-3 ml-0.5" />
            </button>
          </div>
        </div>

        {activeThing ? (
          <div className="flex-1 px-3.5 pb-2.5 pt-2.5 space-y-1">
            {/* Stack arena */}
            <div
              className="relative pb-[140px]"
              onKeyDown={onKeyDown}
              style={{ perspective: "1000px", perspectiveOrigin: "50% 0%" }}
            >
              {/* Background depth cards (Card 3, Card 2) */}
              {Array.from({ length: depthCount }, (_, i) => {
                const depth = depthCount - i;
                const targetIndex = (renderIndex + depth) % things.length;
                const depthThing = things[targetIndex];
                const depthShadow =
                  depth === 1
                    ? "shadow-[0_6px_16px_-3px_rgba(0,0,0,0.08),0_2px_6px_-2px_rgba(0,0,0,0.04)]"
                    : "shadow-[0_2px_8px_-1px_rgba(0,0,0,0.05)]";

                return (
                  <div
                    key={`depth-${depth}-${depthThing?.id ?? i}`}
                    aria-hidden="true"
                    onClick={() => startNavigation(1)}
                    className={cn(
                      "pointer-events-auto absolute top-0 h-[74px] rounded-[15px] border bg-white overflow-hidden select-none cursor-pointer will-change-transform motion-reduce:!transform-none motion-reduce:!opacity-100",
                      lane === "now"
                        ? "border-red-200/90 hover:border-red-300"
                        : lane === "next"
                          ? "border-blue-200/90 hover:border-blue-300"
                          : "border-purple-200/90 hover:border-purple-300",
                      depthShadow,
                    )}
                    style={{
                      zIndex: depth === 1 ? 10 : 5,
                      ...depthCardStyle(depth),
                    }}
                  >
                    {/* Real compact cards remain readable behind the hero card. */}
                    {depthThing && (
                      <div className="px-3 py-2">
                        <div className="grid grid-cols-[24px_minmax(0,1fr)_16px] items-start gap-x-2.5">
                          <PersonAvatar
                            name={depthThing.assignee.name}
                            initials={depthThing.assignee.initials}
                            src={depthThing.assignee.avatarUrl}
                            size={24}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="line-clamp-2 text-[12.5px] font-bold leading-[1.25] text-slate-800">
                              {depthThing.title}
                            </p>
                            <div className="mt-1 flex items-center gap-2 text-[10px]">
                              <span
                                className={cn(
                                  depthThing.dueAt
                                    ? "font-semibold text-red-500"
                                    : "text-slate-400",
                                )}
                              >
                                {depthThing.dueAt
                                  ? `Due ${formatCourtDue(depthThing).label}`
                                  : "No due date"}
                              </span>
                              <span
                                className={cn(
                                  depthThing.workStatus === "under_progress"
                                    ? "text-blue-600"
                                    : "text-slate-400",
                                )}
                              >
                                {depthThing.workStatus === "under_progress"
                                  ? "Under Progress"
                                  : "Not Started"}
                              </span>
                            </div>
                          </div>
                          <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Horizontal motion uncovers the action behind the card. */}
              {swipeDirection ? (
                <div
                  aria-hidden="true"
                  className={cn(
                    "pointer-events-none absolute inset-x-0 top-0 z-[19] h-[168px] overflow-hidden rounded-2xl",
                    swipeDirection === "sort"
                      ? capabilities.canSort
                        ? "bg-emerald-500"
                        : "bg-slate-400"
                      : actionCapabilities.canMoveLater
                        ? "bg-violet-500"
                        : lane === "later"
                          ? "bg-purple-900/80"
                          : "bg-slate-400",
                  )}
                >
                  <div
                    className={cn(
                      "absolute inset-y-0 flex w-[112px] items-center justify-center",
                      swipeDirection === "sort" ? "left-0" : "right-0",
                    )}
                  >
                    <div className="flex flex-col items-center gap-1.5 text-center text-white">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
                        <KatalistIcon
                          name={
                            swipeDirection === "sort"
                              ? "sorted"
                              : lane === "later"
                                ? "clock-time"
                                : capabilities.canCatch
                                  ? "catch"
                                  : "snooze"
                          }
                          className="h-4 w-4"
                        />
                      </span>
                      <span className="text-[11px] font-bold tracking-tight">
                        {swipeDirection === "sort"
                          ? capabilities.canSort
                            ? swipeCommitted
                              ? "Release to sort"
                              : "Sorted"
                            : capabilities.canCatch
                              ? "Catch first"
                              : "Unavailable"
                          : actionCapabilities.canMoveLater
                            ? swipeCommitted
                              ? "Release for Later"
                              : "Later"
                            : lane === "later"
                              ? "Already in Later"
                              : capabilities.canCatch
                                ? "Catch first"
                                : "Unavailable"}
                      </span>
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Active card stays level during both scroll and swipe. */}
              <div
                ref={activeCardRef}
                {...swipePointerProps}
                className={cn(
                  "relative z-20 h-[168px] touch-pan-y select-none will-change-transform motion-reduce:!transform-none motion-reduce:transition-none",
                  !gesture.dragging &&
                    !anim &&
                    "transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                )}
                style={{
                  transformOrigin: "50% 50%",
                  transform: `translate3d(${gesture.offset.x}px, 0, 0)`,
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

              {/* Outgoing card animating out during scroll navigation */}
              {anim?.outgoing ? (
                <div
                  ref={outgoingCardRef}
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 top-0 z-30 h-[168px] overflow-hidden select-none will-change-transform motion-reduce:hidden"
                >
                  <ThingStackCard
                    thing={anim.outgoing}
                    lane={lane}
                    myActorId={myActorId}
                    pendingAction={null}
                    suppressClickRef={{ current: true }}
                    onOpen={() => {}}
                    onAction={() => {}}
                  />
                </div>
              ) : null}
            </div>

            {/* Deck indicator */}
            {things.length > 1 ? (
              <div className="flex flex-col items-center pt-0.5">
                <button
                  type="button"
                  onClick={() => startNavigation(1)}
                  className={cn(
                    "group inline-flex items-center gap-1 px-2 py-1 text-[11px] font-bold transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring rounded",
                    content.tone,
                  )}
                  aria-label={`${things.length - 1} more Things in ${content.label}. Click to cycle.`}
                >
                  <span className="text-[14px] leading-none">+</span>
                  <span>{things.length - 1} more</span>
                  <KatalistIcon
                    name="chevron-down"
                    className="h-3 w-3 transition-transform group-hover:translate-y-0.5"
                  />
                </button>
              </div>
            ) : null}
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
