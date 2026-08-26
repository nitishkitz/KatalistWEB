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

import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { getThingCapabilities } from "@/domain/capabilities";
import type { Thing } from "@/domain/thing";
import { useAvatarUrl } from "@/features/people/directory";
import { rpcCatchThing, rpcSetPersonalPace, rpcSortThing } from "@/features/things/rpc";
import { domainErrorMessage } from "@/lib/domain-error";
import { cn } from "@/lib/utils";
import { getStackPreviewIndices, reconcileStackIndex, stepStackIndex } from "./court-stack-model";
import { formatCourtDue, type CourtLaneId } from "./court-view-model";
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
    descriptor: "Whenever you get to it",
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

const lanePanelTone: Record<CourtLaneId, string> = {
  now: "border-status-now/15 bg-[linear-gradient(180deg,rgba(254,242,242,0.82)_0%,rgba(255,255,255,0.96)_42%)]",
  next: "border-status-next/15 bg-[linear-gradient(180deg,rgba(239,246,255,0.9)_0%,rgba(255,255,255,0.96)_42%)]",
  later:
    "border-status-later/15 bg-[linear-gradient(180deg,rgba(245,243,255,0.92)_0%,rgba(255,255,255,0.96)_42%)]",
};

const previewWorkLabel: Record<Thing["workStatus"], string> = {
  not_started: "Not Started",
  under_progress: "Under Progress",
  sorted: "Sorted",
  cancelled: "Cancelled",
};

