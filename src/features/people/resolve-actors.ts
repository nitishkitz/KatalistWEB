import { supabase } from "@/integrations/supabase/client";
import type { Person } from "@/domain/thing";

function toPerson(id: string, name: string | null, avatar?: string | null): Person {
  const n = name || "Someone";
  return {
    id,
    name: n,
    initials: n
      .split(" ")
      .map((p) => p[0])
      .slice(0, 2)
      .join("")
      .toUpperCase(),
    avatarUrl: avatar,
  };
}

/**
 * Resolve display identity for actor ids the current user is allowed to see.
 * Prefers resolve_actor_identities RPC; falls back to list_assignable_people.
 * Never returns email/phone.
 */
export async function resolveActorPeople(actorIds: string[]): Promise<Map<string, Person>> {
  const unique = [...new Set(actorIds.filter(Boolean))];
  const people = new Map<string, Person>();
  if (!unique.length) return people;

  const { data, error } = await supabase.rpc("resolve_actor_identities", { p_actor_ids: unique });
  if (!error && data) {
    for (const row of data) {
      people.set(row.actor_id, toPerson(row.actor_id, row.display_name, row.avatar_url));
    }
    return people;
  }

  const { data: assignable } = await supabase.rpc("list_assignable_people");
  for (const row of assignable ?? []) {
    if (unique.includes(row.actor_id)) {
      people.set(row.actor_id, toPerson(row.actor_id, row.display_name, row.avatar_url));
    }
  }
  return people;
}

export function personOrSomeone(people: Map<string, Person>, id: string): Person {
  return people.get(id) ?? toPerson(id, "Someone");
}
