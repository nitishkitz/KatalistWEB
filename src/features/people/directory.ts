import { createContext, useContext } from "react";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DEMO_PERSONAS, useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { authedFetch } from "@/lib/authed-fetch";

export type ProfileIdentity = {
  id: string;
  email: string | null;
  display_name: string;
  avatar_url: string | null;
};

export async function fetchProfileIdentities(): Promise<ProfileIdentity[]> {
  const map = new Map<string, ProfileIdentity>();

  // 1. Try server directory endpoint (resolves all real profiles and actors via service role)
  try {
    const res = await authedFetch("/api/people/directory");
    if (res.ok) {
      const json = await res.json();
      for (const p of json.people ?? []) {
        const item: ProfileIdentity = {
          id: p.id,
          email: p.email ?? null,
          display_name: p.display_name,
          avatar_url: p.avatar_url ?? null,
        };
        if (p.profile_id) map.set(p.profile_id, item);
        if (p.actor_id) map.set(p.actor_id, item);
        if (p.id) map.set(p.id, item);
      }
    }
  } catch {
    // ignore
  }

  // 2. Try list_assignable_people RPC
  try {
    const { data: assignable, error } = await supabase.rpc("list_assignable_people");
    if (!error && assignable) {
      for (const r of assignable) {
        if (r.actor_id && r.display_name) {
          const avatarMatch = r.avatar_url?.match(/\/avatars\/([0-9a-f-]{36})\//i);
          const profileId = avatarMatch ? avatarMatch[1] : undefined;
          const item: ProfileIdentity = {
            id: r.actor_id,
            email: null,
            display_name: r.display_name,
            avatar_url: r.avatar_url ?? null,
          };
          if (!map.has(r.actor_id)) map.set(r.actor_id, item);
          if (profileId && !map.has(profileId)) map.set(profileId, item);
        }
      }
    }
  } catch {
    // ignore
  }

  // 3. Try public_identities view
  try {
    const { data: identities, error } = await supabase
      .from("public_identities")
      .select("id, display_name, avatar_url");
    if (!error && identities) {
      for (const r of identities) {
        if (r.id && r.display_name) {
          map.set(r.id, {
            id: r.id as string,
            email: null,
            display_name: r.display_name as string,
            avatar_url: r.avatar_url ?? null,
          });
        }
      }
    }
  } catch {
    // ignore
  }

  // 4. Try profiles table
  try {
    const { data: profs, error } = await supabase.from("profiles").select("id, email, display_name, avatar_url");
    if (!error && profs) {
      for (const r of profs) {
        if (r.id && r.display_name && !map.has(r.id)) {
          map.set(r.id, {
            id: r.id,
            email: r.email ?? null,
            display_name: r.display_name,
            avatar_url: r.avatar_url ?? null,
          });
        }
      }
    }
  } catch {
    // ignore
  }

  // 5. Always include demo personas as fallback identities
  for (const p of DEMO_PERSONAS) {
    const pKey = `p-${p.key}`;
    if (!map.has(pKey) && !map.has(p.key)) {
      map.set(pKey, {
        id: pKey,
        email: p.email ?? null,
        display_name: p.name,
        avatar_url: p.avatarUrl ?? null,
      });
    }
  }

  return Array.from(map.values());
}

export const DEFAULT_AVATARS: Record<string, string> = {
  priya: "/avatars/priya.jpg",
  arjun: "/avatars/arjun.jpg",
  sarah: "/avatars/sarah.jpg",
  mike: "/avatars/mike.jpg",
  neha: "/avatars/neha.jpg",
  rahul: "/avatars/rahul.jpg",
  sai: "/avatars/sai.jpg",
};

export function matchAvatarByName(name?: string | null): string | null {
  if (!name) return null;
  const n = name.trim().toLowerCase();
  if (!n || n === "me" || n === "you" || n === "someone") return null;
  for (const [key, url] of Object.entries(DEFAULT_AVATARS)) {
    if (n.includes(key)) return url;
  }
  return null;
}

export function matchProfile(
  rows: ProfileIdentity[],
  name?: string | null,
  email?: string | null,
): ProfileIdentity | null {
  if (email) {
    const want = email.trim().toLowerCase();
    const hit = rows.find((r) => (r.email ?? "").toLowerCase() === want);
    if (hit) return hit;
  }
  if (!name) return null;
  const n = name.trim().toLowerCase();
  if (!n || n === "me" || n === "you" || n === "someone") return null;
  return (
    rows.find((r) => {
      const d = r.display_name.trim().toLowerCase();
      return d === n || d.startsWith(`${n} `) || d.split(/\s+/)[0] === n;
    }) ?? null
  );
}

export const ProfileDirectoryContext = createContext<ProfileIdentity[]>([]);

export function useProfileDirectory() {
  return useContext(ProfileDirectoryContext);
}

export function useAvatarUrl(name?: string | null, email?: string | null, explicit?: string | null) {
  const rows = useProfileDirectory();
  if (explicit) return explicit;
  const matched = matchProfile(rows, name, email)?.avatar_url;
  if (matched) return matched;
  return matchAvatarByName(name);
}

const PROFILE_DIRECTORY_KEY = ["profile-directory"] as const;
const PROFILE_DIRECTORY_STALE_TIME_MS = 15_000;

export function useProfileDirectoryQuery() {
  // H04: this is mounted once, globally, in __root.tsx (ProfileDirectoryProvider)
  // regardless of route -- it used to fire unconditionally, including on
  // /auth, /welcome and /onboarding before anyone has signed in, guaranteeing
  // three failed (401) requests on every anonymous page view. Gate it the
  // same way every other session-scoped query in this codebase already does.
  const { user, session } = useSession();
  const preview = isPreviewSession(session);
  return useQuery({
    queryKey: PROFILE_DIRECTORY_KEY,
    queryFn: fetchProfileIdentities,
    enabled: Boolean(user) && !preview,
    staleTime: PROFILE_DIRECTORY_STALE_TIME_MS,
  });
}

/**
 * Same cache entry as useProfileDirectoryQuery, for the many plain async
 * `fetchXxx` helpers (list messages, conversations, contacts, hub files...)
 * that each used to call fetchProfileIdentities() directly -- every one of
 * them re-hit the directory endpoint/RPC independently, even when several
 * were in flight on the same page at once. Routing them through
 * `qc.fetchQuery` on this same key means they now dedupe against each other
 * AND against any mounted useProfileDirectoryQuery() consumer.
 */
export function getProfileIdentities(qc: QueryClient): Promise<ProfileIdentity[]> {
  return qc.fetchQuery({
    queryKey: PROFILE_DIRECTORY_KEY,
    queryFn: fetchProfileIdentities,
    staleTime: PROFILE_DIRECTORY_STALE_TIME_MS,
  });
}

