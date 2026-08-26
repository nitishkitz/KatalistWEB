import type { CourtLaneId } from "@/features/court/court-view-model";

export type GestureAxis = "horizontal" | "vertical" | null;

export type HorizontalActionInput = {
  deltaX: number;
  threshold: number;
  canSort: boolean;
  canMoveLater: boolean;
};

export type CourtStackItemsByLane = Readonly<Record<CourtLaneId, readonly { id: string }[]>>;

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

export function shouldCaptureStackPointer(axis: GestureAxis): boolean {
  return axis !== null;
}

export function getStackPreviewIndices(activeIndex: number, count: number, limit = 2): number[] {
  if (count <= 1 || limit <= 0) return [];
  const previewCount = Math.min(limit, count - 1);
  return Array.from({ length: previewCount }, (_, offset) => (activeIndex + offset + 1) % count);
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

export function resistedDragOffset(
  deltaX: number,
  canSort: boolean,
  canMoveLater: boolean,
): number {
  const permitted = (deltaX >= 0 && canSort) || (deltaX <= 0 && canMoveLater);
  return permitted ? deltaX : deltaX * 0.18;
}
