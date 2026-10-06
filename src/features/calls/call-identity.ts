import { useMemo } from "react";
import { useSession } from "@/hooks/useSession";
import { useProfileDirectory, type ProfileIdentity } from "@/features/people/directory";

const GENERIC_NAMES = new Set(["", "katalist user", "someone", "member", "you", "me"]);

/** True when a name is a placeholder rather than a person's real display name. */
export function isGenericName(name?: string | null): boolean {
  return GENERIC_NAMES.has((name ?? "").trim().toLowerCase());
}

export function findCallProfile(rows: ProfileIdentity[], profileId?: string | null): ProfileIdentity | null {
  if (!profileId) return null;
  return rows.find((r) => r.id === profileId) ?? null;
}

/**
 * The signed-in user's call identity. Auth metadata still carries the
 * "Katalist User" placeholder written at phone sign-in, so the profile row
 * (name + uploaded avatar) wins over metadata whenever it is available.
 */
export function useSelfCallIdentity(fallbackName?: string | null): { name: string; avatarUrl: string | null } {
  const { user } = useSession();
  const rows = useProfileDirectory();
  return useMemo(() => {
    const profile = findCallProfile(rows, user?.id);
    const candidates = [
      profile?.display_name,
      fallbackName,
      user?.user_metadata?.display_name as string | undefined,
      user?.user_metadata?.full_name as string | undefined,
      user?.email?.split("@")[0],
    ];
    const name = candidates.find((c) => c && !isGenericName(c)) ?? "You";
    const avatarUrl = profile?.avatar_url ?? (user?.user_metadata?.avatar_url as string | undefined) ?? null;
    return { name, avatarUrl };
  }, [rows, user, fallbackName]);
}
