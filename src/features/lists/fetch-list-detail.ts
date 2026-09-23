import { supabase } from "@/integrations/supabase/client";
import { mapDbListRows, type DbListRow } from "./map-list-rows";
import type { ListRow } from "./fixtures";

/**
 * Kept in its own module (no React/JSX imports) so it's importable from
 * a plain Node test — see scripts/fetch-list-detail.test.mjs — without
 * pulling in use-lists.ts's transitive React-hook/JSX
 * dependency graph (useAppContext -> AppContextProvider.tsx breaks the
 * plain Node test runner; same reason fetchCourt/fetchBuckets moved out
 * of their hook files).
 */
export async function fetchListDetail(profileId: string, listId: string): Promise<ListRow | null> {
  // Map the one List row this query fetches directly, instead of
  // re-fetching every List in its context via fetchLists() just to
  // throw away everything but this one. Same select columns fetchLists()
  // uses, so mapDbListRows() has everything it needs (cover_storage_path,
  // description, etc.).
  const { data, error } = await supabase
    .from("lists")
    .select("id,name,context,owner_profile_id,updated_at,description,cover_storage_path")
    .eq("id", listId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const [row] = await mapDbListRows(profileId, [data as DbListRow]);
  return row ?? null;
}
