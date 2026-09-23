import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { keys } from "@/domain/query-keys";
import { getIdentityEpoch, isEpochCurrent, registerIdentityDisposer } from "@/features/realtime/identity-cache-policy";

/**
 * How long a resolved actor id -- including a legitimate "no actor
 * row yet" null -- stays fresh before a lookup re-checks. Bounded
 * specifically so a profile whose actor gets provisioned after this
 * module first saw "no actor" is eventually discovered on its own,
 * without needing a realtime signal this app doesn't reliably have
 * (see the P3 design doc's note on checking event publication before
 * assuming actor changes are delivered).
 */
export const ACTOR_STALE_TIME_MS = 30_000;

/**
 * Pure fetch: throws on a real failure, returns `null` for a
 * legitimate no-row profile. `.maybeSingle()` already distinguishes
 * the two cases for us ({ data: null, error: null } vs. error set) --
 * same pattern as fetch-court.ts's actor lookup, which this module is
 * meant to replace.
 */
export async function fetchActorId(profileId: string): Promise<string | null> {
  const { data, error } = await supabase.from("actors").select("id").eq("profile_id", profileId).maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

const disposerRegisteredFor = new WeakSet<QueryClient>();

function ensureDisposerRegistered(qc: QueryClient) {
  if (disposerRegisteredFor.has(qc)) return;
  disposerRegisteredFor.add(qc);
  // Hygiene, not a correctness requirement on its own -- actor keys are
  // already profile-scoped (keys.actor(profileId)), so a new identity
  // naturally uses a different key and can't collide with the old
  // one's cached value regardless. Still explicitly evicted on
  // retirement per the P4 acceptance criteria, and this is teardown-
  // only (just qc.removeQueries), matching every other registered
  // disposer's contract.
  registerIdentityDisposer(qc, () => {
    qc.removeQueries({ queryKey: ["actor"] });
  });
}

/**
 * Profile-scoped actor id lookup, deduplicated and cached via the
 * QueryClient itself -- no independent module-level Map. Concurrent
 * callers for the SAME profileId share one in-flight fetch
 * (qc.fetchQuery's own request-deduplication); a failed fetch never
 * becomes a cached successful result (fetchQuery rejects, and
 * TanStack does not write `data` for a thrown queryFn); a legitimate
 * "no actor yet" caches as `null` but only for ACTOR_STALE_TIME_MS, so
 * a since-provisioned actor is discovered without an explicit signal.
 *
 * No `context` parameter: the `actors` table has no context column
 * (verified against the RLS migrations referenced in fetch-court.ts)
 * -- an actor's identity does not vary by work/home, so this cache
 * follows that data model instead of inventing a context dimension
 * the schema doesn't have.
 *
 * Preview/demo sessions never reach this function -- callers are
 * expected to guard that themselves, matching every other
 * Supabase-backed fetcher in this codebase (fetchCourt, fetchLists,
 * etc. all take the same approach).
 */
export async function getActorId(qc: QueryClient, profileId: string): Promise<string | null> {
  ensureDisposerRegistered(qc);
  const epoch = getIdentityEpoch(qc).epoch;
  const result = await qc.fetchQuery({
    queryKey: keys.actor(profileId),
    queryFn: () => fetchActorId(profileId),
    staleTime: ACTOR_STALE_TIME_MS,
  });
  if (!isEpochCurrent(qc, epoch)) {
    // A late completion after this identity retired. The fetch above
    // already wrote its result into the cache as part of resolving --
    // this removes it again immediately, so nothing that looks at this
    // profile's actor cache afterward (including this same profile
    // re-authenticating later) can be served a value that landed after
    // the identity it was requested for had already retired.
    qc.removeQueries({ queryKey: keys.actor(profileId) });
    throw new Error("Stale identity: actor lookup discarded after an identity switch.");
  }
  return result;
}

/**
 * Call after any action known to provision or change an actor row for
 * this profile, so the next getActorId call re-fetches instead of
 * serving a cached value for up to ACTOR_STALE_TIME_MS. No such action
 * exists in this codebase today (actor rows are provisioned server-
 * side, not through a client mutation this app calls) -- exported for
 * whenever one does, rather than left unaddressed.
 */
export function invalidateActorId(qc: QueryClient, profileId: string | undefined): void {
  void qc.invalidateQueries({ queryKey: keys.actor(profileId) });
}
