import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { getListById, getMergedThings } from "@/features/things/local-state";
import { useLocalVersion } from "@/features/things/use-local-version";
import { useCourt } from "@/features/court/use-court";
import type { Thing } from "@/domain/thing";
import { personOrSomeone, resolveActorPeople } from "@/features/people/resolve-actors";
import {
  excludePersonallyShreddedThings,
  isPersonallyShreddedList,
  usePersonalShred,
} from "@/features/things/personal-shred";

export function useListThings(listId: string | undefined) {
  const { session } = useSession();
  const preview = isPreviewSession(session);
  const version = useLocalVersion();
  const court = useCourt();
  const shred = usePersonalShred();
  const hidden = isPersonallyShreddedList(listId, shred);

  const query = useQuery({
    queryKey: ["list-things", listId],
    enabled: Boolean(listId) && !preview && !hidden,
    staleTime: 10_000,
    queryFn: async (): Promise<Thing[]> => {
      const { data, error } = await supabase
        .from("things")
        .select(
          "id,title,acknowledgement,work_status,owner_importance,assignee_personal_pace,due_at,due_has_time,context,list_id,creator_actor_id,owner_actor_id,current_assignee_actor_id,cancelled_at,sorted_at,caught_at,updated_at",
        )
        .eq("list_id", listId!);
      if (error) throw error;
      const ids = new Set<string>();
      for (const r of data ?? []) {
        ids.add(r.creator_actor_id);
        ids.add(r.owner_actor_id);
        ids.add(r.current_assignee_actor_id);
      }
      const people = await resolveActorPeople([...ids]);
      const fb = (id: string) => personOrSomeone(people, id);
      return (data ?? []).map((r) => ({
        id: r.id,
        title: r.title,
        creator: fb(r.creator_actor_id),
        owner: fb(r.owner_actor_id),
        assignee: fb(r.current_assignee_actor_id),
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
    if (!listId || hidden) return [];
    // List identity is UUID only — never listName
    if (preview) {
      if (!getListById(listId)) return [];
      return getMergedThings().filter((t) => t.listId === listId);
    }
    return excludePersonallyShreddedThings(query.data ?? [], shred);
  }, [preview, query.data, listId, version, shred, hidden]);

  return { things, isLoading: !preview && !hidden && query.isLoading, myActorId: court.myActorId };
}
