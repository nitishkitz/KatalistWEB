import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";

/** Live (non-deleted) note counts keyed by bucket id, read in one query. */
export function useBucketNoteCounts(bucketIds: string[]) {
  const { session, user } = useSession();
  const preview = isPreviewSession(session);
  const idsKey = [...bucketIds].sort().join(",");

  const query = useQuery({
    queryKey: ["bucket-note-counts", idsKey],
    enabled: Boolean(user) && !preview && bucketIds.length > 0,
    staleTime: 30_000,
    queryFn: async ({ signal }): Promise<Record<string, number>> => {
      const { data, error } = await supabase
        .from("bucket_notes")
        .select("bucket_id")
        .in("bucket_id", bucketIds)
        .is("deleted_at", null)
        .abortSignal(signal);
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const row of data ?? []) counts[row.bucket_id] = (counts[row.bucket_id] ?? 0) + 1;
      return counts;
    },
  });

  return query.data ?? {};
}
