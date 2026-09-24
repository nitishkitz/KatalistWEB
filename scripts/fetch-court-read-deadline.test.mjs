import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { isReadTimeoutError } from "@/lib/read-request";

/**
 * T01: fetchCourt's Things read is now bounded by read-request.ts's shared
 * deadline, wired to both React Query's own cancellation signal and
 * PostgREST's .abortSignal(). Two things to prove with the REAL fetchCourt
 * (not just read-request.ts's own unit tests): a hung Things query is
 * actually aborted (the mocked query observes its signal firing) and
 * surfaces as a classifiable ReadTimeoutError; an external (React Query)
 * cancellation signal is honored too, and is NOT misreported as a timeout.
 */

mock.module("@/features/things/map-thing-rows", {
  namedExports: {
    mapDbThingRows: (rows) => Promise.resolve(rows.map((r) => ({ id: r.id, title: "mapped" }))),
    THING_COLUMNS: "id",
  },
});
mock.module("@/features/people/actor-query", {
  namedExports: { getActorId: async () => "actor-1" },
});

let thingsAbortSignal = null;

mock.module("@/integrations/supabase/client", {
  namedExports: {
    supabase: {
      from: (table) => {
        if (table === "actors") {
          const node = { select: () => node, eq: () => node, maybeSingle: async () => ({ data: { id: "actor-1" }, error: null }) };
          return node;
        }
        const node = {
          select: () => node,
          eq: () => node,
          is: () => node,
          abortSignal: (signal) => {
            thingsAbortSignal = signal;
            return node;
          },
          then: (resolve, reject) => {
            // Deliberately never resolves on its own -- only reacts to the
            // signal, modeling a genuinely hung request. Matches real
            // fetch()/PostgREST behavior: if the signal is ALREADY aborted
            // by the time `.then()` actually runs (a later microtask --
            // an external abort() called synchronously right after
            // dispatching the read fires before this thenable is ever
            // resolved), reject immediately rather than registering a
            // listener for an "abort" event that already happened and
            // will never fire again.
            if (thingsAbortSignal?.aborted) {
              reject(new Error("aborted"));
              return;
            }
            thingsAbortSignal?.addEventListener("abort", () => reject(new Error("aborted")));
          },
        };
        return node;
      },
    },
  },
});

const { fetchCourt } = await import("@/features/court/fetch-court");

test("fetchCourt's Things read is aborted at the deadline and surfaces as a classifiable ReadTimeoutError", async () => {
  const qc = new QueryClient();
  await assert.rejects(() => fetchCourt("work", "profile-1", qc, undefined, 15), (err) => {
    assert.ok(isReadTimeoutError(err), "must be classifiable as a read timeout");
    assert.ok(thingsAbortSignal?.aborted, "the actual PostgREST abortSignal must have fired");
    return true;
  });
});

test("fetchCourt honors an external (React Query) cancellation signal, and does NOT misreport it as a timeout", async () => {
  const qc = new QueryClient();
  const external = new AbortController();
  const promise = fetchCourt("work", "profile-1", qc, external.signal, 5_000); // long deadline -- external cancel must win
  external.abort();
  await assert.rejects(promise, (err) => {
    assert.equal(isReadTimeoutError(err), false, "an external cancellation must not be misreported as a deadline timeout");
    return true;
  });
});
