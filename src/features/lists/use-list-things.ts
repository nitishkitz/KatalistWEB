import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { getListById, getMergedThings } from "@/features/things/local-state";
import { useLocalVersion } from "@/features/things/use-local-version";
import { useCurrentActor } from "@/features/people/use-current-actor";
import type { Thing } from "@/domain/thing";
import { keys } from "@/domain/query-keys";
import { mapDbThingRows, THING_COLUMNS, type DbThingRow } from "@/features/things/map-thing-rows";
import {
  excludePersonallyShreddedThings,
  isPersonallyShreddedList,
  usePersonalShred,
} from "@/features/things/personal-shred";

export function useListThings(listId: string | undefined) {
  const { session } = useSession();
  const preview = isPreviewSession(session);
  const version = useLocalVersion();
  const currentActor = useCurrentActor();
  const shred = usePersonalShred();
  const hidden = isPersonallyShreddedList(listId, shred);

  const query = useQuery({
    queryKey: listId ? keys.listThings(listId) : ["list-things", listId],
    enabled: Boolean(listId) && !preview && !hidden,
    staleTime: 10_000,
    queryFn: async (): Promise<Thing[]> => {
      const { data, error } = await supabase
        .from("things")
        .select(THING_COLUMNS)
        .eq("list_id", listId!);
      if (error) throw error;
      return mapDbThingRows((data ?? []) as DbThingRow[]);
    },
  });

  const things = useMemo(() => {
    void version;
    if (!listId || hidden) return [];
    // List identity is UUID only — never listName
    if (preview) {
      if (!getListById(listId)) return [];
      return getMergedThings().filter((t) => t.listId === listId);
    }
    return excludePersonallyShreddedThings(query.data ?? [], shred);
  }, [preview, query.data, listId, version, shred, hidden]);

  return { things, isLoading: !preview && !hidden && query.isLoading, myActorId: currentActor.actorId };
}
