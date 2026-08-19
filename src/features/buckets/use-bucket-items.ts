import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { getBucketRefs, getMergedThings, useLocalVersion } from "@/features/things/local-state";
import { rpcAddToBucket, rpcRemoveFromBucket } from "@/features/things/rpc";
import { useCourt } from "@/features/court/use-court";
import { useLists } from "@/features/lists/use-lists";
import type { Thing } from "@/domain/thing";

export type BucketRef = {
  thingId?: string;
  listId?: string;
  title: string;
  kind: "thing" | "list";
};

export function useAccessibleThings() {
  const court = useCourt();
  useLocalVersion();
  if (court.preview) return getMergedThings();
  return court.all;
}

export function useAccessibleLists() {
  const { lists } = useLists();
  return lists;
}

export function useBucketItems(bucketId: string | undefined) {
  const { session } = useSession();
  const preview = isPreviewSession(session);
  const qc = useQueryClient();
  useLocalVersion();

  const query = useQuery({
    queryKey: ["bucket-items", bucketId],
    enabled: Boolean(bucketId) && !preview,
    queryFn: async (): Promise<BucketRef[]> => {
      const { data, error } = await supabase
        .from("bucket_items")
        .select("thing_id, list_id")
        .eq("bucket_id", bucketId!);
      if (error) throw error;
      const thingIds = (data ?? []).map((r) => r.thing_id).filter(Boolean) as string[];
      const listIds = (data ?? []).map((r) => r.list_id).filter(Boolean) as string[];
      const { data: things } = thingIds.length
        ? await supabase.from("things").select("id,title").in("id", thingIds)
        : { data: [] };
      const { data: lists } = listIds.length
        ? await supabase.from("lists").select("id,name").in("id", listIds)
        : { data: [] };
      return (data ?? []).map((r) => {
        if (r.thing_id) {
          const t = things?.find((x) => x.id === r.thing_id);
          return { thingId: r.thing_id, title: t?.title ?? "Thing", kind: "thing" as const };
        }
        const l = lists?.find((x) => x.id === r.list_id);
        return { listId: r.list_id ?? undefined, title: l?.name ?? "List", kind: "list" as const };
      });
    },
  });

  const add = useMutation({
    mutationFn: (input: { thingId?: string; listId?: string }) => rpcAddToBucket(bucketId!, input.thingId, input.listId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["bucket-items", bucketId] });
      void qc.invalidateQueries({ queryKey: ["buckets"] });
    },
  });

  const remove = useMutation({
    mutationFn: (input: { thingId?: string; listId?: string }) =>
      rpcRemoveFromBucket(bucketId!, input.thingId, input.listId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["bucket-items", bucketId] });
      void qc.invalidateQueries({ queryKey: ["buckets"] });
    },
  });

  const items: BucketRef[] = preview && bucketId ? getBucketRefs(bucketId) : (query.data ?? []);
  return { items, add, remove, isLoading: !preview && query.isLoading };
}

export type { Thing };
