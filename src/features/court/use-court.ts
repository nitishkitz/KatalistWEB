import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { keys } from "@/domain/query-keys";
import { isActiveThing, partitionCourt, theirStateFor, type Thing } from "@/domain/thing";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { useAppContext } from "@/features/context/use-app-context";
import { currentDemoActorId } from "@/features/demo/identities";
import { canDemoActorViewThing } from "@/features/demo/visibility";
import { getMergedThings, getLists } from "@/features/things/local-state";
import { useLocalVersion } from "@/features/things/use-local-version";
import { isPreviewSession } from "@/lib/session-mode";
import { mapDbThingRows, THING_COLUMNS, type DbThingRow } from "@/features/things/map-thing-rows";

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
  const things = await mapDbThingRows((rows ?? []) as DbThingRow[]);
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
