import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { matchAvatarByName } from "@/features/people/directory";

export type TeamMember = {
  id: string;
  name: string;
  initials: string;
  avatarUrl: string | null;
  /** From profiles.occupation; may be empty. */
  role: string | null;
  email: string | null;
  /** From profiles.phone_e164; may be empty. */
  phone: string | null;
  /** ISO timestamp from profiles.created_at. */
  connectedSince: string | null;
};

function initialsOf(name: string): string {
  return (
    name
      .split(" ")
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

/**
 * Team roster sourced from the profiles table. Fields that a profile has not
 * filled in (role, phone) come back null so the UI can show a neutral
 * placeholder rather than a fabricated value.
 */
export function useTeam() {
  const { session, user } = useSession();
  const preview = isPreviewSession(session);

  const query = useQuery({
    queryKey: ["team-members"],
    enabled: Boolean(user) && !preview,
    staleTime: 30_000,
    queryFn: async (): Promise<TeamMember[]> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url, email, phone_e164, occupation, created_at")
        .order("display_name", { ascending: true });
      if (error) throw error;
      return (data ?? [])
        .filter((r) => r.display_name && r.display_name.trim().toLowerCase() !== "someone")
        .map((r) => {
          const name = r.display_name?.trim() || "Member";
          return {
            id: r.id,
            name,
            initials: initialsOf(name),
            avatarUrl: r.avatar_url || matchAvatarByName(name),
            role: r.occupation?.trim() || null,
            email: r.email?.trim() || null,
            phone: r.phone_e164?.trim() || null,
            connectedSince: r.created_at ?? null,
          } satisfies TeamMember;
        });
    },
  });

  return { members: query.data ?? [], isLoading: !preview && query.isLoading };
}
