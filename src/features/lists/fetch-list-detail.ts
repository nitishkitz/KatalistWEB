import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { mapDbListRows, type DbListRow } from "./map-list-rows";
import type { ListRow } from "./fixtures";
import { withReadDeadline } from "@/lib/read-request";

const COLUMNS = "id,name,context,owner_profile_id,updated_at,description,cover_storage_path";

/**
 * Kept in its own module (no React/JSX imports) so it's importable from
 * a plain Node test — see scripts/fetch-list-detail.test.mjs — without
 * pulling in use-lists.ts's transitive React-hook/JSX dependency graph
 * (useAppContext -> AppContextProvider.tsx breaks the plain Node test
 * runner; same reason fetchCourt/fetchBuckets moved out of their hook
 * files).
 *
 * Must preserve the same eligibility rules fetchLists() (in
 * use-lists.ts) applies to the whole-context query: only unarchived,
 * `kind = "list"` rows are task Lists. Without these filters, an
 * archived List or a Team-hub conversation row (dm/group `kind`) would
 * resolve here even though neither belongs on the Lists surface.
 */
export async function fetchListDetail(
  qc: QueryClient,
  profileId: string,
  listId: string,
  querySignal?: AbortSignal,
): Promise<ListRow | null> {
  // T01: the primary query and its possible fallback (below) are one
  // logical read operation -- bounded together under a single deadline
  // (read-request.ts), wired to React Query's own cancellation signal so a
  // superseded/refetched call or unmount stops whichever request is
  // actually in flight.
  const { data, error } = await withReadDeadline(querySignal, async (signal) => {
    const first = await supabase
      .from("lists")
      .select(COLUMNS)
      .eq("id", listId)
      .eq("kind", "list")
      .is("archived_at", null)
      .abortSignal(signal)
      .maybeSingle();
    // The `kind` column ships with the Team hub migration; until it's
    // applied, `kind` doesn't exist and Postgres reports it in the error
    // message. Only that specific, narrowly-identified failure falls back
    // to a query without the `kind` filter — any other error (network,
    // permission, validation) must reject, not silently retry without
    // filters. The fallback still restricts by exact id and archive
    // status; it never fetches the whole context.
    if (first.error && /kind/i.test(first.error.message ?? "")) {
      return supabase.from("lists").select(COLUMNS).eq("id", listId).is("archived_at", null).abortSignal(signal).maybeSingle();
    }
    return first;
  });
  if (error) throw error;
  if (!data) return null;
  const [row] = await mapDbListRows(qc, profileId, [data as DbListRow]);
  return row ?? null;
}
