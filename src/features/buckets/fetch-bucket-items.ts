import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Thing } from "@/domain/thing";
import type { ListRow } from "@/features/lists/fixtures";
import { mapDbListRows, type DbListRow } from "@/features/lists/map-list-rows";
import { mapDbThingRows, THING_COLUMNS, type DbThingRow } from "@/features/things/map-thing-rows";

export type BucketItem =
  | { kind: "thing"; thingId: string; thing: Thing }
  | { kind: "list"; listId: string; list: ListRow };

async function fetchListsByIds(qc: QueryClient, profileId: string, listIds: string[]): Promise<ListRow[]> {
  if (!listIds.length) return [];
  const { data: lists, error } = await supabase
    .from("lists")
    .select("id,name,context,owner_profile_id,updated_at")
    .in("id", listIds);
  if (error) throw error;
  return mapDbListRows(qc, profileId, (lists ?? []) as DbListRow[]);
}

/**
 * Kept in its own module (no React/JSX imports) so it's importable from a
 * plain Node test — see scripts/fetch-bucket-items-concurrency.test.mjs —
 * without pulling in use-bucket-items.ts's transitive React-hook/JSX
 * dependency graph (useAppContext -> AppContextProvider.tsx breaks the
 * plain Node test runner; same reason fetchCourt/fetchBuckets moved out
 * of their hook files).
 */
export async function fetchBucketItems(qc: QueryClient, bucketId: string, profileId: string): Promise<BucketItem[]> {
  const { data, error } = await supabase
    .from("bucket_items")
    .select("thing_id, list_id")
    .eq("bucket_id", bucketId);
  if (error) throw error;
  const thingIds = (data ?? []).map((r) => r.thing_id).filter(Boolean) as string[];
  const listIds = (data ?? []).map((r) => r.list_id).filter(Boolean) as string[];

  // Things (+ its mapper) and Lists both depend only on bucket_items'
  // output above, not on each other, so they run concurrently instead of
  // things-then-lists.
  const [things, lists] = await Promise.all([
    (async () => {
      const { data: thingRows, error: thingError } = thingIds.length
        ? await supabase.from("things").select(THING_COLUMNS).in("id", thingIds)
        : { data: [], error: null };
      if (thingError) throw thingError;
      return mapDbThingRows((thingRows ?? []) as DbThingRow[]);
    })(),
    fetchListsByIds(qc, profileId, listIds),
  ]);
  const thingById = new Map(things.map((t) => [t.id, t]));
  const listById = new Map(lists.map((l) => [l.id, l]));

  const items: BucketItem[] = [];
  for (const r of data ?? []) {
    if (r.thing_id) {
      const thing = thingById.get(r.thing_id);
      if (thing) items.push({ kind: "thing", thingId: thing.id, thing });
    } else if (r.list_id) {
      const list = listById.get(r.list_id);
      if (list) items.push({ kind: "list", listId: list.id, list });
    }
  }
  return items;
}
