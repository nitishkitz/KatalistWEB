import { createContext, useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ProfileIdentity = {
  id: string;
  email: string | null;
  display_name: string;
  avatar_url: string | null;
};

async function readRows(table: "profiles" | "public_profiles"): Promise<ProfileIdentity[]> {
  if (table === "public_profiles") {
    const { data, error } = await supabase.from("public_profiles").select("id, email, display_name, avatar_url");
    if (error) return [];
    return (data ?? [])
      .filter((r) => r.id && r.display_name)
      .map((r) => ({
        id: r.id as string,
        email: r.email ?? null,
        display_name: r.display_name as string,
        avatar_url: r.avatar_url ?? null,
      }));
  }
  const { data, error } = await supabase.from("profiles").select("id, email, display_name, avatar_url");
  if (error) return [];
  return (data ?? []).map((r) => ({
    id: r.id,
    email: r.email,
    display_name: r.display_name,
    avatar_url: r.avatar_url,
  }));
}

export async function fetchProfileIdentities(): Promise<ProfileIdentity[]> {
  const { data: identities, error: identError } = await supabase
    .from("public_identities")
    .select("id, display_name, avatar_url");
  if (!identError && identities?.length) {
    return identities
      .filter((r) => r.id && r.display_name)
      .map((r) => ({
        id: r.id as string,
        email: null,
        display_name: r.display_name as string,
        avatar_url: r.avatar_url ?? null,
      }));
  }
  const fromView = await readRows("public_profiles");
  if (fromView.length) return fromView.map((r) => ({ ...r, email: null }));
  const own = await readRows("profiles");
  return own.map((r) => ({ ...r, email: null }));
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
  if (!n || n === "me" || n === "you") return null;
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
  return matchProfile(rows, name, email)?.avatar_url ?? null;
}

export function useProfileDirectoryQuery() {
  return useQuery({
    queryKey: ["profile-directory"],
    queryFn: fetchProfileIdentities,
    staleTime: 15_000,
  });
}
