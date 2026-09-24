import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { getListById, getMergedThings } from "@/features/things/local-state";
import { useLocalVersion } from "@/features/things/use-local-version";
import { useCourt } from "@/features/court/use-court";
import type { Thing } from "@/domain/thing";
import {
  excludePersonallyShreddedThings,
  isPersonallyShreddedList,
  usePersonalShred,
} from "@/features/things/personal-shred";
import { withReadDeadline } from "@/lib/read-request";
import { THING_COLUMNS, type DbThingRow, mapDbThingRows } from "@/features/things/map-thing-rows";

export function useListThings(listId: string | undefined) {
  const { session } = useSession();
  const preview = isPreviewSession(session);
  const version = useLocalVersion();
  const court = useCourt();
  const shred = usePersonalShred();
  const hidden = isPersonallyShreddedList(listId, shred);
  const myActorId = court.myActorId;

  const query = useQuery({
    // T05: myActorId is in the key (not just used inside queryFn) so a Thing
    // list fetched before the actor lookup resolved is refetched with the
    // correct viewer identity once it does -- otherwise comment counts would
    // be computed against a stale/missing myActorId and never self-correct.
    queryKey: ["list-things", listId, myActorId],
    enabled: Boolean(listId) && !preview && !hidden,
    staleTime: 10_000,
    queryFn: async ({ signal }): Promise<Thing[]> => {
      const { data, error } = await withReadDeadline(signal, async (combined) =>
        supabase
          .from("things")
          .select(THING_COLUMNS)
          .eq("list_id", listId!)
          .abortSignal(combined),
      );
      if (error) throw error;
      // Reuses the same mapping Court uses so List picks up the same
      // comment/attachment counts, viewer-scoped unread comparisons, and
      // failure-vs-zero distinction -- this route previously hand-rolled a
      // narrower mapping that never computed comment counts at all.
      return mapDbThingRows((data ?? []) as DbThingRow[], myActorId);
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
    // version forces re-derivation when local-state's mutable module-level
    // store changes (used by getMergedThings()/getListById() above); the
    // linter can't see that indirection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, query.data, listId, version, shred, hidden]);

  return { things, isLoading: !preview && !hidden && query.isLoading, myActorId: court.myActorId };
}
