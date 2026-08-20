import { useQuery, type QueryClient } from "@tanstack/react-query";
import { keys } from "@/domain/query-keys";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";

export type PersonalShred = {
  thingIds: Set<string>;
  listIds: Set<string>;
};

export const EMPTY_PERSONAL_SHRED: PersonalShred = {
  thingIds: new Set(),
  listIds: new Set(),
};

export function personalShredFromRows(
  rows: { object_id: string; object_type: string }[],
): PersonalShred {
  const thingIds = new Set<string>();
  const listIds = new Set<string>();
  for (const row of rows) {
    if (row.object_type === "thing") thingIds.add(row.object_id);
    else if (row.object_type === "list") listIds.add(row.object_id);
  }
  return { thingIds, listIds };
}

export function excludePersonallyShreddedThings<T extends { id: string }>(
  things: T[],
  shred: PersonalShred,
): T[] {
  if (!shred.thingIds.size) return things;
  return things.filter((t) => !shred.thingIds.has(t.id));
}

export function excludePersonallyShreddedLists<T extends { id: string }>(
  lists: T[],
  shred: PersonalShred,
): T[] {
  if (!shred.listIds.size) return lists;
  return lists.filter((l) => !shred.listIds.has(l.id));
}

export function isPersonallyShreddedList(
  listId: string | undefined | null,
  shred: PersonalShred,
): boolean {
  return Boolean(listId && shred.listIds.has(listId));
}

export function excludePersonallyShreddedList<T extends { id: string }>(
  list: T | null | undefined,
  shred: PersonalShred,
): T | undefined {
  if (!list) return undefined;
  if (shred.listIds.has(list.id)) return undefined;
  return list;
}

export async function fetchPersonalShred(): Promise<PersonalShred> {
  const { data, error } = await supabase
    .from("profile_object_state")
    .select("object_id, object_type")
    .not("shredded_at", "is", null);
  if (error) throw error;
  return personalShredFromRows(data ?? []);
}

/** Live personal Shred lens. Demo uses local-state shredded maps instead. */
export function usePersonalShred(): PersonalShred {
  const { session, user } = useSession();
  const preview = isPreviewSession(session);
  const query = useQuery({
    queryKey: keys.shredded(user?.id),
    enabled: Boolean(user) && !preview,
    queryFn: fetchPersonalShred,
    staleTime: 10_000,
  });
  return query.data ?? EMPTY_PERSONAL_SHRED;
}

/** Court / Lists / Nudges / Doorman / buckets after personal Shred or Restore. */
export async function invalidatePersonalSurfaces(qc: QueryClient) {
  await Promise.all([
    qc.invalidateQueries({ queryKey: ["shredded"] }),
    qc.invalidateQueries({ queryKey: ["court"] }),
    qc.invalidateQueries({ queryKey: ["lists"] }),
    qc.invalidateQueries({ queryKey: ["list"] }),
    qc.invalidateQueries({ queryKey: ["list-things"] }),
    qc.invalidateQueries({ queryKey: ["list-messages"] }),
    qc.invalidateQueries({ queryKey: ["doorman"] }),
    qc.invalidateQueries({ queryKey: ["nudges"] }),
    qc.invalidateQueries({ queryKey: ["nudge-history"] }),
    qc.invalidateQueries({ queryKey: ["trophy"] }),
    qc.invalidateQueries({ queryKey: ["accessible-things"] }),
    qc.invalidateQueries({ queryKey: ["bucket-items"] }),
    qc.invalidateQueries({ queryKey: ["buckets"] }),
    qc.invalidateQueries({ queryKey: ["bucket"] }),
  ]);
}
