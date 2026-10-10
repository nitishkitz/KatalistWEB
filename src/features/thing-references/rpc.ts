import { useQuery } from "@tanstack/react-query";
import { callUngeneratedRpc } from "@/integrations/supabase/rpcs";
import { isPreviewMode } from "@/lib/session-mode";
import { isThingId, makeThingReference, type ThingReference } from "./thing-reference";

const previewReferences = new Map<string, ThingReference[]>();

/** Attaches references to a Thing. Server-side checks require the caller to see the Thing and every source. */
export async function rpcAddThingReferences(thingId: string, references: readonly ThingReference[]) {
  if (!references.length) return;
  if (isPreviewMode()) {
    previewReferences.set(thingId, [...references]);
    return;
  }
  const { error } = await callUngeneratedRpc("add_thing_references", {
    p_thing_id: thingId,
    p_source_ids: references.map((ref) => ref.thingId),
  });
  if (error) throw new Error(error.message);
}

async function fetchThingReferences(thingId: string): Promise<ThingReference[]> {
  if (isPreviewMode()) return previewReferences.get(thingId) ?? [];
  const { data, error } = await callUngeneratedRpc("get_thing_references", { p_thing_id: thingId });
  if (error) throw new Error(error.message);
  const rows = Array.isArray(data) ? (data as Array<{ source_thing_id?: unknown }>) : [];
  return rows.flatMap((row) =>
    isThingId(row.source_thing_id) ? [makeThingReference(row.source_thing_id)].filter((r): r is ThingReference => Boolean(r)) : [],
  );
}

export function useThingReferences(thingId: string | null) {
  return useQuery({
    queryKey: ["thing-references", thingId ?? "none"],
    queryFn: () => fetchThingReferences(thingId!),
    enabled: Boolean(thingId),
    staleTime: 30_000,
  });
}
