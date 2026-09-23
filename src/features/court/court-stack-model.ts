import type { CourtLaneId } from "@/features/court/court-view-model";

export type GestureAxis = "horizontal" | "vertical" | null;

export type CourtWorkspacePhase = "overview" | "opening" | "focused" | "closing";

export type FocusViewTabId = CourtLaneId | "theirs";

export type CourtFocusSelection = {
  lane: FocusViewTabId;
  thingId: string;
};

export type FocusColumn =
  | { kind: "navigator"; lane: CourtLaneId }
  | { kind: "detail"; lane: CourtLaneId; thingId: string }
  | { kind: "compact"; lane: CourtLaneId };

export type HorizontalActionInput = {
  deltaX: number;
  threshold: number;
  canSort: boolean;
  canMoveLater: boolean;
};

export type CourtStackItemsByLane = Readonly<
  Record<CourtLaneId, readonly { id: string }[]>
>;

const laneOrder: CourtLaneId[] = ["now", "next", "later"];

export function focusColumns(selection: CourtFocusSelection): FocusColumn[] {
  return laneOrder.flatMap((lane): FocusColumn[] => {
    if (lane !== selection.lane) return [{ kind: "compact", lane }];
    return [
      { kind: "navigator", lane },
      { kind: "detail", lane, thingId: selection.thingId },
    ];
  });
}

export function transitionDuration(
  phase: CourtWorkspacePhase,
  reduceMotion: boolean,
): number {
  if (reduceMotion) return 0;
  if (phase === "opening") return 240;
  if (phase === "closing") return 220;
  if (phase === "focused") return 180;
  return 0;
}

export function reconcileStackIndex(
  previousIndex: number,
  previousThingId: string | null,
  things: readonly { id: string }[],
): number {
  if (things.length === 0) return 0;
  const identityIndex = previousThingId
    ? things.findIndex((thing) => thing.id === previousThingId)
    : -1;
  if (identityIndex >= 0) return identityIndex;
  return Math.max(0, Math.min(previousIndex, things.length - 1));
}

export function stepStackIndex(index: number, count: number, direction: 1 | -1): number {
  if (count <= 1) return 0;
  return (index + direction + count) % count;
}

/**
 * Decides whether a failed optimistic removal (Sort/Snooze/pace-later on a
 * Court stack card) should restore selection/focus to the Thing it
 * removed, once the card is back in `things`. Only true if nothing has
 * explicitly navigated (arrow/wheel/navigator-strip/focusThing) since the
 * removal started — a version counter bumped only by those explicit
 * actions, never by the automatic reconciliation that runs when `things`
 * changes, is what distinguishes "the user did something else in the
 * meantime" from "this failure is the only thing that happened."
 */
export function shouldRestoreSelectionAfterFailedRemoval(input: {
  navigationVersionAtRemoval: number;
  currentNavigationVersion: number;
  removedThingId: string;
  things: readonly { id: string }[];
}): boolean {
  return (
    input.currentNavigationVersion === input.navigationVersionAtRemoval &&
    input.things.some((thing) => thing.id === input.removedThingId)
  );
}

/**
 * Decides whether to actually move DOM/keyboard focus back to the
 * restored card, separately from (and more conservatively than)
 * shouldRestoreSelectionAfterFailedRemoval above. Moving focus is
 * deferred to a requestAnimationFrame after the logical-selection
 * decision, so between scheduling that callback and it actually firing,
 * the user can navigate again or click/focus something entirely outside
 * this lane (an input, another panel) — this must be re-checked at fire
 * time, not just decided once when scheduling, or the deferred focus call
 * steals focus from whatever the user has since moved to.
 *
 * `focusIsWithinLane` should be true if the currently focused element is
 * either absent (null/document.body) or inside this lane's own DOM
 * subtree — i.e. the user hasn't focused something unrelated (a dialog,
 * a text input elsewhere) since the removal. Callers must compute this at
 * both schedule time (skip scheduling entirely if already false) and
 * fire time (skip the actual focus() call if it became false meanwhile).
 */
export function shouldRestoreFocusAfterFailedRemoval(input: {
  navigationVersionAtSchedule: number;
  currentNavigationVersion: number;
  focusIsWithinLane: boolean;
}): boolean {
  return input.currentNavigationVersion === input.navigationVersionAtSchedule && input.focusIsWithinLane;
}

export function lockGestureAxis(
  current: GestureAxis,
  deltaX: number,
  deltaY: number,
  threshold = 10,
): GestureAxis {
  if (current) return current;
  if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < threshold) return null;
  return Math.abs(deltaX) >= Math.abs(deltaY) ? "horizontal" : "vertical";
}

export function resolveHorizontalAction({
  deltaX,
  threshold,
  canSort,
  canMoveLater,
}: HorizontalActionInput): "sort" | "later" | null {
  if (deltaX >= threshold && canSort) return "sort";
  if (deltaX <= -threshold && canMoveLater) return "later";
  return null;
}

export function resistedDragOffset(deltaX: number, canSort: boolean, canMoveLater: boolean): number {
  const permitted = (deltaX >= 0 && canSort) || (deltaX <= 0 && canMoveLater);
  return permitted ? deltaX : deltaX * 0.18;
}
