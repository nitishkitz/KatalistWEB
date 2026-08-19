import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { keys } from "@/domain/query-keys";
import { isActiveThing, partitionCourt, theirStateFor, type Thing } from "@/domain/thing";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { useAppContext } from "@/features/context/use-app-context";
import { currentDemoActorId } from "@/features/demo/identities";
import { canDemoActorViewThing } from "@/features/demo/visibility";
import { getMergedThings, getLists, useLocalVersion } from "@/features/things/local-state";
import { isPreviewSession } from "@/lib/session-mode";
import { personOrSomeone, resolveActorPeople } from "@/features/people/resolve-actors";

async function fetchCourt(context: "work" | "home"): Promise<{ things: Thing[]; myActorId: string | null }> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { things: [], myActorId: null };

  const { data: actor } = await supabase.from("actors").select("id").eq("profile_id", auth.user.id).maybeSingle();
  const myActorId = actor?.id ?? null;

  const { data: rows, error } = await supabase
    .from("things")
    .select(
      "id,title,acknowledgement,work_status,owner_importance,assignee_personal_pace,due_at,due_has_time,context,list_id,creator_actor_id,owner_actor_id,current_assignee_actor_id,cancelled_at,sorted_at,caught_at,updated_at",
    )
    .eq("context", context)
    .is("cancelled_at", null);

  if (error) throw error;

  const actorIds = new Set<string>();
  for (const r of rows ?? []) {
    actorIds.add(r.creator_actor_id);
    actorIds.add(r.owner_actor_id);
    actorIds.add(r.current_assignee_actor_id);
  }

  const people = await resolveActorPeople([...actorIds]);
  const fallback = (id: string) => personOrSomeone(people, id);

  const listIds = [...new Set((rows ?? []).map((r) => r.list_id).filter(Boolean))] as string[];
  const listNames = new Map<string, string>();
  if (listIds.length) {
    const { data: lists } = await supabase.from("lists").select("id,name").in("id", listIds);
    for (const l of lists ?? []) listNames.set(l.id, l.name);
  }

  const things: Thing[] = (rows ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    creator: fallback(r.creator_actor_id),
    owner: fallback(r.owner_actor_id),
    assignee: fallback(r.current_assignee_actor_id),
    acknowledgement: r.acknowledgement,
    workStatus: r.work_status,
    ownerImportance: r.owner_importance,
    personalPace: r.assignee_personal_pace,
    dueAt: r.due_at,
    dueHasTime: r.due_has_time,
    context: r.context,
    listId: r.list_id,
    listName: r.list_id ? (listNames.get(r.list_id) ?? "List") : "Standalone",
    cancelledAt: r.cancelled_at,
    sortedAt: r.sorted_at,
    caughtAt: r.caught_at,
    updatedAt: r.updated_at,
  }));

  return { things, myActorId };
}

export function useCourt() {
  const { session, user } = useSession();
  const preview = isPreviewSession(session);
  const liveAuth = Boolean(session) && !preview;
  const { context } = useAppContext();
  useLocalVersion();

  const query = useQuery({
    queryKey: keys.court(user?.id, context),
    queryFn: () => fetchCourt(context),
    staleTime: 15_000,
    enabled: liveAuth,
  });

  const source = useMemo(() => {
    if (preview) {
      const me = currentDemoActorId();
      const lists = getLists();
      const things = getMergedThings()
        .filter((t) => t.context === context)
        .filter((t) => canDemoActorViewThing(t, me, lists));
      return { things, myActorId: me, live: false as const };
    }
    return {
      things: query.data?.things ?? [],
      myActorId: query.data?.myActorId ?? null,
      live: true as const,
    };
  }, [preview, query.data, context]);

  const parts = partitionCourt(source.things, source.myActorId ?? "");
  const theirs = parts.theirs;

  return {
    isLoading: liveAuth && query.isLoading,
    error: query.error,
    live: source.live,
    preview,
    now: parts.now,
    next: parts.next,
    later: parts.later,
    theirs,
    all: source.things.filter(isActiveThing),
    myActorId: source.myActorId,
    theirGroups: {
      waiting_for_catch: theirs.filter((t) => theirStateFor(t) === "waiting_for_catch"),
      moving: theirs.filter((t) => theirStateFor(t) === "moving"),
      needs_attention: theirs.filter((t) => theirStateFor(t) === "needs_attention"),
    },
    refetch: query.refetch,
    context,
  };
}
