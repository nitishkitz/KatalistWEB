import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveAsyncBranch, classifyAsyncError, isPermanentQueryError } from "@/lib/query-policy";
import { withReadDeadline } from "@/lib/read-request";

const TRANSIENT_ERROR = new Error("network request failed");
const FORBIDDEN_ERROR = new Error("permission denied (row-level security policy)");
const UNAUTHENTICATED_ERROR = new Error("not authenticated");
const NOT_FOUND_ERROR = new Error("not found");

test("offline, still loading, never fetched: blocks", () => {
  assert.equal(
    resolveAsyncBranch({ online: false, isLoading: true, error: null, isEmpty: true, hasFetchedOnce: false }),
    "offline-blocked",
  );
});

test("offline, a settled error, never fetched: blocks", () => {
  assert.equal(
    resolveAsyncBranch({
      online: false,
      isLoading: false,
      error: TRANSIENT_ERROR,
      isEmpty: true,
      hasFetchedOnce: false,
    }),
    "offline-blocked",
  );
});

test("offline, a paused query that never fetched (isLoading and error both absent): still blocks", () => {
  // The specific gap this covers: react-query reports isLoading: false and
  // no error for a query "paused" offline before its first fetch
  // (networkMode "online", status stays "pending" — it just isn't
  // actively fetching). Deriving "confirmed" from `!isLoading &&
  // !error` would misread this as a settled, confirmed-empty result.
  // hasFetchedOnce is the caller-supplied ground truth that isn't fooled
  // by that combination.
  assert.equal(
    resolveAsyncBranch({ online: false, isLoading: false, error: null, isEmpty: true, hasFetchedOnce: false }),
    "offline-blocked",
  );
});

test("offline with a successfully-loaded empty result renders the accurate empty state, not the offline block", () => {
  // A confirmed "you have zero" result (hasFetchedOnce: true) must not be
  // presented as "nothing cached yet" just because connectivity happens
  // to be down right now.
  assert.equal(
    resolveAsyncBranch({ online: false, isLoading: false, error: null, isEmpty: true, hasFetchedOnce: true }),
    "empty",
  );
});

test("offline with non-empty data renders ready (content stays visible)", () => {
  assert.equal(
    resolveAsyncBranch({ online: false, isLoading: false, error: null, isEmpty: false, hasFetchedOnce: true }),
    "ready",
  );
});

test("offline with non-empty data and a background transient error still renders ready, not the error block", () => {
  // e.g. a background refetch failed while offline, but prior successful
  // data is still cached and non-empty.
  assert.equal(
    resolveAsyncBranch({
      online: false,
      isLoading: false,
      error: TRANSIENT_ERROR,
      isEmpty: false,
      hasFetchedOnce: true,
    }),
    "ready",
  );
});

test("online, loading, no data yet: loading", () => {
  assert.equal(
    resolveAsyncBranch({ online: true, isLoading: true, error: null, isEmpty: true, hasFetchedOnce: false }),
    "loading",
  );
});

test("online with a transient error and no data: error-blocked", () => {
  assert.equal(
    resolveAsyncBranch({
      online: true,
      isLoading: false,
      error: TRANSIENT_ERROR,
      isEmpty: true,
      hasFetchedOnce: false,
    }),
    "error-blocked",
  );
});

test("online with a transient error but non-empty (stale) data: ready, a harmless background failure does not hide loaded content", () => {
  assert.equal(
    resolveAsyncBranch({
      online: true,
      isLoading: false,
      error: TRANSIENT_ERROR,
      isEmpty: false,
      hasFetchedOnce: true,
    }),
    "ready",
  );
});

// B-03: the actual defect this audit item fixed -- a CONFIRMED access-loss
// error (forbidden/unauthenticated/not-found) must clear protected content
// even when stale non-empty data is still cached. "Loaded data + a
// harmless background failure" and "loaded data + confirmed 403" are NOT
// the same fact, and were previously collapsed into the same "ready"
// branch just because both had isEmpty: false.

test("online with a FORBIDDEN error and stale non-empty data: error-blocked, not ready -- confirmed access loss must clear protected content", () => {
  assert.equal(
    resolveAsyncBranch({
      online: true,
      isLoading: false,
      error: FORBIDDEN_ERROR,
      isEmpty: false,
      hasFetchedOnce: true,
    }),
    "error-blocked",
  );
});

test("online with an UNAUTHENTICATED error and stale non-empty data: error-blocked", () => {
  assert.equal(
    resolveAsyncBranch({
      online: true,
      isLoading: false,
      error: UNAUTHENTICATED_ERROR,
      isEmpty: false,
      hasFetchedOnce: true,
    }),
    "error-blocked",
  );
});

test("online with a NOT-FOUND error and stale non-empty data: error-blocked", () => {
  assert.equal(
    resolveAsyncBranch({
      online: true,
      isLoading: false,
      error: NOT_FOUND_ERROR,
      isEmpty: false,
      hasFetchedOnce: true,
    }),
    "error-blocked",
  );
});

test("online, settled, empty, no error: empty", () => {
  assert.equal(
    resolveAsyncBranch({ online: true, isLoading: false, error: null, isEmpty: true, hasFetchedOnce: true }),
    "empty",
  );
});

