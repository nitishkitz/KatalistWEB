import { useQuery } from "@tanstack/react-query";
import { keys } from "@/domain/query-keys";
import { currentDemoActorId } from "@/features/demo/identities";
import { useSession } from "@/hooks/useSession";
import { supabase } from "@/integrations/supabase/client";
import { isPreviewSession } from "@/lib/session-mode";

async function fetchCurrentActor(profileId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("actors")
    .select("id")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

export function useCurrentActor() {
  const { session, user } = useSession();
  const preview = isPreviewSession(session);
  const query = useQuery({
    queryKey: keys.currentActor(user?.id),
    queryFn: () => fetchCurrentActor(user!.id),
    enabled: Boolean(user?.id) && !preview,
    staleTime: 5 * 60_000,
  });

  return {
    actorId: preview ? currentDemoActorId() : (query.data ?? null),
    isLoading: !preview && query.isLoading,
    error: query.error,
  };
}
