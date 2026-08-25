import { supabase } from "@/integrations/supabase/client";
import type { ListRow } from "./fixtures";

const COLORS = ["bg-violet-500", "bg-sky-500", "bg-emerald-500", "bg-amber-500", "bg-rose-500"];

export type DbListRow = {
  id: string;
  name: string;
  context: "work" | "home";
  owner_profile_id: string;
  description?: string | null;
  cover_storage_path?: string | null;
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

/**
 * Safe List identity mapping: members + owner via resolve_profile_identities.
 * Never joins profiles for display name or avatar. Owner name resolves even
 * when the owner is not a list_members row.
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
  if (unique.length) {
    const { data } = await supabase.rpc("resolve_profile_identities", { p_profile_ids: unique });
    for (const row of data ?? []) {
      if (!row.id) continue;
      identities.set(row.id, {
        display_name: row.display_name || "Someone",
        avatar_url: row.avatar_url ?? null,
      });
    }
  }

  return lists.map((l, i) => {
    const listMembers = memberRows.filter((m) => m.list_id === l.id);
    const mine = listMembers.find((m) => m.profile_id === profileId);
    const role = l.owner_profile_id === profileId ? "owner" : ((mine?.role as ListRow["role"] | undefined) ?? "view_only");
    const listThings = (things ?? []).filter((t) => t.list_id === l.id);
    const ownerName = identities.get(l.owner_profile_id)?.display_name;
    const ownerLine =
      l.owner_profile_id === profileId ? "Owned by you" : ownerName ? `Owned by ${ownerName}` : "Owned by Someone";
    return {
      id: l.id,
      name: l.name,
      description: l.description ?? null,
      coverStoragePath: l.cover_storage_path ?? null,
      context: l.context,
      role,
      ownerLine,
      members: [{
        name: ownerName ?? "Someone",
        profileId: l.owner_profile_id,
        role: "owner" as const,
        initials: initialsFrom(ownerName ?? "Someone"),
        avatarUrl: identities.get(l.owner_profile_id)?.avatar_url ?? null,
      }, ...listMembers.slice(0, 4).map((m) => {
        const ident = identities.get(m.profile_id);
        const name = ident?.display_name ?? "Someone";
        return {
          name,
          profileId: m.profile_id,
          role: (m.role ?? "collaborator") as ListRow["role"],
          initials: initialsFrom(name),
          avatarUrl: ident?.avatar_url ?? null,
        };
      })],
      memberCount: listMembers.length + 1,
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
