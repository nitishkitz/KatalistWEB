import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { keys } from "@/domain/query-keys";
import { isActiveThing, laneOf, theirStateFor, type Thing, type Person } from "@/domain/thing";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { useAppContext } from "@/features/context/use-app-context";
import { courtFixtures, MY_ACTOR_ID } from "./fixtures";

type ActorRow = {
  id: string;
  profile_id: string | null;
  profiles: { display_name: string; avatar_url: string | null } | null;
};

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

async function fetchCourt(context: "work" | "home"): Promise<{ things: Thing[]; myActorId: string | null }> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { things: [], myActorId: null };

  const { data: actor } = await supabase
    .from("actors")
    .select("id")
    .eq("profile_id", auth.user.id)
    .maybeSingle();
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

  const people = new Map<string, Person>();
  if (actorIds.size) {
    const { data: actorRows } = await supabase
      .from("actors")
      .select("id, profile_id, profiles(display_name, avatar_url)")
      .in("id", [...actorIds]);
    for (const a of (actorRows ?? []) as unknown as ActorRow[]) {
      people.set(a.id, toPerson(a.id, a.profiles?.display_name ?? null, a.profiles?.avatar_url));
    }
  }

  const listIds = [...new Set((rows ?? []).map((r) => r.list_id).filter(Boolean))] as string[];
  const listNames = new Map<string, string>();
  if (listIds.length) {
    const { data: lists } = await supabase.from("lists").select("id,name").in("id", listIds);
    for (const l of lists ?? []) listNames.set(l.id, l.name);
  }

  const fallback = (id: string) => people.get(id) ?? toPerson(id, "Someone");

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
  const { session } = useSession();
  const isAuthenticated = Boolean(session) && session?.app_metadata?.provider !== "demo";
  const { context } = useAppContext();

  const query = useQuery({
    queryKey: keys.court(isAuthenticated ? "me" : "preview", context),
    queryFn: () => fetchCourt(context),
    staleTime: 15_000,
  });

  const source = useMemo(() => {
    const live = (query.data?.things ?? []).filter(isActiveThing);
    if (live.length > 0) {
      return { things: live, myActorId: query.data?.myActorId ?? null, live: true };
    }
    // Design-preview dataset matches locked Court screenshot when live data is empty
    return { things: courtFixtures.filter(isActiveThing), myActorId: MY_ACTOR_ID, live: false };
  }, [query.data]);

  const now = source.things.filter((t) => laneOf(t) === "now");
  const next = source.things.filter((t) => laneOf(t) === "next");
  const later = source.things.filter((t) => laneOf(t) === "later");
  const theirs = source.things.filter((t) => t.assignee.id !== source.myActorId);

  return {
    isLoading: query.isLoading,
    error: query.error,
    live: source.live,
    now,
    next,
    later,
    theirs,
    theirGroups: {
      waiting_for_catch: theirs.filter((t) => theirStateFor(t) === "waiting_for_catch"),
      moving: theirs.filter((t) => theirStateFor(t) === "moving"),
      needs_attention: theirs.filter((t) => theirStateFor(t) === "needs_attention"),
    },
    refetch: query.refetch,
  };
}
