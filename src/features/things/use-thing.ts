import { useQuery } from "@tanstack/react-query";
import { keys } from "@/domain/query-keys";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { getThing, useLocalVersion } from "./local-state";
import type { Thing } from "@/domain/thing";
import { personOrSomeone, resolveActorPeople } from "@/features/people/resolve-actors";

async function fetchThing(thingId: string): Promise<Thing | null> {
  const { data, error } = await supabase
    .from("things")
    .select(
      "id,title,acknowledgement,work_status,owner_importance,assignee_personal_pace,due_at,due_has_time,context,list_id,creator_actor_id,owner_actor_id,current_assignee_actor_id,cancelled_at,sorted_at,caught_at,updated_at",
    )
    .eq("id", thingId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const ids = [data.creator_actor_id, data.owner_actor_id, data.current_assignee_actor_id];
  const people = await resolveActorPeople(ids);
  const fallback = (id: string) => personOrSomeone(people, id);
  let listName: string | null = null;
  if (data.list_id) {
    const { data: list } = await supabase.from("lists").select("name").eq("id", data.list_id).maybeSingle();
    listName = list?.name ?? "List";
  }

  return {
    id: data.id,
    title: data.title,
    creator: fallback(data.creator_actor_id),
    owner: fallback(data.owner_actor_id),
    assignee: fallback(data.current_assignee_actor_id),
    acknowledgement: data.acknowledgement,
    workStatus: data.work_status,
    ownerImportance: data.owner_importance,
    personalPace: data.assignee_personal_pace,
    dueAt: data.due_at,
    dueHasTime: data.due_has_time,
    context: data.context,
    listId: data.list_id,
    listName,
    cancelledAt: data.cancelled_at,
    sortedAt: data.sorted_at,
    caughtAt: data.caught_at,
    updatedAt: data.updated_at,
  };
}

export function useThing(thingId: string | null) {
  const { session } = useSession();
  const preview = isPreviewSession(session);
  useLocalVersion();

  const query = useQuery({
    queryKey: keys.thing(thingId ?? "none"),
    queryFn: () => fetchThing(thingId!),
    enabled: Boolean(thingId) && !preview,
    staleTime: 10_000,
  });

  if (!thingId) return { thing: null, isLoading: false };
  if (preview) return { thing: getThing(thingId) ?? null, isLoading: false };
  return { thing: query.data ?? null, isLoading: query.isLoading, error: query.error };
}
