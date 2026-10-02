import assert from "node:assert/strict";
import { test, mock } from "node:test";

const rows = [
  { id: "f1", thing_id: "t1", storage_key: "things/t1/shared.pdf", file_name: "shared.pdf", mime_type: "application/pdf", byte_size: 1234, created_at: "2026-09-24T10:00:00Z" },
  { id: "f2", thing_id: "t2", storage_key: "things/t1/shared.pdf", file_name: "shared.pdf", mime_type: "application/pdf", byte_size: 1234, created_at: "2026-09-24T10:00:01Z" },
  { id: "f3", thing_id: "t2", storage_key: "things/t2/missing.png", file_name: "missing.png", mime_type: "image/png", byte_size: 800, created_at: "2026-09-24T10:00:02Z" },
];

let signingCalls = [];
let signingFails = false;
const tableRequest = {
  select: () => tableRequest,
  in: () => tableRequest,
  order: async () => ({ data: rows, error: null }),
};
mock.module("@/integrations/supabase/client", {
  namedExports: { supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: "test-token" } } }) },
    from: (table) => { assert.equal(table, "thing_attachments"); return tableRequest; },
    storage: { from: (bucket) => {
      assert.equal(bucket, "thing-attachments");
      return { createSignedUrls: async (paths, ttl) => {
        signingCalls.push({ paths, ttl });
        if (signingFails) return { data: null, error: new Error("session not ready") };
        return { data: [
          { path: "things/t1/shared.pdf", signedUrl: "https://example.invalid/shared" },
          { path: "things/t2/missing.png", signedUrl: null, error: { message: "not found" } },
        ], error: null };
      } };
    } },
  } },
});

const { fetchRealAttachments } = await import("@/features/things/attachments");

test("server signer recovers previews when client signing races login", async () => {
  signingFails = true;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    assert.equal(init.headers.get("Authorization"), "Bearer test-token");
    return { ok: true, json: async () => ({ urls: {
      "things/t1/shared.pdf": "https://example.invalid/recovered",
    } }) };
  };
  try {
    const result = await fetchRealAttachments(["t1", "t2"]);
    assert.equal(result.get("t1")[0].url, "https://example.invalid/recovered");
    assert.equal(result.get("t2")[0].url, "https://example.invalid/recovered");
    assert.match(result.get("t2")[1].urlError, /preview unavailable/i);
  } finally {
    signingFails = false;
    globalThis.fetch = originalFetch;
  }
});

test("signs distinct attachment paths in one bounded request and keeps per-file failure", async () => {
  signingCalls = [];
  const result = await fetchRealAttachments(["t1", "t2"]);
  assert.equal(signingCalls.length, 1, "N attachments must not cause N signing requests");
  assert.deepEqual(signingCalls[0].paths, ["things/t1/shared.pdf", "things/t2/missing.png"]);
  assert.equal(signingCalls[0].ttl, 3600);
  assert.equal(result.get("t1")[0].url, "https://example.invalid/shared");
  assert.equal(result.get("t2")[0].url, "https://example.invalid/shared");
  assert.equal(result.get("t2")[1].url, undefined);
  assert.match(result.get("t2")[1].urlError, /not found/i);
});
