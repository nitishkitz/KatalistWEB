import type { Thing } from "@/domain/thing";
import { supabase } from "@/integrations/supabase/client";
import { mapDbThingRows, THING_COLUMNS, type DbThingRow } from "@/features/things/map-thing-rows";

/**
 * Kept in its own module (no React/JSX imports) so it's importable from a
 * plain Node test — see scripts/use-court-concurrency.test.mjs — without
 * pulling in use-court.ts's transitive React-hook/JSX dependency graph.
 */
export async function fetchCourt(
  context: "work" | "home",
  profileId: string,
): Promise<{ things: Thing[]; myActorId: string | null }> {
  // profileId comes from the session useCourt() already holds (see its
  // enabled: liveAuth gate) — no need to re-fetch the current user via
  // supabase.auth.getUser() just to get an id we already have. The actor
  // lookup and the things query are independent of each other (the
  // things query only needs `context`), so they run concurrently instead
  // of the actor lookup blocking the things query behind it.
  const [{ data: actor }, { data: rows, error }] = await Promise.all([
    supabase.from("actors").select("id").eq("profile_id", profileId).maybeSingle(),
    supabase.from("things").select(THING_COLUMNS).eq("context", context).is("cancelled_at", null),
  ]);
  const myActorId = actor?.id ?? null;

  if (error) throw error;
  const things = await mapDbThingRows((rows ?? []) as DbThingRow[], myActorId);
  return { things, myActorId };
}
