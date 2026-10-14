import type { CourtLaneId } from "./court-view-model";
import type { Thing } from "@/domain/thing";

export const TOSS_CARD_EMPHASIS_MS = 2000;
export const TOSS_BADGE_MS = 8000;
export const TOSS_RECEIPT_EXPAND_MS = 8000;

export interface TossCreationNotice {
  createdIds: string[];
  title: string;
  bucketFailedIds: string[];
  uploadFailed?: string[];
}

export type ResolvedDestination =
  | { kind: "visible"; lane: CourtLaneId; thing: Thing }
  | { kind: "filtered"; lane: CourtLaneId; thing: Thing }
  | { kind: "theirs"; thing: Thing }
  | { kind: "unresolved" };

export interface CardFeedbackState {
  ring: boolean;
  badge: "just-added" | "here-it-is" | null;
}

const LANES: CourtLaneId[] = ["now", "next", "later"];

export function resolveTossDestination(
  thingId: string,
  rawCourt?: (Partial<Record<CourtLaneId, Thing[]>> & { theirs?: Thing[] }) | null,
  visibleCourt?: (Partial<Record<CourtLaneId, Thing[]>> & { theirs?: Thing[] }) | null,
): ResolvedDestination {
  if (!thingId) return { kind: "unresolved" };

  if (visibleCourt) {
    for (const lane of LANES) {
      const things = visibleCourt[lane];
      if (things) {
        const found = things.find((t) => t.id === thingId);
        if (found) {
          return { kind: "visible", lane, thing: found };
        }
      }
    }
    if (visibleCourt.theirs) {
      const found = visibleCourt.theirs.find((t) => t.id === thingId);
      if (found) {
        return { kind: "theirs", thing: found };
      }
    }
  }

  if (rawCourt) {
    for (const lane of LANES) {
      const things = rawCourt[lane];
      if (things) {
        const found = things.find((t) => t.id === thingId);
        if (found) {
          return { kind: "filtered", lane, thing: found };
        }
      }
    }
    if (rawCourt.theirs) {
      const found = rawCourt.theirs.find((t) => t.id === thingId);
      if (found) {
        return { kind: "theirs", thing: found };
      }
    }
  }

  return { kind: "unresolved" };
}

export interface TossFeedbackItem {
  thingId: string;
  title: string;
  destination: ResolvedDestination;
  status: "saved" | "unavailable";
  unavailableReason?: string;
  createdAt: number;
}

export function createTossFeedbackItem(
  thingId: string,
  fallbackTitle: string,
  rawCourt?: Partial<Record<CourtLaneId, Thing[]>> | null,
  visibleCourt?: Partial<Record<CourtLaneId, Thing[]>> | null,
  now = Date.now(),
): TossFeedbackItem {
  const destination = resolveTossDestination(thingId, rawCourt, visibleCourt);
  const title =
    destination.kind !== "unresolved" && destination.thing.title
      ? destination.thing.title
      : fallbackTitle;

  return {
    thingId,
    title,
    destination,
    status: "saved",
    createdAt: now,
  };
}

export function mergeTossNoticeIntoItems(
  currentItems: TossFeedbackItem[],
  notice: TossCreationNotice,
  rawCourt?: Partial<Record<CourtLaneId, Thing[]>> | null,
  visibleCourt?: Partial<Record<CourtLaneId, Thing[]>> | null,
  now = Date.now(),
): TossFeedbackItem[] {
  const existingIds = new Set(currentItems.map((item) => item.thingId));
  const newItems: TossFeedbackItem[] = [];

  const isMulti = notice.createdIds.length > 1;

  notice.createdIds.forEach((id, index) => {
    if (existingIds.has(id)) return;
    existingIds.add(id);

    // For multi-create, do not assume positional titles without verification.
    // Use canonical thing title if already resolved, else fallback placeholder.
    const fallbackTitle = isMulti ? `${notice.title || "Thing"} (${index + 1})` : notice.title || "Untitled Thing";
    newItems.push(createTossFeedbackItem(id, fallbackTitle, rawCourt, visibleCourt, now));
  });

  return [...currentItems, ...newItems];
}

export function hydrateTossFeedbackItems(
  items: TossFeedbackItem[],
  rawCourt?: Partial<Record<CourtLaneId, Thing[]>> | null,
  visibleCourt?: Partial<Record<CourtLaneId, Thing[]>> | null,
): { items: TossFeedbackItem[]; changed: boolean } {
  let changed = false;

  const nextItems = items.map((item) => {
    // If destination already visible or thing unavailable, leave as is unless moving from filtered to visible
    const dest = resolveTossDestination(item.thingId, rawCourt, visibleCourt);

    if (dest.kind === "unresolved" && item.destination.kind === "unresolved") {
      return item;
    }

    const laneChanged =
      (dest.kind === "visible" || dest.kind === "filtered") &&
      (item.destination.kind === "visible" || item.destination.kind === "filtered") &&
      dest.lane !== item.destination.lane;

    if (dest.kind !== item.destination.kind || laneChanged) {
      changed = true;
      const nextTitle = dest.kind !== "unresolved" && dest.thing.title ? dest.thing.title : item.title;
      return {
        ...item,
        destination: dest,
        title: nextTitle,
      };
    }

    // Hydrate title if previously generic and now has real title
    if (dest.kind !== "unresolved" && dest.thing.title && dest.thing.title !== item.title) {
      changed = true;
      return {
        ...item,
        title: dest.thing.title,
        destination: dest,
      };
    }

    return item;
  });

  return { items: nextItems, changed };
}

export function formatLaneName(lane: CourtLaneId): string {
  switch (lane) {
    case "now":
      return "Now";
    case "next":
      return "Next";
    case "later":
      return "Later";
  }
}

export function formatDestinationLabel(destination: ResolvedDestination): string {
  switch (destination.kind) {
    case "visible":
      return `Added to ${formatLaneName(destination.lane)}`;
    case "filtered":
      return `Added to ${formatLaneName(destination.lane)}, hidden by current filters`;
    case "theirs":
      return "Added to With Others";
    case "unresolved":
      return "Saved · locating in Court…";
  }
}
