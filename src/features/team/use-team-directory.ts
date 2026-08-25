import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { directoryPeople } from "@/features/things/local-state";

export type TeamPerson = { profileId: string; name: string; initials: string; avatarUrl?: string | null; phone?: string | null };
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";

export function useTeamDirectory() {
  const { session } = useSession();
  const preview = isPreviewSession(session);
  const query = useQuery({
    queryKey: ["team-directory"],
    enabled: !preview,
    staleTime: 30_000,
    queryFn: async (): Promise<TeamPerson[]> => {
      const { data, error } = await supabase.rpc("list_team_directory");
      if (error) throw error;
      return (data ?? []).map((row) => ({ profileId: row.profile_id, name: row.display_name || "Someone", initials: initials(row.display_name || "Someone"), avatarUrl: row.avatar_url, phone: row.phone_e164 }));
    },
  });
  const people: TeamPerson[] = preview
    ? directoryPeople().map((person) => ({ profileId: person.id, name: person.name, initials: person.initials, avatarUrl: person.avatarUrl, phone: null }))
    : (query.data ?? []);
  return { people, isLoading: !preview && query.isLoading, error: query.error };
}
