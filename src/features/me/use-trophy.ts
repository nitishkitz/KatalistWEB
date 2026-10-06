import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { callUngeneratedRpc } from "@/integrations/supabase/rpcs";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { getMergedThings, getShredded, restoreLocal } from "@/features/things/local-state";
import { useLocalVersion } from "@/features/things/use-local-version";
import { currentDemoActorId } from "@/features/demo/identities";
import { rpcRestore } from "@/features/things/rpc";
import { invalidatePersonalSurfaces } from "@/features/things/personal-shred";
import { keys } from "@/domain/query-keys";
import { getIdentityEpoch } from "@/features/realtime/identity-cache-policy";
import { computeStreak } from "@/features/nudges/escalation-logic";

/** Demo streak from the seeded sorted history, formatted like the live stat. */
function demoStreakLabel(things: { sortedAt: string | null }[]): string {
  const days = computeStreak(things.flatMap((t) => (t.sortedAt ? [t.sortedAt] : [])));
  return days > 0 ? `${days}d` : "—";
}

export type TrophyStats = {
  sorted: number;
  caught: number;
  inProgress: number;
  waiting: number;
  streak: string;
  weekly: number;
  achievement: string;
  shredded: { id: string; title: string; kind: "thing" | "list" | "bucket" }[];
};

export type TrophyReadState = "loading" | "ready" | "stale" | "error";

export function resolveTrophyReadState(preview: boolean, hasData: boolean, hasError: boolean): TrophyReadState {
  if (preview) return "ready";
  if (hasData) return hasError ? "stale" : "ready";
  return hasError ? "error" : "loading";
}

/**
 * Exported (not just a queryFn closure) so it's directly callable from
 * scripts/fetch-trophy-stats-concurrency.test.mjs — no extraction to a
 * separate module needed here, unlike fetchCourt/fetchBuckets/
 * fetchBucketItems: this file has no useAppContext (.tsx) import, so it
 * already loads fine in the plain Node test runner.
 */
export async function fetchTrophyStats(_profileId: string, _qc: QueryClient): Promise<TrophyStats> {
  // The invoker-scoped aggregate and Shred history are independent and
  // run together. Both are required: failure must not become a false zero.
  // The aggregate derives the caller's actor via auth.uid(), so this path
  // no longer transfers every activity row or needs the P4 actor cache.
  const [activity, { data: shreddedRows, error: shreddedError }] = await Promise.all([
    (async () => {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const { data, error } = await callUngeneratedRpc("get_trophy_activity_stats", { p_timezone: timezone });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as {
        sorted_count: number; caught_count: number; weekly_count: number; streak_days: number;
      } | null;
      if (!row) throw new Error("Trophy activity stats unavailable");
      return row;
    })(),
    supabase
      .from("profile_object_state")
      .select("object_id, object_type, shredded_at")
      .not("shredded_at", "is", null)
      .order("shredded_at", { ascending: false })
      .limit(10),
  ]);
  if (shreddedError) throw shreddedError;
  const sorted = activity.sorted_count;
  const caught = activity.caught_count;
  const weekly = activity.weekly_count;
  const streakDays = activity.streak_days;
  const thingIds = (shreddedRows ?? []).filter((s) => s.object_type === "thing").map((s) => s.object_id);
  const listIds = (shreddedRows ?? []).filter((s) => s.object_type === "list").map((s) => s.object_id);
  const bucketIds = (shreddedRows ?? []).filter((s) => s.object_type === "bucket").map((s) => s.object_id);
  // Each of these three depends only on shreddedRows above, not on each
  // other, so they also run concurrently. Unlike shreddedRows itself,
  // these are deliberately left decorative: they only resolve a display
  // *name* for an item whose shredded status is already established
  // above. A failed name lookup degrades to the object_type fallback
  // string below, rather than dropping the item or rejecting the batch.
  const [{ data: tnames }, { data: lnames }, { data: bnames }] = await Promise.all([
    thingIds.length
      ? supabase.from("things").select("id,title").in("id", thingIds)
      : Promise.resolve({ data: [] as { id: string; title: string }[] }),
    listIds.length
      ? supabase.from("lists").select("id,name").in("id", listIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    bucketIds.length
      ? supabase.from("buckets").select("id,name").in("id", bucketIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  return {
    sorted,
    caught,
    inProgress: 0,
    waiting: 0,
    streak: streakDays > 0 ? `${streakDays}d` : "—",
    weekly,
    achievement: sorted > 0 ? "Movement on the board" : "—",
    shredded: (shreddedRows ?? []).map((s) => ({
      id: s.object_id,
      title:
        tnames?.find((t) => t.id === s.object_id)?.title ??
        lnames?.find((l) => l.id === s.object_id)?.name ??
        bnames?.find((b) => b.id === s.object_id)?.name ??
        s.object_type,
      kind: (s.object_type === "list" || s.object_type === "bucket" ? s.object_type : "thing") as
        | "thing"
        | "list"
        | "bucket",
    })),
  };
}

export function useTrophy() {
  const { session, user } = useSession();
  const preview = isPreviewSession(session);
  const qc = useQueryClient();
  useLocalVersion();

  const query = useQuery({
    queryKey: keys.trophy(user?.id),
    queryFn: () => fetchTrophyStats(user!.id, qc),
    enabled: Boolean(user) && !preview,
    staleTime: 15_000,
  });


  if (preview) {
    const me = currentDemoActorId();
    const mineAssigned = getMergedThings().filter((t) => t.assignee.id === me);
    return {
      stats: {
        sorted: mineAssigned.filter((t) => t.workStatus === "sorted").length,
        caught: mineAssigned.filter((t) => t.acknowledgement === "caught").length,
        inProgress: mineAssigned.filter((t) => t.workStatus === "under_progress").length,
        waiting: mineAssigned.filter((t) => t.acknowledgement === "waiting_for_catch").length,
        streak: demoStreakLabel(mineAssigned),
        weekly: mineAssigned.filter((t) => t.workStatus === "under_progress").length,
        achievement: mineAssigned.some((t) => t.workStatus === "sorted") ? "Movement on the board" : "—",
        shredded: getShredded().map((s) => ({ id: s.id, title: s.title, kind: s.kind })),
      } satisfies TrophyStats,
      restore: (id: string, kind: "thing" | "list" | "bucket" = "thing") => restoreLocal(id, kind === "list" ? "list" : "thing"),
      preview: true,
      readState: "ready" as TrophyReadState,
      retry: () => undefined,
    };
  }

  return {
    stats: query.data ?? {
      sorted: 0,
      caught: 0,
      inProgress: 0,
      waiting: 0,
      streak: "—",
      weekly: 0,
      achievement: "—",
      shredded: [],
    },
    restore: async (id: string, kind: "thing" | "list" | "bucket" = "thing") => {
      // Captured before the first await, at the point this call started.
      const epoch = getIdentityEpoch(qc).epoch;
      await rpcRestore(id, kind);
      await invalidatePersonalSurfaces(qc, epoch);
    },
    preview: false,
    readState: resolveTrophyReadState(false, query.data !== undefined, query.isError),
    retry: () => { void query.refetch(); },
  };
}
