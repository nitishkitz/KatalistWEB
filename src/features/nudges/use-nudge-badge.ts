import { useQuery } from "@tanstack/react-query";
import { keys } from "@/domain/query-keys";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { nudgeFixtures } from "./fixtures";
import { countActionableNudges } from "./nudge-badge";

type NudgeableThingRow = { thing_id: string };

export function useNudgeBadge() {
  const { session, user } = useSession();
  const preview = isPreviewSession(session);
  const query = useQuery({
    queryKey: keys.nudges(user?.id, "work"),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_nudgeable_things");
      if (error) throw error;
      return (data ?? []) as NudgeableThingRow[];
    },
    enabled: Boolean(user) && !preview,
    staleTime: 15_000,
  });

  return {
    count: preview
      ? countActionableNudges(nudgeFixtures)
      : (query.data?.length ?? 0),
  };
}
