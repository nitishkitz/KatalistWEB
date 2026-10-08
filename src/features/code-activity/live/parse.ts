/** Runtime guards for Code Activity API replies. Anything unexpected becomes an error, never a guess. */

export type ConnectionStatus = "none" | "pending_repository" | "active" | "suspended" | "revoked" | "disconnected";
export interface ConnectionView {
  status: ConnectionStatus;
  repositoryFullName: string | null;
  lastSyncedAt: string | null;
  syncStatus: string | null;
  /** Access is uncertain: no activity is shown until the owner disconnects and connects again. */
  needsReverification: boolean;
}
export interface AiStatus {
  /** The operator switched Coey on and a model is configured. */
  available: boolean;
  /** The owner consented, for this List. */
  consent: boolean;
}
export interface Capabilities {
  enabled: boolean;
  /** Present only when the caller is a member of an enabled List. */
  configured: boolean;
  ai: AiStatus;
}
export interface ProofRepository {
  proofId: string;
  fullName: string;
  visibility: "private" | "public";
  updatedAt: string | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const STATUSES: readonly string[] = ["none", "pending_repository", "active", "suspended", "revoked", "disconnected"];

export function parseCapabilities(raw: unknown): Capabilities | null {
  if (!isObject(raw) || typeof raw.enabled !== "boolean") return null;
  const ai = isObject(raw.ai) ? raw.ai : {};
  return {
    enabled: raw.enabled,
    configured: raw.enabled && raw.configured === true,
    ai: { available: raw.enabled && ai.available === true, consent: raw.enabled && ai.consent === true },
  };
}

export function parseConnection(raw: unknown): ConnectionView | null {
  if (!isObject(raw) || typeof raw.status !== "string" || !STATUSES.includes(raw.status)) return null;
  return {
    status: raw.status as ConnectionStatus,
    repositoryFullName: typeof raw.repositoryFullName === "string" ? raw.repositoryFullName : null,
    lastSyncedAt: typeof raw.lastSyncedAt === "string" ? raw.lastSyncedAt : null,
    syncStatus: typeof raw.syncStatus === "string" ? raw.syncStatus : null,
    needsReverification: raw.needsReverification === true,
  };
}

export function parseRepositories(raw: unknown): { items: ProofRepository[]; nextCursor: string | null } | null {
  if (!isObject(raw) || !Array.isArray(raw.items)) return null;
  const items: ProofRepository[] = [];
  for (const item of raw.items) {
    if (!isObject(item) || typeof item.proofId !== "string" || typeof item.fullName !== "string") return null;
    if (item.visibility !== "private" && item.visibility !== "public") return null;
    items.push({
      proofId: item.proofId,
      fullName: item.fullName,
      visibility: item.visibility,
      updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : null,
    });
  }
  return { items, nextCursor: typeof raw.nextCursor === "string" ? raw.nextCursor : null };
}

export type ReturnOutcome = "select" | "continue" | "denied" | "error" | "too_many" | "timed_out";
const OUTCOMES: readonly string[] = ["select", "continue", "denied", "error", "too_many", "timed_out"];

/** Reads the `codeActivity` outcome the callback appended to the List URL. Anything else is ignored. */
export function parseReturnOutcome(search: string): ReturnOutcome | null {
  const value = new URLSearchParams(search).get("codeActivity");
  return value && OUTCOMES.includes(value) ? (value as ReturnOutcome) : null;
}

/** Appends a page of repositories, keeping the first occurrence of each proof so a repeated page cannot duplicate rows. */
export function mergeRepositoryPages(existing: readonly ProofRepository[], page: readonly ProofRepository[]): ProofRepository[] {
  const seen = new Set(existing.map((r) => r.proofId));
  return [...existing, ...page.filter((r) => !seen.has(r.proofId))];
}
