/**
 * T01: shared abort/deadline ownership for read queries. React Query
 * already passes each queryFn an AbortSignal that fires when the query is
 * cancelled (unmount, a superseded/refetched call, `queryClient.cancel
 * Queries()`) -- but on its own that signal never times out a read that's
 * simply hanging (a stalled connection, a backend that never responds).
 * This combines that signal with an explicit deadline, so a read is always
 * bounded, and lets a caller tell "this specific request hit ITS OWN
 * deadline" apart from "this request was cancelled for an unrelated
 * reason" (route-away, a newer query superseding it) -- those need
 * different UI (recovery/retry vs nothing, per AsyncState's own contract)
 * and must not be presented as the same "the read failed" fact.
 *
 * Gotcha for callers: pass an `async` function to `run`, even when its
 * body is a single Supabase call with no `await` of its own -- a
 * PostgrestFilterBuilder is thenable but not a real `Promise`, so a plain
 * (non-async) arrow returning `supabase.from(...).abortSignal(signal)`
 * makes TypeScript infer `T` as the builder itself instead of its
 * resolved `{data, error}` shape. Wrapping in `async` forces the correct
 * inference (confirmed directly against every call site in this
 * codebase).
 */

import { logTelemetryEvent } from "./telemetry";

/** Matches AsyncState's own SLOW/STALLED tiers (query-policy.ts) -- the
 *  stalled tier is exactly where a read should actually be aborted. */
export const READ_DEADLINE_MS = 15_000;

const READ_TIMEOUT_MARKER = Symbol("read-timeout");

export type ReadTimeoutError = Error & { [READ_TIMEOUT_MARKER]: true };

export function isReadTimeoutError(err: unknown): err is ReadTimeoutError {
  return err instanceof Error && (err as Partial<ReadTimeoutError>)[READ_TIMEOUT_MARKER] === true;
}

function makeReadTimeoutError(): ReadTimeoutError {
  const err = new Error("Read timed out") as ReadTimeoutError;
  err[READ_TIMEOUT_MARKER] = true;
  return err;
}

/** Combines multiple AbortSignals into one that aborts when any of them
 *  do -- `AbortSignal.any` where available (Node 20+, evergreen browsers),
 *  a small manual fallback otherwise (older Safari). */
function anySignal(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === "function") return AbortSignal.any(signals);
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}

/**
 * Runs `run` with a combined signal (the query's own cancellation signal,
 * if given, plus a fresh `deadlineMs` timer) and re-throws a distinct
 * `ReadTimeoutError` (see `isReadTimeoutError`) specifically when OUR OWN
 * deadline is what fired -- a plain external cancellation (route-away, a
 * superseded query) is left as whatever `run` itself throws/however React
 * Query's own cancellation handling already treats it, since that is
 * normal navigation, not a stall worth showing recovery UI for.
 */
export async function withReadDeadline<T>(
  querySignal: AbortSignal | undefined,
  run: (signal: AbortSignal) => Promise<T>,
  deadlineMs: number = READ_DEADLINE_MS,
): Promise<T> {
  const deadlineController = new AbortController();
  const timer = setTimeout(() => deadlineController.abort(), deadlineMs);
  const combined = anySignal(querySignal ? [deadlineController.signal, querySignal] : [deadlineController.signal]);
  try {
    return await run(combined);
  } catch (err) {
    if (deadlineController.signal.aborted && !querySignal?.aborted) {
      // V-05: logged HERE, once, inside the shared primitive -- every read
      // this app makes goes through withReadDeadline, so this single hook
      // point covers every call site's timeout without adding a call at
      // each of the ~13 places that use it.
      logTelemetryEvent({ category: "query_timeout", outcome: "timeout", durationMs: deadlineMs });
      throw makeReadTimeoutError();
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
