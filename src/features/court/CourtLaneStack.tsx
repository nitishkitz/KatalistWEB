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
import { useAvatarUrl } from "@/features/people/directory";

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
    bgTone: "bg-[#fff8f6]",
    borderTone: "border-red-100/80",
  },
  next: {
    label: "NEXT",
    descriptor: "On deck soon",
    icon: "next-rally",
    tone: "text-status-next",
    headerTone: "bg-transparent",
    bgTone: "bg-[#f4f8ff]",
    borderTone: "border-blue-100/80",
  },
  later: {
    label: "LATER",
    descriptor: "Whenever you get to it",
    icon: "later-lob",
    tone: "text-status-later",
    headerTone: "bg-transparent",
    bgTone: "bg-[#f8f6ff]",
    borderTone: "border-purple-100/80",
  },
};

type NavigationAnimation = {
  outgoing: Thing;
  direction: 1 | -1;
  phase: "prepare" | "moving";
};

function incomingStyle(
  animation: NavigationAnimation | null,
  offset: { x: number; y: number },
): CSSProperties {
  if (!animation) return { transform: `translate3d(${offset.x}px, ${offset.y}px, 0)` };
  if (animation.phase === "prepare") {
    return {
      opacity: 0.55,
      transform: `translate3d(0, ${animation.direction * 18}px, 0)`,
    };
  }
  return { opacity: 1, transform: "translate3d(0, 0, 0)" };
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
    const [animation, setAnimation] = useState<NavigationAnimation | null>(null);
    const activeThingIdRef = useRef<string | null>(things[initialIndex]?.id ?? null);
    const activeButtonRef = useRef<HTMLButtonElement | null>(null);
    const headingRef = useRef<HTMLHeadingElement | null>(null);
    const animationFrameRef = useRef<number | null>(null);
    const content = courtLaneContent[lane];
    const renderIndex = reconcileStackIndex(activeIndex, activeThingIdRef.current, things);
    const activeThing = things[renderIndex] ?? null;
    const capabilities = activeThing
      ? getThingCapabilities(activeThing, myActorId)
      : {
          canCatch: false,
          canSetPace: false,
          canSort: false,
        };

    useEffect(() => {
      setActiveIndex((previousIndex) => {
        const nextIndex = reconcileStackIndex(previousIndex, activeThingIdRef.current, things);
        activeThingIdRef.current = things[nextIndex]?.id ?? null;
        return nextIndex;
      });
    }, [things]);

    useEffect(
      () => () => {
        if (animationFrameRef.current !== null) {
          cancelAnimationFrame(animationFrameRef.current);
        }
      },
      [],
    );

    const startNavigation = useCallback(
      (direction: 1 | -1) => {
        if (!activeThing || things.length <= 1 || pendingAction) return;
        const nextIndex = stepStackIndex(renderIndex, things.length, direction);
        const nextThing = things[nextIndex];
        setAnimation({ outgoing: activeThing, direction, phase: "prepare" });
        setActiveIndex(nextIndex);
        activeThingIdRef.current = nextThing.id;
        setAnnouncement(`Now viewing ${nextThing.title}.`);
        if (animationFrameRef.current !== null) {
          cancelAnimationFrame(animationFrameRef.current);
        }
        animationFrameRef.current = requestAnimationFrame(() => {
          animationFrameRef.current = requestAnimationFrame(() => {
            setAnimation((current) => (current ? { ...current, phase: "moving" } : null));
          });
        });
      },
      [activeThing, pendingAction, renderIndex, things],
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
        getPosition: () => ({
          activeIndex: renderIndex,
          activeThingId: activeThing?.id ?? null,
        }),
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

    return (
      <section
        className={cn(
          "flex min-w-0 flex-col overflow-hidden rounded-2xl border shadow-xs transition-colors",
          content.bgTone,
          content.borderTone,
        )}
        aria-labelledby={`court-${lane}-title`}
      >
        <div className="flex min-h-[48px] items-center gap-2 border-b border-border/40 px-4">
          <KatalistIcon name={content.icon} className={cn("h-4 w-4", content.tone)} />
          <h2
            ref={headingRef}
            id={`court-${lane}-title`}
            tabIndex={-1}
            className={cn(
              "text-[12px] font-bold tracking-[0.08em] outline-none focus-visible:ring-2 focus-visible:ring-ring",
              content.tone,
            )}
          >
            {content.label}
          </h2>
          <span
            className={cn(
              "rounded-full bg-white/90 px-1.5 py-0.5 text-[10px] font-semibold shadow-xs",
              content.tone,
            )}
          >
            {things.length}
          </span>
          <div className="ml-auto flex items-center gap-2.5">
            <span className="text-[10.5px] text-muted-foreground">{content.descriptor}</span>
            <span className="flex items-center text-[10.5px] font-medium text-muted-foreground/80 hover:text-foreground">
              View all <KatalistIcon name="chevron-right" className="h-3 w-3" />
            </span>
          </div>
        </div>

        {activeThing ? (
          <div
            className="relative min-h-[220px] overflow-hidden px-3 pb-5 pt-3"
            onKeyDown={onKeyDown}
          >
            {Array.from({ length: depthCount }, (_, index) => {
              const depth = depthCount - index;
              return (
                <div
                  key={depth}
                  aria-hidden="true"
                  className={cn(
                    "pointer-events-none absolute inset-x-3 top-3 min-h-[190px] rounded-xl border bg-white shadow-xs",
                    content.borderTone,
                  )}
                  style={{
                    transform: `translateY(${depth * -5}px)`,
                    opacity: 1 - depth * 0.12,
                  }}
                />
              );
            })}

            {animation ? (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-3 top-3 z-10 transition-[transform,opacity] duration-[240ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:!transform-none motion-reduce:!opacity-100 motion-reduce:transition-none"
                style={
                  animation.phase === "moving"
                    ? {
                        opacity: 0,
                        transform: `translate3d(0, ${animation.direction * -34}px, 0)`,
                      }
                    : { opacity: 1, transform: "translate3d(0, 0, 0)" }
                }
              >
                <div className="min-h-[190px] rounded-xl border border-border bg-white px-4 pt-4 shadow-sm">
                  <span className="block line-clamp-2 text-[14px] font-semibold leading-5 text-foreground">
                    {animation.outgoing.title}
                  </span>
                </div>
              </div>
            ) : null}

            {/* Later overlay — left swipe (negative offset) */}
            {gesture.dragging &&
            gesture.offset.x < -8 &&
            capabilities.canSetPace &&
            lane !== "later" ? (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-3 top-3 z-[15] flex min-h-[190px] items-center justify-end rounded-xl bg-status-later/95 px-6 transition-opacity duration-150"
                style={{ opacity: Math.min(1, Math.abs(gesture.offset.x) / 72) }}
              >
                <div className="flex flex-col items-center gap-1 text-white">
                  <KatalistIcon name="arrow-left" className="h-6 w-6" />
                  <span className="text-[13px] font-semibold">Later</span>
                  <span className="text-[10px] opacity-80">Moves to LATER</span>
                </div>
              </div>
            ) : null}

            {/* Sorted overlay — right swipe (positive offset) */}
            {gesture.dragging && gesture.offset.x > 8 && capabilities.canSort ? (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-3 top-3 z-[15] flex min-h-[190px] items-center justify-start rounded-xl bg-emerald-500/95 px-6 transition-opacity duration-150"
                style={{ opacity: Math.min(1, Math.abs(gesture.offset.x) / 72) }}
              >
                <div className="flex flex-col items-center gap-1 text-white">
                  <KatalistIcon name="arrow-right" className="h-6 w-6" />
                  <span className="text-[13px] font-semibold">Sorted</span>
                  <span className="text-[10px] opacity-80">Move to DONE</span>
                </div>
              </div>
            ) : null}

            <div
              {...gesture.gestureProps}
              className={cn(
                "relative z-20 touch-pan-y select-none transition-[transform,opacity] duration-[240ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:!transform-none motion-reduce:!opacity-100 motion-reduce:transition-none",
                gesture.dragging && "transition-none",
              )}
              style={incomingStyle(animation, gesture.offset)}
              onTransitionEnd={(event) => {
                if (event.target === event.currentTarget && animation?.phase === "moving") {
                  setAnimation(null);
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

            <div className="absolute inset-x-0 bottom-1 z-30 text-center text-[10px] tabular-nums text-muted-foreground">
              {renderIndex + 1} / {things.length}
            </div>
          </div>
        ) : (
          <div className="flex min-h-[220px] items-center justify-center px-3 text-center text-[11px] text-muted-foreground">
            No Things match this view.
          </div>
        )}

        {/* Below-stack preview rows */}
        {things.length > 1 ? (
          <div className="border-t border-border/50 px-3 pb-2 pt-1">
            {things
              .filter((_, index) => index !== renderIndex)
              .slice(0, 2)
              .map((previewThing) => {
                const previewDue = formatCourtDue(previewThing);
                return (
                  <button
                    key={previewThing.id}
                    type="button"
                    onClick={() => {
                      const thingIndex = things.findIndex((t) => t.id === previewThing.id);
                      if (thingIndex >= 0) {
                        setActiveIndex(thingIndex);
                        activeThingIdRef.current = previewThing.id;
                      }
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left outline-none hover:bg-white/80 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <PersonAvatar
                      name={previewThing.assignee.name}
                      initials={previewThing.assignee.initials}
                      src={previewThing.assignee.avatarUrl}
                      size={26}
                    />
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-semibold text-foreground">
                        {previewThing.title}
                      </span>
                      {previewDue.label === "No due date" ? null : (
                        <span
                          className={cn(
                            "block text-[10px]",
                            previewDue.urgent
                              ? "font-medium text-status-now"
                              : "text-muted-foreground",
                          )}
                        >
                          {previewDue.label}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            {things.length > 3 ? (
              <button
                type="button"
                className="flex w-full items-center justify-center gap-1 py-1.5 text-[10.5px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  const nextIndex = stepStackIndex(renderIndex, things.length, 1);
                  setActiveIndex(nextIndex);
                  activeThingIdRef.current = things[nextIndex]?.id ?? null;
                }}
              >
                <KatalistIcon name="chevron-down" className="h-3 w-3" />
                Scroll for more
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {announcement}
        </div>
      </section>
    );
  },
);
