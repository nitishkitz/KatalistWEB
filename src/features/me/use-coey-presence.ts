import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";

export type CoeyPresence = "full" | "light" | "quiet";

/** Quiet Coey (§12.9). Defaults to Full when unknown, so functional moments never depend on this read. */
export function useCoeyPresence() {
  const { session, user } = useSession();
  const qc = useQueryClient();
  const live = Boolean(user) && !isPreviewSession(session);
  const key = ["coey", "presence", user?.id] as const;
  const query = useQuery({
    queryKey: key,
    enabled: live,
    staleTime: 60_000,
    queryFn: async (): Promise<CoeyPresence> => {
      const { data } = await supabase.from("profiles").select("coey_presence" as never).eq("id", user!.id).maybeSingle();
      const value = (data as { coey_presence?: string } | null)?.coey_presence;
      return value === "light" || value === "quiet" ? value : "full";
    },
  });
  const update = useMutation({
    mutationFn: async (next: CoeyPresence) => {
      const { error } = await supabase.from("profiles").update({ coey_presence: next } as never).eq("id", user!.id);
      if (error) throw error;
      return next;
    },
    onSuccess: (next) => qc.setQueryData(key, next),
  });
  return { presence: query.data ?? "full", setPresence: update.mutateAsync, saving: update.isPending };
}
