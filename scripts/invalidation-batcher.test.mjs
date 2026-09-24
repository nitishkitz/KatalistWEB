import assert from "node:assert/strict";
import { test } from "node:test";
import { createInvalidationBatcher } from "@/features/realtime/invalidation-batcher";

/**
 * P6 acceptance criteria for the batcher, each with a deterministic
 * fake scheduler -- no wall-clock elapsed-time assertions, matching
 * the discipline established for every other concurrency test in this
 * batch. The fake scheduler models time as a single integer "now" and
 * a list of pending (fireAt, fn) entries; advancing time fires
 * whatever's due, in order.
 */

function makeFakeClock() {
  let now = 0;
  let nextHandle = 1;
  const pending = new Map(); // handle -> { fireAt, fn }
  return {
    setTimeout: (fn, ms) => {
      const handle = nextHandle++;
      pending.set(handle, { fireAt: now + ms, fn });
      return handle;
    },
    clearTimeout: (handle) => {
      pending.delete(handle);
    },
    advance(ms) {
      now += ms;
      // Fire everything due, in fireAt order; a fired timer's own
      // side effect (e.g. flush() scheduling a new timer) must not be
      // fired again within this same advance() call unless its fireAt
      // is also <= now, matching how real timers behave.
      let firedSomething = true;
      while (firedSomething) {
        firedSomething = false;
        const due = [...pending.entries()]
          .filter(([, t]) => t.fireAt <= now)
          .sort((a, b) => a[1].fireAt - b[1].fireAt);
        for (const [handle, t] of due) {
          pending.delete(handle);
          t.fn();
          firedSomething = true;
        }
      }
    },
    pendingCount() {
      return pending.size;
    },
  };
}

test("a burst of related events inside one debounce window yields exactly one flush, with each deduplicated target invalidated exactly once", () => {
  const clock = makeFakeClock();
  const invalidated = [];
  const batcher = createInvalidationBatcher({
    invalidate: (t) => invalidated.push(t[0]),
    debounceMs: 150,
    maxWaitMs: 500,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });

  // 20 events, several repeating the same target, all within the debounce window.
  for (let i = 0; i < 20; i++) {
    batcher.enqueue([["court"], ["thing"]]);
    clock.advance(10); // 10ms apart, well under the 150ms debounce
  }

  assert.equal(invalidated.length, 0, "must not have flushed yet -- still inside the debounce window");

  clock.advance(150); // let the trailing debounce elapse with no further events

  assert.deepEqual(invalidated.sort(), ["court", "thing"], "expected exactly one flush with each deduplicated target invalidated exactly once, not 20 full refreshes");
});

test("continuous events still flush within maxWaitMs, not postponed forever by the trailing debounce", () => {
  const clock = makeFakeClock();
  let flushCount = 0;
  const batcher = createInvalidationBatcher({
    invalidate: () => { flushCount += 1; },
    debounceMs: 150,
    maxWaitMs: 500,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });

  // An event every 100ms -- always resets the 150ms trailing debounce
  // before it can elapse, so ONLY the 500ms max-wait bound can force a
  // flush here.
  for (let i = 0; i < 12; i++) {
    batcher.enqueue([["court"]]);
    clock.advance(100);
  }

  assert.ok(flushCount >= 1, "a continuous stream of events must still flush within maxWaitMs, not be postponed indefinitely by the trailing debounce alone");
});

test("events during an in-flight flush form the next batch, not lost and not merged into the one currently draining", () => {
  const clock = makeFakeClock();
  const flushes = [];
  const batcher = createInvalidationBatcher({
    invalidate: (t) => {
      flushes.push(t[0]);
      // Simulate a second event arriving as a synchronous side effect
      // of invalidating the first target -- e.g. a refetch immediately
      // completing and triggering another realtime event.
      if (t[0] === "court" && flushes.filter((x) => x === "court").length === 1) {
        batcher.enqueue([["thing"]]);
      }
    },
    debounceMs: 150,
    maxWaitMs: 500,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });

  batcher.enqueue([["court"]]);
  clock.advance(150); // first flush fires, enqueues ["thing"] as a side effect

  assert.deepEqual(flushes, ["court"], "the side-effect enqueue must not be invalidated synchronously inside the same flush");

  clock.advance(150); // second batch's own debounce elapses

  assert.deepEqual(flushes, ["court", "thing"], "the side-effect-enqueued target must flush as its own, later batch");
});

test("flush() drains immediately and cancels pending timers, even before the debounce would have elapsed", () => {
  const clock = makeFakeClock();
  const invalidated = [];
  const batcher = createInvalidationBatcher({
    invalidate: (t) => invalidated.push(t[0]),
    debounceMs: 150,
    maxWaitMs: 500,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });

  batcher.enqueue([["court"]]);
  assert.equal(batcher.hasPending(), true);
  batcher.flush();

  assert.deepEqual(invalidated, ["court"]);
  assert.equal(batcher.hasPending(), false);
  assert.equal(clock.pendingCount(), 0, "flush() must cancel the now-unnecessary scheduled timers");
});

test("flush() with nothing pending is a safe no-op", () => {
  const clock = makeFakeClock();
  const batcher = createInvalidationBatcher({
    invalidate: () => { throw new Error("must not be called"); },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });
  assert.doesNotThrow(() => batcher.flush());
});

test("dispose() discards any pending batch and makes further enqueue() calls no-ops", () => {
  const clock = makeFakeClock();
  const invalidated = [];
  const batcher = createInvalidationBatcher({
    invalidate: (t) => invalidated.push(t[0]),
    debounceMs: 150,
    maxWaitMs: 500,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });

  batcher.enqueue([["court"]]);
  batcher.dispose();
  clock.advance(1000);
  assert.deepEqual(invalidated, [], "a disposed batcher must not flush its discarded pending batch");

  batcher.enqueue([["thing"]]);
  clock.advance(1000);
  assert.deepEqual(invalidated, [], "enqueue() after dispose() must be a no-op, not silently start scheduling again");
});

test("a broad target subsumes narrower targets regardless of enqueue order", () => {
  const invalidated = [];
  const batcher = createInvalidationBatcher({ invalidate: (target) => invalidated.push(target) });
  batcher.enqueue([["list", "one"], ["list", "two"], ["court"]]);
  batcher.enqueue([["list"]]);
  batcher.flush();
  assert.deepEqual(invalidated, [["court"], ["list"]]);
  batcher.dispose();
});
