import { useMemo } from "react";
import { useCourt } from "@/features/court/use-court";
import { isActiveThing, theirStateFor, type Thing } from "@/domain/thing";
import type { NudgeGroup, NudgeRow, RecentNudge } from "./fixtures";
import { nudgeFixtures, recentNudgeFixtures } from "./fixtures";

function asRow(t: Thing, group: NudgeGroup, canNudge: boolean, reason: string): NudgeRow {
  return {
    id: t.id,
    title: t.title,
    person: t.assignee.name,
    reason,
    acknowledged: t.acknowledgement === "waiting_for_catch" ? "Waiting" : "Caught",
    workStatus: t.workStatus === "under_progress" ? "Under Progress" : t.workStatus === "sorted" ? "Sorted" : "Not Started",
    due: t.dueAt ? new Date(t.dueAt).toLocaleString() : "—",
    lastMovement: t.updatedAt,
    group,
    canNudge,
  };
}

export function useNudges() {
  const court = useCourt();
  const liveThings = court.all.filter(isActiveThing);

  const derived = useMemo(() => {
    if (court.preview) {
      return {
        rows: nudgeFixtures,
        recent: recentNudgeFixtures,
      };
    }
    const rows: NudgeRow[] = [];
    for (const t of liveThings) {
      if (t.workStatus === "sorted" || t.workStatus === "cancelled") continue;
      if (t.acknowledgement === "waiting_for_catch") {
        rows.push(asRow(t, "waiting_for_catch", true, "Waiting for Catch"));
        continue;
      }
      const their = theirStateFor(t);
      if (their === "needs_attention") rows.push(asRow(t, "stale", true, "No recent movement"));
      else if (t.workStatus === "under_progress") rows.push(asRow(t, "caught_moving", true, "Caught and moving"));
      else rows.push(asRow(t, "needs_a_tap", true, "Needs a tap"));
    }
    return { rows, recent: [] as RecentNudge[] };
  }, [court.preview, liveThings]);

  const counts = useMemo(() => {
    const map: Record<NudgeGroup, number> = {
      waiting_for_catch: 0,
      needs_a_tap: 0,
      recently_nudged: 0,
      caught_moving: 0,
      stale: 0,
    };
    for (const r of derived.rows) map[r.group] += 1;
    return map;
  }, [derived.rows]);

  return { ...derived, counts, preview: court.preview };
}
