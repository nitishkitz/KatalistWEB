import { statusOf } from "./types";
import type { WorkspaceCategory, WorkspaceItem, WorkspaceKind } from "./types";

export interface WorkspaceFilters {
  /** Lower-cased author keys (GitHub login, else display name). */
  authors: string[];
  statuses: string[];
  types: WorkspaceKind[];
  /** Calendar dates, YYYY-MM-DD, in the browser time zone. */
  dateFrom: string | null;
  dateTo: string | null;
  /** A literal path or directory prefix. */
  path: string;
  search: string;
}

export const EMPTY_FILTERS: WorkspaceFilters = { authors: [], statuses: [], types: [], dateFrom: null, dateTo: null, path: "", search: "" };

export interface FilterIssues {
  date?: string;
  path?: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const authorKey = (item: Pick<WorkspaceItem, "author">): string => (item.author.login ?? item.author.name).toLowerCase();

/** Start of the first day and end of the last day, in the browser's time zone, as epoch milliseconds. */
export function dateBounds(from: string | null, to: string | null): { fromMs: number | null; toMs: number | null; issue?: string } {
  const parse = (value: string | null, end: boolean): number | null => {
    if (value === null || value === "") return null;
    if (!DATE.test(value)) return NaN;
    const [y, m, d] = value.split("-").map(Number);
    const date = end ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d, 0, 0, 0, 0);
    // new Date rolls 2026-02-31 into March; reject that instead of guessing.
    return date.getMonth() === m - 1 && date.getDate() === d ? date.getTime() : NaN;
  };
  const fromMs = parse(from, false);
  const toMs = parse(to, true);
  if ((fromMs !== null && Number.isNaN(fromMs)) || (toMs !== null && Number.isNaN(toMs))) return { fromMs: null, toMs: null, issue: "Enter valid dates." };
  if (fromMs !== null && toMs !== null && fromMs > toMs) return { fromMs: null, toMs: null, issue: "The start date is after the end date." };
  return { fromMs, toMs };
}

/** A literal repository path or directory prefix: no regex, no `..`, no absolute or doubled slashes. Null when invalid or empty. */
export function normalizePath(input: string): { path: string | null; issue?: string } {
  const trimmed = input.trim().replace(/\\/g, "/");
  if (trimmed === "") return { path: null };
  const cleaned = trimmed.replace(/^\.?\/+/, "").replace(/\/{2,}/g, "/");
  if (cleaned.split("/").some((part) => part === ".." || part === ".")) return { path: null, issue: "Use a path inside the repository." };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(cleaned) || cleaned.length > 255) return { path: null, issue: "That path cannot be used." };
  const stripped = cleaned.replace(/\/+$/, "");
  return { path: stripped === "" ? null : stripped };
}

export function issuesFor(filters: WorkspaceFilters): FilterIssues {
  const issues: FilterIssues = {};
  const bounds = dateBounds(filters.dateFrom, filters.dateTo);
  if (bounds.issue) issues.date = bounds.issue;
  const path = normalizePath(filters.path);
  if (path.issue) issues.path = path.issue;
  return issues;
}

/** True when a known file path equals the filter, sits under it as a directory, or ends with it at a path boundary. */
export function pathMatches(filePath: string, wanted: string): boolean {
  const file = filePath.toLowerCase();
  const want = wanted.toLowerCase();
  return file === want || file.startsWith(`${want}/`) || file.endsWith(`/${want}`);
}

export interface MatchContext {
  /** Paths known from loaded details, keyed by item id. Bounded by the caller. */
  knownPaths: ReadonlyMap<string, readonly string[]>;
}

export interface MatchResult {
  match: boolean;
  /** False when a path filter is active but this item's files are unknown: it stays visible, marked "path not checked". */
  pathChecked: boolean;
}

export function matchItem(item: WorkspaceItem, filters: WorkspaceFilters, ctx: MatchContext): MatchResult {
  if (filters.authors.length > 0 && !filters.authors.includes(authorKey(item))) return { match: false, pathChecked: true };
  if (filters.statuses.length > 0 && !filters.statuses.includes(statusOf(item))) return { match: false, pathChecked: true };
  if (filters.types.length > 0 && !filters.types.includes(item.kind)) return { match: false, pathChecked: true };

  const bounds = dateBounds(filters.dateFrom, filters.dateTo);
  const at = Date.parse(item.occurredAt);
  if (bounds.fromMs !== null && at < bounds.fromMs) return { match: false, pathChecked: true };
  if (bounds.toMs !== null && at > bounds.toMs) return { match: false, pathChecked: true };

  const query = filters.search.trim().toLowerCase();
  if (query) {
    const paths = ctx.knownPaths.get(item.id) ?? [];
    const haystack = [item.title, item.author.name, item.author.login ?? "", item.branch ?? "", item.baseBranch ?? "", item.deployment?.environment ?? "", ...paths].join("\n").toLowerCase();
    const sha = (item.sha ?? "").toLowerCase();
    const shaHit = sha !== "" && /^[0-9a-f]{4,40}$/.test(query) && sha.startsWith(query);
    if (!haystack.includes(query) && !shaHit) return { match: false, pathChecked: true };
  }

  const path = normalizePath(filters.path).path;
  if (path) {
    const known = ctx.knownPaths.get(item.id);
    if (known === undefined) return { match: true, pathChecked: false };
    if (!known.some((p) => pathMatches(p, path))) return { match: false, pathChecked: true };
  }
  return { match: true, pathChecked: true };
}

export function activeFilterCount(filters: WorkspaceFilters): number {
  return (
    (filters.authors.length > 0 ? 1 : 0) +
    (filters.statuses.length > 0 ? 1 : 0) +
    (filters.types.length > 0 ? 1 : 0) +
    (filters.dateFrom || filters.dateTo ? 1 : 0) +
    (filters.path.trim() ? 1 : 0) +
    (filters.search.trim() ? 1 : 0)
  );
}

/** Kinds a category can contain, for the Activity type filter. */
export function typesFor(category: WorkspaceCategory): WorkspaceKind[] {
  switch (category) {
    case "commits":
      return ["commit"];
    case "pull_requests":
      return ["pull_request"];
    case "checks":
      return ["check"];
    case "deployments":
      return ["deployment"];
    default:
      return ["commit", "pull_request", "push", "deployment"];
  }
}

const STATUS_BY_KIND: Record<WorkspaceKind, string[]> = {
  commit: ["passed", "failing", "pending", "none", "unavailable"],
  push: ["passed", "failing", "pending", "none", "unavailable"],
  check: ["passed", "failing", "pending"],
  pull_request: ["open", "draft", "merged", "closed"],
  deployment: ["success", "failure", "error", "in_progress", "pending", "queued", "inactive"],
};

/** Only statuses that can occur in this category are offered. */
export function statusOptions(category: WorkspaceCategory): string[] {
  const kinds = typesFor(category);
  return [...new Set(kinds.flatMap((k) => STATUS_BY_KIND[k]))];
}

export const STATUS_LABEL: Record<string, string> = {
  passed: "Checks passed",
  failing: "Checks failing",
  pending: "Pending",
  none: "No checks reported",
  unavailable: "Checks unavailable",
  open: "Open",
  draft: "Draft",
  merged: "Merged",
  closed: "Closed",
  success: "Deployed",
  failure: "Failed",
  error: "Errored",
  in_progress: "In progress",
  queued: "Queued",
  inactive: "Inactive",
  unknown: "Unknown",
};
