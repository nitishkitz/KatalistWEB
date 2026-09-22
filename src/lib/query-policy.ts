import { extractErrorMessage } from "@/lib/domain-error";

/**
 * Shared read-query retry/timeout policy (Batch B2 of the Katalist
 * implementation plan). React Query's own default — 3 retries with
 * exponential backoff on every failure — retries authorization and
 * validation failures exactly as hard as a dropped connection, which just
 * delays showing the user a permission/not-found message they can't fix by
 * waiting. This restricts automatic retry to failures that are plausibly
 * transient (network blips, 5xx) and caps it at one attempt.
 */

/** A failure that retrying is unlikely to fix — the caller must act (sign in) or nothing will change (permission, not found, bad input). */
export function isPermanentQueryError(error: unknown): boolean {
  const message = (extractErrorMessage(error) ?? "").toLowerCase();
  if (!message) return false;
  return (
    message.includes("permission") ||
    message.includes("row-level") ||
    message.includes("42501") ||
    message.includes("not allowed") ||
    message.includes("not authenticated") ||
    message.includes("jwt") ||
    message.includes("unauthorized") ||
    message.includes("not found") ||
    message.includes("invalid input syntax")
  );
}

/** Pass as `retry` in useQuery/QueryClient defaultOptions.queries. */
export function retryReadOnce(failureCount: number, error: unknown): boolean {
  if (isPermanentQueryError(error)) return false;
  return failureCount < 1;
}

/** Milestones for AsyncState's "still working" / "stuck" messaging. */
export const SLOW_QUERY_MS = 3_000;
export const STALLED_QUERY_MS = 15_000;

export type AsyncErrorKind = "unauthenticated" | "forbidden" | "not-found" | "failed";

/** Classifies a caught query error for AsyncState's distinct empty/error states. */
export function classifyAsyncError(error: unknown): AsyncErrorKind {
  const message = (extractErrorMessage(error) ?? "").toLowerCase();
  if (message.includes("not authenticated") || message.includes("jwt") || message.includes("unauthorized")) {
    return "unauthenticated";
  }
  if (message.includes("permission") || message.includes("row-level") || message.includes("42501") || message.includes("not allowed")) {
    return "forbidden";
  }
  if (message.includes("not found")) return "not-found";
  return "failed";
}
