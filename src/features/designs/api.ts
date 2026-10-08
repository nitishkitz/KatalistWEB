import { supabase } from "@/integrations/supabase/client";
import { callUngeneratedRpc } from "@/integrations/supabase/rpcs";
import { withReadDeadline } from "@/lib/read-request";
import {
  DESIGN_FAVORITE_LIMIT,
  DESIGN_FOLDER_LIMIT,
  DESIGN_LINK_LIMIT,
  buildDesignCursorFilter,
  clampDesignPageSize,
  nextDesignCursor,
  toDesignError,
  type DesignCursor,
  type DesignResourceFilter,
} from "./design-queries";
import {
  mapDesignFolder,
  mapDesignResource,
  mapDesignThingLink,
  type DesignFolder,
  type DesignFolderRow,
  type DesignResource,
  type DesignResourceRow,
  type DesignThingLink,
  type DesignThingLinkRow,
} from "./records";

// The generated Supabase types do not know the design tables yet and must not be
// hand-edited. This is the single, narrow escape hatch for reads on them.
type QueryResult = { data: unknown; error: { message: string; hint?: string | null; code?: string | null; details?: string | null } | null };
type UntypedBuilder = PromiseLike<QueryResult> & {
  select(columns: string): UntypedBuilder;
  eq(column: string, value: string | boolean): UntypedBuilder;
  is(column: string, value: null): UntypedBuilder;
  not(column: string, op: string, value: null): UntypedBuilder;
  or(filter: string): UntypedBuilder;
  order(column: string, opts: { ascending: boolean }): UntypedBuilder;
  limit(count: number): UntypedBuilder;
  abortSignal(signal: AbortSignal): UntypedBuilder;
};
const designTable = (name: string) => (supabase as unknown as { from(table: string): UntypedBuilder }).from(name);

const RESOURCE_COLUMNS =
  "id, list_id, kind, file_key, node_id, starting_point_node_id, version_id, page_id, identity_key, original_url, title, notes, tags, owner_profile_id, folder_id, cover_storage_key, created_by, created_at, updated_at, archived_at";

export type DesignResourcePage = { items: DesignResource[]; nextCursor: DesignCursor | undefined };

export async function fetchDesignResourcePage(
  listId: string,
  filter: DesignResourceFilter,
  cursor: DesignCursor | undefined,
  pageSize: number | undefined,
  querySignal?: AbortSignal,
): Promise<DesignResourcePage> {
  const size = clampDesignPageSize(pageSize);
  const { data, error } = await withReadDeadline(querySignal, async (signal) => {
    let query = designTable("design_resources").select(RESOURCE_COLUMNS).eq("list_id", listId);
    query = filter.archived ? query.not("archived_at", "is", null) : query.is("archived_at", null);
    if (filter.folder === "unfiled") query = query.is("folder_id", null);
    else if (filter.folder !== "all") query = query.eq("folder_id", filter.folder);
    if (cursor) query = query.or(buildDesignCursorFilter(cursor));
    return query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(size)
      .abortSignal(signal);
  });
  if (error) throw toDesignError(error);
  const rows = (data ?? []) as DesignResourceRow[];
  return { items: rows.map(mapDesignResource), nextCursor: nextDesignCursor(rows, size) };
}

export async function fetchDesignFolders(listId: string, querySignal?: AbortSignal): Promise<DesignFolder[]> {
  const { data, error } = await withReadDeadline(querySignal, async (signal) =>
    designTable("design_folders")
      .select("id, list_id, name, created_at, updated_at")
      .eq("list_id", listId)
      .order("name", { ascending: true })
      .limit(DESIGN_FOLDER_LIMIT)
      .abortSignal(signal),
  );
  if (error) throw toDesignError(error);
  return ((data ?? []) as DesignFolderRow[]).map(mapDesignFolder);
}

/** Ids of designs the current member has favorited in this List (RLS limits rows to the caller). */
export async function fetchDesignFavoriteIds(listId: string, profileId: string, querySignal?: AbortSignal): Promise<string[]> {
  const { data, error } = await withReadDeadline(querySignal, async (signal) =>
    designTable("design_favorites")
      .select("resource_id")
      .eq("list_id", listId)
      .eq("profile_id", profileId)
      .limit(DESIGN_FAVORITE_LIMIT)
      .abortSignal(signal),
  );
  if (error) throw toDesignError(error);
  return ((data ?? []) as Array<{ resource_id: string }>).map((r) => r.resource_id);
}

