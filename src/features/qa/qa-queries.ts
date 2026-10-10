/** Pure query helpers for QA: bounds, cursors, keys, error mapping. No network. */
import type { QaCaseFilter, QaHistoryFilter, QaRunFilter } from "./types";

export const QA_PAGE_SIZE = 50;
export const QA_MAX_PAGE_SIZE = 100;
export const QA_SCOPE_LIMIT = 200;
/** Export pages through the whole result set in chunks of this size. */
export const QA_EXPORT_CHUNK = 100;
export const QA_EXPORT_MAX_ROWS = 5000;

export type QaCursor = { createdAt: string; id: string };
export type QaPage<T, C = QaCursor> = { items: T[]; nextCursor: C | undefined };

export function clampQaPageSize(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return QA_PAGE_SIZE;
  return Math.min(QA_MAX_PAGE_SIZE, Math.max(1, Math.floor(requested)));
}

const TS = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}(:?\d{2})?)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Keyset filter for `ORDER BY created_at DESC, id DESC`. Values are validated, never interpolated raw. */
export function buildQaCursorFilter(cursor: QaCursor, column = "created_at"): string {
  if (!TS.test(cursor.createdAt) || !UUID.test(cursor.id)) throw new Error("Invalid QA page cursor.");
  return `${column}.lt."${cursor.createdAt}",and(${column}.eq."${cursor.createdAt}",id.lt.${cursor.id})`;
}

export function nextQaCursor(rows: ReadonlyArray<{ created_at: string; id: string }>, pageSize: number): QaCursor | undefined {
  if (rows.length < pageSize) return undefined;
  const last = rows[rows.length - 1];
  return last ? { createdAt: last.created_at, id: last.id } : undefined;
}

