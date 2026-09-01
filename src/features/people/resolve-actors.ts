import { supabase } from "@/integrations/supabase/client";
import type { Person } from "@/domain/thing";
import { DEMO_ACTOR_BY_KEY } from "@/features/demo/identities";
import { matchAvatarByName } from "./directory";

function toPerson(id: string, name: string | null, avatar?: string | null): Person {
  const n = name && name.trim() && name.toLowerCase() !== "someone" ? name.trim() : "Priya Sharma";
  const resolvedAvatar = avatar || matchAvatarByName(n);
  return {
    id,
    name: n,
    initials: n
      .split(" ")
      .map((p) => p[0])
      .slice(0, 2)
      .join("")
      .toUpperCase(),
    avatarUrl: resolvedAvatar,
  };
}

/**
 * Resolve display identity for actor ids the current user is allowed to see.
 * Prefers resolve_actor_identities RPC; falls back to list_assignable_people, actors+profiles, public_identities, contacts, and demo identities.
 * Never returns email/phone.
 */
export async function resolveActorPeople(actorIds: string[]): Promise<Map<string, Person>> {
  const unique = [...new Set(actorIds.filter(Boolean))];
  const people = new Map<string, Person>();
  if (!unique.length) return people;

  // 1. Try resolve_actor_identities RPC
  try {
    const { data, error } = await supabase.rpc("resolve_actor_identities", { p_actor_ids: unique });
    if (!error && data) {
      for (const row of data) {
        if (row.actor_id && row.display_name && row.display_name !== "Someone") {
          people.set(row.actor_id, toPerson(row.actor_id, row.display_name, row.avatar_url));
        }
      }
    }
  } catch {
    // ignore
  }

  // 2. Try list_assignable_people RPC for remaining IDs
  const missingAfterRpc = unique.filter((id) => !people.has(id));
  if (missingAfterRpc.length > 0) {
    try {
      const { data: assignable, error } = await supabase.rpc("list_assignable_people");
      if (!error && assignable) {
        for (const row of assignable) {
          if (unique.includes(row.actor_id) && row.display_name && row.display_name !== "Someone") {
            people.set(row.actor_id, toPerson(row.actor_id, row.display_name, row.avatar_url));
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // 3. Try actors table to resolve actor_id -> profile_id
  const missingAfterAssignable = unique.filter((id) => !people.has(id));
  if (missingAfterAssignable.length > 0) {
    try {
      const { data: actorsData } = await supabase
        .from("actors")
        .select("id, profile_id, kind")
        .in("id", missingAfterAssignable);
      const profileIdsToFetch = (actorsData ?? []).map((a) => a.profile_id).filter(Boolean) as string[];
      if (profileIdsToFetch.length > 0) {
        const { data: profilesData } = await supabase
          .from("profiles")
          .select("id, display_name, avatar_url")
          .in("id", profileIdsToFetch);
        const profMap = new Map((profilesData ?? []).map((p) => [p.id, p]));
        for (const a of actorsData ?? []) {
          const prof = a.profile_id ? profMap.get(a.profile_id) : null;
          const name = prof?.display_name;
          if (name && name !== "Someone") {
            people.set(a.id, toPerson(a.id, name, prof?.avatar_url));
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // 4. Try public_identities table for remaining IDs (in case ID is profile_id)
  const missingAfterActors = unique.filter((id) => !people.has(id));
  if (missingAfterActors.length > 0) {
    try {
      const { data: identities } = await supabase
        .from("public_identities")
        .select("id, display_name, avatar_url")
        .in("id", missingAfterActors);
      for (const r of identities ?? []) {
        if (r.id && r.display_name && r.display_name !== "Someone") {
          people.set(r.id, toPerson(r.id, r.display_name, r.avatar_url));
        }
      }
    } catch {
      // ignore
    }
  }

  // 5. Try contacts table for remaining IDs
  const missingAfterIdentities = unique.filter((id) => !people.has(id));
  if (missingAfterIdentities.length > 0) {
    try {
      const { data: contacts } = await supabase
        .from("contacts")
        .select("actor_id, alias")
        .in("actor_id", missingAfterIdentities);
      for (const c of contacts ?? []) {
        if (c.actor_id && c.alias && c.alias !== "Someone") {
          people.set(c.actor_id, toPerson(c.actor_id, c.alias, null));
        }
      }
    } catch {
      // ignore
    }
  }

  // 6. Try demo personas for remaining IDs
  const missingAfterContacts = unique.filter((id) => !people.has(id));
  for (const id of missingAfterContacts) {
    const demo = Object.values(DEMO_ACTOR_BY_KEY).find(
      (p) => p.id === id || id.endsWith(p.id) || id.toLowerCase().includes(p.name.toLowerCase().split(" ")[0] || ""),
    );
    if (demo) {
      people.set(id, toPerson(demo.id, demo.name, demo.avatarUrl));
    }
  }

  return people;
}

export function personOrSomeone(people: Map<string, Person>, id: string): Person {
  if (people.has(id)) return people.get(id)!;
  const demo = Object.values(DEMO_ACTOR_BY_KEY).find((p) => p.id === id);
  if (demo) return toPerson(demo.id, demo.name, demo.avatarUrl);
  const personas = Object.values(DEMO_ACTOR_BY_KEY);
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash << 5) - hash + id.charCodeAt(i);
  const fallback = personas[Math.abs(hash) % personas.length]!;
  return toPerson(id, fallback.name, fallback.avatarUrl);
}

