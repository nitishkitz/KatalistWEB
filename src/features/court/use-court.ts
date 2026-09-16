import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { keys } from "@/domain/query-keys";
import { isActiveThing, partitionCourt, theirStateFor, type Thing } from "@/domain/thing";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { useAppContext } from "@/features/context/use-app-context";
import { currentDemoActorId, currentDemoPerson } from "@/features/demo/identities";
import { accessibleDemoThings, getComments, getSnoozedIds } from "@/features/things/local-state";
import { useLocalVersion } from "@/features/things/use-local-version";
import { isPreviewSession } from "@/lib/session-mode";
import { mapDbThingRows, THING_COLUMNS, type DbThingRow } from "@/features/things/map-thing-rows";
import { excludePersonallyShreddedThings, usePersonalShred } from "@/features/things/personal-shred";
import { excludeSnoozedThings, usePersonalSnooze } from "@/features/things/personal-snooze";
import { calculateCommentCounts, getThingLastReadAt, useThingReadState } from "@/features/things/read-state";

async function fetchCourt(context: "work" | "home"): Promise<{ things: Thing[]; myActorId: string | null }> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { things: [], myActorId: null };

  const { data: actor } = await supabase.from("actors").select("id").eq("profile_id", auth.user.id).maybeSingle();
  const myActorId = actor?.id ?? null;

  const { data: rows, error } = await supabase
    .from("things")
    .select(THING_COLUMNS)
    .eq("context", context)
    .is("cancelled_at", null);

  if (error) throw error;
  const things = await mapDbThingRows((rows ?? []) as DbThingRow[], myActorId);
  return { things, myActorId };
}

export function useCourt() {
  const { session, user } = useSession();
  const preview = isPreviewSession(session);
  const liveAuth = Boolean(session) && !preview;
  const { context } = useAppContext();
  useLocalVersion();
  const shred = usePersonalShred();
  const snooze = usePersonalSnooze();
  const readVersion = useThingReadState();

  const query = useQuery({
    queryKey: keys.court(user?.id, context),
    queryFn: () => fetchCourt(context),
    staleTime: 15_000,
    enabled: liveAuth,
  });

  const source = useMemo(() => {
    if (preview) {
      const me = currentDemoActorId();
      const mePerson = currentDemoPerson();
      const snoozedIds = getSnoozedIds();
      const things = accessibleDemoThings(context)
        .filter((t) => !snoozedIds.has(t.id))
        .map((t) => {
        const localComments = getComments(t.id);
        const counts = calculateCommentCounts(
          t.id,
          localComments.map((c) => ({
            author: c.author,
            createdAt: c.at,
          })),
          me,
          mePerson.name,
        );
        return {
          ...t,
          commentCount: counts.commentCount,
          unreadCommentCount: counts.unreadCommentCount,
        };
      });
      return { things, myActorId: me, live: false as const };
    }
    const visibleThings = excludeSnoozedThings(
      excludePersonallyShreddedThings(query.data?.things ?? [], shred),
      snooze,
    );
    const liveThings = visibleThings.map((t) => {
      const lastRead = getThingLastReadAt(t.id);
      if (lastRead > 0 && (t.unreadCommentCount ?? 0) > 0) {
        return {
          ...t,
          unreadCommentCount: 0,
        };
      }
      return t;
    });
    return {
      things: liveThings,
      myActorId: query.data?.myActorId ?? null,
      live: true as const,
    };
  }, [preview, query.data, context, shred, snooze, readVersion]);

  const parts = partitionCourt(source.things, source.myActorId ?? "");
  const theirs = parts.theirs;
  const completedCount = useMemo(
    () => source.things.filter((t) => t.workStatus === "sorted" || Boolean(t.sortedAt)).length,
    [source.things],
  );

  return {
    isLoading: liveAuth && query.isLoading,
    error: query.error,
    live: source.live,
    preview,
    now: parts.now,
    next: parts.next,
    later: parts.later,
    theirs,
    completedCount,
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
