import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { keys } from "@/domain/query-keys";
import { isActiveThing, partitionCourt, theirStateFor, type Thing } from "@/domain/thing";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { useAppContext } from "@/features/context/use-app-context";
import { accessibleDemoThings } from "@/features/things/local-state";
import { useLocalVersion } from "@/features/things/use-local-version";
import { isPreviewSession } from "@/lib/session-mode";
import { mapDbThingRows, THING_COLUMNS, type DbThingRow } from "@/features/things/map-thing-rows";
import { excludePersonallyShreddedThings, usePersonalShred } from "@/features/things/personal-shred";
import { useCurrentActor } from "@/features/people/use-current-actor";

async function fetchCourt(context: "work" | "home"): Promise<Thing[]> {
  const { data: rows, error } = await supabase
    .from("things")
    .select(THING_COLUMNS)
    .eq("context", context)
    .is("cancelled_at", null);

  if (error) throw error;
  return mapDbThingRows((rows ?? []) as DbThingRow[]);
}

export function useCourt() {
  const { session, user } = useSession();
  const preview = isPreviewSession(session);
  const liveAuth = Boolean(session) && !preview;
  const { context } = useAppContext();
  const localVersion = useLocalVersion();
  const shred = usePersonalShred();
  const currentActor = useCurrentActor();

  const query = useQuery({
    queryKey: keys.court(user?.id, context),
    queryFn: () => fetchCourt(context),
    staleTime: 15_000,
    enabled: liveAuth,
  });

  const source = useMemo(() => {
    void localVersion;
    if (preview) {
      return {
        things: accessibleDemoThings(context),
        myActorId: currentActor.actorId,
        live: false as const,
      };
    }
    return {
      things: excludePersonallyShreddedThings(query.data ?? [], shred),
      myActorId: currentActor.actorId,
      live: true as const,
    };
  }, [preview, query.data, context, shred, localVersion, currentActor.actorId]);

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
