import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { keys } from "@/domain/query-keys";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { useAppContext } from "@/features/context/use-app-context";
import { isPreviewSession } from "@/lib/session-mode";
import { getLists } from "@/features/things/local-state";
import { useLocalVersion } from "@/features/things/use-local-version";
import { rpcCreateList } from "@/features/things/rpc";
import {
  excludePersonallyShreddedList,
  excludePersonallyShreddedLists,
  isPersonallyShreddedList,
  usePersonalShred,
} from "@/features/things/personal-shred";
import { mapDbListRows, type DbListRow } from "./map-list-rows";
import { fetchListDetail } from "./fetch-list-detail";
import { getListDetailSeed } from "./list-detail-seed";
import type { ListRow } from "./fixtures";
import { getIdentityEpoch, isEpochCurrent } from "@/features/realtime/identity-cache-policy";

async function fetchLists(profileId: string, context: "work" | "home"): Promise<ListRow[]> {
  const columns = "id,name,context,owner_profile_id,updated_at,description,cover_storage_path";
  // Only task lists here — conversation-kind rows (dm/group) belong to the Team hub.
  // The `kind` column ships with the Team hub migration; until it is applied we
  // fall back to an unfiltered query so the Lists surface keeps working.
  let { data: lists, error } = await supabase
    .from("lists")
    .select(columns)
    .eq("context", context)
    .eq("kind", "list")
    .is("archived_at", null);
  if (error && /kind/i.test(error.message ?? "")) {
    ({ data: lists, error } = await supabase
      .from("lists")
      .select(columns)
      .eq("context", context)
      .is("archived_at", null));
  }
  if (error) throw error;
  return mapDbListRows(profileId, (lists ?? []) as DbListRow[]);
}

export function useLists() {
  const { session, user } = useSession();
  const { context } = useAppContext();
  const preview = isPreviewSession(session);
  const version = useLocalVersion();
  const qc = useQueryClient();
  const shred = usePersonalShred();

  const query = useQuery({
    queryKey: keys.lists(user?.id, context),
    queryFn: () => fetchLists(user!.id, context),
    enabled: Boolean(user) && !preview,
    staleTime: 15_000,
  });

  const lists = useMemo(() => {
    if (preview) return getLists().filter((l) => l.context === context);
    return excludePersonallyShreddedLists(query.data ?? [], shred);
    // version forces re-derivation when local-state's mutable module-level
    // store changes (used by getLists() above); the linter can't see that
    // indirection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, query.data, context, version, shred]);

  const create = useMutation({
    mutationFn: (input: { name: string; description?: string | null }) =>
      rpcCreateList({ ...input, context }),
    onMutate: () => ({ epoch: getIdentityEpoch(qc).epoch }),
    onSuccess: async (_data, _vars, mutationContext) => {
      if (isEpochCurrent(qc, mutationContext.epoch)) {
        await qc.invalidateQueries({ queryKey: keys.lists(user?.id, context) });
      }
    },
  });

  const refetch = async () => {
    const epoch = getIdentityEpoch(qc).epoch;
    if (isEpochCurrent(qc, epoch)) await qc.invalidateQueries({ queryKey: keys.lists(user?.id, context) });
  };

  return {
    lists,
    isLoading: !preview && query.isLoading,
    // Whether this query has ever produced a real result, distinct from
    // `!isLoading` — react-query's `isLoading` is false while a query is
    // "paused" offline (never fetched, no error, no data), which would
    // otherwise look identical to a confirmed empty result. `query.data`
    // itself persists across later pauses/errors once populated, so this
    // stays true even if a later background refetch fails.
    hasFetchedOnce: preview || query.data !== undefined,
    error: query.error,
    preview,
    create,
    refetch,
  };
}

export function useList(listId: string | undefined) {
  const { session, user } = useSession();
  const { context } = useAppContext();
  const preview = isPreviewSession(session);
  const shred = usePersonalShred();
  const hidden = isPersonallyShreddedList(listId, shred);
  const qc = useQueryClient();
  useLocalVersion();

  const byId = useQuery({
    queryKey: ["list", listId],
    enabled: Boolean(listId) && Boolean(user) && !preview && !hidden,
    // Seed from the Lists cache so the detail renders instantly (no skeleton
    // flash) and the shared-element hero transition has its target present.
    initialData: () => preview ? undefined : getListDetailSeed(qc, user?.id, context, listId),
    initialDataUpdatedAt: 0,
    queryFn: () => fetchListDetail(user!.id, listId!),
  });

  if (preview) {
    const list = getLists().find((l) => l.id === listId);
    return { list, isLoading: false, error: null, preview: true, refetch: byId.refetch };
  }
  if (hidden) {
    return { list: undefined, isLoading: false, error: null, preview: false, refetch: byId.refetch };
  }
  return {
    list: excludePersonallyShreddedList(byId.data ?? undefined, shred),
    isLoading: byId.isLoading,
    error: byId.error,
    preview: false,
    refetch: byId.refetch,
  };
}
