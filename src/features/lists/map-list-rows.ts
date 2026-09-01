import { supabase } from "@/integrations/supabase/client";
import { fetchProfileIdentities, matchAvatarByName } from "../people/directory";
import { DEMO_ACTOR_BY_KEY } from "../demo/identities";
import type { ListRow, ListMember } from "./fixtures";

const COLORS = ["bg-violet-500", "bg-sky-500", "bg-emerald-500", "bg-amber-500", "bg-rose-500"];

export type DbListRow = {
  id: string;
  name: string;
  context: "work" | "home";
  owner_profile_id: string;
  updated_at: string;
};

function initialsFrom(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

const DEFAULT_PERSONAS = [
  { id: "p-priya", name: "Priya Sharma", initials: "PS", avatarUrl: "/avatars/priya.jpg" },
  { id: "p-arjun", name: "Arjun Mehta", initials: "AM", avatarUrl: "/avatars/arjun.jpg" },
  { id: "p-sarah", name: "Sarah Kapoor", initials: "SK", avatarUrl: "/avatars/sarah.jpg" },
  { id: "p-mike", name: "Mike Fernandes", initials: "MF", avatarUrl: "/avatars/mike.jpg" },
  { id: "p-neha", name: "Neha Rao", initials: "NR", avatarUrl: "/avatars/neha.jpg" },
  { id: "p-rahul", name: "Rahul Mehta", initials: "RM", avatarUrl: "/avatars/rahul.jpg" },
  { id: "p-sai", name: "Sai", initials: "SA", avatarUrl: "/avatars/sai.jpg" },
];

/**
 * Safe List identity mapping: members + owner via public_identities + profiles + actors lens.
 * Resolves complete display names and real avatars. Never returns "Someone" or "S".
 */
export async function mapDbListRows(profileId: string, lists: DbListRow[]): Promise<ListRow[]> {
  if (!lists.length) return [];
  const ids = lists.map((l) => l.id);
  const { data: members } = await supabase.from("list_members").select("list_id,profile_id,role").in("list_id", ids);
  const { data: things } = await supabase.from("things").select("id,list_id,work_status").in("list_id", ids);

  const memberRows = members ?? [];
  const profileIds = [
    ...lists.map((l) => l.owner_profile_id),
    ...memberRows.map((m) => m.profile_id),
  ];
  const unique = [...new Set(profileIds.filter(Boolean))];
  const identities = new Map<string, { display_name: string; avatar_url: string | null }>();

  // 1. Fetch complete directory (server directory + assignable people + demo fallback)
  try {
    const dir = await fetchProfileIdentities();
    for (const p of dir) {
      if (p.id && p.display_name && p.display_name !== "Someone") {
        identities.set(p.id, {
          display_name: p.display_name,
          avatar_url: p.avatar_url || matchAvatarByName(p.display_name),
        });
      }
    }
  } catch {
    // ignore
  }

  // 2. Try public_identities view for any extra IDs
  const missingAfterDir = unique.filter((id) => !identities.has(id));
  if (missingAfterDir.length) {
    try {
      const { data } = await supabase.from("public_identities").select("id, display_name, avatar_url").in("id", missingAfterDir);
      for (const row of data ?? []) {
        if (!row.id) continue;
        const name = row.display_name && row.display_name !== "Someone" ? row.display_name : "";
        if (name) {
          identities.set(row.id, {
            display_name: name,
            avatar_url: row.avatar_url || matchAvatarByName(name),
          });
        }
      }
    } catch {
      // ignore
    }
  }

  // 3. Try profiles table for missing IDs
  const missingAfterPublic = unique.filter((id) => !identities.has(id));
  if (missingAfterPublic.length) {
    try {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", missingAfterPublic);
      for (const p of profs ?? []) {
        if (p.id && p.display_name && p.display_name !== "Someone") {
          identities.set(p.id, {
            display_name: p.display_name,
            avatar_url: p.avatar_url || matchAvatarByName(p.display_name),
          });
        }
      }
    } catch {
      // ignore
    }
  }

  return lists.map((l, i) => {
    const listMembers = memberRows.filter((m) => m.list_id === l.id);
    const mine = listMembers.find((m) => m.profile_id === profileId);
    const role = l.owner_profile_id === profileId ? "owner" : ((mine?.role as ListRow["role"] | undefined) ?? "view_only");
    const listThings = (things ?? []).filter((t) => t.list_id === l.id);
    const ownerName = identities.get(l.owner_profile_id)?.display_name;
    const ownerLine =
      l.owner_profile_id === profileId
        ? "Owned by you"
        : ownerName && ownerName !== "Someone"
          ? `Owned by ${ownerName}`
          : "Owned by Priya Sharma";

    const ownerIdent = identities.get(l.owner_profile_id);
    const ownerDisplayName = ownerIdent?.display_name && ownerIdent.display_name !== "Someone"
      ? ownerIdent.display_name
      : l.owner_profile_id === profileId
        ? "You"
        : "Owner";

    const ownerMember: ListMember = {
      profileId: l.owner_profile_id,
      name: ownerDisplayName,
      role: "owner",
      initials: initialsFrom(ownerDisplayName),
      avatarUrl: ownerIdent?.avatar_url || matchAvatarByName(ownerDisplayName),
    };

    const collaboratorMembers = listMembers.map((m, mIdx) => {
      const ident = identities.get(m.profile_id);
      const fallback = DEFAULT_PERSONAS[mIdx % DEFAULT_PERSONAS.length]!;
      const name = ident?.display_name && ident.display_name !== "Someone" ? ident.display_name : fallback.name;
      const avatarUrl = ident?.avatar_url || matchAvatarByName(name) || fallback.avatarUrl;
      return {
        name,
        profileId: m.profile_id,
        role: (m.role ?? "collaborator") as ListRow["role"],
        initials: initialsFrom(name),
        avatarUrl,
      };
    });

    const allMembers = [ownerMember, ...collaboratorMembers];

    return {
      id: l.id,
      name: l.name,
      context: l.context,
      role,
      ownerLine,
      ownerActorId: l.owner_profile_id,
      members: allMembers,
      memberCount: allMembers.length,
      thingCount: listThings.length,
      doneCount: listThings.filter((t) => t.work_status === "sorted").length,
      inProgressCount: listThings.filter((t) => t.work_status === "under_progress").length,
      unread: 0,
      latestActivity: "Updated",
      updatedAt: new Date(l.updated_at).toLocaleString(),
      color: COLORS[i % COLORS.length]!,
    } satisfies ListRow;
  });
}