export async function fetchDesignThingLinks(resourceId: string, querySignal?: AbortSignal): Promise<DesignThingLink[]> {
  const { data, error } = await withReadDeadline(querySignal, async (signal) =>
    designTable("design_thing_links")
      .select("id, resource_id, thing_id, list_id, created_at")
      .eq("resource_id", resourceId)
      .order("created_at", { ascending: false })
      .limit(DESIGN_LINK_LIMIT)
      .abortSignal(signal),
  );
  if (error) throw toDesignError(error);
  return ((data ?? []) as DesignThingLinkRow[]).map(mapDesignThingLink);
}

async function callRpc<T>(name: string, args: object): Promise<T> {
  const { data, error } = await callUngeneratedRpc(name, args);
  if (error) throw toDesignError(error as { message: string; hint?: string; code?: string });
  return data as T;
}

export type AddDesignInput = {
  listId: string;
  url: string;
  title: string;
  notes?: string | null;
  tags?: string[];
  ownerProfileId?: string | null;
  folderId?: string | null;
};

export type UpdateDesignInput = {
  resourceId: string;
  title: string;
  notes?: string | null;
  tags?: string[];
  ownerProfileId?: string | null;
  folderId?: string | null;
  /** Omit to keep the current link. */
  url?: string | null;
};

export async function fetchThingDesigns(thingId: string, querySignal?: AbortSignal): Promise<DesignResource[]> {
  const call = callUngeneratedRpc("get_thing_designs", { p_thing_id: thingId });
  const { data, error } = await (querySignal ? call.abortSignal(querySignal) : call);
  if (error) throw toDesignError(error as { message: string; hint?: string; code?: string });
  return ((data ?? []) as DesignResourceRow[]).map(mapDesignResource);
}

export const designApi = {
  addResource: async (input: AddDesignInput) =>
    mapDesignResource(
      await callRpc<DesignResourceRow>("add_design_resource", {
        p_list_id: input.listId,
        p_url: input.url,
        p_title: input.title,
        p_notes: input.notes ?? null,
        p_tags: input.tags ?? [],
        p_owner_profile_id: input.ownerProfileId ?? null,
        p_folder_id: input.folderId ?? null,
      }),
    ),
  updateResource: async (input: UpdateDesignInput) =>
    mapDesignResource(
      await callRpc<DesignResourceRow>("update_design_resource", {
        p_resource_id: input.resourceId,
        p_title: input.title,
        p_notes: input.notes ?? null,
        p_tags: input.tags ?? [],
        p_owner_profile_id: input.ownerProfileId ?? null,
        p_folder_id: input.folderId ?? null,
        p_url: input.url ?? null,
      }),
    ),
  setArchived: async (resourceId: string, archived: boolean) =>
    mapDesignResource(
      await callRpc<DesignResourceRow>("set_design_resource_archived", { p_resource_id: resourceId, p_archived: archived }),
    ),
  setFavorite: (resourceId: string, favorite: boolean) =>
    callRpc<void>("set_design_favorite", { p_resource_id: resourceId, p_favorite: favorite }),
  createFolder: async (listId: string, name: string) =>
    mapDesignFolder(await callRpc<DesignFolderRow>("create_design_folder", { p_list_id: listId, p_name: name })),
  renameFolder: async (folderId: string, name: string) =>
    mapDesignFolder(await callRpc<DesignFolderRow>("rename_design_folder", { p_folder_id: folderId, p_name: name })),
  deleteFolder: (folderId: string) => callRpc<void>("delete_design_folder", { p_folder_id: folderId }),
  linkThing: async (resourceId: string, thingId: string) =>
    mapDesignThingLink(await callRpc<DesignThingLinkRow>("link_design_thing", { p_resource_id: resourceId, p_thing_id: thingId })),
  unlinkThing: (resourceId: string, thingId: string) =>
    callRpc<void>("unlink_design_thing", { p_resource_id: resourceId, p_thing_id: thingId }),
};
