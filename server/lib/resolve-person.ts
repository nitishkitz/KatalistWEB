import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Resolves a fuzzy personId (actor id, profile id, or a display-name
 * fragment) to a profile id, scoped through whatever client is passed in -
 * a user-scoped client naturally limits results to what that caller can see.
 */
export async function resolvePersonToProfileId(
  client: SupabaseClient,
  personId: string,
): Promise<string | null> {
  const { data: actor } = await client.from("actors").select("id, profile_id").eq("id", personId).maybeSingle();
  if (actor?.profile_id) return actor.profile_id;

  const { data: prof } = await client.from("profiles").select("id").eq("id", personId).maybeSingle();
  if (prof?.id) return prof.id;

  const { data: byName } = await client.from("profiles").select("id").ilike("display_name", `%${personId}%`).limit(1);
  if (byName?.[0]?.id) return byName[0].id;

  return null;
}
