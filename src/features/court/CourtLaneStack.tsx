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
  {
    label: string;
    descriptor: string;
    icon: KatalistIconName;
    tone: string;
    headerTone: string;
    previewBorder: string;
  }
> = {
  now: {
    label: "NOW",
    descriptor: "Needs you now",
    icon: "now-smash",
    tone: "text-status-now",
    headerTone: "bg-status-now/5",
    previewBorder: "border-status-now/35",
  },
  next: {
    label: "NEXT",
    descriptor: "On deck soon",
    icon: "next-rally",
    tone: "text-status-next",
    headerTone: "bg-status-next/5",
    previewBorder: "border-status-next/35",
  },
  later: {
    label: "LATER",
    descriptor: "Whenever you get to it",
    icon: "later-lob",
    tone: "text-status-later",
    headerTone: "bg-status-later/5",
    previewBorder: "border-status-later/35",
  },
};

type NavigationAnimation = {
  outgoing: Thing;
  direction: 1 | -1;
  phase: "prepare" | "moving";
};

const lanePanelTone: Record<CourtLaneId, string> = {
  now: "border-status-now/20 bg-red-50/25",
  next: "border-status-next/20 bg-blue-50/25",
  later: "border-status-later/20 bg-violet-50/25",
};

const previewWorkLabel: Record<Thing["workStatus"], string> = {
  not_started: "Not Started",
  under_progress: "Under Progress",
  sorted: "Sorted",
  cancelled: "Cancelled",
};

function LanePreviewRow({
  thing,
  borderClass,
  onOpen,
}: {
  thing: Thing;
  borderClass: string;
  onOpen: (thing: Thing, origin: HTMLElement) => void;
}) {
  const due = formatCourtDue(thing);
  const avatar = useAvatarUrl(thing.assignee.name, null, thing.assignee.avatarUrl);

  return (
    <button
      type="button"
      onClick={(event) => onOpen(thing, event.currentTarget)}
      className={cn(
        "group mb-1 flex min-h-[46px] w-full items-center gap-2.5 rounded-[13px] border bg-white/90 px-3 py-1.5 text-left outline-none last:mb-0 hover:bg-white focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        borderClass,
      )}
      aria-label={`Open ${thing.title}`}
    >
      <PersonAvatar
        name={thing.assignee.name}
        initials={thing.assignee.initials}
        src={avatar}
        size={24}
        className="ring-2 ring-white"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11.5px] font-semibold text-slate-800 transition-colors group-hover:text-primary">
          {thing.title}
        </span>
        <span className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span>{previewWorkLabel[thing.workStatus]}</span>
          {due ? (
            <>
              <span aria-hidden="true">·</span>
              <span className={cn("truncate", due.urgent && "font-medium text-status-now")}>
                {due.label}
              </span>
            </>
          ) : null}
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
      opacity: 0.72,
      transform: `translate3d(0, ${animation.direction * 20}px, 0) scale(.985)`,
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
    const remainingCount = Math.max(0, things.length - 1 - previewThings.length);

    return (
      <section
        className={cn(
          "flex min-w-0 flex-col overflow-hidden rounded-[16px] border",
          lanePanelTone[lane],
        )}
        aria-labelledby={`court-${lane}-title`}
      >
        <div className={cn("flex h-12 items-center border-b border-white/80 px-3", content.headerTone)}>
          <div className="flex w-full items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-[9px] bg-white/90 ring-1 ring-slate-900/5">
              <KatalistIcon name={content.icon} className={cn("h-4 w-4", content.tone)} />
            </span>
            <h2
              ref={headingRef}
              id={`court-${lane}-title`}
              tabIndex={-1}
              className={cn(
                "text-[13px] font-bold tracking-[0.06em] outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
            <span className="ml-auto text-[10.5px] font-semibold tabular-nums text-slate-500">
              {things.length ? (
                <>
                  {renderIndex + 1} / {things.length}
                </>
              ) : (
                "0 / 0"
              )}
            </span>
            <button
              type="button"
              onClick={() => startNavigation(-1)}
              disabled={things.length <= 1 || pendingAction !== null}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 outline-none hover:bg-white hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-35"
              aria-label={`Previous ${content.label} Thing`}
            >
              <KatalistIcon name="arrow-left" className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => startNavigation(1)}
              disabled={things.length <= 1 || pendingAction !== null}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 outline-none hover:bg-white hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-35"
              aria-label={`Next ${content.label} Thing`}
            >
              <KatalistIcon name="arrow-right" className="h-3.5 w-3.5" />
            </button>
            <span className="sr-only">{content.descriptor}</span>
          </div>
        </div>

        {activeThing ? (
          <div className="relative min-h-[356px] px-3 pb-3" onKeyDown={onKeyDown}>
            <div className="relative pt-4">
              {Array.from({ length: depthCount }, (_, index) => {
                const depth = depthCount - index;
                return (
                  <div
                    key={depth}
                    aria-hidden="true"
                    className={cn(
                      "pointer-events-none absolute inset-x-3 min-h-[200px] rounded-[16px] border bg-white/85",
                      content.previewBorder,
                    )}
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
                  className="pointer-events-none absolute inset-x-0 top-4 z-10 transition-[transform,opacity] duration-[200ms] ease-out motion-reduce:!transform-none motion-reduce:!opacity-100 motion-reduce:transition-none"
                  style={
                    animation.phase === "moving"
                      ? {
                          opacity: 0,
                          transform: `translate3d(0, ${animation.direction * 26}px, 0) scale(.985)`,
                        }
                      : { opacity: 1, transform: "translate3d(0, 0, 0)" }
                  }
                >
                  <div
                    className={cn(
                      "min-h-[200px] rounded-[16px] border bg-white px-4 pt-4",
                      content.previewBorder,
                    )}
                  >
                    <span className="block line-clamp-2 text-[14px] font-semibold leading-5 text-foreground">
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
                  className="pointer-events-none absolute inset-x-0 top-4 z-[15] flex min-h-[200px] items-center justify-end rounded-[16px] bg-violet-700 px-7 text-white"
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
                  className="pointer-events-none absolute inset-x-0 top-4 z-[15] flex min-h-[200px] items-center justify-start rounded-[16px] bg-emerald-700 px-7 text-white"
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
                ref={gesture.gestureRef}
                {...gesture.gestureProps}
                className={cn(
                  "relative z-20 touch-pan-y select-none transition-[transform,opacity] duration-[200ms] ease-out motion-reduce:!transform-none motion-reduce:!opacity-100 motion-reduce:transition-none",
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
              <div className="relative z-30 mt-2 px-1">
                {previewThings.map((thing) => (
                  <LanePreviewRow
                    key={thing.id}
                    thing={thing}
                    borderClass={content.previewBorder}
                    onOpen={onOpen}
                  />
                ))}
              </div>
            ) : null}

            {remainingCount > 0 ? (
              <div className={cn("relative z-30 mt-2 px-2 text-[10px] font-medium", content.tone)}>
                + {remainingCount} more
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex min-h-[356px] items-center justify-center px-6 text-center text-[12px] text-muted-foreground">
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
