import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { directoryPeople } from "@/features/things/local-state";
import type { Person } from "@/domain/thing";

export function useAssignablePeople() {
  const { session } = useSession();
  const preview = isPreviewSession(session);

  const query = useQuery({
    queryKey: ["assignable-people"],
    enabled: !preview,
    staleTime: 30_000,
    queryFn: async (): Promise<Person[]> => {
      const { data, error } = await supabase.rpc("list_assignable_people");
      if (error) throw error;
      return (data ?? []).map((row) => {
        const name = row.display_name || "Someone";
        return {
          id: row.actor_id,
          name,
          initials: name
            .split(" ")
            .map((p: string) => p[0])
            .slice(0, 2)
            .join("")
            .toUpperCase(),
          avatarUrl: row.avatar_url,
        };
      });
    },
  });

  return preview ? directoryPeople() : (query.data ?? []);
}
