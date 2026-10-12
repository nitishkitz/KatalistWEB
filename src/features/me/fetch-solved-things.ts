import type { QueryClient } from "@tanstack/react-query";
import type { Thing } from "@/domain/thing";
import { supabase } from "@/integrations/supabase/client";
import { getActorId } from "@/features/people/actor-query";
import { withReadDeadline } from "@/lib/read-request";
import { THING_OVERVIEW_COLUMNS, type DbThingRow, mapDbThingRows } from "@/features/things/map-thing-rows";

export const SOLVED_THINGS_PAGE_SIZE = 30;

export type SolvedThingsPage = { things: Thing[]; hasMore: boolean };

/**
 * Currently solved Things, each once: accessible Things whose current
 * assignee is the signed-in actor, that are Sorted and not cancelled, across
 * Work and Home. Personally shredded Things are deliberately included, so
 * hiding a Thing from Court does not erase the completion record. Access is
 * enforced by RLS; this is a current-state list, not a historical ledger.
 *
 * Kept free of React/JSX imports so it is importable from a plain Node test.
 */
export async function fetchSolvedThings(
  profileId: string,
  qc: QueryClient,
  page: number,
  signal?: AbortSignal,
): Promise<SolvedThingsPage> {
  const actorId = await getActorId(qc, profileId);
  if (!actorId) return { things: [], hasMore: false };
  const from = page * SOLVED_THINGS_PAGE_SIZE;
  // One extra row tells us whether another page exists.
  const to = from + SOLVED_THINGS_PAGE_SIZE;
  const { data, error } = await withReadDeadline(signal, async (combined) =>
    supabase
      .from("things")
      .select(THING_OVERVIEW_COLUMNS)
      .eq("current_assignee_actor_id", actorId)
      .eq("work_status", "sorted")
      .is("cancelled_at", null)
      .order("sorted_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .range(from, to)
      .abortSignal(combined),
  );
  if (error) throw error;
  const rows = (data ?? []) as DbThingRow[];
  const hasMore = rows.length > SOLVED_THINGS_PAGE_SIZE;
  const things = await mapDbThingRows(rows.slice(0, SOLVED_THINGS_PAGE_SIZE), actorId, "overview");
  return { things, hasMore };
}

/** Count-only query with the identical membership filters as the list. */
export async function fetchSolvedThingCount(profileId: string, qc: QueryClient): Promise<number> {
  const actorId = await getActorId(qc, profileId);
  if (!actorId) return 0;
  const { count, error } = await withReadDeadline(undefined, async (combined) =>
    supabase
      .from("things")
      .select("id", { count: "exact", head: true })
      .eq("current_assignee_actor_id", actorId)
      .eq("work_status", "sorted")
      .is("cancelled_at", null)
      .abortSignal(combined),
  );
  if (error) throw error;
  return count ?? 0;
}

/** Preview equivalent: same membership and order over locally merged Things. */
export function solvedThingsFromLocal(things: Thing[], actorId: string): Thing[] {
  return things
    .filter((t) => t.assignee.id === actorId && t.workStatus === "sorted" && !t.cancelledAt)
    .sort((a, b) => {
      const at = a.sortedAt ? new Date(a.sortedAt).getTime() : null;
      const bt = b.sortedAt ? new Date(b.sortedAt).getTime() : null;
      if (at === null && bt !== null) return 1;
      if (bt === null && at !== null) return -1;
      if (at !== null && bt !== null && at !== bt) return bt - at;
      return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
    });
}
