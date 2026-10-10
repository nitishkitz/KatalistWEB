import { createError, setResponseHeader, type H3Event } from "h3";
import type { SupabaseClient } from "@supabase/supabase-js";
import { VaultDecryptError, VaultInputError, VaultUnavailableError } from "./vault";
import { getSupabaseAdmin } from "../supabase-admin";

/** Responses that carry or follow secret material must never be cached. */
export function noStore(event: H3Event) {
  setResponseHeader(event, "Cache-Control", "no-store, max-age=0");
  setResponseHeader(event, "Pragma", "no-cache");
}

export function qaError(statusCode: number, code: string, message: string) {
  return createError({ statusCode, message, data: { code } });
}

type PgError = { message?: string; code?: string | null; hint?: string | null } | null | undefined;

/** Maps a database error from a QA RPC to an HTTP error without leaking internals. */
export function fromRpcError(error: PgError, fallback = "The QA request failed.") {
  const hint = error?.hint || "";
  switch (error?.code) {
    case "28000":
      return qaError(401, "not_authenticated", "Authentication required.");
    case "42501":
      return qaError(403, "forbidden", error?.message || "You do not have permission to do that.");
    case "P0002":
      return qaError(404, "not_found", error?.message || "Not found.");
    case "22023":
    case "23514":
    case "23502":
    case "22001":
      return qaError(400, hint || "invalid_input", error?.message || "Invalid input.");
    case "23503":
      return qaError(400, "cross_list", "That item belongs to a different List.");
    case "23505":
      return qaError(409, hint || "duplicate", error?.message || "That already exists.");
    case "55000":
      return qaError(409, hint || "conflict", error?.message || "That is not allowed right now.");
    case "PGRST202":
    case "PGRST205":
    case "42883":
    case "42P01":
      return qaError(503, "migration_missing", "QA is not set up on this database yet.");
    default:
      return qaError(500, "unknown", fallback);
  }
}

export function fromVaultError(error: unknown) {
  if (error instanceof VaultUnavailableError) return qaError(503, error.code, "Protected credential storage is not configured on this server.");
  if (error instanceof VaultDecryptError) return qaError(500, error.code, "The stored credential could not be read. Ask an owner to set it again.");
  if (error instanceof VaultInputError) return qaError(400, error.code, error.message);
  return null;
}

export const isUuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export type AuditAction =
  | "credential_create"
  | "credential_update"
  | "credential_secret_set"
  | "credential_grants_change"
  | "credential_reveal"
  | "credential_copy"
  | "credential_archive";

/** Records safe metadata only (never a value). Audit failure must not break or leak the action. */
export async function audit(entry: {
  listId: string;
  accountId?: string | null;
  actorId: string;
  action: AuditAction;
  outcome: "success" | "denied" | "unavailable" | "error";
  details?: Record<string, string | number | boolean | null>;
}) {
  try {
    const admin: SupabaseClient = getSupabaseAdmin();
    await admin.from("qa_audit_events").insert({
      list_id: entry.listId,
      account_id: entry.accountId ?? null,
      actor_profile_id: entry.actorId,
      action: entry.action,
      outcome: entry.outcome,
      details: entry.details ?? {},
    });
  } catch (error) {
    console.error("[qa] audit write failed", error instanceof Error ? error.name : "unknown");
  }
}

/**
 * Best-effort per-instance throttle for secret release. It slows scripted harvesting on a single
 * server instance; it is not a distributed rate limit (see the completion report).
 */
const windows = new Map<string, number[]>();
export function throttleSecretRelease(userId: string, limit = 30, windowMs = 60_000) {
  const now = Date.now();
  const recent = (windows.get(userId) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) throw qaError(429, "rate_limited", "Too many credential requests. Wait a minute and try again.");
  recent.push(now);
  windows.set(userId, recent);
}
