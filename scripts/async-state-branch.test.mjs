import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveAsyncBranch } from "@/lib/query-policy";

test("offline, still loading, never fetched: blocks", () => {
  assert.equal(
    resolveAsyncBranch({ online: false, isLoading: true, hasError: false, isEmpty: true, hasFetchedOnce: false }),
    "offline-blocked",
  );
});

test("offline, a settled error, never fetched: blocks", () => {
  assert.equal(
    resolveAsyncBranch({ online: false, isLoading: false, hasError: true, isEmpty: true, hasFetchedOnce: false }),
    "offline-blocked",
  );
});

test("offline, a paused query that never fetched (isLoading and hasError both false): still blocks", () => {
  // The specific gap this covers: react-query reports isLoading: false and
  // hasError: false for a query "paused" offline before its first fetch
  // (networkMode "online", status stays "pending" — it just isn't
  // actively fetching). Deriving "confirmed" from `!isLoading &&
  // !hasError` would misread this as a settled, confirmed-empty result.
  // hasFetchedOnce is the caller-supplied ground truth that isn't fooled
  // by that combination.
  assert.equal(
    resolveAsyncBranch({ online: false, isLoading: false, hasError: false, isEmpty: true, hasFetchedOnce: false }),
    "offline-blocked",
  );
});

test("offline with a successfully-loaded empty result renders the accurate empty state, not the offline block", () => {
  // A confirmed "you have zero" result (hasFetchedOnce: true) must not be
  // presented as "nothing cached yet" just because connectivity happens
  // to be down right now.
  assert.equal(
    resolveAsyncBranch({ online: false, isLoading: false, hasError: false, isEmpty: true, hasFetchedOnce: true }),
    "empty",
  );
});

test("offline with non-empty data renders ready (content stays visible)", () => {
  assert.equal(
    resolveAsyncBranch({ online: false, isLoading: false, hasError: false, isEmpty: false, hasFetchedOnce: true }),
    "ready",
  );
});

test("offline with non-empty data and a background error still renders ready, not the error block", () => {
  // e.g. a background refetch failed while offline, but prior successful
  // data is still cached and non-empty.
  assert.equal(
    resolveAsyncBranch({ online: false, isLoading: false, hasError: true, isEmpty: false, hasFetchedOnce: true }),
    "ready",
  );
});

test("online, loading, no data yet: loading", () => {
  assert.equal(
    resolveAsyncBranch({ online: true, isLoading: true, hasError: false, isEmpty: true, hasFetchedOnce: false }),
    "loading",
  );
});

test("online with an error and no data: error-blocked", () => {
  assert.equal(
    resolveAsyncBranch({ online: true, isLoading: false, hasError: true, isEmpty: true, hasFetchedOnce: false }),
    "error-blocked",
  );
});

test("online with an error but non-empty (stale) data: ready, error does not hide loaded content", () => {
  assert.equal(
    resolveAsyncBranch({ online: true, isLoading: false, hasError: true, isEmpty: false, hasFetchedOnce: true }),
    "ready",
  );
});

test("online, settled, empty, no error: empty", () => {
  assert.equal(
    resolveAsyncBranch({ online: true, isLoading: false, hasError: false, isEmpty: true, hasFetchedOnce: true }),
    "empty",
  );
});

test("online, settled, non-empty, no error: ready", () => {
  assert.equal(
    resolveAsyncBranch({ online: true, isLoading: false, hasError: false, isEmpty: false, hasFetchedOnce: true }),
    "ready",
  );
});

test("online, never fetched (e.g. an intentionally disabled query), no error: falls through to empty", () => {
  // Unlike the offline case, this isn't the paused-query hazard the other
  // tests cover — while online, isLoading is false + hasFetchedOnce false
  // realistically means the query is disabled for some other reason (not
  // yet authenticated, etc.), which is a separate, pre-existing concern
  // this function doesn't attempt to solve. Documenting the actual
  // current behavior here (rather than leaving it unspecified) so a
  // future change to this branch is a deliberate decision, not a surprise.
  assert.equal(
    resolveAsyncBranch({ online: true, isLoading: false, hasError: false, isEmpty: true, hasFetchedOnce: false }),
    "empty",
  );
});
