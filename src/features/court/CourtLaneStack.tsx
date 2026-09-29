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
import {
  rpcCatchAndStart,
  rpcSetPersonalPace,
  rpcSnoozeThing,
  rpcSortThing,
} from "@/features/things/rpc";
import { runThingAction } from "@/features/things/run-thing-action";
import {
  cancelThingReads,
  claimThingMutation,
  patchThingInCaches,
  releaseThingMutation,
  withOptimisticPatch,
  type ThingPatch,
} from "@/features/things/query-updates";
import { getIdentityEpoch, isEpochCurrent } from "@/features/realtime/identity-cache-policy";
import {
  invalidateSnoozeSurfaces,
  snoozeUntilFor,
  SNOOZE_OPTIONS,
  type SnoozeOption,
} from "@/features/things/personal-snooze";
import { domainErrorMessage } from "@/lib/domain-error";
import { cn } from "@/lib/utils";
import {
  reconcileStackIndex,
  shouldRestoreFocusAfterFailedRemoval,
  shouldRestoreSelectionAfterFailedRemoval,
  stepStackIndex,
} from "./court-stack-model";
import { formatCourtDue, type CourtLaneId } from "./court-view-model";
import { KatalistIcon } from "./KatalistIcon";
import { courtLaneContent } from "./court-lane-content";
import { courtLaneDropAction } from "./court-lane-drop";
import { ThingStackCard, type CourtStackAction } from "./ThingStackCard";
import { useStackGesture } from "./use-stack-gesture";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { useAvatarUrl } from "@/features/people/directory";
import {
  getEffectiveReducedMotion,
  subscribeToMotionPreference,
} from "@/hooks/use-motion-preference";
import { motionDurationSeconds } from "@/lib/motion-tokens";
import catchRevealAsset from "@/assets/court-actions/catch.png";
import snoozeRevealAsset from "@/assets/court-actions/snooze.png";

gsap.registerPlugin(Observer);

export type CourtLaneStackHandle = {
  getPosition: () => { activeIndex: number; activeThingId: string | null };
  focusThing: (thingId: string | null) => void;
};

