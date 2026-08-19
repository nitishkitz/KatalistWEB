import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { getMergedThings, getShredded, restoreLocal, useLocalVersion } from "@/features/things/local-state";
import { rpcRestore } from "@/features/things/rpc";
import { keys } from "@/domain/query-keys";

export type TrophyStats = {
  sorted: number;
  caught: number;
  inProgress: number;
  waiting: number;
  streak: string;
  weekly: number;
  achievement: string;
  shredded: { id: string; title: string; kind: string }[];
};

export function useTrophy() {
  const { session, user } = useSession();
  const preview = isPreviewSession(session);
  useLocalVersion();

  const query = useQuery({
    queryKey: keys.trophy(user?.id),
    queryFn: async (): Promise<TrophyStats> => {
      const { data: things, error } = await supabase
        .from("things")
        .select("id, title, work_status, acknowledgement, sorted_at, caught_at, updated_at");
      if (error) throw error;
      const rows = things ?? [];
      const sorted = rows.filter((t) => t.work_status === "sorted").length;
      const caught = rows.filter((t) => t.acknowledgement === "caught" || t.caught_at).length;
      const inProgress = rows.filter((t) => t.work_status === "under_progress").length;
      const waiting = rows.filter((t) => t.acknowledgement === "waiting_for_catch").length;
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const weekly = rows.filter((t) => new Date(t.updated_at).getTime() >= weekAgo).length;
      const { data: shreddedRows } = await supabase
        .from("profile_object_state")
        .select("object_id, object_type, shredded_at")
        .not("shredded_at", "is", null)
        .order("shredded_at", { ascending: false })
        .limit(10);
      return {
        sorted,
        caught,
        inProgress,
        waiting,
        streak: sorted > 0 ? `${Math.min(sorted, 7)}d` : "—",
        weekly,
        achievement: sorted > 0 ? "Movement on the board" : "—",
        shredded: (shreddedRows ?? []).map((s) => ({
          id: s.object_id,
          title: s.object_type,
          kind: s.object_type,
        })),
      };
    },
    enabled: Boolean(user) && !preview,
    staleTime: 15_000,
  });

  if (preview) {
    const things = getMergedThings();
    return {
      stats: {
        sorted: things.filter((t) => t.workStatus === "sorted").length,
        caught: things.filter((t) => t.acknowledgement === "caught").length,
        inProgress: things.filter((t) => t.workStatus === "under_progress").length,
        waiting: things.filter((t) => t.acknowledgement === "waiting_for_catch").length,
        streak: "—",
        weekly: things.filter((t) => t.workStatus === "under_progress").length,
        achievement: things.some((t) => t.workStatus === "sorted") ? "Movement on the board" : "—",
        shredded: getShredded().map((s) => ({ id: s.id, title: s.title, kind: s.kind })),
      } satisfies TrophyStats,
      restore: (id: string) => restoreLocal(id),
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
    restore: (id: string, kind: "thing" | "list" | "bucket" = "thing") => rpcRestore(id, kind),
    preview: false,
  };
}
