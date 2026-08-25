import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { keys } from "@/domain/query-keys";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { useAppContext } from "@/features/context/use-app-context";
import { isPreviewSession } from "@/lib/session-mode";
import { getBucketRefs, getBuckets } from "@/features/things/local-state";
import { useLocalVersion } from "@/features/things/use-local-version";
import { rpcCreateBucket, rpcDeleteBucket, rpcRenameBucket } from "@/features/things/rpc";
import type { BucketCard } from "./fixtures";

const COLORS = ["bg-violet-500", "bg-sky-500", "bg-emerald-500", "bg-amber-500"];

async function fetchBuckets(context: "work" | "home"): Promise<BucketCard[]> {
  const { data: buckets, error } = await supabase
    .from("buckets")
    .select("id,name,context,updated_at")
    .eq("context", context)
    .is("archived_at", null);
  if (error) throw error;
  const ids = (buckets ?? []).map((b) => b.id);
  const { data: items } = ids.length
    ? await supabase.from("bucket_items").select("bucket_id,thing_id,list_id").in("bucket_id", ids)
    : { data: [] };

  return (buckets ?? []).map((b, i) => {
    const refs = (items ?? []).filter((it) => it.bucket_id === b.id);
    return {
      id: b.id,
      name: b.name,
      description: "Private focus space",
      color: COLORS[i % COLORS.length]!,
      pinned: i < 2,
      thingCount: refs.filter((r) => r.thing_id).length,
      listCount: refs.filter((r) => r.list_id).length,
      thingIds: refs.map((r) => r.thing_id).filter(Boolean) as string[],
      updatedAt: new Date(b.updated_at).toLocaleString(),
      context: (b.context === "home" ? "home" : "work") as "work" | "home",
      previews: [],
    } satisfies BucketCard;
  });
}

export function useBuckets() {
  const { session, user } = useSession();
  const { context } = useAppContext();
  const preview = isPreviewSession(session);
  const version = useLocalVersion();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: keys.buckets(user?.id, context),
    queryFn: () => fetchBuckets(context),
    enabled: Boolean(user) && !preview,
    staleTime: 15_000,
  });

  const buckets = useMemo(() => {
    void version;
    if (preview) {
      return getBuckets(context).map((bucket) => ({
        ...bucket,
        thingIds: getBucketRefs(bucket.id).flatMap((item) => item.thingId ? [item.thingId] : []),
      }));
    }
    return query.data ?? [];
  }, [preview, query.data, version, context]);

  const create = useMutation({
    mutationFn: (name: string) => rpcCreateBucket(name, context),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: keys.buckets(user?.id, context) });
    },
  });

  return { buckets, isLoading: !preview && query.isLoading, error: query.error, preview, create };
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
    return { bucket, isLoading: false, error: null, preview: true, rename, remove };
  }
  return {
    bucket: query.data ?? undefined,
    isLoading: query.isLoading,
    error: query.error,
    preview: false,
    rename,
    remove,
  };
}
