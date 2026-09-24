import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { accessibleDemoThings, getBucketRefs, getListById, getThing } from "@/features/things/local-state";
import { useLocalVersion } from "@/features/things/use-local-version";
import { rpcAddToBucket, rpcRemoveFromBucket } from "@/features/things/rpc";
import { useAppContext } from "@/features/context/use-app-context";
import { useLists } from "@/features/lists/use-lists";
import { keys } from "@/domain/query-keys";
import type { Thing } from "@/domain/thing";
import { mapDbThingRows, THING_COLUMNS, type DbThingRow } from "@/features/things/map-thing-rows";
import { getIdentityEpoch, isEpochCurrent } from "@/features/realtime/identity-cache-policy";
import {
  excludePersonallyShreddedThings,
  usePersonalShred,
} from "@/features/things/personal-shred";
import { fetchBucketItems, type BucketItem } from "./fetch-bucket-items";

export type { BucketItem };

function resolveDemoItems(bucketId: string): BucketItem[] {
  const items: BucketItem[] = [];
  for (const ref of getBucketRefs(bucketId)) {
    if (ref.kind === "thing" && ref.thingId) {
      const thing = getThing(ref.thingId);
      if (thing) items.push({ kind: "thing", thingId: thing.id, thing });
    } else if (ref.kind === "list" && ref.listId) {
      const list = getListById(ref.listId);
      if (list) items.push({ kind: "list", listId: list.id, list });
    }
  }
  return items;
}

export function useAccessibleThings() {
  const { session, user } = useSession();
  const preview = isPreviewSession(session);
  const { context } = useAppContext();
  const version = useLocalVersion();
  const shred = usePersonalShred();

  const query = useQuery({
    queryKey: keys.accessibleThings(user?.id, context),
    enabled: Boolean(user) && !preview,
    queryFn: async (): Promise<Thing[]> => {
      const { data, error } = await supabase.from("things").select(THING_COLUMNS).eq("context", context);
      if (error) throw error;
      return mapDbThingRows((data ?? []) as DbThingRow[]);
    },
    staleTime: 15_000,
  });

  if (preview) {
    void version;
    return accessibleDemoThings(context);
  }
  return excludePersonallyShreddedThings(query.data ?? [], shred);
}

export function useAccessibleLists() {
  const { lists } = useLists();
  return lists;
}

export function useBucketItems(bucketId: string | undefined) {
  const { session, user } = useSession();
  const preview = isPreviewSession(session);
  const qc = useQueryClient();
  useLocalVersion();
  const shred = usePersonalShred();

  const query = useQuery({
    queryKey: keys.bucketItems(bucketId ?? "none"),
    enabled: Boolean(bucketId) && Boolean(user) && !preview,
    queryFn: ({ signal }) => fetchBucketItems(qc, bucketId!, user!.id, signal),
  });

  const invalidate = (epoch: number) => {
    if (!isEpochCurrent(qc, epoch)) return;
    void qc.invalidateQueries({ queryKey: ["bucket-items"] });
    void qc.invalidateQueries({ queryKey: ["bucket"] });
    void qc.invalidateQueries({ queryKey: ["buckets"] });
  };

  const add = useMutation({
    mutationFn: (input: { thingId?: string; listId?: string }) => rpcAddToBucket(bucketId!, input.thingId, input.listId),
    onMutate: () => ({ epoch: getIdentityEpoch(qc).epoch }),
    onSuccess: (_data, _vars, mutationContext) => invalidate(mutationContext.epoch),
  });

  const remove = useMutation({
    mutationFn: (input: { thingId?: string; listId?: string }) =>
      rpcRemoveFromBucket(bucketId!, input.thingId, input.listId),
    onMutate: () => ({ epoch: getIdentityEpoch(qc).epoch }),
    onSuccess: (_data, _vars, mutationContext) => invalidate(mutationContext.epoch),
  });

  const raw: BucketItem[] = preview && bucketId ? resolveDemoItems(bucketId) : (query.data ?? []);
  const items = raw.filter((item) =>
    item.kind === "thing" ? !shred.thingIds.has(item.thingId) : !shred.listIds.has(item.listId),
  );
  return { items, add, remove, isLoading: !preview && query.isLoading, error: query.error };
}
