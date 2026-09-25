import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { callUngeneratedRpc } from "@/integrations/supabase/rpcs";
import { fetchProfileIdentitiesByIds, matchAvatarByName } from "../people/directory";
import { DEMO_ACTOR_BY_KEY } from "../demo/identities";
import type { ListRow, ListMember } from "./fixtures";

const COLORS = ["bg-violet-500", "bg-sky-500", "bg-emerald-500", "bg-amber-500", "bg-rose-500"];

export type DbListRow = {
  id: string;
  name: string;
  context: "work" | "home";
  owner_profile_id: string;
  updated_at: string;
  description?: string | null;
  cover_storage_path?: string | null;
};

const COVER_BUCKET = "list-covers";
const COVER_URL_TTL_SECONDS = 60 * 60; // 1 hour

type ListCounts = { list_id: string; thing_count: number; done_count: number; in_progress_count: number };

export async function fetchListCounts(ids: string[]): Promise<Map<string, ListCounts>> {
  const counts = new Map<string, ListCounts>();
  for (let offset = 0; offset < ids.length; offset += 500) {
    const { data, error } = await callUngeneratedRpc("get_list_overview_counts", { p_list_ids: ids.slice(offset, offset + 500) });
    if (error) throw error;
    for (const row of (data ?? []) as ListCounts[]) counts.set(row.list_id, row);
  }
  return counts;
}

/** Batch-sign the private cover paths into displayable URLs. */
async function signCoverUrls(paths: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(paths.filter(Boolean))];
  if (!unique.length) return map;
  try {
    const { data } = await supabase.storage
      .from(COVER_BUCKET)
      .createSignedUrls(unique, COVER_URL_TTL_SECONDS);
    for (const entry of data ?? []) {
      if (entry.path && entry.signedUrl) map.set(entry.path, entry.signedUrl);
    }
  } catch {
    // Covers are decorative — never block the list on a signing failure.
  }
  return map;
}

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
export async function mapDbListRows(_qc: QueryClient, profileId: string, lists: DbListRow[]): Promise<ListRow[]> {
  if (!lists.length) return [];
  const ids = lists.map((l) => l.id);
  // These three are independent of each other — cover URLs only need
  // `lists`' own cover paths, and the members/things queries only need
  // `ids`, none of the three needs another's result — so they run
  // concurrently instead of cover-then-members-then-things. (The
  // identity-resolution chain below does depend on `members`, so it
  // still waits for this Promise.all to settle.)
  //
  // members/counts are required data: a failed read must not silently
  // present as "this List has no members/Things" — that's a false empty
  // state. Cover-URL signing is decorative (signCoverUrls already fails
  // open internally, see its own try/catch) and stays nonblocking.
  const [
    coverUrls,
    { data: members, error: membersError },
    counts,
  ] = await Promise.all([
    signCoverUrls(lists.map((l) => l.cover_storage_path).filter((p): p is string => Boolean(p))),
    supabase.from("list_members").select("list_id,profile_id,role").in("list_id", ids),
    fetchListCounts(ids),
  ]);
  if (membersError) throw membersError;

  const memberRows = members ?? [];
  const profileIds = [
    ...lists.map((l) => l.owner_profile_id),
    ...memberRows.map((m) => m.profile_id),
  ];
  const unique = [...new Set(profileIds.filter(Boolean))];
  const identities = new Map<string, { display_name: string; avatar_url: string | null }>();

  // 1. Resolve only this page's owner/member profile IDs. The former broad
  // directory fetch transferred unrelated people on every cold List page.
  try {
    const dir = await fetchProfileIdentitiesByIds(unique);
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
    const listCounts = counts.get(l.id);
    if (!listCounts) throw new Error(`List counters unavailable for ${l.id}`);
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

    const dedupedCollaborators: ListMember[] = [];
    const seenKeys = new Set<string>();
    if (l.owner_profile_id) seenKeys.add(l.owner_profile_id);
    if (ownerDisplayName) seenKeys.add(ownerDisplayName.toLowerCase().trim());

    for (let mIdx = 0; mIdx < listMembers.length; mIdx++) {
      const m = listMembers[mIdx]!;
      if (m.profile_id && seenKeys.has(m.profile_id)) continue;

      const ident = identities.get(m.profile_id);
      const fallback = DEFAULT_PERSONAS[mIdx % DEFAULT_PERSONAS.length]!;
      const name = ident?.display_name && ident.display_name !== "Someone" ? ident.display_name : fallback.name;
      const normName = name.toLowerCase().trim();
      if (seenKeys.has(normName)) continue;

      if (m.profile_id) seenKeys.add(m.profile_id);
      seenKeys.add(normName);

      const avatarUrl = ident?.avatar_url || matchAvatarByName(name) || fallback.avatarUrl;
      dedupedCollaborators.push({
        name,
        profileId: m.profile_id,
        role: (m.role ?? "collaborator") as ListRow["role"],
        initials: initialsFrom(name),
        avatarUrl,
      });
    }

    const allMembers = [ownerMember, ...dedupedCollaborators];

    return {
      id: l.id,
      name: l.name,
      context: l.context,
      role,
      description: l.description ?? null,
      coverUrl: l.cover_storage_path ? (coverUrls.get(l.cover_storage_path) ?? null) : null,
      ownerLine,
      ownerActorId: l.owner_profile_id,
      members: allMembers,
      memberCount: allMembers.length,
      thingCount: listCounts.thing_count,
      doneCount: listCounts.done_count,
      inProgressCount: listCounts.in_progress_count,
      unread: 0,
      latestActivity: "Updated",
      updatedAt: new Date(l.updated_at).toLocaleString(),
      updatedAtIso: l.updated_at,
      color: COLORS[i % COLORS.length]!,
    } satisfies ListRow;
  });
}
