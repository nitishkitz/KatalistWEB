import { parseFigmaUrl } from "./figma-url";
import type { FigmaResourceKind, FigmaUrlResult } from "./types";

export type DesignResource = {
  id: string;
  listId: string;
  kind: FigmaResourceKind;
  fileKey: string;
  nodeId: string | null;
  startingPointNodeId: string | null;
  versionId: string | null;
  pageId: string | null;
  identityKey: string;
  /** Canonical link built by the database from the validated URL. */
  originalUrl: string;
  title: string;
  notes: string | null;
  tags: string[];
  ownerProfileId: string | null;
  folderId: string | null;
  coverStorageKey: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type DesignFolder = {
  id: string;
  listId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type DesignThingLink = {
  id: string;
  resourceId: string;
  thingId: string;
  listId: string;
  createdAt: string;
};

export type DesignResourceRow = {
  id: string;
  list_id: string;
  kind: FigmaResourceKind;
  file_key: string;
  node_id: string | null;
  starting_point_node_id: string | null;
  version_id: string | null;
  page_id: string | null;
  identity_key: string;
  original_url: string;
  title: string;
  notes: string | null;
  tags: string[] | null;
  owner_profile_id: string | null;
  folder_id: string | null;
  cover_storage_key: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type DesignFolderRow = {
  id: string;
  list_id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

export type DesignThingLinkRow = {
  id: string;
  resource_id: string;
  thing_id: string;
  list_id: string;
  created_at: string;
};

export function mapDesignResource(row: DesignResourceRow): DesignResource {
  return {
    id: row.id,
    listId: row.list_id,
    kind: row.kind,
    fileKey: row.file_key,
    nodeId: row.node_id,
    startingPointNodeId: row.starting_point_node_id,
    versionId: row.version_id,
    pageId: row.page_id,
    identityKey: row.identity_key,
    originalUrl: row.original_url,
    title: row.title,
    notes: row.notes,
    tags: row.tags ?? [],
    ownerProfileId: row.owner_profile_id,
    folderId: row.folder_id,
    coverStorageKey: row.cover_storage_key,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

export function mapDesignFolder(row: DesignFolderRow): DesignFolder {
  return { id: row.id, listId: row.list_id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function mapDesignThingLink(row: DesignThingLinkRow): DesignThingLink {
  return {
    id: row.id,
    resourceId: row.resource_id,
    thingId: row.thing_id,
    listId: row.list_id,
    createdAt: row.created_at,
  };
}

/**
 * The embed URL is never stored. It is derived from the stored canonical link by
 * the Stage 1 parser, so a stored value that no longer validates yields an error
 * result instead of an unvalidated iframe source.
 */
export function deriveDesignEmbed(resource: Pick<DesignResource, "originalUrl">): FigmaUrlResult {
  return parseFigmaUrl(resource.originalUrl);
}
