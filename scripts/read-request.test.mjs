import assert from "node:assert/strict";
import { test } from "node:test";
import { withReadDeadline, isReadTimeoutError, READ_DEADLINE_MS } from "@/lib/read-request";

test("READ_DEADLINE_MS matches AsyncState's own stalled-tier milestone", async () => {
  const { STALLED_QUERY_MS } = await import("@/lib/query-policy");
  assert.equal(READ_DEADLINE_MS, STALLED_QUERY_MS);
});

test("a read that resolves well before the deadline resolves normally, with no timeout error", async () => {
  const result = await withReadDeadline(undefined, async () => "ok", 50);
  assert.equal(result, "ok");
});

test("a read that never settles is aborted at the deadline and throws a distinct ReadTimeoutError", async () => {
  await assert.rejects(
    () =>
      withReadDeadline(
        undefined,
        (signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new Error("aborted")));
          }),
        20,
      ),
    (err) => {
      assert.ok(isReadTimeoutError(err), "must be classifiable as a read timeout, not a generic error");
      return true;
    },
  );
});

test("a read cancelled by the CALLER's own signal (not our deadline) is NOT reported as a timeout", async () => {
  const external = new AbortController();
  const runPromise = withReadDeadline(
    external.signal,
    (signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("cancelled")));
      }),
    5_000, // deliberately long -- the external cancel must win, not our own deadline
  );
  external.abort();
  await assert.rejects(runPromise, (err) => {
    assert.equal(isReadTimeoutError(err), false, "an external cancellation must not be misreported as our own timeout");
    assert.equal(err.message, "cancelled");
    return true;
  });
});

test("the combined signal passed to `run` is aborted once the deadline fires, so callers can pass it straight to abortSignal()", async () => {
  let observedAborted = false;
  await assert.rejects(
    () =>
      withReadDeadline(
        undefined,
        (signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => {
              observedAborted = signal.aborted;
              reject(new Error("aborted"));
            });
          }),
        15,
      ),
    () => true,
  );
  assert.equal(observedAborted, true);
});

function hangUntilAborted(signal) {
  return new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")));
  });
}

test("classifyAsyncError maps a ReadTimeoutError to the distinct 'timeout' kind, not 'failed'", async () => {
  const { classifyAsyncError } = await import("@/lib/query-policy");
  await assert.rejects(
    () => withReadDeadline(undefined, hangUntilAborted, 10),
    (err) => {
      assert.equal(classifyAsyncError(err), "timeout");
      return true;
    },
  );
});

test("isPermanentQueryError treats a read timeout as non-retriable (surface immediately, don't silently retry another 15s)", async () => {
  const { isPermanentQueryError } = await import("@/lib/query-policy");
  await assert.rejects(
    () => withReadDeadline(undefined, hangUntilAborted, 10),
    (err) => {
      assert.equal(isPermanentQueryError(err), true);
      return true;
    },
  );
});
