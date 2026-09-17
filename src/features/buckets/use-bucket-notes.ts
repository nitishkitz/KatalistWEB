import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";

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
    queryFn: async (): Promise<BucketNote[]> => {
      const { data, error } = await supabase
        .from("bucket_notes")
        .select("id, title, body, created_at, updated_at")
        .eq("bucket_id", bucketId)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        title: r.title,
        body: r.body,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
    },
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: key });

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
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: async (input: { id: string; title: string; body: string }) => {
      const { error } = await supabase
        .from("bucket_notes")
        .update({ title: input.title, body: input.body, updated_at: new Date().toISOString() })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("bucket_notes")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { notes: query.data ?? [], isLoading: query.isLoading, create, update, remove };
}
