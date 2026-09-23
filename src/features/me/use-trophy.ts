import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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

/**
 * Exported (not just a queryFn closure) so it's directly callable from
 * scripts/fetch-trophy-stats-concurrency.test.mjs — no extraction to a
 * separate module needed here, unlike fetchCourt/fetchBuckets/
 * fetchBucketItems: this file has no useAppContext (.tsx) import, so it
 * already loads fine in the plain Node test runner.
 */
export async function fetchTrophyStats(profileId: string): Promise<TrophyStats> {
  // The actor+events chain and the shredded-objects lookup are
  // independent of each other (shredded rows aren't filtered by actorId
  // at all — profile_object_state is scoped to the caller by RLS), so
  // they run concurrently instead of one after another.
  // The activity-events count/streak and the Shred history are stats,
  // not decorative: a failed read must not masquerade as "you haven't
  // sorted/shredded anything" (a false zero). .maybeSingle() already
  // distinguishes a genuinely-absent actor row ({ data: null,
  // error: null }, which legitimately means "no activity yet") from an
  // actual read failure (error set) — same distinction as
  // fetch-court.ts's actor lookup.
  const [mine, { data: shreddedRows, error: shreddedError }] = await Promise.all([
    (async () => {
      const { data: actor, error: actorError } = await supabase
        .from("actors")
        .select("id")
        .eq("profile_id", profileId)
        .maybeSingle();
      if (actorError) throw actorError;
      const { data: events, error } = await supabase
        .from("thing_activity")
        .select("event, created_at, actor_id")
        .eq("actor_id", actor?.id ?? "00000000-0000-0000-0000-000000000000");
      if (error) throw error;
      return events ?? [];
    })(),
    supabase
      .from("profile_object_state")
      .select("object_id, object_type, shredded_at")
      .not("shredded_at", "is", null)
      .order("shredded_at", { ascending: false })
      .limit(10),
  ]);
  if (shreddedError) throw shreddedError;
  const sorted = mine.filter((e) => e.event === "sorted").length;
  const caught = mine.filter((e) => e.event === "caught").length;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const weekly = mine.filter((e) => new Date(e.created_at).getTime() >= weekAgo).length;
  // Real consecutive-day streak from "sorted" events (shared, unit-tested logic).
  const streakDays = computeStreak(mine.filter((e) => e.event === "sorted").map((e) => e.created_at as string));
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
    queryFn: () => fetchTrophyStats(user!.id),
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
        streak: "—",
        weekly: mineAssigned.filter((t) => t.workStatus === "under_progress").length,
        achievement: mineAssigned.some((t) => t.workStatus === "sorted") ? "Movement on the board" : "—",
        shredded: getShredded().map((s) => ({ id: s.id, title: s.title, kind: s.kind })),
      } satisfies TrophyStats,
      restore: (id: string, kind: "thing" | "list" | "bucket" = "thing") => restoreLocal(id, kind === "list" ? "list" : "thing"),
      preview: true,
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
  };
}
