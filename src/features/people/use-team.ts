import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { fetchProfileIdentities, matchAvatarByName } from "@/features/people/directory";

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
      // Roster of people you can see (not RLS-locked to self): the shared
      // directory aggregates public_identities + assignable people + profiles.
      const identities = await fetchProfileIdentities();

      // Contact details live in `profiles`, which RLS scopes to rows you may
      // read (typically your own). Enrich where available; others fall back to
      // "—" rather than fabricated values.
      const { data: profRows } = await supabase
        .from("profiles")
        .select("id, email, phone_e164, occupation, created_at");
      const detailById = new Map((profRows ?? []).map((r) => [r.id, r]));

      // Placeholder/default display names carried by unnamed or seeded accounts.
      const GENERIC_NAMES = new Set(["someone", "member", "katalist user", "unknown", "guest", "user"]);
      const seenIds = new Set<string>();
      const seenNames = new Set<string>();
      const members: TeamMember[] = [];
      for (const p of identities) {
        if (!p.id || seenIds.has(p.id)) continue;
        const name = (p.display_name || "").trim();
        const key = name.toLowerCase();
        if (!name || GENERIC_NAMES.has(key)) continue;
        // Collapse duplicate default names (e.g. two unnamed "Priya Sharma").
        if (seenNames.has(key)) continue;
        seenIds.add(p.id);
        seenNames.add(key);
        const d = detailById.get(p.id);
        members.push({
          id: p.id,
          name,
          initials: initialsOf(name),
          avatarUrl: p.avatar_url || matchAvatarByName(name),
          role: d?.occupation?.trim() || null,
          email: d?.email?.trim() || null,
          phone: d?.phone_e164?.trim() || null,
          connectedSince: d?.created_at ?? null,
        });
      }
      members.sort((a, b) => a.name.localeCompare(b.name));
      return members;
    },
  });

  return { members: query.data ?? [], isLoading: !preview && query.isLoading };
}
