import type { InvalidationTarget } from "./event-invalidation-map";
import { targetKey } from "./event-invalidation-map";

/**
 * P6: pure batching engine for realtime-triggered invalidations. Takes
 * injected scheduling and an injected invalidate function so tests can
 * be deterministic (event-order/call-count assertions), not
 * wall-clock-timing-based -- same discipline as every other concurrency
 * test in this batch.
 *
 * No automatic payload patching: Batch B's optimistic-write ownership
 * rules (query-updates.ts) already own the client cache's mutation-side
 * writes; an incomplete realtime payload must not bypass them by
 * writing directly into the cache here.
 */

export type InvalidationBatcherOptions = {
  /** Runs the actual invalidation for one target. Defaults to nothing here -- the caller (P7's owner) supplies the real qc.invalidateQueries call. */
  invalidate: (target: InvalidationTarget) => void;
  /** Trailing debounce: a burst of events resets this timer each time; the batch flushes once it elapses with no new events. Default 150ms per the plan. */
  debounceMs?: number;
  /** Bounded max wait: even under continuous events, the batch flushes at least this often so it can never be postponed forever. Default 500ms per the plan. */
  maxWaitMs?: number;
  /** Injected scheduling, for deterministic tests -- defaults to the real timer functions. */
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
};

export type InvalidationBatcher = {
  /** Adds targets to the current pending batch (deduplicated) and (re)schedules a flush. */
  enqueue: (targets: InvalidationTarget[]) => void;
  /** Whether events are queued but not yet invalidated. */
  hasPending: () => boolean;
  /** Drains and invalidates whatever's currently pending, immediately, cancelling any scheduled timers. Safe to call with nothing pending. */
  flush: () => void;
  /** Cancels all pending timers and discards any not-yet-flushed batch. Call on teardown (identity retirement, unmount) -- after dispose(), enqueue() is a no-op. */
  dispose: () => void;
};

export function createInvalidationBatcher(options: InvalidationBatcherOptions): InvalidationBatcher {
  const debounceMs = options.debounceMs ?? 150;
  const maxWaitMs = options.maxWaitMs ?? 500;
  const scheduleTimeout = options.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const cancelTimeout = options.clearTimeout ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let pending = new Map<string, InvalidationTarget>();
  let debounceHandle: unknown = null;
  let maxWaitHandle: unknown = null;
  let disposed = false;

  function clearTimers() {
    if (debounceHandle !== null) {
      cancelTimeout(debounceHandle);
      debounceHandle = null;
    }
    if (maxWaitHandle !== null) {
      cancelTimeout(maxWaitHandle);
      maxWaitHandle = null;
    }
  }

  function flush() {
    clearTimers();
    if (pending.size === 0) return;
    // Drain atomically: the batch about to be invalidated is swapped
    // out for a fresh empty one BEFORE running any invalidation, so
    // any event that arrives synchronously as a side effect of
    // invalidating (e.g. a refetch immediately completing and
    // triggering another realtime event) is queued into the NEXT
    // batch, not lost and not merged into the one currently draining.
    const batch = pending;
    pending = new Map();
    const targets = [...batch.values()];
    for (const target of targets) {
      // A broad family refresh subsumes narrower entries in this flush.
      // Keep this at flush time: event order can put either target first.
      if (targets.some((other) => other.length < target.length &&
        other.every((value, index) => value === target[index]))) continue;
      options.invalidate(target);
    }
  }

  function scheduleFlush() {
    // Trailing debounce: any new event resets this timer.
    if (debounceHandle !== null) cancelTimeout(debounceHandle);
    debounceHandle = scheduleTimeout(() => {
      debounceHandle = null;
      flush();
    }, debounceMs);
    // Bounded max wait: only ever scheduled once per batch (not reset
    // on every event), so a continuous stream of events still flushes
    // within maxWaitMs of the FIRST event in the batch, rather than
    // being postponed forever by the trailing debounce alone.
    if (maxWaitHandle === null) {
      maxWaitHandle = scheduleTimeout(() => {
        maxWaitHandle = null;
        flush();
      }, maxWaitMs);
    }
  }

  return {
    enqueue(targets: InvalidationTarget[]) {
      if (disposed) return;
      for (const target of targets) {
        pending.set(targetKey(target), target);
      }
      if (pending.size > 0) scheduleFlush();
    },
    hasPending: () => pending.size > 0,
    flush,
    dispose() {
      disposed = true;
      clearTimers();
      pending = new Map();
    },
  };
}
