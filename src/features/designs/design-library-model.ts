import { parseFigmaUrl } from "./figma-url";
import { normalizeDesignTags, type DesignOperationError } from "./design-queries";
import type { DesignResource } from "./records";
import type { FigmaResourceKind, FigmaUrlError } from "./types";

/** Pure model for the Designs library: labels, filtering, state resolution, drafts. */

export const KIND_LABELS: Record<FigmaResourceKind, string> = {
  design: "Design",
  figjam: "FigJam",
  prototype: "Prototype",
  slides: "Slides",
  deck: "Slides deck",
};

export const KIND_OPTIONS = Object.entries(KIND_LABELS).map(([value, label]) => ({
  value: value as FigmaResourceKind,
  label,
}));

export type DesignCriteria = {
  search: string;
  kind: FigmaResourceKind | "all";
  /** Profile id, `unowned`, or `all`. */
  owner: string;
  favoritesOnly: boolean;
};

export const EMPTY_CRITERIA: DesignCriteria = { search: "", kind: "all", owner: "all", favoritesOnly: false };

/** True when any criterion is applied to the loaded pages (search/type/owner/favorites). */
export function hasClientCriteria(c: DesignCriteria): boolean {
  return c.search.trim() !== "" || c.kind !== "all" || c.owner !== "all" || c.favoritesOnly;
}

/** Search matches titles, tags and notes; every whitespace-separated term must match somewhere. */
export function matchesSearch(resource: DesignResource, search: string): boolean {
  const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = [resource.title, resource.notes ?? "", ...resource.tags].join("\n").toLowerCase();
  return terms.every((t) => haystack.includes(t));
}

export function filterDesigns(
  resources: readonly DesignResource[],
  criteria: DesignCriteria,
  favoriteIds: ReadonlySet<string>,
): DesignResource[] {
  return resources.filter((r) => {
    if (criteria.kind !== "all" && r.kind !== criteria.kind) return false;
    if (criteria.owner === "unowned" ? r.ownerProfileId !== null : criteria.owner !== "all" && r.ownerProfileId !== criteria.owner) {
      return false;
    }
    if (criteria.favoritesOnly && !favoriteIds.has(r.id)) return false;
    return matchesSearch(r, criteria.search);
  });
}

export type LibraryState =
  | "preview-unavailable"
  | "migration-missing"
  | "access-lost"
  | "error"
  | "offline"
  | "loading"
  | "empty"
  | "ready";

/**
 * Decides what the library shows. A failed or paused read can never become `empty`:
 * `empty` requires a successful fetch. `refreshFailed` marks a background failure
 * while earlier results are still shown.
 */
export function resolveLibraryState(input: {
  preview: boolean;
  online: boolean;
  isPaused: boolean;
  isLoading: boolean;
  hasFetchedOnce: boolean;
  error: DesignOperationError | null;
  itemCount: number;
}): { state: LibraryState; refreshFailed: boolean } {
  const { preview, online, isPaused, isLoading, hasFetchedOnce, error, itemCount } = input;
  if (preview) return { state: "preview-unavailable", refreshFailed: false };
  if (error?.code === "migration_missing") return { state: "migration-missing", refreshFailed: false };
  if (error && (error.code === "forbidden" || error.code === "not_found" || error.code === "not_authenticated")) {
    return { state: "access-lost", refreshFailed: false };
  }
  if (!hasFetchedOnce) {
    if (error) return { state: "error", refreshFailed: false };
    if (isPaused || !online) return { state: "offline", refreshFailed: false };
    if (isLoading) return { state: "loading", refreshFailed: false };
    return { state: "loading", refreshFailed: false };
  }
  const refreshFailed = error !== null;
  return { state: itemCount === 0 ? "empty" : "ready", refreshFailed };
}

/** Comma/newline separated tags to a normalized list. */
export function parseTagInput(input: string): string[] {
  return normalizeDesignTags(input.split(/[,\n]/));
}

export type DesignDraft = {
  url: string;
  title: string;
  notes: string;
  tags: string;
  ownerProfileId: string;
  folderId: string;
};

export const EMPTY_DRAFT: DesignDraft = { url: "", title: "", notes: "", tags: "", ownerProfileId: "", folderId: "" };

export type DraftErrors = Partial<Record<"url" | "title" | "notes" | "tags", string>>;

export const TITLE_MAX = 200;
export const NOTES_MAX = 4000;
export const TAG_MAX = 40;
export const TAGS_MAX_COUNT = 20;

/** Client-side validation for fast feedback; the database re-validates everything. */
export function validateDraft(draft: DesignDraft): DraftErrors {
  const errors: DraftErrors = {};
  const url = parseFigmaUrl(draft.url);
  if (!url.ok) errors.url = url.error.message;
  const title = draft.title.trim();
  if (!title) errors.title = "Enter a title.";
  else if (title.length > TITLE_MAX) errors.title = `Keep the title under ${TITLE_MAX} characters.`;
  if (draft.notes.length > NOTES_MAX) errors.notes = `Keep notes under ${NOTES_MAX} characters.`;
  const tags = parseTagInput(draft.tags);
  if (tags.length > TAGS_MAX_COUNT) errors.tags = `Use at most ${TAGS_MAX_COUNT} tags.`;
  else if (tags.some((t) => t.length > TAG_MAX)) errors.tags = `Keep each tag under ${TAG_MAX} characters.`;
  return errors;
}

export function draftFromResource(resource: DesignResource): DesignDraft {
  return {
    url: resource.originalUrl,
    title: resource.title,
    notes: resource.notes ?? "",
    tags: resource.tags.join(", "),
    ownerProfileId: resource.ownerProfileId ?? "",
    folderId: resource.folderId ?? "",
  };
}

/** Short description of the detected target for the URL field helper text. */
export function describeUrl(urlInput: string): { ok: true; text: string } | { ok: false; error: FigmaUrlError } | null {
  if (!urlInput.trim()) return null;
  const parsed = parseFigmaUrl(urlInput);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const v = parsed.value;
  const target = v.nodeId ? `frame ${v.nodeId}` : v.pageId ? `page ${v.pageId}` : "whole file";
  return { ok: true, text: `${KIND_LABELS[v.kind]} · ${target}` };
}

/** Plain-language message for a failed write, shown inline in the dialog. */
export function describeWriteError(error: DesignOperationError): string {
  switch (error.code) {
    case "duplicate_design":
      return "This design is already saved in this List.";
    case "duplicate_folder":
      return "A folder with that name already exists.";
    case "forbidden":
      return "You don't have permission to change designs in this List.";
    case "not_authenticated":
      return "Your session expired. Sign in again; your draft is kept.";
    case "owner_not_member":
      return "The owner must be a member of this List.";
    case "cross_list":
      return "That folder belongs to a different List.";
    case "archived":
      return "Restore this design before editing it.";
    case "migration_missing":
      return error.message;
    default:
      return error.message || "That could not be saved. Your draft is kept; try again.";
  }
}
