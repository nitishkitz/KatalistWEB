import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { keys } from "@/domain/query-keys";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { useAppContext } from "@/features/context/use-app-context";
import { isPreviewSession } from "@/lib/session-mode";
import { getBuckets } from "@/features/things/local-state";
import { useLocalVersion } from "@/features/things/use-local-version";
import { rpcCreateBucket, rpcDeleteBucket, rpcRenameBucket } from "@/features/things/rpc";
import { fetchBuckets } from "./fetch-buckets";
import type { BucketCard } from "./fixtures";

export function useBuckets() {
  const { session, user } = useSession();
  const { context } = useAppContext();
  const preview = isPreviewSession(session);
  const version = useLocalVersion();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: keys.buckets(user?.id, context),
    queryFn: () => fetchBuckets(context, user?.id ?? ""),
    enabled: Boolean(user) && !preview,
    staleTime: 15_000,
  });

  const buckets = useMemo(() => {
    void version;
    if (preview) return getBuckets(context);
    return query.data ?? [];
  }, [preview, query.data, version, context]);

  const create = useMutation({
    mutationFn: (name: string) => rpcCreateBucket(name, context),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: keys.buckets(user?.id, context) });
    },
  });

  return {
    buckets,
    isLoading: !preview && query.isLoading,
    // See useLists' identical field: react-query's isLoading reads false
    // while a query is "paused" offline (never fetched, no error, no
    // data), which would otherwise look identical to a confirmed empty
    // result. query.data persists across later pauses/errors once
    // populated, so this stays true even through a later failed refetch.
    hasFetchedOnce: preview || query.data !== undefined,
    error: query.error,
    preview,
    create,
    refetch: query.refetch,
  };
}

export function useBucket(bucketId: string | undefined) {
  const { session, user } = useSession();
  const preview = isPreviewSession(session);
  useLocalVersion();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: keys.bucket(bucketId ?? "none"),
    enabled: Boolean(bucketId) && Boolean(user) && !preview,
    queryFn: async (): Promise<BucketCard | null> => {
      const { data, error } = await supabase
        .from("buckets")
        .select("id,name,context,updated_at")
        .eq("id", bucketId!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const { data: items } = await supabase
        .from("bucket_items")
        .select("thing_id,list_id")
        .eq("bucket_id", data.id);
      return {
        id: data.id,
        name: data.name,
        description: "Private focus space",
        color: "bg-violet-500",
        pinned: false,
        thingCount: (items ?? []).filter((r) => r.thing_id).length,
        listCount: (items ?? []).filter((r) => r.list_id).length,
        updatedAt: new Date(data.updated_at).toLocaleString(),
        context: (data.context === "home" ? "home" : "work") as "work" | "home",
        previews: [],
      };
    },
  });

  const rename = useMutation({
    mutationFn: (name: string) => rpcRenameBucket(bucketId!, name),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["bucket"] });
      void qc.invalidateQueries({ queryKey: ["buckets"] });
    },
  });
  const remove = useMutation({
    mutationFn: () => rpcDeleteBucket(bucketId!),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["bucket"] });
      void qc.invalidateQueries({ queryKey: ["buckets"] });
      void qc.invalidateQueries({ queryKey: ["bucket-items"] });
    },
  });

  if (preview) {
    const bucket = getBuckets().find((b) => b.id === bucketId);
    return { bucket, isLoading: false, error: null, preview: true, rename, remove, refetch: query.refetch };
  }
  return {
    bucket: query.data ?? undefined,
    isLoading: query.isLoading,
    error: query.error,
    preview: false,
    rename,
    remove,
    refetch: query.refetch,
  };
}
