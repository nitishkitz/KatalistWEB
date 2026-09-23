import type { QueryClient } from "@tanstack/react-query";
import { keys } from "@/domain/query-keys";
import type { ListRow } from "./fixtures";

/** Viewer-relative fields must come from this profile's current context. */
export function getListDetailSeed(
  qc: QueryClient,
  profileId: string | undefined,
  context: string,
  listId: string | undefined,
): ListRow | undefined {
  if (!profileId || !listId) return undefined;
  return qc.getQueryData<ListRow[]>(keys.lists(profileId, context))?.find((list) => list.id === listId);
}
