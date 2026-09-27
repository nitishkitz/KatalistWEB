import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h, useEffect } from "react";
import { act } from "react";
import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * G-06 (audit): useBucketNotes() threw its query error inside queryFn
 * but never exposed it in its return value -- notes: query.data ?? []
 * fell through to an empty array on failure, indistinguishable from a
 * genuinely empty Bucket. Added `error`/`refetch` to the return.
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let notesResult = { data: null, error: null };
let observedSignal = null;

mock.module("@/hooks/useSession", { namedExports: { useSession: () => ({ user: { id: "profile-1" } }) } });
mock.module("@/integrations/supabase/client", {
  namedExports: {
    supabase: {
      from: () => {
        const node = {
          select: () => node,
          eq: () => node,
          is: () => node,
          order: () => node,
          abortSignal: async (signal) => {
            observedSignal = signal;
            return notesResult;
          },
        };
        return node;
      },
    },
  },
});

const { useBucketNotes } = await import("@/features/buckets/use-bucket-notes");

function Probe({ onValue }) {
  const value = useBucketNotes("bucket-1");
  useEffect(() => {
    onValue(value);
  });
  return null;
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

test("a rejected notes read surfaces as error, not a silently-empty notes array", async () => {
  notesResult = { data: null, error: { message: "read failed" } };
  const qc = newClient();
  let latest = null;

  await act(async () => {
    render(h(QueryClientProvider, { client: qc }, h(Probe, { onValue: (v) => (latest = v) })));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });

  assert.ok(latest.error, "the read failure must surface as error");
  assert.deepEqual(latest.notes, []);
  assert.equal(typeof latest.refetch, "function");

  cleanup();
  qc.clear();
});

test("a successful read with real rows has no error and maps rows correctly", async () => {
  notesResult = {
    data: [{ id: "n1", title: "Title", body: "Body", created_at: "2026-01-01", updated_at: "2026-01-02" }],
    error: null,
  };
  const qc = newClient();
  let latest = null;

  await act(async () => {
    render(h(QueryClientProvider, { client: qc }, h(Probe, { onValue: (v) => (latest = v) })));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });

  assert.equal(latest.error, null);
  assert.equal(latest.notes.length, 1);
  assert.equal(latest.notes[0].title, "Title");
  assert.ok(observedSignal instanceof AbortSignal, "the notes read receives the query/deadline cancellation signal");

  cleanup();
  qc.clear();
});
