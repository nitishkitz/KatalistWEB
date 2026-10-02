import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { getIdentityEpoch, isEpochCurrent } from "@/features/realtime/identity-cache-policy";
import { withReadDeadline } from "@/lib/read-request";

export type BucketNote = {
  id: string;
  title: string;
  body: string;
  contentJson: unknown | null;
  plainText: string;
  pinnedAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

function isMissingNotesSchema(error: { code?: string; message?: string } | null) {
  return Boolean(error && (error.code === "42703" || error.code === "PGRST204" || /column.*(content_json|plain_text|revision|pinned_at).*does not exist/i.test(error.message ?? "")));
}

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
          .select("id, title, body, content_json, plain_text, pinned_at, revision, created_at, updated_at")
          .eq("bucket_id", bucketId)
          .is("deleted_at", null)
          .order("updated_at", { ascending: false })
          .abortSignal(combined);
        if (isMissingNotesSchema(error)) {
          const legacy = await supabase.from("bucket_notes")
            .select("id, title, body, created_at, updated_at")
            .eq("bucket_id", bucketId).is("deleted_at", null)
            .order("updated_at", { ascending: false }).abortSignal(combined);
          if (legacy.error) throw legacy.error;
          return (legacy.data ?? []).map((r) => ({
            id: r.id, title: r.title, body: r.body, contentJson: null,
            plainText: r.body, pinnedAt: null, revision: 0,
            createdAt: r.created_at, updatedAt: r.updated_at,
          }));
        }
        if (error) throw error;
        return (data ?? []).map((r) => ({
          id: r.id,
          title: r.title,
          body: r.body,
          contentJson: r.content_json,
          plainText: r.plain_text,
          pinnedAt: r.pinned_at,
          revision: r.revision,
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

  const pin = useMutation({
    mutationFn: async ({ id, pinned }: { id: string; pinned: boolean }) => {
      const { error } = await supabase.from("bucket_notes")
        .update({ pinned_at: pinned ? new Date().toISOString() : null })
        .eq("id", id);
      if (error) throw error;
    },
    onMutate: () => ({ epoch: getIdentityEpoch(qc).epoch }),
    onSuccess: (_data, _vars, mutationContext) => invalidate(mutationContext.epoch),
  });

  const saveRich = async (input: { id: string; title: string; plainText: string; contentJson: import("@/integrations/supabase/types").Json; revision: number }) => {
    const { data, error } = await supabase.from("bucket_notes")
      .update({ title: input.title, body: input.plainText, plain_text: input.plainText, content_json: input.contentJson, revision: input.revision + 1, updated_at: new Date().toISOString() })
      .eq("id", input.id).eq("revision", input.revision).select("revision").maybeSingle();
    if (isMissingNotesSchema(error)) {
      const legacy = await supabase.from("bucket_notes")
        .update({ title: input.title, body: input.plainText, updated_at: new Date().toISOString() })
        .eq("id", input.id);
      if (legacy.error) throw legacy.error;
      invalidate(getIdentityEpoch(qc).epoch);
      return input.revision + 1;
    }
    if (error) throw error;
    if (!data) throw new Error("This note changed on another device. Copy your edits before reloading.");
    invalidate(getIdentityEpoch(qc).epoch);
    return data.revision;
  };

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
    pin,
    saveRich,
  };
}
