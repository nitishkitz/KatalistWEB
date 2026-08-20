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
import type { ListRow } from "@/features/lists/fixtures";
import { mapDbListRows, type DbListRow } from "@/features/lists/map-list-rows";
import { mapDbThingRows, THING_COLUMNS, type DbThingRow } from "@/features/things/map-thing-rows";

export type BucketItem =
  | { kind: "thing"; thingId: string; thing: Thing }
  | { kind: "list"; listId: string; list: ListRow };

async function fetchListsByIds(profileId: string, listIds: string[]): Promise<ListRow[]> {
  if (!listIds.length) return [];
  const { data: lists, error } = await supabase
    .from("lists")
    .select("id,name,context,owner_profile_id,updated_at")
    .in("id", listIds);
  if (error) throw error;
  return mapDbListRows(profileId, (lists ?? []) as DbListRow[]);
}

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
  return query.data ?? [];
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

  const query = useQuery({
    queryKey: keys.bucketItems(bucketId ?? "none"),
    enabled: Boolean(bucketId) && Boolean(user) && !preview,
    queryFn: async (): Promise<BucketItem[]> => {
      const { data, error } = await supabase
        .from("bucket_items")
        .select("thing_id, list_id")
        .eq("bucket_id", bucketId!);
      if (error) throw error;
      const thingIds = (data ?? []).map((r) => r.thing_id).filter(Boolean) as string[];
      const listIds = (data ?? []).map((r) => r.list_id).filter(Boolean) as string[];

      const { data: thingRows, error: thingError } = thingIds.length
        ? await supabase.from("things").select(THING_COLUMNS).in("id", thingIds)
        : { data: [], error: null };
      if (thingError) throw thingError;
      const things = await mapDbThingRows((thingRows ?? []) as DbThingRow[]);
      const thingById = new Map(things.map((t) => [t.id, t]));
      const lists = await fetchListsByIds(user!.id, listIds);
      const listById = new Map(lists.map((l) => [l.id, l]));

      const items: BucketItem[] = [];
      for (const r of data ?? []) {
        if (r.thing_id) {
          const thing = thingById.get(r.thing_id);
          if (thing) items.push({ kind: "thing", thingId: thing.id, thing });
        } else if (r.list_id) {
          const list = listById.get(r.list_id);
          if (list) items.push({ kind: "list", listId: list.id, list });
        }
      }
      return items;
    },
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["bucket-items"] });
    void qc.invalidateQueries({ queryKey: ["bucket"] });
    void qc.invalidateQueries({ queryKey: ["buckets"] });
  };

  const add = useMutation({
    mutationFn: (input: { thingId?: string; listId?: string }) => rpcAddToBucket(bucketId!, input.thingId, input.listId),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (input: { thingId?: string; listId?: string }) =>
      rpcRemoveFromBucket(bucketId!, input.thingId, input.listId),
    onSuccess: invalidate,
  });

  const items: BucketItem[] = preview && bucketId ? resolveDemoItems(bucketId) : (query.data ?? []);
  return { items, add, remove, isLoading: !preview && query.isLoading, error: query.error };
}
