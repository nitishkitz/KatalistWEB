import { createContext, useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DEMO_PERSONAS } from "@/hooks/useSession";

export type ProfileIdentity = {
  id: string;
  email: string | null;
  display_name: string;
  avatar_url: string | null;
};

export async function fetchProfileIdentities(): Promise<ProfileIdentity[]> {
  const map = new Map<string, ProfileIdentity>();

  // 1. Try public_identities view
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

  // 2. Try list_assignable_people RPC
  try {
    const { data: assignable, error } = await supabase.rpc("list_assignable_people");
    if (!error && assignable) {
      for (const r of assignable) {
        if (r.actor_id && r.display_name && !map.has(r.actor_id)) {
          map.set(r.actor_id, {
            id: r.actor_id,
            email: null,
            display_name: r.display_name,
            avatar_url: r.avatar_url ?? null,
          });
        }
      }
    }
  } catch {
    // ignore
  }

  // 3. Try profiles table
  try {
    const { data: profs, error } = await supabase.from("profiles").select("id, email, display_name, avatar_url");
    if (!error && profs) {
      for (const r of profs) {
        if (r.id && r.display_name) {
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

  // 4. Try public_profiles table
  try {
    const { data: pubProfs, error } = await supabase.from("public_profiles").select("id, email, display_name, avatar_url");
    if (!error && pubProfs) {
      for (const r of pubProfs) {
        if (r.id && r.display_name && !map.has(r.id)) {
          map.set(r.id, {
            id: r.id as string,
            email: r.email ?? null,
            display_name: r.display_name as string,
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

export function useProfileDirectoryQuery() {
  return useQuery({
    queryKey: ["profile-directory"],
    queryFn: fetchProfileIdentities,
    staleTime: 15_000,
  });
}