export type CourtLaneStackProps = {
  lane: CourtLaneId;
  things: Thing[];
  courtThings: Record<CourtLaneId, Thing[]>;
  listCoversById?: ReadonlyMap<string, string | null>;
  myActorId: string | null;
  initialPosition?: { activeIndex: number; activeThingId: string | null };
  onOpen: (thing: Thing, origin: HTMLElement) => void;
  /** `epoch` is the caller's own captured epoch (before its mutation's first await) -- see query-updates.ts's withOptimisticPatch for why this can't be read fresh inside onRefresh itself. */
  onRefresh: (epoch: number) => unknown;
  onViewAll?: (lane: CourtLaneId) => void;
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
  depth,
  myActorId,
  onOpen,
  onPreview,
}: {
  thing: Thing;
  lane: CourtLaneId;
  depth: number;
  myActorId: string | null;
  onOpen: () => void;
  onPreview: () => void;
}) {
  const assignedByOther = Boolean(
    myActorId && thing.assignee.id === myActorId && thing.owner.id !== thing.assignee.id,
  );
  const facePerson = assignedByOther ? thing.owner : thing.assignee;
  const faceAvatar = useAvatarUrl(facePerson.name, null, facePerson.avatarUrl);
  const faceLabel = assignedByOther
    ? `${thing.owner.name.split(" ")[0]} → You`
    : myActorId && thing.assignee.id === myActorId
      ? "You"
      : thing.assignee.name.split(" ")[0];
  const due = formatCourtDue(thing);
  const queueMeta = [
    thing.dueAt ? due.label : null,
    (thing.commentCount ?? 0) > 0
      ? `${thing.commentCount} ${thing.commentCount === 1 ? "comment" : "comments"}`
      : null,
    (thing.attachmentCount ?? thing.files?.length ?? 0) > 0
      ? `${thing.attachmentCount ?? thing.files?.length} ${
          (thing.attachmentCount ?? thing.files?.length ?? 0) === 1 ? "file" : "files"
        }`
      : null,
  ].filter(Boolean);
  const imagePreview = thing.files?.find(
    (file) => ["image", "png", "jpg"].includes(file.type) && file.url,
  );

  return (
    <button
      type="button"
      onClick={onOpen}
      onPointerEnter={onPreview}
      onFocus={onPreview}
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
      className="group/queue relative z-0 flex min-h-[76px] w-full flex-col justify-center rounded-b-xl border border-slate-200/80 bg-white px-3.5 py-2 text-left shadow-[0_3px_5px_rgba(15,23,42,0.14)] transition-[transform,box-shadow,border-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:z-30 hover:-translate-y-0.5 hover:scale-[1.005] hover:border-slate-300 hover:shadow-[0_14px_26px_-18px_rgba(15,23,42,0.34)] select-none outline-none focus-visible:z-30 focus-visible:border-slate-300 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none motion-reduce:hover:transform-none [&:not(:first-child)]:-mt-1"
      style={{ zIndex: 10 - depth }}
      title={`Jump to ${thing.title}`}
      aria-label={`Jump to ${thing.title}`}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2 text-[12px] leading-tight">
            <div className="flex min-w-0 items-center gap-1.5">
              <PersonAvatar
                name={facePerson.name}
                initials={facePerson.initials}
                src={faceAvatar}
                size={20}
              />
              <span className="truncate text-[12px] font-medium text-slate-800">{faceLabel}</span>
            </div>
            {thing.dueAt && (
              <span
                className={cn(
                  "shrink-0 text-[12px] font-bold",
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
          <p className="mt-1 line-clamp-2 text-[12.5px] font-medium leading-[1.25] text-slate-900">
            {thing.title}
          </p>
          {queueMeta.length > 0 ? (
            <p className="mt-1 truncate text-[11px] font-medium text-slate-500">
              {queueMeta.join(" · ")}
            </p>
          ) : null}
        </div>
        {imagePreview?.url ? (
          <img
            src={imagePreview.url}
            alt=""
            className="h-12 w-14 shrink-0 rounded-md object-cover"
            loading="lazy"
          />
        ) : null}
      </div>
    </button>
  );
}

export const CourtLaneStack = forwardRef<CourtLaneStackHandle, CourtLaneStackProps>(
  function CourtLaneStack(
    {
      lane,
      things: allThings,
      courtThings,
      listCoversById,
      myActorId,
      initialPosition,
      onOpen,
      onRefresh,
      onViewAll,
    },
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
    const [hoveredPreviewId, setHoveredPreviewId] = useState<string | null>(null);
    const activeThingIdRef = useRef<string | null>(things[initialIndex]?.id ?? null);
    const activeButtonRef = useRef<HTMLButtonElement | null>(null);
    const activeCardRef = useRef<HTMLDivElement | null>(null);
    const outgoingCardRef = useRef<HTMLDivElement | null>(null);
    const headingRef = useRef<HTMLHeadingElement | null>(null);
    const sectionRef = useRef<HTMLElement | null>(null);
    const animatingRef = useRef(false);
    const lastWheelTimeRef = useRef(0);
    // Bumped by every *explicit* selection change (arrow/wheel navigation,
    // the navigator strip, or an external focusThing() call) — never by the
    // automatic post-removal reconciliation effect below. A failed
    // optimistic removal uses this to tell "nothing else happened, restore
    // the original selection" apart from "the user has since moved on,
    // leave their newer selection alone."
    const navigationVersionRef = useRef(0);
    // Set by a failed removal's rollback, just before reverting removedIds,
    // so the reconciliation effect below can decide (via
    // shouldRestoreSelectionAfterFailedRemoval, once `things` reflects the
    // reverted removal) whether to restore focus to this Thing.
    const pendingSelectionRestoreRef = useRef<{
      thingId: string;
      navigationVersionAtRemoval: number;
    } | null>(null);

    useLayoutEffect(() => {
      return () => {
        // Deliberately reading .current at cleanup/unmount time, not a
        // mount-time snapshot: these refs get reassigned to whatever card
        // is currently active/outgoing as swipes happen, and the goal on
        // unmount is to kill tweens on whichever nodes are live *now*, not
        // whichever were live when this effect first ran.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        gsap.killTweensOf(activeCardRef.current);
        // eslint-disable-next-line react-hooks/exhaustive-deps
        gsap.killTweensOf(outgoingCardRef.current);
      };
    }, []);

    // D02: if the motion preference flips to reduced mid-swipe-animation
    // (an OS setting or the Me toggle changing while a card is still
    // sliding), snap immediately to the final state instead of letting an
    // already-scheduled spatial animation keep running under a preference
    // that says it shouldn't.
    useEffect(() => {
      const snapIfAnimating = () => {
        if (!animatingRef.current || !getEffectiveReducedMotion()) return;
        gsap.killTweensOf(activeCardRef.current);
        gsap.killTweensOf(outgoingCardRef.current);
        if (activeCardRef.current) {
          gsap.set(activeCardRef.current, { clearProps: "transform,scale,opacity" });
        }
        animatingRef.current = false;
        setAnim(null);
      };
      // D08: shares the hook's own OS-media-query/storage/broadcast wiring
      // instead of re-deriving a second `matchMedia` listener here.
      return subscribeToMotionPreference(snapIfAnimating);
    }, []);

    const content = courtLaneContent[lane];
    const renderIndex = reconcileStackIndex(activeIndex, activeThingIdRef.current, things);
    const activeThing = things[renderIndex] ?? null;
    const hoveredPreview = hoveredPreviewId
      ? (things.find((thing) => thing.id === hoveredPreviewId) ?? null)
      : null;
    const previewThing = hoveredPreview ?? activeThing;
    const previewIsTemporary = Boolean(hoveredPreview && hoveredPreview.id !== activeThing?.id);
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
      const pending = pendingSelectionRestoreRef.current;
      pendingSelectionRestoreRef.current = null;
      // Decided here (not at rollback time) because `things` needs to
      // already reflect the reverted removal for the "is it actually back"
      // half of the check to mean anything.
      const restoring = Boolean(
        pending &&
        shouldRestoreSelectionAfterFailedRemoval({
          navigationVersionAtRemoval: pending.navigationVersionAtRemoval,
          currentNavigationVersion: navigationVersionRef.current,
          removedThingId: pending.thingId,
          things,
        }),
      );
      setActiveIndex((prev) => {
        const targetId = restoring ? pending!.thingId : activeThingIdRef.current;
        const next = reconcileStackIndex(prev, targetId, things);
        activeThingIdRef.current = things[next]?.id ?? null;
        return next;
      });
      if (restoring) {
        // Also restore actual keyboard focus, not just which card is
        // logically selected — matching what focusThing() does for the
        // same "return attention to this specific card" case. Deferred to
        // a rAF, so re-check at fire time (not just now): the user can
        // navigate again, or focus something entirely outside this lane
        // (an input, another panel), in the gap between scheduling and
        // the callback actually running — either of those must be able to
        // veto stealing focus back.
        const focusIsWithinLane = () =>
          typeof document === "undefined" ||
          document.activeElement == null ||
          document.activeElement === document.body ||
          Boolean(sectionRef.current?.contains(document.activeElement));
        // Skip scheduling entirely if focus has already moved outside this
        // lane by now (e.g. it never was here to begin with).
        if (focusIsWithinLane()) {
          const navigationVersionAtSchedule = navigationVersionRef.current;
          requestAnimationFrame(() => {
            if (
              shouldRestoreFocusAfterFailedRemoval({
                navigationVersionAtSchedule,
                currentNavigationVersion: navigationVersionRef.current,
                focusIsWithinLane: focusIsWithinLane(),
              })
            ) {
              (activeButtonRef.current ?? headingRef.current)?.focus();
            }
          });
        }
      }
    }, [things]);

    const startNavigation = useCallback(
      (direction: 1 | -1) => {
        if (!activeThing || things.length <= 1 || pendingAction || animatingRef.current) return;
        const nextIndex = stepStackIndex(renderIndex, things.length, direction);
        const nextThing = things[nextIndex];
        if (!nextThing) return;
        navigationVersionRef.current += 1;

        const reduceMotion = getEffectiveReducedMotion();

        if (reduceMotion) {
          setActiveIndex(nextIndex);
          activeThingIdRef.current = nextThing.id;
          setAnnouncement(`Card ${nextIndex + 1} of ${things.length}`);
          return;
        }

        animatingRef.current = true;
        setAnim({ outgoing: activeThing, direction });
        setActiveIndex(nextIndex);
        activeThingIdRef.current = nextThing.id;
        setAnnouncement(`Card ${nextIndex + 1} of ${things.length}`);
      },
      [activeThing, pendingAction, renderIndex, things],
    );

    const navigateToIndex = useCallback(
      (targetIndex: number) => {
        if (!activeThing || things.length <= 1 || pendingAction || animatingRef.current) return;
        const nextIndex = ((targetIndex % things.length) + things.length) % things.length;
        const nextThing = things[nextIndex];
        if (!nextThing || nextIndex === renderIndex) return;
        navigationVersionRef.current += 1;

        const reduceMotion = getEffectiveReducedMotion();

        if (reduceMotion) {
          setActiveIndex(nextIndex);
          activeThingIdRef.current = nextThing.id;
          setAnnouncement(`Card ${nextIndex + 1} of ${things.length}`);
          return;
        }

        const direction: 1 | -1 = targetIndex > renderIndex ? 1 : -1;
        animatingRef.current = true;
        setAnim({ outgoing: activeThing, direction });
        setActiveIndex(nextIndex);
        activeThingIdRef.current = nextThing.id;
        setAnnouncement(`Card ${nextIndex + 1} of ${things.length}`);
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
      // D02: this effect only ever runs once `anim` is set, which both
      // navigation callbacks above only do on the non-reduced-motion path
      // (the reduced branch returns early without touching `anim`) -- so
      // the workspace band applies unconditionally here.
      const workspaceDuration = motionDurationSeconds("workspace", false);
      const context = gsap.context(() => {
        if (outgoingNode) {
          gsap.fromTo(
            outgoingNode,
            { y: 0, opacity: 1, scale: 1 },
            {
              y: forward ? -140 : 140,
              opacity: 0,
              scale: 0.96,
              duration: workspaceDuration,
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
            duration: workspaceDuration,
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
      // `patch`, when given, is applied to the shared Court/single-Thing
      // caches via query-updates.ts — the same module ThingDetailContent's
      // buttons use — so a Thing swiped here and a Thing detail panel open
      // on the *same* Thing coordinate through one rollback mechanism
      // instead of two independent ones each thinking they own the cache.
      // Timed Snooze (personal-visibility, not a shared field) calls this
      // with no patch at all — see runSnooze below.
      async (
        thing: Thing,
        label: string,
        patch: ThingPatch | undefined,
        mutate: () => Promise<unknown>,
      ) => {
        if (inFlightRef.current.has(thing.id)) return;
        // Captured before any await, at construction time — see
        // withOptimisticPatch's identical comment in query-updates.ts for
        // why this can't be read fresh later in this function.
        const epoch = getIdentityEpoch(qc).epoch;
        // inFlightRef only dedupes within this one lane instance; claimThingMutation
        // is shared across every surface (a detail panel's own mutation, another
        // lane) that goes through query-updates.ts for this Thing.
        const token = claimThingMutation(qc, thing.id, epoch);
        if (!token) return;
        inFlightRef.current.add(thing.id);
        // Snapshot before removing, so a later failure can tell whether
        // anything has explicitly navigated away since (see
        // navigationVersionRef's declaration) — if not, restore focus to
        // this same Thing; if so, respect the newer selection instead.
        const navigationVersionAtRemoval = navigationVersionRef.current;
        setRemovedIds((prev) => {
          const next = new Set(prev);
          next.add(thing.id);
          return next;
        });
        setAnnouncement(`${thing.title} ${label}.`);
        let rollbackPatch: (() => void) | null = null;
        if (patch) {
          await cancelThingReads(qc, thing.id);
          // Re-check after the await, before applying the optimistic
          // patch or dispatching the RPC below — a guard at entry alone
          // does not protect this.
          if (!isEpochCurrent(qc, epoch)) {
            inFlightRef.current.delete(thing.id);
            releaseThingMutation(qc, token);
            return;
          }
          rollbackPatch = patchThingInCaches(qc, thing.id, patch, epoch);
        }
        try {
          await mutate();
          if (isEpochCurrent(qc, epoch)) await onRefresh(epoch);
        } catch (error) {
          rollbackPatch?.();
          if (isEpochCurrent(qc, epoch)) {
            pendingSelectionRestoreRef.current = { thingId: thing.id, navigationVersionAtRemoval };
            // Roll back — the card slides back into the stack.
            setRemovedIds((prev) => {
              if (!prev.has(thing.id)) return prev;
              const next = new Set(prev);
              next.delete(thing.id);
              return next;
            });
            toast.error(domainErrorMessage(error));
          }
        } finally {
          inFlightRef.current.delete(thing.id);
          releaseThingMutation(qc, token);
        }
      },
      [onRefresh, qc],
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
          void runOptimisticRemoval(target, "snoozed", { personalPace: "later" }, async () => {
            await rpcSetPersonalPace(target.id, "later");
            toast.success("Snoozed.");
          });
          return;
        }
        if (action === "sort") {
          const target = activeThing;
          void runOptimisticRemoval(
            target,
            `sorted in ${content.label}`,
            { workStatus: "sorted", sortedAt: new Date().toISOString() },
            async () => {
              await rpcSortThing(target.id);
              toast.success("Nicely sorted.");
            },
          );
          return;
        }

        // Catch keeps the card in place, so keep the blocking pending state.
        if (pendingAction) return;
        setPendingAction(action);
        // Captured here, synchronously, immediately before dispatching
        // withOptimisticPatch's own thunk below -- withOptimisticPatch
        // captures its own epoch internally for the patch/RPC dispatch,
        // but the `fn` closure passed to it (which calls onRefresh) has
        // no access to that internal value, so it needs its own capture
        // at the same moment.
        const catchEpoch = getIdentityEpoch(qc).epoch;
        try {
          await withOptimisticPatch(
            qc,
            activeThing.id,
            { acknowledgement: "caught", workStatus: "under_progress", personalPace: "next" },
            async () => {
              await rpcCatchAndStart(activeThing.id);
              toast.success("Caught.");
              if (isEpochCurrent(qc, catchEpoch)) {
                await onRefresh(catchEpoch);
                setAnnouncement(`${activeThing.title} updated in ${content.label}.`);
              }
            },
          )();
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
        qc,
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
        // Timed Snooze is personal-visibility (thing_snooze), not a shared
        // Thing field — no patch to apply here, unlike the pace/sort/catch
        // actions above.
        const snoozeEpoch = getIdentityEpoch(qc).epoch;
        void runOptimisticRemoval(target, "snoozed", undefined, async () => {
          await rpcSnoozeThing(target.id, snoozeUntilFor(option));
          toast.success(label);
          await invalidateSnoozeSurfaces(qc, snoozeEpoch);
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
          navigationVersionRef.current += 1;
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

    // A document or image preview makes the active card much taller. Show one
    // readable card below it and use the pager for the rest of the deck.
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
        onPointerLeave={() => setHoveredPreviewId(null)}
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
          // Captured before any await in this handler.
          const dropEpoch = getIdentityEpoch(qc).epoch;
          try {
            const raw = e.dataTransfer.getData("application/katalist-thing");
            if (!raw) return;
            const data = JSON.parse(raw) as {
              thingId: string;
              fromLane: CourtLaneId;
              title: string;
            };
            if (data.fromLane === lane) return;
            const sourceThing = Object.values(courtThings)
              .flat()
              .find((thing) => thing.id === data.thingId);
            if (!sourceThing) return;
            const action = courtLaneDropAction(sourceThing, myActorId, lane);
            if (!action) {
              toast.error("Only the assignee can move this Thing between lanes.");
              return;
            }

            const outcome = await runThingAction(qc, action, { dismissGhost: async () => {} });
            if (outcome.status === "failed") {
              if (isEpochCurrent(qc, dropEpoch)) toast.error(domainErrorMessage(outcome.error));
              return;
            }
            if (outcome.status !== "performed" || !isEpochCurrent(qc, dropEpoch)) return;
            toast.success(`Moved "${sourceThing.title}" to ${content.label}`);
            try {
              await onRefresh(dropEpoch);
            } catch {
              // The mutation succeeded and the optimistic Court cache already
              // reflects the new pace. A refresh failure must not claim the move failed.
              toast.info("Moved. The board will refresh when Katalist reconnects.");
            }
          } catch (err: unknown) {
            if (isEpochCurrent(qc, dropEpoch)) toast.error(domainErrorMessage(err));
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
            <div className="flex items-center gap-2 rounded-xl bg-white/95 px-4 py-2.5 katalist-elevation-card border border-border/70 backdrop-blur-sm">
              <KatalistIcon
                name={content.icon}
                className={cn("h-4 w-4 fill-current", content.tone)}
              />
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
                  className="min-w-0 truncate text-[20px] font-medium uppercase leading-none tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  style={{ color: content.accent }}
                >
                  {content.label}
                </h2>
                <span
                  className="shrink-0 text-[13px] font-medium leading-none"
                  style={{ color: content.accent }}
                >
                  {things.length}
                </span>
              </div>
              {/* E02: this section's own ancestor has `overflow-hidden`
                  (for the drag/scroll boundary) -- at 200% zoom the
                  available column width can shrink below this text's
                  natural width, and without its own `truncate` the label
                  was silently cut off mid-character by that ancestor
                  boundary ("NOW" -> "NO") instead of degrading to an
                  ellipsis. */}
              <p className="mt-1 min-w-0 truncate text-[12px] font-normal leading-none text-black/75">
                {content.descriptor}
              </p>
            </div>
          </div>
          {(() => {
            const unreadThings = things.filter((t) => (t.unreadCommentCount ?? 0) > 0);
            return (
              <div className="flex shrink-0 items-center gap-1.5">
                {things.length > 1 && (
                  <div className="flex items-center gap-1" aria-hidden="true">
                    {things.map((thing, index) => (
                      <span
                        key={thing.id}
                        className="h-1.5 w-1.5 rounded-full transition-colors"
                        style={{
                          backgroundColor:
                            index === renderIndex ? content.accent : `${content.accent}40`,
                        }}
                      />
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    if (unreadThings[0]) {
                      onOpen(unreadThings[0], e.currentTarget);
                    } else {
                      onViewAll?.(lane);
                    }
                  }}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-white/60 hover:text-slate-700 cursor-pointer transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
              </div>
            );
          })()}
        </div>

        {activeThing && previewThing ? (
          <div className="flex min-h-0 flex-1 flex-col px-3.5 pb-2.5 pt-2.5">
            {/* Stack arena */}
            <div className="relative" onKeyDown={onKeyDown}>
              {/* Horizontal motion uncovers the action behind the card. */}
              {swipeDirection ? (
                <div
                  aria-hidden="true"
                  className={cn(
                    "pointer-events-none absolute inset-0 z-[19] overflow-hidden rounded-2xl",
                    swipeDirection === "sort"
                      ? capabilities.canSort
                        ? "bg-[radial-gradient(circle_at_22%_50%,#f8fff9_0%,#ddf8e7_44%,#bcefd3_100%)]"
                        : "bg-slate-400"
                      : canSnooze
                        ? "bg-[radial-gradient(circle_at_78%_50%,#fffaff_0%,#f1e3ff_44%,#d9beff_100%)]"
                        : "bg-slate-400",
                  )}
                >
                  <div
                    className={cn(
                      "absolute inset-y-0 flex w-[122px] items-center justify-center",
                      swipeDirection === "sort" ? "left-0" : "right-0",
                    )}
                  >
                    <div className="flex flex-col items-center gap-0.5 text-center">
                      <img
                        src={swipeDirection === "sort" ? catchRevealAsset : snoozeRevealAsset}
                        alt=""
                        className="h-[68px] w-[68px] object-contain drop-shadow-[0_5px_10px_rgba(71,33,118,0.16)]"
                      />
                      <span className="text-[12px] font-bold tracking-tight text-[#24113f]">
                        {swipeDirection === "sort"
                          ? capabilities.canSort
                            ? swipeCommitted
                              ? "Release to sort"
                              : "Caught!"
                            : capabilities.canCatch
                              ? "Catch first"
                              : "Unavailable"
                          : swipeCommitted
                            ? "Release to snooze"
                            : "Snoozed"}
                      </span>
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Active card stays level during both scroll and swipe. */}
              <div
                ref={activeCardRef}
                {...(!previewIsTemporary ? swipePointerProps : {})}
                className={cn(
                  "relative z-20 touch-pan-y select-none will-change-transform motion-reduce:!transform-none motion-reduce:transition-none",
                  !gesture.dragging &&
                    !anim &&
                    // D02: 260ms mirrors motion-tokens.ts's "workspace" band
                    // (<=280ms) -- a Tailwind arbitrary-duration class can't
                    // import the JS constant, so this must be kept in sync
                    // with MOTION_DURATIONS_MS.workspace by hand.
                    "transition-transform duration-[260ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
                )}
                style={{
                  transformOrigin: "50% 50%",
                  transform: `translate3d(${previewIsTemporary ? 0 : gesture.offset.x}px, 0, 0)`,
                }}
              >
                <ThingStackCard
                  ref={activeButtonRef}
                  key={previewThing.id}
                  thing={previewThing}
                  listCoverUrl={
                    previewThing.listId ? listCoversById?.get(previewThing.listId) : null
                  }
                  lane={lane}
                  myActorId={myActorId}
                  pendingAction={pendingAction}
                  suppressClickRef={gesture.suppressClickRef}
                  onOpen={onOpen}
                  onAction={(action) => void runAction(action)}
                  onSnooze={() => setSnoozeOpen(true)}
                  hideActions={previewIsTemporary}
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
                          className="flex cursor-pointer items-center justify-between rounded-[9px] border border-[#eaeffa] bg-[#f6f7fd] px-3 py-2 text-[12.5px] font-medium text-[#1d1d1d] transition-colors hover:bg-[#eef1fc] disabled:opacity-60 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span>{opt.label}</span>
                          <KatalistIcon name="clock-time" className="h-3.5 w-3.5 text-[#503188]" />
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => setSnoozeOpen(false)}
                      className="mt-2 w-full cursor-pointer rounded-[9px] px-3 py-1.5 text-[12px] font-medium text-[#46557d] transition-colors hover:bg-slate-100 outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                    listCoverUrl={
                      anim.outgoing.listId ? listCoversById?.get(anim.outgoing.listId) : null
                    }
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
              <div className="relative z-10 -mt-1.5 flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-px pb-1">
                {Array.from({ length: depthCount }, (_, i) => {
                  const depth = i + 1;
                  const depthThing = previewIsTemporary
                    ? [
                        activeThing,
                        ...things.filter(
                          (thing) => thing.id !== activeThing.id && thing.id !== previewThing.id,
                        ),
                      ][i]
                    : things[(renderIndex + depth) % things.length];
                  if (!depthThing) return null;
                  const targetIndex = things.findIndex((thing) => thing.id === depthThing.id);
                  return (
                    <PeekQueueCard
                      key={`queue-${depthThing.id}`}
                      thing={depthThing}
                      lane={lane}
                      depth={depth}
                      myActorId={myActorId}
                      onOpen={() => navigateToIndex(targetIndex)}
                      onPreview={() => {
                        if (!previewIsTemporary) setHoveredPreviewId(depthThing.id);
                      }}
                    />
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="flex min-h-[160px] flex-1 items-center justify-center px-3 text-center text-[12px] text-muted-foreground">
            No Things match this view.
          </div>
        )}

        {/* decorative deck offset: depth * -6 */}
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {announcement || `Card ${renderIndex + 1} of ${things.length}`}
        </div>
      </section>
    );
  },
);
