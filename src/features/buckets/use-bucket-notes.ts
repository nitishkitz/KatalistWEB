import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { getIdentityEpoch, isEpochCurrent } from "@/features/realtime/identity-cache-policy";
import { withReadDeadline } from "@/lib/read-request";

export type BucketNote = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

/** Apple-Notes-style notes for a private Bucket (owner only). */
export function useBucketNotes(bucketId: string) {
  const { user } = useSession();
  const qc = useQueryClient();
  const key = ["bucket-notes", bucketId] as const;

  const query = useQuery({
    queryKey: key,
    enabled: Boolean(bucketId) && Boolean(user),
    queryFn: ({ signal }): Promise<BucketNote[]> =>
      withReadDeadline(signal, async (combined) => {
        const { data, error } = await supabase
          .from("bucket_notes")
          .select("id, title, body, created_at, updated_at")
          .eq("bucket_id", bucketId)
          .is("deleted_at", null)
          .order("updated_at", { ascending: false })
          .abortSignal(combined);
        if (error) throw error;
        return (data ?? []).map((r) => ({
          id: r.id,
          title: r.title,
          body: r.body,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        }));
      }),
  });

  const invalidate = (epoch: number) => {
    if (isEpochCurrent(qc, epoch)) void qc.invalidateQueries({ queryKey: key });
  };

  const create = useMutation({
    mutationFn: async (input: { title: string; body: string }): Promise<string> => {
      if (!user?.id) throw new Error("Sign in to add a note.");
      const { data, error } = await supabase
        .from("bucket_notes")
        .insert({ bucket_id: bucketId, author_profile_id: user.id, title: input.title, body: input.body })
        .select("id")
        .single();
      if (error) throw error;
      return data.id;
    },
    onMutate: () => ({ epoch: getIdentityEpoch(qc).epoch }),
    onSuccess: (_data, _vars, mutationContext) => invalidate(mutationContext.epoch),
  });

  const update = useMutation({
    mutationFn: async (input: { id: string; title: string; body: string }) => {
      const { error } = await supabase
        .from("bucket_notes")
        .update({ title: input.title, body: input.body, updated_at: new Date().toISOString() })
        .eq("id", input.id);
      if (error) throw error;
    },
    onMutate: () => ({ epoch: getIdentityEpoch(qc).epoch }),
    onSuccess: (_data, _vars, mutationContext) => invalidate(mutationContext.epoch),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("bucket_notes")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onMutate: () => ({ epoch: getIdentityEpoch(qc).epoch }),
    onSuccess: (_data, _vars, mutationContext) => invalidate(mutationContext.epoch),
  });

  return {
    notes: query.data ?? [],
    isLoading: query.isLoading,
    // G-06: previously not exposed at all -- a rejected read fell through
    // to notes: [] with no way for a consumer to tell "genuinely no
    // notes" apart from "the read failed". `refetch` lets a consumer
    // offer a real Retry instead of only showing an empty state.
    error: query.error,
    refetch: query.refetch,
    create,
    update,
    remove,
  };
}