function LanePreviewRow({
  thing,
  onOpen,
}: {
  thing: Thing;
  onOpen: (thing: Thing, origin: HTMLElement) => void;
}) {
  const due = formatCourtDue(thing);
  const avatar = useAvatarUrl(thing.assignee.name, null, thing.assignee.avatarUrl);

  return (
    <button
      type="button"
      onClick={(event) => onOpen(thing, event.currentTarget)}
      className="group flex min-h-[68px] w-full items-center gap-3 border-t border-slate-100 px-4 py-2.5 text-left outline-none first:border-t-0 hover:bg-white focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      aria-label={`Open ${thing.title}`}
    >
      <PersonAvatar
        name={thing.assignee.name}
        initials={thing.assignee.initials}
        src={avatar}
        size={30}
        className="shadow-sm ring-2 ring-white"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-semibold text-slate-800 transition-colors group-hover:text-primary">
          {thing.title}
        </span>
        <span className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span>{previewWorkLabel[thing.workStatus]}</span>
          <span aria-hidden="true">·</span>
          <span className={cn("truncate", due.urgent && "font-medium text-status-now")}>
            {due.label}
          </span>
        </span>
      </span>
      <KatalistIcon
        name="chevron-right"
        className="h-4 w-4 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
      />
    </button>
  );
}

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
    const previewThings = getStackPreviewIndices(renderIndex, things.length, 2).map(
      (index) => things[index],
    );

    return (
      <section
        className={cn(
          "flex min-w-0 flex-col overflow-hidden rounded-[24px] border shadow-[0_24px_60px_-48px_rgba(15,23,42,0.35)]",
          lanePanelTone[lane],
        )}
        aria-labelledby={`court-${lane}-title`}
      >
        <div className={cn("min-h-[90px] border-b border-white/75 px-5 py-4", content.headerTone)}>
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/80 shadow-sm ring-1 ring-slate-900/5">
              <KatalistIcon name={content.icon} className={cn("h-[18px] w-[18px]", content.tone)} />
            </span>
            <h2
              ref={headingRef}
              id={`court-${lane}-title`}
              tabIndex={-1}
              className={cn(
                "text-[14px] font-bold tracking-[0.06em] outline-none focus-visible:ring-2 focus-visible:ring-ring",
                content.tone,
              )}
            >
              {content.label}
            </h2>
            <span
              className={cn(
                "rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-bold shadow-sm",
                content.tone,
              )}
            >
              {things.length}
            </span>
            <span className="ml-auto inline-flex items-center gap-1 text-[10.5px] font-medium text-slate-500">
              View all
              <KatalistIcon name="chevron-right" className="h-3.5 w-3.5" />
            </span>
          </div>
          <p className="mt-2 pl-[46px] text-[11px] text-slate-500">{content.descriptor}</p>
        </div>

        {activeThing ? (
          <div className="relative min-h-[532px] px-4 pb-4 pt-1" onKeyDown={onKeyDown}>
            <div className="relative pt-4">
              {Array.from({ length: depthCount }, (_, index) => {
                const depth = depthCount - index;
                return (
                  <div
                    key={depth}
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-3 min-h-[322px] rounded-[22px] border border-white/90 bg-white/82 shadow-[0_10px_30px_-22px_rgba(15,23,42,0.32)] backdrop-blur-sm"
                    style={{
                      top: `${2 + (depthCount - depth) * 5}px`,
                      transform: `scale(${1 - depth * 0.022})`,
                    }}
                  />
                );
              })}

              {animation ? (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 top-4 z-10 transition-[transform,opacity] duration-[220ms] ease-out motion-reduce:!transform-none motion-reduce:!opacity-100 motion-reduce:transition-none"
                  style={
                    animation.phase === "moving"
                      ? {
                          opacity: 0,
                          transform: `translate3d(0, ${animation.direction * -38}px, 0)`,
                        }
                      : { opacity: 1, transform: "translate3d(0, 0, 0)" }
                  }
                >
                  <div className="min-h-[322px] rounded-[22px] border border-border bg-white px-5 pt-5 shadow-lg">
                    <span className="block line-clamp-2 text-[18px] font-semibold leading-6 text-foreground">
                      {animation.outgoing.title}
                    </span>
                  </div>
                </div>
              ) : null}

              {gesture.dragging &&
              gesture.offset.x < -8 &&
              capabilities.canSetPace &&
              lane !== "later" ? (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 top-4 z-[15] flex min-h-[322px] items-center justify-end rounded-[22px] bg-[linear-gradient(135deg,#7c3aed,#5b21b6)] px-7 text-white shadow-lg"
                  style={{ opacity: Math.min(1, Math.abs(gesture.offset.x) / 72) }}
                >
                  <div className="flex flex-col items-center gap-1.5">
                    <KatalistIcon name="arrow-left" className="h-6 w-6" />
                    <span className="text-[12px] font-bold">Move to Later</span>
                    <span className="text-[9.5px] text-white/75">Changes personal pace</span>
                  </div>
                </div>
              ) : null}

              {gesture.dragging && gesture.offset.x > 8 && capabilities.canSort ? (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 top-4 z-[15] flex min-h-[322px] items-center justify-start rounded-[22px] bg-[linear-gradient(135deg,#10b981,#047857)] px-7 text-white shadow-lg"
                  style={{ opacity: Math.min(1, Math.abs(gesture.offset.x) / 72) }}
                >
                  <div className="flex flex-col items-center gap-1.5">
                    <KatalistIcon name="arrow-right" className="h-6 w-6" />
                    <span className="text-[12px] font-bold">Sorted</span>
                    <span className="text-[9.5px] text-white/75">Complete this Thing</span>
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
            </div>

            {previewThings.length ? (
              <div className="relative z-30 mt-3 overflow-hidden rounded-2xl border border-white/90 bg-white/75 shadow-[0_14px_35px_-28px_rgba(15,23,42,0.45)] backdrop-blur-sm">
                {previewThings.map((thing) => (
                  <LanePreviewRow key={thing.id} thing={thing} onOpen={onOpen} />
                ))}
              </div>
            ) : null}

            <div className="relative z-30 mt-3 flex items-center justify-center gap-2 text-[10px] text-muted-foreground">
              <KatalistIcon name="chevron-down" className="h-3.5 w-3.5" />
              <span>{things.length > 1 ? "Scroll or swipe for more" : "All clear after this"}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">
                {renderIndex + 1} / {things.length}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex min-h-[532px] items-center justify-center px-6 text-center text-[12px] text-muted-foreground">
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
