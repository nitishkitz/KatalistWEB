import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { getMergedThings, useLocalVersion } from "@/features/things/local-state";
import { useCourt } from "@/features/court/use-court";
import type { Thing, Person } from "@/domain/thing";

function toPerson(id: string, name: string | null): Person {
  const n = name || "Someone";
  return {
    id,
    name: n,
    initials: n
      .split(" ")
      .map((p) => p[0])
      .slice(0, 2)
      .join("")
      .toUpperCase(),
  };
}

export function useListThings(listId: string | undefined) {
  const { session } = useSession();
  const preview = isPreviewSession(session);
  const version = useLocalVersion();
  const court = useCourt();

  const query = useQuery({
    queryKey: ["list-things", listId],
    enabled: Boolean(listId) && !preview,
    staleTime: 10_000,
    queryFn: async (): Promise<Thing[]> => {
      const { data, error } = await supabase
        .from("things")
        .select(
          "id,title,acknowledgement,work_status,owner_importance,assignee_personal_pace,due_at,due_has_time,context,list_id,creator_actor_id,owner_actor_id,current_assignee_actor_id,cancelled_at,sorted_at,caught_at,updated_at",
        )
        .eq("list_id", listId!);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        title: r.title,
        creator: toPerson(r.creator_actor_id, null),
        owner: toPerson(r.owner_actor_id, null),
        assignee: toPerson(r.current_assignee_actor_id, null),
        acknowledgement: r.acknowledgement,
        workStatus: r.work_status,
        ownerImportance: r.owner_importance,
        personalPace: r.assignee_personal_pace,
        dueAt: r.due_at,
        dueHasTime: r.due_has_time,
        context: r.context,
        listId: r.list_id,
        listName: null,
        cancelledAt: r.cancelled_at,
        sortedAt: r.sorted_at,
        caughtAt: r.caught_at,
        updatedAt: r.updated_at,
      }));
    },
  });

  const things = useMemo(() => {
    if (preview) return getMergedThings().filter((t) => t.listId === listId || t.listName);
    return query.data ?? [];
  }, [preview, query.data, listId, version]);

  return { things, isLoading: !preview && query.isLoading, myActorId: court.myActorId };
}
