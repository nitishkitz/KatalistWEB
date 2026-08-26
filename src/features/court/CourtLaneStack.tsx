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
import type { CourtLaneId } from "./court-view-model";
import { KatalistIcon, type KatalistIconName } from "./KatalistIcon";
import { ThingStackCard, type CourtStackAction } from "./ThingStackCard";
import { useStackGesture } from "./use-stack-gesture";

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
      transform: `translate3d(0, ${animation.direction * 18}px, 0) scale(.99)`,
    };
  }
  return { opacity: 1, transform: "translate3d(0, 0, 0) scale(1)" };
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
            action === "catch"
              ? "Caught."
              : action === "later"
                ? "Moved to Later."
                : "Nicely sorted.",
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

    const depthCount = Math.min(3, Math.max(0, things.length - 1));

    return (
      <section
        className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border/70 bg-white"
        aria-labelledby={`court-${lane}-title`}
      >
        <div
          className={cn(
            "flex min-h-[54px] items-center gap-2 border-b border-border/70 px-4",
            content.headerTone,
          )}
        >
          <KatalistIcon name={content.icon} className={cn("h-4 w-4", content.tone)} />
          <h2
            ref={headingRef}
            id={`court-${lane}-title`}
            tabIndex={-1}
            className={cn(
              "text-[12px] font-semibold tracking-[0.08em] outline-none focus-visible:ring-2 focus-visible:ring-ring",
              content.tone,
            )}
          >
            {content.label}
          </h2>
          <span
            className={cn(
              "rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] font-semibold",
              content.tone,
            )}
          >
            {things.length}
          </span>
          <span className="truncate text-[11px] text-muted-foreground">{content.descriptor}</span>
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
                  className="pointer-events-none absolute inset-x-3 top-3 min-h-[190px] rounded-xl border border-border/70 bg-white shadow-sm"
                  style={{
                    transform: `translateY(${2 + depth * 2}px) scale(${1 - depth * 0.008})`,
                  }}
                />
              );
            })}

            {animation ? (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-3 top-3 z-10 transition-[transform,opacity] duration-[220ms] ease-out motion-reduce:!transform-none motion-reduce:!opacity-100 motion-reduce:transition-none"
                style={
                  animation.phase === "moving"
                    ? {
                        opacity: 0,
                        transform: `translate3d(0, ${animation.direction * -28}px, 0)`,
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

            <div
              {...gesture.gestureProps}
              className={cn(
                "relative z-20 touch-pan-y select-none transition-[transform,opacity] duration-[220ms] ease-out motion-reduce:!transform-none motion-reduce:!opacity-100 motion-reduce:transition-none",
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

        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {announcement}
        </div>
      </section>
    );
  },
);
