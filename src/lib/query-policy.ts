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

export type AsyncBranch = "offline-blocked" | "error-blocked" | "loading" | "empty" | "ready";

/**
 * Pure decision logic behind AsyncState's top-level branching, extracted so
 * it's unit-testable without a DOM/React harness (this repo has neither).
 *
 * `isEmpty` is trusted at face value as the caller's authoritative signal
 * for "loaded successfully with nothing in it" — see AsyncState's own
 * docs for why a `data == null`/truthiness check can't stand in for it
 * (an empty array is truthy).
 *
 * `hasFetchedOnce` must come from the query itself (e.g. `query.data !==
 * undefined`), not be derived here from `!isLoading && !hasError`: when a
 * query is "paused" offline (network mode "online", never yet fetched),
 * react-query reports `isLoading: false` and no error — status stays
 * `"pending"` the whole time, it just isn't actively fetching — which
 * would be indistinguishable from a confirmed empty result if derived
 * from those two flags alone.
 *
 * B-03: takes the actual `error` (not a bare `hasError` boolean) so it can
 * tell a CONFIRMED access-loss (unauthenticated/forbidden/not-found — the
 * caller must act or nothing will change) apart from an ambiguous/transient
 * failure (network blip, 5xx, timeout). Stale non-empty data survives a
 * transient failure (the caller can layer a soft warning on top of
 * `children` itself), but confirmed access loss must clear protected
 * content even when stale data is still cached — old data plus a 403 is
 * not the same fact as a harmless background refetch failure.
 */
export function resolveAsyncBranch(input: {
  online: boolean;
  isLoading: boolean;
  error: unknown;
  isEmpty: boolean;
  hasFetchedOnce: boolean;
}): AsyncBranch {
  const { online, isLoading, error, isEmpty, hasFetchedOnce } = input;
  // A successfully-loaded-but-empty result is a confirmed fact ("you
  // genuinely have zero Lists"), not an unknown — blocking it behind
  // "offline, nothing cached yet" would misrepresent a known result as
  // unknown. Only block offline when there's neither non-empty data to
  // fall back on (isEmpty is false) nor a confirmed result to trust.
  if (!online && isEmpty && !hasFetchedOnce) return "offline-blocked";
  if (error != null) {
    const kind = classifyAsyncError(error);
    const isConfirmedAccessLoss = kind === "unauthenticated" || kind === "forbidden" || kind === "not-found";
    if (isConfirmedAccessLoss || isEmpty) return "error-blocked";
    // Otherwise: an ambiguous/transient failure with stale non-empty data
    // already loaded -- fall through to "ready" below.
  }
  if (isLoading) return "loading";
  if (isEmpty) return "empty";
  return "ready";
}
