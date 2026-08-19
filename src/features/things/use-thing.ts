import { useQuery } from "@tanstack/react-query";
import { keys } from "@/domain/query-keys";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { getThing, useLocalVersion } from "./local-state";
import type { Person, Thing } from "@/domain/thing";

function toPerson(id: string, name: string | null, avatar?: string | null): Person {
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
    avatarUrl: avatar,
  };
}

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
  const { data: actors } = await supabase
    .from("actors")
    .select("id, profiles(display_name, avatar_url)")
    .in("id", ids);
  const people = new Map<string, Person>();
  for (const a of actors ?? []) {
    const profile = (a as { profiles?: { display_name?: string; avatar_url?: string | null } }).profiles;
    people.set(a.id, toPerson(a.id, profile?.display_name ?? null, profile?.avatar_url));
  }
  const fallback = (id: string) => people.get(id) ?? toPerson(id, "Someone");
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
