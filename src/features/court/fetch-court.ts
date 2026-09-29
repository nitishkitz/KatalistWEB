import type { QueryClient } from "@tanstack/react-query";
import type { Thing } from "@/domain/thing";
import { supabase } from "@/integrations/supabase/client";
import { mapDbThingRows, THING_OVERVIEW_COLUMNS, type DbThingRow } from "@/features/things/map-thing-rows";
import { getActorId } from "@/features/people/actor-query";
import { withReadDeadline, READ_DEADLINE_MS } from "@/lib/read-request";

/**
 * Kept in its own module (no React/JSX imports) so it's importable from a
 * plain Node test — see scripts/use-court-concurrency.test.mjs — without
 * pulling in use-court.ts's transitive React-hook/JSX dependency graph.
 */
export async function fetchCourt(
  context: "work" | "home",
  profileId: string,
  qc: QueryClient,
  querySignal?: AbortSignal,
  /** Test-only override of read-request.ts's shared deadline -- production
   *  callers never pass this, so they always get the real 15s bound. */
  readDeadlineMs: number = READ_DEADLINE_MS,
): Promise<{ things: Thing[]; myActorId: string | null }> {
  // profileId comes from the session useCourt() already holds (see its
  // enabled: liveAuth gate) — no need to re-fetch the current user via
  // supabase.auth.getUser() just to get an id we already have. This
  // isn't a weaker identity check: both RLS policies this function
  // depends on key off auth.uid() (the server-validated JWT claim), not
  // any client-supplied id —
  //   actors: "profile_id = auth.uid()" (supabase/migrations/
  //     20260818125511_...sql)
  //   things: katalist_priv.can_view_thing(), which checks
  //     "a.profile_id = auth.uid()" internally (supabase/migrations/
  //     20260818142601_...sql) — the things query below doesn't even
  //     pass myActorId as a filter, only `context`.
  // A stale/wrong profileId here can only ever cause the actors lookup
  // to return no row (myActorId becomes null); it can't leak another
  // account's data, since the database enforces the real boundary
  // independent of this argument. This also matches use-lists.ts and
  // use-buckets.ts, neither of which ever called auth.getUser() either.
  //
  // The actor lookup (now the shared, deduplicated, epoch-guarded P4
  // actor cache -- see actor-query.ts) and the things query are
  // independent of each other (the things query only needs `context`),
  // so they run concurrently instead of the actor lookup blocking the
  // things query behind it. The actor lookup's result isn't decorative:
  // myActorId feeds partitionCourt()'s "mine" vs "theirs" split. A
  // failed lookup must reject, not silently resolve to null — a null
  // myActorId despite successfully fetched Things would make both
  // partitions look empty (a false-empty state), not just "this profile
  // has no actor yet". getActorId already distinguishes those two
  // cases (throws on a real failure; resolves null for a legitimate
  // no-row profile).
  // Bound the complete load, including shared actor resolution and row
  // enrichment. Only the Things request belongs to this caller; cancelling
  // Court must not cancel the shared actor cache used by other screens.
  return withReadDeadline(querySignal, async (signal) => {
    const [myActorId, { data: rows, error }] = await Promise.all([
      getActorId(qc, profileId),
      supabase.from("things").select(THING_OVERVIEW_COLUMNS).eq("context", context).is("cancelled_at", null).abortSignal(signal),
    ]);

    if (error) throw error;
    const things = await mapDbThingRows((rows ?? []) as DbThingRow[], myActorId, "overview");
    return { things, myActorId };
  }, readDeadlineMs);
}
