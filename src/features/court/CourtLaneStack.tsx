import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { gsap } from "gsap";
import { Observer } from "gsap/Observer";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

import { getThingCapabilities } from "@/domain/capabilities";
import type { Thing } from "@/domain/thing";
import { rpcCatchAndStart, rpcSetPersonalPace, rpcSnoozeThing, rpcSortThing } from "@/features/things/rpc";
import {
  invalidateSnoozeSurfaces,
  snoozeUntilFor,
  SNOOZE_OPTIONS,
  type SnoozeOption,
} from "@/features/things/personal-snooze";
import { domainErrorMessage } from "@/lib/domain-error";
import { cn } from "@/lib/utils";
import { reconcileStackIndex, stepStackIndex } from "./court-stack-model";
import { formatCourtDue, type CourtLaneId } from "./court-view-model";
import { KatalistIcon, type KatalistIconName } from "./KatalistIcon";
import { ThingStackCard, type CourtStackAction } from "./ThingStackCard";
import { useStackGesture } from "./use-stack-gesture";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { useAvatarUrl } from "@/features/people/directory";

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
    /** Exact Figma accent (headers, counts). */
    accent: string;
    /** Exact Figma colored icon-box background. */
    iconBoxBg: string;
    /** Exact Figma lane gradient background. */
    gradient: string;
  }
