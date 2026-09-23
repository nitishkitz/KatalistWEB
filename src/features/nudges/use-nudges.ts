import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCourt } from "@/features/court/use-court";
import { isActiveThing, theirStateFor, type Thing } from "@/domain/thing";
import { getThingCapabilities } from "@/domain/capabilities";
import type { NudgeGroup, NudgeRow, RecentNudge } from "./fixtures";
import { isRecentlyNudged, canNudge as demoCanNudge } from "@/features/things/local-state";
import { useLocalVersion } from "@/features/things/use-local-version";
import { supabase } from "@/integrations/supabase/client";
import { keys } from "@/domain/query-keys";
import { useSession } from "@/hooks/useSession";
import { useAppContext } from "@/features/context/use-app-context";
import { isPreviewSession } from "@/lib/session-mode";
import type { NudgeReason } from "@/features/things/rpc";

function asRow(t: Thing, group: NudgeGroup, canNudge: boolean, reason: string, dbReason?: NudgeReason): NudgeRow {
  return {
    id: t.id,
    title: t.title,
    person: t.assignee.name,
    reason,
    dbReason,
    acknowledged: t.acknowledgement === "waiting_for_catch" ? "Waiting" : "Caught",
    workStatus: t.workStatus === "under_progress" ? "Under Progress" : t.workStatus === "sorted" ? "Sorted" : "Not Started",
    due: t.dueAt ? new Date(t.dueAt).toLocaleString() : "—",
    lastMovement: t.updatedAt,
    group,
    canNudge,
  };
}

function groupThing(t: Thing, recently: boolean): { group: NudgeGroup; reason: string } {
  if (t.acknowledgement === "waiting_for_catch") return { group: "waiting_for_catch", reason: "Waiting for Catch" };
  if (recently) return { group: "recently_nudged", reason: "Recently nudged" };
  const their = theirStateFor(t);
  if (their === "needs_attention") return { group: "stale", reason: "No recent movement" };
  if (t.workStatus === "under_progress") return { group: "caught_moving", reason: "Caught and moving" };
  return { group: "needs_a_tap", reason: "Needs a tap" };
}

export function useNudges() {
  const court = useCourt();
  const { session, user } = useSession();
  const { context } = useAppContext();
  const preview = isPreviewSession(session);
  const liveAuth = Boolean(session) && !preview;
  useLocalVersion();
  const liveThings = court.theirs.filter(isActiveThing);

  const nudgeable = useQuery({
    queryKey: keys.nudges(user?.id, context),
    enabled: liveAuth,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_nudgeable_things");
      if (error) throw error;
      return data ?? [];
    },
  });

  const history = useQuery({
    queryKey: keys.nudgeHistory(user?.id, context),
    enabled: liveAuth,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("nudges")
        .select("id, thing_id, created_at, reason, to_actor_id")
        .order("created_at", { ascending: false })
        .limit(40);
      if (error) throw error;
      return data ?? [];
    },
  });

  const derived = useMemo(() => {
    const rows: NudgeRow[] = [];
    const recent: RecentNudge[] = [];
    const allowed = new Set((nudgeable.data ?? []).map((n) => n.thing_id));
    const reasonByThing = new Map((nudgeable.data ?? []).map((n) => [n.thing_id, n.reason as NudgeReason]));
    const COOLDOWN_MS = 120 * 60 * 1000;
    const latestByThing = new Map<string, { created_at: string; reason: string }>();
    for (const n of history.data ?? []) {
      if (!latestByThing.has(n.thing_id)) latestByThing.set(n.thing_id, { created_at: n.created_at, reason: n.reason });
    }
    const isLiveRecent = (thingId: string) => {
      const hit = latestByThing.get(thingId);
      if (!hit) return false;
      return Date.now() - new Date(hit.created_at).getTime() < COOLDOWN_MS;
    };
    for (const t of liveThings) {
      if (t.workStatus === "sorted" || t.workStatus === "cancelled") continue;
      const recently = court.preview ? isRecentlyNudged(t.id) : isLiveRecent(t.id);
      const { group, reason } = groupThing(t, recently);
      const caps = getThingCapabilities(t, court.myActorId);
      const can = court.preview ? caps.canNudge && demoCanNudge(t.id) : caps.canNudge && allowed.has(t.id);
      rows.push(asRow(t, group, can, reason, reasonByThing.get(t.id)));
    }
    if (court.preview) {
      for (const t of liveThings.filter((x) => isRecentlyNudged(x.id))) {
        recent.push({ id: t.id, title: t.title, person: t.assignee.name, when: "Just now", state: "Recently nudged" });
      }
    } else {
      for (const [thingId, hit] of latestByThing) {
        if (Date.now() - new Date(hit.created_at).getTime() >= COOLDOWN_MS) continue;
        const t = liveThings.find((x) => x.id === thingId);
        if (!t) continue;
        recent.push({
          id: thingId,
          title: t.title,
          person: t.assignee.name,
          when: new Date(hit.created_at).toLocaleString(),
          state: hit.reason,
        });
      }
    }
    return { rows, recent };
  }, [liveThings, court.preview, court.myActorId, nudgeable.data, history.data]);

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

  // Rows are derived from Court, so they aren't ready until Court's own
  // query resolves — a prior version of this hook omitted court.isLoading
  // here, which let a still-loading Court render as "0 nudges / caught up"
  // for a moment. Eligibility (which rows *can* be nudged, and cooldown
  // history) resolves separately and more slowly, so it's exposed on its
  // own: callers should keep showing the rows they already have and only
  // gray out/disable the nudge action while eligibilityLoading is true,
  // rather than blocking the whole list on it.
  const rowsLoading = liveAuth && court.isLoading;
  const eligibilityLoading = liveAuth && (nudgeable.isLoading || history.isLoading);
  // Kept separate rather than merged into one `error`: a failed eligibility
  // check is not evidence a row is ineligible, and conflating it with a
  // failed row load meant AsyncState (which only surfaces an error when
  // there's no data at all) silently swallowed it whenever Court had
  // already loaded some rows — the eligibility failure just vanished,
  // rendered identically to "checked, and genuinely not eligible."
  const rowsError = court.error ?? null;
  const eligibilityError = nudgeable.error ?? history.error ?? null;
  const retryRows = useCallback(() => void court.refetch(), [court]);
  const retryEligibility = useCallback(() => {
    void nudgeable.refetch();
    void history.refetch();
  }, [nudgeable, history]);
  const retry = useCallback(() => {
    retryRows();
    retryEligibility();
  }, [retryRows, retryEligibility]);

  return {
    ...derived,
    counts,
    preview: court.preview,
    rowsLoading,
    // Rows come from Court, so "has this ever produced a confirmed
    // result" tracks Court's own hasFetchedOnce — see its definition for
    // why this can't just be derived from `!rowsLoading && !rowsError`.
    rowsHasFetchedOnce: court.hasFetchedOnce,
    eligibilityLoading,
    eligibilityError,
    // Backward-compatible combined flag/alias: reflects row readiness and
    // the row-load error only, per the note above — never blocks on
    // eligibility, which callers should surface separately via
    // eligibilityError.
    isLoading: rowsLoading,
    error: rowsError,
    retry,
    retryEligibility,
  };
}