test("online, settled, non-empty, no error: ready", () => {
  assert.equal(
    resolveAsyncBranch({ online: true, isLoading: false, error: null, isEmpty: false, hasFetchedOnce: true }),
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
    resolveAsyncBranch({ online: true, isLoading: false, error: null, isEmpty: true, hasFetchedOnce: false }),
    "empty",
  );
});

// R-09: classifyAsyncError() previously looked only at lowercased message
// text. A caller supplying a structured {status} or {code} without a
// recognized message substring (Supabase's PostgrestError shape, or a
// fetch-Response-derived error exposing only a numeric status) fell
// through to "failed", which resolveAsyncBranch() does not treat as a
// confirmed access loss -- stale protected data kept rendering. Verified
// directly against the pre-fix resolver: {status: 403, message:
// "Forbidden"} and {code: "42501", message: "access denied"} both
// returned "ready" with stale non-empty data loaded.

test("classifyAsyncError: a structured status:401 with no recognized message text is unauthenticated", () => {
  assert.equal(classifyAsyncError({ status: 401, message: "Unauthorized" }), "unauthenticated");
});

test("classifyAsyncError: a structured status:403 with no recognized message text is forbidden", () => {
  assert.equal(classifyAsyncError({ status: 403, message: "Forbidden" }), "forbidden");
});

test("classifyAsyncError: a structured code:42501 (Postgres RLS) with no recognized message text is forbidden", () => {
  assert.equal(classifyAsyncError({ code: "42501", message: "access denied" }), "forbidden");
});

test("classifyAsyncError: a structured status:404 with no recognized message text is not-found", () => {
  assert.equal(classifyAsyncError({ status: 404, message: "Gone" }), "not-found");
});

test("classifyAsyncError: a structured code:PGRST116 (PostgREST not-found) is not-found", () => {
  assert.equal(classifyAsyncError({ code: "PGRST116", message: "no rows" }), "not-found");
});

test("classifyAsyncError: a structured status:500 is failed (transient), not misread as a denial", () => {
  assert.equal(classifyAsyncError({ status: 500, message: "Internal Server Error" }), "failed");
});

test("resolveAsyncBranch: a structured 403 with stale non-empty data is error-blocked, not ready", () => {
  assert.equal(
    resolveAsyncBranch({
      online: true,
      isLoading: false,
      error: { status: 403, message: "Forbidden" },
      isEmpty: false,
      hasFetchedOnce: true,
    }),
    "error-blocked",
  );
});

test("resolveAsyncBranch: a structured 42501 code with stale non-empty data is error-blocked, not ready", () => {
  assert.equal(
    resolveAsyncBranch({
      online: true,
      isLoading: false,
      error: { code: "42501", message: "access denied" },
      isEmpty: false,
      hasFetchedOnce: true,
    }),
    "error-blocked",
  );
});

test("resolveAsyncBranch: a structured 500 with stale non-empty data stays ready (transient, not a denial)", () => {
  assert.equal(
    resolveAsyncBranch({
      online: true,
      isLoading: false,
      error: { status: 500, message: "Internal Server Error" },
      isEmpty: false,
      hasFetchedOnce: true,
    }),
    "ready",
  );
});

test("isPermanentQueryError: a structured 403 is permanent even with no recognized message text", () => {
  assert.equal(isPermanentQueryError({ status: 403, message: "Forbidden" }), true);
});

test("isPermanentQueryError: a structured 42501 code is permanent even with no recognized message text", () => {
  assert.equal(isPermanentQueryError({ code: "42501", message: "access denied" }), true);
});

test("isPermanentQueryError: a structured 500 is not permanent (worth retrying)", () => {
  assert.equal(isPermanentQueryError({ status: 500, message: "Internal Server Error" }), false);
});

// T01: a read-request.ts deadline abort is neither a confirmed access loss
// nor an ordinary transient failure -- resolveAsyncBranch must still block
// (like any other error) when there's nothing to fall back on, but the
// classification consumers see must be "timeout", not "failed", so
// AsyncState can show its own distinct recovery messaging.

test("resolveAsyncBranch: a read timeout with no data yet is error-blocked, classified as 'timeout'", async () => {
  await assert.rejects(
    () =>
      withReadDeadline(
        undefined,
        (signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("x")))),
        10,
      ),
    (err) => {
      assert.equal(classifyAsyncError(err), "timeout");
      assert.equal(
        resolveAsyncBranch({ online: true, isLoading: false, error: err, isEmpty: true, hasFetchedOnce: false }),
        "error-blocked",
      );
      return true;
    },
  );
});

test("resolveAsyncBranch: a read timeout with stale non-empty data already loaded stays ready (same as any other transient failure)", async () => {
  await assert.rejects(
    () =>
      withReadDeadline(
        undefined,
        (signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("x")))),
        10,
      ),
    (err) => {
      assert.equal(
        resolveAsyncBranch({ online: true, isLoading: false, error: err, isEmpty: false, hasFetchedOnce: true }),
        "ready",
      );
      return true;
    },
  );
});
