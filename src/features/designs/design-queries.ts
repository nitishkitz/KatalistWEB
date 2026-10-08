/** Pure query helpers for Designs (no network): bounds, cursors, keys, error mapping. */

export const DESIGN_PAGE_SIZE = 30;
export const DESIGN_MAX_PAGE_SIZE = 50;
export const DESIGN_FOLDER_LIMIT = 200;
export const DESIGN_FAVORITE_LIMIT = 1000;
export const DESIGN_LINK_LIMIT = 200;

export type DesignCursor = { createdAt: string; id: string };

export type DesignFolderFilter = "all" | "unfiled" | string;

export type DesignResourceFilter = {
  /** Archived designs are a separate view; the default is active only. */
  archived: boolean;
  /** `all`, `unfiled`, or a folder id. */
  folder: DesignFolderFilter;
};

export const DEFAULT_DESIGN_FILTER: DesignResourceFilter = { archived: false, folder: "all" };

export function clampDesignPageSize(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return DESIGN_PAGE_SIZE;
  return Math.min(DESIGN_MAX_PAGE_SIZE, Math.max(1, Math.floor(requested)));
}

/**
 * Keyset filter for `ORDER BY created_at DESC, id DESC`. Values are double-quoted
 * per PostgREST so timestamps (`:` and `+`) cannot break the filter grammar, and
 * anything outside the expected shapes is rejected rather than interpolated.
 */
export function buildDesignCursorFilter(cursor: DesignCursor): string {
  const ts = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}(:?\d{2})?)$/;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!ts.test(cursor.createdAt) || !uuid.test(cursor.id)) throw new Error("Invalid design page cursor.");
  return `created_at.lt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",id.lt.${cursor.id})`;
}

/** The next cursor, or undefined when the page was short (end of list). */
export function nextDesignCursor(
  rows: ReadonlyArray<{ created_at: string; id: string }>,
  pageSize: number,
): DesignCursor | undefined {
  if (rows.length < pageSize) return undefined;
  const last = rows[rows.length - 1];
  return last ? { createdAt: last.created_at, id: last.id } : undefined;
}

export const designKeys = {
  all: ["designs"] as const,
  list: (listId: string) => ["designs", listId] as const,
  resources: (listId: string, filter: DesignResourceFilter = DEFAULT_DESIGN_FILTER) =>
    ["designs", listId, "resources", filter.archived, filter.folder] as const,
  resourcesPrefix: (listId: string) => ["designs", listId, "resources"] as const,
  folders: (listId: string) => ["designs", listId, "folders"] as const,
  /** Favorites are per member: the profile id is part of the key. */
  favorites: (listId: string, profileId: string | undefined) => ["designs", listId, "favorites", profileId] as const,
  /** Signed cover URLs for the given keys; the key list is part of the cache key. */
  covers: (listId: string, keys: readonly string[]) => ["designs", listId, "covers", ...keys] as const,
  coversPrefix: (listId: string) => ["designs", listId, "covers"] as const,
  /** Designs linked to a Thing (the Thing id is not a List id, so it cannot collide with list keys). */
  thing: (thingId: string) => ["designs", "thing", thingId] as const,
  thingPrefix: ["designs", "thing"] as const,
  links: (listId: string, resourceId: string) => ["designs", listId, "links", resourceId] as const,
  linksPrefix: (listId: string) => ["designs", listId, "links"] as const,
};

export type DesignErrorCode =
  | "not_authenticated"
  | "not_found"
  | "forbidden"
  | "duplicate_design"
  | "duplicate_folder"
  | "cross_list"
  | "owner_not_member"
  | "archived"
  | "invalid_input"
  | "unavailable"
  | "migration_missing"
  | "cover_missing"
  | "unknown"
  // Figma URL codes (hint from the database parser; same codes as FigmaUrlErrorCode).
  | "empty"
  | "too_long"
  | "malformed"
  | "insecure_protocol"
  | "credentials_not_allowed"
  | "port_not_allowed"
  | "unsupported_host"
  | "unsupported_route"
  | "invalid_file_key"
  | "invalid_node_id"
  | "invalid_version_id"
  | "invalid_parameter";

export class DesignOperationError extends Error {
  readonly code: DesignErrorCode;
  /** Existing active design id when a duplicate is reported. */
  readonly existingId: string | null;
  constructor(code: DesignErrorCode, message: string, existingId: string | null = null) {
    super(message);
    this.name = "DesignOperationError";
    this.code = code;
    this.existingId = existingId;
  }
}

const HINT_CODES = new Set<string>([
  "duplicate_design",
  "duplicate_folder",
  "cover_missing",
  "cross_list",
  "owner_not_member",
  "archived",
  "empty",
  "too_long",
  "malformed",
  "insecure_protocol",
  "credentials_not_allowed",
  "port_not_allowed",
  "unsupported_host",
  "unsupported_route",
  "invalid_file_key",
  "invalid_node_id",
  "invalid_version_id",
  "invalid_parameter",
]);

type PostgrestLikeError = { message?: string; hint?: string | null; code?: string | null; details?: string | null };

/** Maps a PostgREST/Postgres error to a typed, user-presentable error. */
export function toDesignError(error: PostgrestLikeError | null | undefined): DesignOperationError {
  const message = error?.message?.trim() || "Something went wrong with that design request.";
  const hint = error?.hint ?? "";
  if (HINT_CODES.has(hint)) {
    const existing = hint === "duplicate_design" && error?.details && /^[0-9a-f-]{36}$/i.test(error.details) ? error.details : null;
    return new DesignOperationError(hint as DesignErrorCode, message, existing);
  }
  switch (error?.code) {
    // The Designs migration has not been applied to this database (table or RPC unknown).
    case "PGRST205":
    case "PGRST202":
    case "42P01":
    case "42883":
      return new DesignOperationError(
        "migration_missing",
        "Designs are not set up on this database yet. The Designs migration has not been applied.",
      );
    case "28000":
      return new DesignOperationError("not_authenticated", message);
    case "42501":
      return new DesignOperationError("forbidden", message);
    case "P0002":
      return new DesignOperationError("not_found", message);
    case "23514":
    case "23502":
    case "22023":
    case "22001":
      return new DesignOperationError("invalid_input", message);
    case "23503":
      return new DesignOperationError("cross_list", "That folder or item belongs to a different List.");
    case "23505":
      return new DesignOperationError("duplicate_design", message);
    default:
      return new DesignOperationError("unknown", message);
  }
}

/** Trims, de-duplicates (case-insensitive) and drops blank tags, mirroring the database. */
export function normalizeDesignTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}