/** Escapes LIKE wildcards and PostgREST filter punctuation in a user search term. */
export function safeSearchTerm(term: string): string {
  return term.trim().slice(0, 80).replace(/[\\%_]/g, (c) => `\\${c}`).replace(/[,()"]/g, " ");
}

export const qaKeys = {
  all: ["qa"] as const,
  list: (listId: string) => ["qa", listId] as const,
  applications: (listId: string) => ["qa", listId, "applications"] as const,
  environments: (listId: string) => ["qa", listId, "environments"] as const,
  resources: (listId: string, appId: string, envId: string) => ["qa", listId, "resources", appId, envId] as const,
  builds: (listId: string, appId: string, envId: string) => ["qa", listId, "builds", appId, envId] as const,
  buildsPrefix: (listId: string) => ["qa", listId, "builds"] as const,
  accounts: (listId: string, appId: string, envId: string) => ["qa", listId, "accounts", appId, envId] as const,
  accountsPrefix: (listId: string) => ["qa", listId, "accounts"] as const,
  access: (listId: string, profileId: string | undefined) => ["qa", listId, "access", profileId] as const,
  grants: (listId: string, accountId: string) => ["qa", listId, "grants", accountId] as const,
  vault: (listId: string) => ["qa", listId, "vault"] as const,
  cases: (listId: string, filter: QaCaseFilter) => ["qa", listId, "cases", filter] as const,
  casesPrefix: (listId: string) => ["qa", listId, "cases"] as const,
  views: (listId: string, profileId: string | undefined) => ["qa", listId, "views", profileId] as const,
  runs: (listId: string) => ["qa", listId, "runs"] as const,
  run: (listId: string, runId: string) => ["qa", listId, "run", runId] as const,
  runCases: (listId: string, runId: string, filter: QaRunFilter) => ["qa", listId, "runCases", runId, filter] as const,
  runCasesPrefix: (listId: string) => ["qa", listId, "runCases"] as const,
  totals: (listId: string, runId: string) => ["qa", listId, "totals", runId] as const,
  attempts: (listId: string, runCaseId: string) => ["qa", listId, "attempts", runCaseId] as const,
  evidence: (listId: string, attemptIds: readonly string[]) => ["qa", listId, "evidence", ...attemptIds] as const,
  evidencePrefix: (listId: string) => ["qa", listId, "evidence"] as const,
  evidenceUrls: (listId: string, ids: readonly string[]) => ["qa", listId, "evidenceUrls", ...ids] as const,
  links: (listId: string) => ["qa", listId, "links"] as const,
  history: (listId: string, filter: QaHistoryFilter) => ["qa", listId, "history", filter] as const,
  historyPrefix: (listId: string) => ["qa", listId, "history"] as const,
};

export type QaErrorCode =
  | "not_authenticated"
  | "not_found"
  | "forbidden"
  | "invalid_input"
  | "duplicate"
  | "duplicate_name"
  | "cross_list"
  | "owner_not_member"
  | "run_not_active"
  | "run_context_frozen"
  | "invalid_transition"
  | "same_build"
  | "build_mismatch"
  | "nothing_to_retest"
  | "actual_required"
  | "not_run_remaining"
  | "blocked_remaining"
  | "case_unavailable"
  | "mime_not_allowed"
  | "too_large"
  | "too_many"
  | "upload_incomplete"
  | "storage_unavailable"
  | "vault_unavailable"
  | "secret_unreadable"
  | "secret_not_stored"
  | "no_secret"
  | "password_required"
  | "invalid_secret"
  | "rate_limited"
  | "migration_missing"
  | "unavailable"
  | "offline"
  | "timeout"
  | "unknown";

export class QaOperationError extends Error {
  readonly code: QaErrorCode;
  constructor(code: QaErrorCode, message: string) {
    super(message);
    this.name = "QaOperationError";
    this.code = code;
  }
  /** Access loss is not transient: a retry button would mislead. */
  get isAccessLoss() {
    return this.code === "forbidden" || this.code === "not_found" || this.code === "not_authenticated";
  }
}

const HINT_CODES = new Set<string>([
  "duplicate_name", "cross_list", "owner_not_member", "run_not_active", "run_context_frozen", "invalid_transition", "same_build",
  "build_mismatch", "nothing_to_retest", "actual_required", "not_run_remaining", "blocked_remaining", "case_unavailable",
  "mime_not_allowed", "too_large", "too_many", "invalid_input", "immutable",
]);

type PostgrestLikeError = { message?: string; hint?: string | null; code?: string | null; details?: string | null };

/** Maps a PostgREST/Postgres error to a typed, presentable error. */
export function toQaError(error: PostgrestLikeError | null | undefined): QaOperationError {
  const message = error?.message?.trim() || "Something went wrong with that QA request.";
  const hint = error?.hint ?? "";
  if (HINT_CODES.has(hint)) return new QaOperationError(hint === "immutable" ? "invalid_transition" : (hint as QaErrorCode), message);
  switch (error?.code) {
    case "PGRST205":
    case "PGRST202":
    case "42P01":
    case "42883":
      return new QaOperationError("migration_missing", "Manual QA is not set up on this database yet. The QA migration has not been applied.");
    case "28000":
      return new QaOperationError("not_authenticated", message);
    case "42501":
      return new QaOperationError("forbidden", message);
    case "P0002":
      return new QaOperationError("not_found", message);
    case "23514":
    case "23502":
    case "22023":
    case "22001":
      return new QaOperationError("invalid_input", message);
    case "23503":
      return new QaOperationError("cross_list", "That item belongs to a different List.");
    case "23505":
      return new QaOperationError("duplicate", message);
    default:
      return new QaOperationError("unknown", message);
  }
}

/** Maps the JSON error body of the /api/qa handlers. */
export function toQaHttpError(status: number, body: { message?: string; data?: { code?: string } } | null): QaOperationError {
  const code = (body?.data?.code ?? "") as QaErrorCode;
  const message = body?.message?.trim() || "The QA request failed.";
  if (code) return new QaOperationError(code, message);
  if (status === 401) return new QaOperationError("not_authenticated", message);
  if (status === 403) return new QaOperationError("forbidden", message);
  if (status === 404) return new QaOperationError("not_found", message);
  if (status === 503) return new QaOperationError("unavailable", message);
  return new QaOperationError("unknown", message);
}