> = {
  now: {
    label: "NOW",
    descriptor: "Things to handle now",
    icon: "now-smash",
    tone: "text-status-now",
    headerTone: "bg-transparent",
    bgTone: "bg-[#fff8f7]",
    borderTone: "border-[#fdecec]",
    accent: "#fe1016",
    iconBoxBg: "#fd4946",
    gradient: "linear-gradient(180deg,#fef1f4 0%,#fffbfd 100%)",
  },
  next: {
    label: "NEXT",
    descriptor: "Up next on your plate",
    icon: "next-rally",
    tone: "text-status-next",
    headerTone: "bg-transparent",
    bgTone: "bg-[#f4f8ff]",
    borderTone: "border-[#e3f0fd]",
    accent: "#0b62f8",
    iconBoxBg: "#005dfe",
    gradient: "linear-gradient(180deg,#e7f2fe 0%,rgba(238,246,254,0.35) 100%)",
  },
  later: {
    label: "LATER",
    descriptor: "For later consideration",
    icon: "later-lob",
    tone: "text-status-later",
    headerTone: "bg-transparent",
    bgTone: "bg-[#f9f7ff]",
    borderTone: "border-[#efeafe]",
    accent: "#641dfb",
    iconBoxBg: "#7c33fd",
    gradient: "linear-gradient(180deg,#efebfe 0%,rgba(244,243,255,0.35) 100%)",
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

function PeekQueueCard({
  thing,
  lane,
  onOpen,
}: {
  thing: Thing;
  lane: CourtLaneId;
  onOpen: () => void;
}) {
  const assigneeAvatar = useAvatarUrl(thing.assignee.name, null, thing.assignee.avatarUrl);
  const due = formatCourtDue(thing);

  return (
    <div
      onClick={onOpen}
      draggable={true}
      onDragStart={(e) => {
        e.dataTransfer.setData(
          "application/katalist-thing",
          JSON.stringify({ thingId: thing.id, fromLane: lane, title: thing.title }),
        );
        e.dataTransfer.setData(
          "text/plain",
          JSON.stringify({ thingId: thing.id, fromLane: lane, title: thing.title }),
        );
        e.dataTransfer.effectAllowed = "copyMove";
      }}
      className="group/queue flex flex-col justify-center rounded-xl border border-slate-200/80 bg-white px-3.5 py-2 shadow-2xs cursor-pointer transition-all hover:border-slate-300 hover:shadow-xs select-none min-h-[58px] h-[58px]"
      title={`Jump to ${thing.title}`}
    >
      <div className="flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-1.5 min-w-0">
          <PersonAvatar
            name={thing.assignee.name}
            initials={thing.assignee.initials}
            src={assigneeAvatar}
            size={20}
          />
          <span className="font-medium text-slate-800 text-[11.5px] truncate">
            {thing.assignee.name.split(" ")[0]}
          </span>
        </div>
        {thing.dueAt && (
          <span
            className={cn(
              "shrink-0 text-[11px] font-bold",
              due.urgent
                ? "text-red-500"
                : lane === "now"
                  ? "text-red-500"
                  : lane === "next"
                    ? "text-blue-500"
                    : "text-slate-500",
            )}
          >
            {due.label}
          </span>
        )}
      </div>
      <p className="mt-0.5 text-[12.5px] font-medium text-slate-900 truncate leading-tight">
        {thing.title}
      </p>
    </div>
  );
}

export const CourtLaneStack = forwardRef<CourtLaneStackHandle, CourtLaneStackProps>(
  function CourtLaneStack(
    { lane, things: allThings, myActorId, initialPosition, onOpen, onRefresh, onViewAll },
    ref,
  ) {
    const qc = useQueryClient();
    // Optimistic removal: when a card is sorted / paced-later / snoozed we hide it
    // instantly and run the RPC in the background, so the stack never freezes while
    // waiting on the network. If the RPC fails we drop the id and the card returns.
    const [removedIds, setRemovedIds] = useState<Set<string>>(() => new Set<string>());
    const inFlightRef = useRef<Set<string>>(new Set());
    const things = useMemo(
      () => (removedIds.size ? allThings.filter((t) => !removedIds.has(t.id)) : allThings),
      [allThings, removedIds],
    );

    // Once the server refetch confirms a removal (or the thing never existed),
    // drop it from the optimistic set so it cannot grow unbounded. A rolled-back
    // failure is unaffected because the thing is still present in allThings.
    useEffect(() => {
      setRemovedIds((prev) => {
        if (!prev.size) return prev;
        const next = new Set([...prev].filter((id) => allThings.some((t) => t.id === id)));
        return next.size === prev.size ? prev : next;
      });
    }, [allThings]);

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
    const [snoozeOpen, setSnoozeOpen] = useState(false);
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
    // Swipe-left now defers via a timed Snooze (June BRD v1.1). It is available
    // for any card in the person's own Court, regardless of lane.
    const canSnooze = Boolean(activeThing);
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

    const navigateToIndex = useCallback(
      (targetIndex: number) => {
        if (!activeThing || things.length <= 1 || pendingAction || animatingRef.current) return;
        const nextIndex = ((targetIndex % things.length) + things.length) % things.length;
        const nextThing = things[nextIndex];
        if (!nextThing || nextIndex === renderIndex) return;

        const reduceMotion =
          typeof window !== "undefined" &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        if (reduceMotion) {
          setActiveIndex(nextIndex);
          activeThingIdRef.current = nextThing.id;
          setAnnouncement(`Now viewing ${nextThing.title}.`);
          return;
        }

        const direction: 1 | -1 = targetIndex > renderIndex ? 1 : -1;
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

    // Hide a card immediately, then reconcile with the server in the background.
    // On failure the card is restored so nothing is silently lost.
    const runOptimisticRemoval = useCallback(
      async (thing: Thing, label: string, mutate: () => Promise<unknown>) => {
        if (inFlightRef.current.has(thing.id)) return;
        inFlightRef.current.add(thing.id);
        setRemovedIds((prev) => {
          const next = new Set(prev);
          next.add(thing.id);
          return next;
        });
        setAnnouncement(`${thing.title} ${label}.`);
        try {
          await mutate();
          await onRefresh();
        } catch (error) {
          // Roll back — the card slides back into the stack.
          setRemovedIds((prev) => {
            if (!prev.has(thing.id)) return prev;
            const next = new Set(prev);
            next.delete(thing.id);
            return next;
          });
          toast.error(domainErrorMessage(error));
        } finally {
          inFlightRef.current.delete(thing.id);
        }
      },
      [onRefresh],
    );

    const runAction = useCallback(
      async (action: CourtStackAction) => {
        if (!activeThing) return;
        if (action === "catch" && !capabilities.canCatch) return;
        if (action === "later" && !actionCapabilities.canMoveLater) return;
        if (action === "sort" && !capabilities.canSort) return;

        // Sort and pace-later remove the card from this lane — do them optimistically.
        if (action === "later") {
          const target = activeThing;
          void runOptimisticRemoval(target, "snoozed", async () => {
            await rpcSetPersonalPace(target.id, "later");
            toast.success("Snoozed.");
          });
          return;
        }
        if (action === "sort") {
          const target = activeThing;
          void runOptimisticRemoval(target, `sorted in ${content.label}`, async () => {
            await rpcSortThing(target.id);
            toast.success("Nicely sorted.");
          });
          return;
        }

        // Catch keeps the card in place, so keep the blocking pending state.
        if (pendingAction) return;
        setPendingAction(action);
        try {
          await rpcCatchAndStart(activeThing.id);
          toast.success("Caught.");
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
        runOptimisticRemoval,
      ],
    );

    const runSnooze = useCallback(
      (option: SnoozeOption) => {
        if (!activeThing) return;
        const target = activeThing;
        setSnoozeOpen(false);
        const label =
          option === "1h"
            ? "Snoozed for 1 hour."
            : option === "6h"
              ? "Snoozed for 6 hours."
              : "Snoozed until tomorrow, 9 AM.";
        void runOptimisticRemoval(target, "snoozed", async () => {
          await rpcSnoozeThing(target.id, snoozeUntilFor(option));
          toast.success(label);
          await invalidateSnoozeSurfaces(qc);
        });
      },
      [activeThing, qc, runOptimisticRemoval],
    );

    // Close the snooze menu whenever the active card changes.
    useEffect(() => {
      setSnoozeOpen(false);
    }, [activeThing?.id]);

    const gesture = useStackGesture({
      canSort: capabilities.canSort,
      canMoveLater: canSnooze,
      interactionDisabled: pendingAction !== null || anim !== null || snoozeOpen,
      onSort: () => void runAction("sort"),
      onLater: () => setSnoozeOpen(true),
      onBlockedAction: (action) => {
        if (action === "sort") {
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

    const depthCount = Math.min(6, Math.max(0, things.length - 1));
    const swipeDistance = Math.abs(gesture.offset.x);
    const swipeCommitted = swipeDistance >= 54;
    const swipeDirection = gesture.offset.x > 0 ? "sort" : gesture.offset.x < 0 ? "later" : null;
    return (
      <section
        ref={sectionRef}
        className={cn(
          "relative flex min-w-0 flex-col overflow-hidden rounded-[14px] border transition-colors",
          content.borderTone,
        )}
        style={{ background: content.gradient }}
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
        <div className="sticky top-0 z-20 flex items-start justify-between px-4 pt-4 pb-2.5 bg-inherit shrink-0">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] text-white"
              style={{ backgroundColor: content.iconBoxBg }}
            >
              <KatalistIcon name={content.icon} className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h2
                  ref={headingRef}
                  id={`court-${lane}-title`}
                  tabIndex={-1}
                  className="text-[20px] font-medium uppercase leading-none tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  style={{ color: content.accent }}
                >
                  {content.label}
                </h2>
                <span
                  className="text-[13px] font-medium leading-none"
                  style={{ color: content.accent }}
                >
                  {things.length}
                </span>
              </div>
              <p className="mt-1 text-[11px] font-normal leading-none text-black/75">
                {content.descriptor}
              </p>
            </div>
          </div>
          {(() => {
            const unreadThings = things.filter((t) => (t.unreadCommentCount ?? 0) > 0);
            return (
              <button
                type="button"
                onClick={(e) => {
                  if (unreadThings[0]) {
                    onOpen(unreadThings[0], e.currentTarget);
                  } else {
                    onViewAll?.(lane);
                  }
                }}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-white/60 hover:text-slate-700 cursor-pointer transition-colors"
                aria-label={
                  unreadThings.length > 0
                    ? `${unreadThings.length} with unread comments in ${content.label}`
                    : `View all ${things.length} in ${content.label}`
                }
                title={
                  unreadThings.length > 0
                    ? `${unreadThings.length} with unread comments`
                    : `View all ${things.length}`
                }
              >
                <KatalistIcon name="chevron-right" className="h-4 w-4" />
              </button>
            );
          })()}
        </div>

        {activeThing ? (
          <div className="flex min-h-0 flex-1 flex-col px-3.5 pb-2.5 pt-2.5">
            {/* Stack arena */}
            <div
              className="relative"
              onKeyDown={onKeyDown}
            >
              {/* Horizontal motion uncovers the action behind the card. */}
              {swipeDirection ? (
                <div
                  aria-hidden="true"
                  className={cn(
                    "pointer-events-none absolute inset-0 z-[19] overflow-hidden rounded-2xl",
                    swipeDirection === "sort"
                      ? capabilities.canSort
                        ? "bg-emerald-500"
                        : "bg-slate-400"
                      : canSnooze
                        ? "bg-violet-500"
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
                          name={swipeDirection === "sort" ? "sorted" : "snooze"}
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
                          : swipeCommitted
                            ? "Release to snooze"
                            : "Snooze"}
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
                  "relative z-20 touch-pan-y select-none will-change-transform motion-reduce:!transform-none motion-reduce:transition-none",
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

              {/* Snooze interval menu (swipe-left / June BRD v1.1) */}
              {snoozeOpen && activeThing ? (
                <div className="absolute inset-0 z-40 flex items-center justify-center rounded-2xl bg-slate-900/50 p-3 backdrop-blur-sm">
                  <div
                    className="w-full max-w-[240px] rounded-2xl border border-black/5 bg-white p-3"
                    style={{ boxShadow: "0 18px 40px rgba(15,23,42,0.28)" }}
                  >
                    <div className="mb-2 flex items-center gap-2 text-[#050d33]">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-100 text-violet-600">
                        <KatalistIcon name="snooze" className="h-4 w-4" />
                      </span>
                      <p className="text-[13px] font-semibold">Snooze for…</p>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {SNOOZE_OPTIONS.map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          disabled={pendingAction !== null}
                          onClick={() => void runSnooze(opt.id)}
                          className="flex cursor-pointer items-center justify-between rounded-[9px] border border-[#eaeffa] bg-[#f6f7fd] px-3 py-2 text-[12.5px] font-medium text-[#1d1d1d] transition-colors hover:bg-[#eef1fc] disabled:opacity-60"
                        >
                          <span>{opt.label}</span>
                          <KatalistIcon name="clock-time" className="h-3.5 w-3.5 text-[#503188]" />
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => setSnoozeOpen(false)}
                      className="mt-2 w-full cursor-pointer rounded-[9px] px-3 py-1.5 text-[12px] font-medium text-[#46557d] transition-colors hover:bg-slate-100"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}

              {/* Outgoing card animating out during scroll navigation */}
              {anim?.outgoing ? (
                <div
                  ref={outgoingCardRef}
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 z-30 overflow-hidden select-none will-change-transform motion-reduce:hidden"
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

            {/* Peek queue — fills the room below the active card and clips extras
                so the pager below always stays visible. */}
            {things.length > 1 && (
              <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
                {Array.from({ length: depthCount }, (_, i) => {
                  const depth = i + 1;
                  const targetIndex = (renderIndex + depth) % things.length;
                  const depthThing = things[targetIndex];
                  if (!depthThing) return null;
                  return (
                    <PeekQueueCard
                      key={`queue-${depthThing.id}`}
                      thing={depthThing}
                      lane={lane}
                      onOpen={() => navigateToIndex(targetIndex)}
                    />
                  );
                })}
              </div>
            )}

            {/* Deck indicator — pinned, always visible */}
            {things.length > 1 ? (
              <div className="shrink-0 flex items-center justify-between px-3 pt-3 pb-1 text-[11.5px] text-slate-500 font-medium">
                <button
                  type="button"
                  onClick={() => startNavigation(-1)}
                  className="p-1 hover:text-slate-800 transition-colors cursor-pointer"
                  aria-label="Previous card"
                >
                  <KatalistIcon name="arrow-left" className="h-3.5 w-3.5" />
                </button>
                <span>{renderIndex + 1} of {things.length}</span>
                <button
                  type="button"
                  onClick={() => startNavigation(1)}
                  className="p-1 hover:text-slate-800 transition-colors cursor-pointer"
                  aria-label="Next card"
                >
                  <KatalistIcon name="arrow-right" className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex min-h-[160px] flex-1 items-center justify-center px-3 text-center text-[11px] text-muted-foreground">
            No Things match this view.
          </div>
        )}

        {/* decorative deck offset: depth * -6 */}
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {announcement || `${Math.max(0, things.length - 1)} more Things in ${content.label}`}
        </div>
      </section>
    );
  },
);
