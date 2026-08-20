import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { getMergedThings, getShredded, restoreLocal } from "@/features/things/local-state";
import { useLocalVersion } from "@/features/things/use-local-version";
import { currentDemoActorId } from "@/features/demo/identities";
import { rpcRestore } from "@/features/things/rpc";
import { keys } from "@/domain/query-keys";

export type TrophyObjectKind = "thing" | "list" | "bucket";

export type TrophyStats = {
  sorted: number;
  caught: number;
  inProgress: number;
  waiting: number;
  streak: string;
  weekly: number;
  achievement: string;
  shredded: { id: string; title: string; kind: TrophyObjectKind }[];
};

export function useTrophy() {
  const { session, user } = useSession();
  const preview = isPreviewSession(session);
  useLocalVersion();

  const query = useQuery({
    queryKey: keys.trophy(user?.id),
    queryFn: async (): Promise<TrophyStats> => {
      const { data: actor } = await supabase.from("actors").select("id").eq("profile_id", user!.id).maybeSingle();
      const actorId = actor?.id;
      const { data: events, error } = await supabase
        .from("thing_activity")
        .select("event, created_at, actor_id")
        .eq("actor_id", actorId ?? "00000000-0000-0000-0000-000000000000");
      if (error) throw error;
      const mine = events ?? [];
      const sorted = mine.filter((e) => e.event === "sorted").length;
      const caught = mine.filter((e) => e.event === "caught").length;
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const weekly = mine.filter((e) => new Date(e.created_at).getTime() >= weekAgo).length;
      const { data: shreddedRows } = await supabase
        .from("profile_object_state")
        .select("object_id, object_type, shredded_at")
        .not("shredded_at", "is", null)
        .order("shredded_at", { ascending: false })
        .limit(10);
      const thingIds = (shreddedRows ?? []).filter((s) => s.object_type === "thing").map((s) => s.object_id);
      const listIds = (shreddedRows ?? []).filter((s) => s.object_type === "list").map((s) => s.object_id);
      const bucketIds = (shreddedRows ?? []).filter((s) => s.object_type === "bucket").map((s) => s.object_id);
      const { data: tnames } = thingIds.length ? await supabase.from("things").select("id,title").in("id", thingIds) : { data: [] };
      const { data: lnames } = listIds.length ? await supabase.from("lists").select("id,name").in("id", listIds) : { data: [] };
      const { data: bnames } = bucketIds.length ? await supabase.from("buckets").select("id,name").in("id", bucketIds) : { data: [] };
      return {
        sorted,
        caught,
        inProgress: 0,
        waiting: 0,
        streak: sorted > 0 ? `${Math.min(sorted, 7)}d` : "—",
        weekly,
        achievement: sorted > 0 ? "Movement on the board" : "—",
        shredded: (shreddedRows ?? []).map((s) => ({
          id: s.object_id,
          title:
            tnames?.find((t) => t.id === s.object_id)?.title ??
            lnames?.find((l) => l.id === s.object_id)?.name ??
            bnames?.find((b) => b.id === s.object_id)?.name ??
            s.object_type,
          kind: s.object_type,
        })),
      };
    },
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
      restore: (id: string, kind: TrophyObjectKind = "thing") => restoreLocal(id, kind === "list" ? "list" : "thing"),
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
    restore: (id: string, kind: TrophyObjectKind = "thing") => rpcRestore(id, kind),
    preview: false,
  };
}
