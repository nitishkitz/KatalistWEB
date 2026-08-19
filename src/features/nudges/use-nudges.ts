import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCourt } from "@/features/court/use-court";
import { isActiveThing, theirStateFor, type Thing } from "@/domain/thing";
import { getThingCapabilities } from "@/domain/capabilities";
import type { NudgeGroup, NudgeRow, RecentNudge } from "./fixtures";
import { isRecentlyNudged, canNudge as demoCanNudge, getMergedThings, useLocalVersion } from "@/features/things/local-state";
import { supabase } from "@/integrations/supabase/client";
import { keys } from "@/domain/query-keys";

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

function groupThing(t: Thing, myActorId: string | null): { group: NudgeGroup; reason: string } {
  if (t.acknowledgement === "waiting_for_catch") return { group: "waiting_for_catch", reason: "Waiting for Catch" };
  if (isRecentlyNudged(t.id)) return { group: "recently_nudged", reason: "Recently nudged" };
  const their = theirStateFor(t);
  if (their === "needs_attention") return { group: "stale", reason: "No recent movement" };
  if (t.workStatus === "under_progress") return { group: "caught_moving", reason: "Caught and moving" };
  return { group: "needs_a_tap", reason: "Needs a tap" };
}

export function useNudges() {
  const court = useCourt();
  useLocalVersion();
  const liveThings = (court.preview ? getMergedThings() : court.all).filter(isActiveThing);

  const nudgeable = useQuery({
    queryKey: keys.nudges(undefined, "work"),
    enabled: !court.preview,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_nudgeable_things");
      if (error) throw error;
      return data ?? [];
    },
  });

  const derived = useMemo(() => {
    const rows: NudgeRow[] = [];
    const recent: RecentNudge[] = [];
    const allowed = new Set((nudgeable.data ?? []).map((n) => n.thing_id));
    for (const t of liveThings) {
      if (t.workStatus === "sorted" || t.workStatus === "cancelled") continue;
      const { group, reason } = groupThing(t, court.myActorId);
      const caps = getThingCapabilities(t, court.myActorId);
      const can =
        court.preview
          ? caps.canNudge && demoCanNudge(t.id)
          : caps.canNudge && (allowed.size === 0 || allowed.has(t.id));
      rows.push(asRow(t, group, can, reason));
      if (group === "recently_nudged") {
        recent.push({ id: t.id, title: t.title, person: t.assignee.name, when: "Just now", state: reason });
      }
    }
    return { rows, recent };
  }, [liveThings, court.preview, court.myActorId, nudgeable.data]);

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
