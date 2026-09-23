import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveAsyncBranch } from "@/lib/query-policy";

test("offline with no confirmed result and no data blocks", () => {
  assert.equal(
    resolveAsyncBranch({ online: false, isLoading: true, hasError: false, isEmpty: true }),
    "offline-blocked",
  );
});

test("offline with a settled error and no data blocks", () => {
  assert.equal(
    resolveAsyncBranch({ online: false, isLoading: false, hasError: true, isEmpty: true }),
    "offline-blocked",
  );
});

test("offline with a successfully-loaded empty result renders the accurate empty state, not the offline block", () => {
  // The point of the P2 fix: a confirmed "you have zero" result (settled,
  // no error) must not be presented as "nothing cached yet" just because
  // connectivity happens to be down right now.
  assert.equal(
    resolveAsyncBranch({ online: false, isLoading: false, hasError: false, isEmpty: true }),
    "empty",
  );
});

test("offline with non-empty data renders ready (content stays visible)", () => {
  assert.equal(
    resolveAsyncBranch({ online: false, isLoading: false, hasError: false, isEmpty: false }),
    "ready",
  );
});

test("offline with non-empty data and a background error still renders ready, not the error block", () => {
  // e.g. a background refetch failed while offline, but prior successful
  // data is still cached and non-empty.
  assert.equal(
    resolveAsyncBranch({ online: false, isLoading: false, hasError: true, isEmpty: false }),
    "ready",
  );
});

test("online, loading, no data yet: loading", () => {
  assert.equal(
    resolveAsyncBranch({ online: true, isLoading: true, hasError: false, isEmpty: true }),
    "loading",
  );
});

test("online with an error and no data: error-blocked", () => {
  assert.equal(
    resolveAsyncBranch({ online: true, isLoading: false, hasError: true, isEmpty: true }),
    "error-blocked",
  );
});

test("online with an error but non-empty (stale) data: ready, error does not hide loaded content", () => {
  assert.equal(
    resolveAsyncBranch({ online: true, isLoading: false, hasError: true, isEmpty: false }),
    "ready",
  );
});

test("online, settled, empty, no error: empty", () => {
  assert.equal(
    resolveAsyncBranch({ online: true, isLoading: false, hasError: false, isEmpty: true }),
    "empty",
  );
});

test("online, settled, non-empty, no error: ready", () => {
  assert.equal(
    resolveAsyncBranch({ online: true, isLoading: false, hasError: false, isEmpty: false }),
    "ready",
  );
});
