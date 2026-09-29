import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { getThing, getListById } from "@/features/things/local-state";
import { currentDemoActorId } from "@/features/demo/identities";
import type { NotificationItem, NotificationThing } from "./notification-model";

export function useNotificationTargets(items: NotificationItem[], enabled: boolean, preview: boolean) {
  const { user } = useSession();
  const thingIds = [...new Set(items.flatMap((item) => item.thingId ? [item.thingId] : []))].sort();
  const listIds = [...new Set(items.flatMap((item) => item.listId ? [item.listId] : []))].sort();
  const query = useQuery({
    queryKey: ["notifications", user?.id, "targets", thingIds, listIds],
    enabled: enabled && Boolean(user) && !preview,
    staleTime: 0,
    queryFn: async ({ signal }) => {
      const [things, lists, actor] = await Promise.all([
        thingIds.length ? supabase.from("things").select("id,title,owner_actor_id,current_assignee_actor_id,acknowledgement,work_status,cancelled_at").in("id", thingIds).abortSignal(signal) : Promise.resolve({ data: [], error: null }),
        listIds.length ? supabase.from("lists").select("id,name,kind").in("id", listIds).abortSignal(signal) : Promise.resolve({ data: [], error: null }),
        supabase.from("actors").select("id").eq("profile_id", user!.id).abortSignal(signal).maybeSingle(),
      ]);
      if (things.error) throw things.error;
      if (lists.error) throw lists.error;
      if (actor.error) throw actor.error;
      return { things: things.data ?? [], lists: lists.data ?? [], actorId: actor.data?.id ?? null };
    },
  });
  if (preview) {
    const things: NotificationThing[] = thingIds.flatMap((id) => {
      const t = getThing(id);
      return t ? [{ id, title: t.title, owner_actor_id: t.owner.id, current_assignee_actor_id: t.assignee.id, acknowledgement: t.acknowledgement, work_status: t.workStatus, cancelled_at: t.cancelledAt ?? null }] : [];
    });
    return { things, lists: listIds.flatMap((id) => { const l = getListById(id); return l ? [{ id, name: l.name, kind: "list" }] : []; }), actorId: currentDemoActorId(), ready: true, error: null, retry: query.refetch };
  }
  return { things: query.data?.things ?? [], lists: query.data?.lists ?? [], actorId: query.data?.actorId ?? null, ready: !query.isFetching && !query.isError && Boolean(query.data), error: query.error, retry: query.refetch };
}
