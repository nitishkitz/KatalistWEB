import { useCallback, useEffect, useRef, useState, useMemo, type MutableRefObject } from "react";
import type { CourtLaneId } from "./court-view-model";
import type { Thing } from "@/domain/thing";
import {
  TOSS_CARD_EMPHASIS_MS,
  TOSS_BADGE_MS,
  TOSS_RECEIPT_EXPAND_MS,
  type TossCreationNotice,
  type TossFeedbackItem,
  type CardFeedbackState,
  resolveTossDestination,
  mergeTossNoticeIntoItems,
  hydrateTossFeedbackItems,
} from "./toss-feedback-model";
import type { CourtLaneStackHandle } from "./CourtLaneStack";

export interface UseTossFeedbackOptions {
  userId?: string | null;
  context: string;
  rawCourt?: Partial<Record<CourtLaneId, Thing[]>> | null;
  visibleCourt?: Partial<Record<CourtLaneId, Thing[]>> | null;
  laneRefs?: MutableRefObject<Partial<Record<CourtLaneId, CourtLaneStackHandle | null>>>;
}

export function useTossFeedback({
  userId,
  context,
  rawCourt,
  visibleCourt,
  laneRefs,
}: UseTossFeedbackOptions) {
  const [items, setItems] = useState<TossFeedbackItem[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [expandedDetails, setExpandedDetails] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [feedbackByThingId, setFeedbackByThingId] = useState<Record<string, CardFeedbackState>>({});

  // Timers and visible elapsed tracking
  const receiptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ringTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const badgeTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const creationTimestampsRef = useRef<Map<string, number>>(new Map());

  // Clear everything on identity or context change
  useEffect(() => {
    setItems([]);
    setCollapsed(false);
    setExpandedDetails(false);
    setFeedbackByThingId({});
    setAnnouncement("");

    if (receiptTimerRef.current) {
      clearTimeout(receiptTimerRef.current);
      receiptTimerRef.current = null;
    }
    ringTimersRef.current.forEach((t) => clearTimeout(t));
    ringTimersRef.current.clear();
    badgeTimersRef.current.forEach((t) => clearTimeout(t));
    badgeTimersRef.current.clear();
    creationTimestampsRef.current.clear();
  }, [userId, context]);

  // Handle hydration from fresh rawCourt and visibleCourt
  useEffect(() => {
    if (items.length === 0) return;
    setItems((current) => {
      const { items: next, changed } = hydrateTossFeedbackItems(current, rawCourt, visibleCourt);
      return changed ? next : current;
    });
  }, [rawCourt, visibleCourt, items.length]);

  // Check which items are currently visible in stack to start card-local timers
  useEffect(() => {
    if (items.length === 0 || !visibleCourt || !laneRefs) return;

    items.forEach((item) => {
      const dest = item.destination;
      if (dest.kind !== "visible") return;

      const laneHandle = laneRefs.current?.[dest.lane];
      const pos = laneHandle?.getPosition();
      const isCardActive = pos ? pos.activeThingId === item.thingId : false;

      if (isCardActive) {
        // If card is actively showing on the top of the stack, trigger 2s ring and 8s badge if not started
        const createdTime = creationTimestampsRef.current.get(item.thingId) ?? item.createdAt;
        const now = Date.now();
        const elapsedSinceCreated = now - createdTime;

        if (!ringTimersRef.current.has(item.thingId) && elapsedSinceCreated < TOSS_CARD_EMPHASIS_MS) {
          setFeedbackByThingId((prev) => ({
            ...prev,
            [item.thingId]: {
              ring: true,
              badge: prev[item.thingId]?.badge ?? "just-added",
            },
          }));

          const remainingRing = Math.max(0, TOSS_CARD_EMPHASIS_MS - elapsedSinceCreated);
          const ringTimer = setTimeout(() => {
            setFeedbackByThingId((prev) => {
              const current = prev[item.thingId];
              if (!current) return prev;
              return { ...prev, [item.thingId]: { ...current, ring: false } };
            });
          }, remainingRing);
          ringTimersRef.current.set(item.thingId, ringTimer);
        }

        if (!badgeTimersRef.current.has(item.thingId) && elapsedSinceCreated < TOSS_BADGE_MS) {
          setFeedbackByThingId((prev) => ({
            ...prev,
            [item.thingId]: {
              ring: prev[item.thingId]?.ring ?? false,
              badge: "just-added",
            },
          }));

          const remainingBadge = Math.max(0, TOSS_BADGE_MS - elapsedSinceCreated);
          const badgeTimer = setTimeout(() => {
            setFeedbackByThingId((prev) => {
              const current = prev[item.thingId];
              if (!current) return prev;
              return { ...prev, [item.thingId]: { ...current, badge: null } };
            });
          }, remainingBadge);
          badgeTimersRef.current.set(item.thingId, badgeTimer);
        }
      } else {
        // Card is in lane but buried: provide quiet badge state for lane header without stack ring
        const createdTime = creationTimestampsRef.current.get(item.thingId) ?? item.createdAt;
        const now = Date.now();
        if (now - createdTime < TOSS_BADGE_MS) {
          setFeedbackByThingId((prev) => {
            if (prev[item.thingId]?.badge) return prev;
            return {
              ...prev,
              [item.thingId]: {
                ring: false,
                badge: "just-added",
              },
            };
          });
        }
      }
    });
  }, [items, visibleCourt, laneRefs]);

  // Manage 8-second collapse timer for receipt
  useEffect(() => {
    if (items.length === 0 || collapsed) return;
    if (isHovered || isFocused) {
      if (receiptTimerRef.current) {
        clearTimeout(receiptTimerRef.current);
        receiptTimerRef.current = null;
      }
      return;
    }

    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return;
    }

    receiptTimerRef.current = setTimeout(() => {
      setCollapsed(true);
    }, TOSS_RECEIPT_EXPAND_MS);

    return () => {
      if (receiptTimerRef.current) {
        clearTimeout(receiptTimerRef.current);
        receiptTimerRef.current = null;
      }
    };
  }, [items.length, collapsed, isHovered, isFocused]);

  // Listener for tab visibility changes
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        if (receiptTimerRef.current) {
          clearTimeout(receiptTimerRef.current);
          receiptTimerRef.current = null;
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  // Record a committed Toss
  const recordCommit = useCallback(
    (notice: TossCreationNotice) => {
      const now = Date.now();
      notice.createdIds.forEach((id) => {
        creationTimestampsRef.current.set(id, now);
      });

      setItems((prev) => {
        const next = mergeTossNoticeIntoItems(prev, notice, rawCourt, visibleCourt, now);
        return next;
      });

      // Expand receipt on new toss
      setCollapsed(false);

      // Polite announcement
      const title = notice.title || "Thing";
      const count = notice.createdIds.length;
      if (count === 1) {
        setAnnouncement(`Saved: ${title}`);
      } else {
        setAnnouncement(`Saved: ${count} Things`);
      }
    },
    [rawCourt, visibleCourt],
  );

  // Trigger card emphasis upon explicit reveal (Show in Court)
  const triggerCardEmphasis = useCallback((thingId: string) => {
    const createdTime = creationTimestampsRef.current.get(thingId);
    const now = Date.now();
    const isStillFresh = createdTime ? now - createdTime < TOSS_BADGE_MS : false;
    const badgeType = isStillFresh ? "just-added" : "here-it-is";

    // Clear any existing ring timer
    if (ringTimersRef.current.has(thingId)) {
      clearTimeout(ringTimersRef.current.get(thingId)!);
    }

    setFeedbackByThingId((prev) => ({
      ...prev,
      [thingId]: {
        ring: true,
        badge: badgeType,
      },
    }));

    const timer = setTimeout(() => {
      setFeedbackByThingId((prev) => {
        const current = prev[thingId];
        if (!current) return prev;
        return {
          ...prev,
          [thingId]: {
            ring: false,
            badge: isStillFresh ? current.badge : null,
          },
        };
      });
    }, TOSS_CARD_EMPHASIS_MS);

    ringTimersRef.current.set(thingId, timer);
  }, []);

  // Clear emphasis when card is opened or acted on
  const clearEmphasis = useCallback((thingId: string) => {
    setFeedbackByThingId((prev) => {
      if (!prev[thingId]) return prev;
      const next = { ...prev };
      delete next[thingId];
      return next;
    });
    if (ringTimersRef.current.has(thingId)) {
      clearTimeout(ringTimersRef.current.get(thingId)!);
      ringTimersRef.current.delete(thingId);
    }
    if (badgeTimersRef.current.has(thingId)) {
      clearTimeout(badgeTimersRef.current.get(thingId)!);
      badgeTimersRef.current.delete(thingId);
    }
  }, []);

  // Dismiss item(s) from receipt
  const dismissReceipt = useCallback((thingId?: string) => {
    if (!thingId) {
      setItems([]);
      setCollapsed(false);
      setExpandedDetails(false);
      return;
    }

    setItems((prev) => prev.filter((item) => item.thingId !== thingId));
  }, []);

  return {
    items,
    collapsed,
    expandedDetails,
    setExpandedDetails,
    setCollapsed,
    isHovered,
    setIsHovered,
    isFocused,
    setIsFocused,
    announcement,
    feedbackByThingId,
    recordCommit,
    triggerCardEmphasis,
    clearEmphasis,
    dismissReceipt,
  };
}
