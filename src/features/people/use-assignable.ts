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
      const { data, error } = await supabase.from("actors").select("id, kind, profile_id, profiles(display_name, avatar_url)");
      if (error) throw error;
      const people: Person[] = [];
      for (const row of data ?? []) {
        if (row.kind !== "user") continue;
        const profile = (Array.isArray(row.profiles) ? row.profiles[0] : row.profiles) as
          | { display_name?: string; avatar_url?: string | null }
          | null;
        const name = profile?.display_name;
        if (!name) continue;
        people.push({
          id: row.id,
          name,
          initials: name
            .split(" ")
            .map((p: string) => p[0])
            .slice(0, 2)
            .join("")
            .toUpperCase(),
          avatarUrl: profile?.avatar_url ?? null,
        });
      }
      return people;
    },
  });

  return preview ? directoryPeople() : (query.data ?? []);
}
