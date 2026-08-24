import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { validateAttachmentBatch } from "@/features/court/magic-box/useMagicBoxAttachments";
import {
  createFinalizeAttachmentHandler,
  createRemoveAttachmentHandler,
  cleanupStalePendingAttachments,
  createAttachmentCleanupHandler,
} from "@/features/attachments/attachment-api.server";

function fakeFile(name, size) {
  return { name, size, type: "application/pdf" };
}

test("batch limit: 0 existing + 6 selected accepts exactly 5 in selection order", () => {
  const files = [1, 2, 3, 4, 5, 6].map((n) => fakeFile(`f${n}.pdf`, 10));
  const result = validateAttachmentBatch(files, 0);
  assert.equal(result.accepted.length, 5);
  assert.deepEqual(result.accepted.map((f) => f.name), ["f1.pdf", "f2.pdf", "f3.pdf", "f4.pdf", "f5.pdf"]);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].file.name, "f6.pdf");
});

test("batch limit: 4 existing + 3 selected accepts exactly 1", () => {
  const files = ["a", "b", "c"].map((n) => fakeFile(`${n}.pdf`, 10));
  const result = validateAttachmentBatch(files, 4);
  assert.equal(result.accepted.length, 1);
  assert.equal(result.accepted[0].name, "a.pdf");
  assert.equal(result.rejected.length, 2);
});

test("any file above 20 MiB is rejected without consuming a slot", () => {
  const files = [fakeFile("big.pdf", 21 * 1024 * 1024), fakeFile("ok.pdf", 10)];
  const result = validateAttachmentBatch(files, 0);
  assert.equal(result.accepted.map((f) => f.name).join(), "ok.pdf");
  assert.equal(result.rejected[0].file.name, "big.pdf");
});

function makeDeps(overrides = {}) {
  const store = {
    rows: new Map(),
    objects: new Set(),
    adminMoves: 0,
  };
  const deps = {
    getUser: async () => ({ id: "user-1" }),
    attachmentsEnabled: () => true,
    async reserve(input) {
      store.reserveCalls = (store.reserveCalls ?? 0) + 1;
      const existing = [...store.rows.values()].find((r) => r.client_id === input.clientId);
      if (existing) return existing;
      const row = {
        id: "att-1",
        thing_id: input.thingId,
        client_id: input.clientId,
        staging_key: input.stagingKey,
        storage_key: `things/${input.thingId}/att-1/${input.fileName}`,
        file_name: input.fileName,
        mime_type: input.mimeType,
        byte_size: 12,
        status: "pending",
      };
      store.rows.set(row.id, row);
      return row;
    },
    async complete(id, key) {
      if (!store.objects.has(key)) throw new Error("attachment missing");
      const row = store.rows.get(id);
      row.status = "ready";
      row.storage_key = key;
      return row;
    },
    async abandon(input) {
      for (const [id, row] of store.rows) {
        if (row.client_id === input.clientId && row.staging_key === input.stagingKey && row.status === "pending") {
          store.rows.delete(id);
        }
      }
    },
    async storageMove(from, to) {
      store.adminMoves += 1;
      if (store.objects.has(to) && !store.objects.has(from)) return { ok: false, missingSource: true };
      if (!store.objects.has(from)) return { ok: false, missingSource: true };
      store.objects.delete(from);
      store.objects.add(to);
      return { ok: true };
    },
    async storageExists(key) {
      return store.objects.has(key);
    },
    async storageRemove(key) {
      store.objects.delete(key);
    },
    ...overrides,
  };
  return { deps, store };
}

function jsonRequest(url, body, user = "user-1") {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${user}` },
    body: JSON.stringify(body),
  });
}

const payload = {
  thingId: "thing-1",
  clientId: "11111111-1111-1111-1111-111111111111",
  stagingKey: "staging/user-1/11111111-1111-1111-1111-111111111111/brief.pdf",
  fileName: "brief.pdf",
  mimeType: "application/pdf",
};

test("attachment saga: authenticated reserve -> move -> complete -> 200 ready", async () => {
  const { deps, store } = makeDeps();
  store.objects.add(payload.stagingKey);
  const handler = createFinalizeAttachmentHandler(deps);
  const res = await handler(jsonRequest("https://x/finalize", payload));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.status, "ready");
  assert.equal(json.attachmentId, "att-1");
});

test("attachment saga: duplicate identical request returns the same attachment ID", async () => {
  const { deps, store } = makeDeps();
  store.objects.add(payload.stagingKey);
  const handler = createFinalizeAttachmentHandler(deps);
  const first = await (await handler(jsonRequest("https://x/finalize", payload))).json();
  store.objects.add(`things/${payload.thingId}/att-1/${payload.fileName}`);
  const second = await (await handler(jsonRequest("https://x/finalize", payload))).json();
  assert.equal(first.attachmentId, second.attachmentId);
});

test("attachment saga: source missing + destination present completes as ready", async () => {
  const { deps, store } = makeDeps();
  store.objects.add(`things/${payload.thingId}/att-1/${payload.fileName}`);
  const handler = createFinalizeAttachmentHandler(deps);
  const res = await handler(jsonRequest("https://x/finalize", payload));
  assert.equal(res.status, 200);
});

test("attachment saga: move failure is 503 retryable and row remains pending", async () => {
  const { deps, store } = makeDeps({
    storageMove: async () => ({ ok: false, missingSource: false }),
  });
  store.objects.add(payload.stagingKey);
  const handler = createFinalizeAttachmentHandler(deps);
  const res = await handler(jsonRequest("https://x/finalize", payload));
  assert.equal(res.status, 503);
  assert.equal([...store.rows.values()][0].status, "pending");
});

test("attachment saga: unauthorized Thing does not call admin storage", async () => {
  let moves = 0;
  const { deps } = makeDeps({
    reserve: async () => {
      throw new Error("Thing not found");
    },
    storageMove: async () => {
      moves += 1;
      return { ok: true };
    },
  });
  const handler = createFinalizeAttachmentHandler(deps);
  const res = await handler(jsonRequest("https://x/finalize", payload));
  assert.equal(res.status, 404);
  assert.equal(moves, 0);
});

test("attachment saga: spoofed user prefix is 400 without admin storage", async () => {
  let moves = 0;
  const { deps } = makeDeps({
    storageMove: async () => {
      moves += 1;
      return { ok: true };
    },
  });
  const handler = createFinalizeAttachmentHandler(deps);
  const res = await handler(
    jsonRequest("https://x/finalize", { ...payload, stagingKey: "staging/other/11111111-1111-1111-1111-111111111111/x.pdf" }),
  );
  assert.equal(res.status, 400);
  assert.equal(moves, 0);
});

test("attachment saga: sixth attachment is 409", async () => {
  const { deps } = makeDeps({
    reserve: async () => {
      throw new Error("attachment limit");
    },
  });
  const handler = createFinalizeAttachmentHandler(deps);
  const res = await handler(jsonRequest("https://x/finalize", payload));
  assert.equal(res.status, 409);
});

test("SQL saga never writes storage.objects", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20260824122123_magic_box_attachment_saga.sql", import.meta.url), "utf8");
  assert.equal(/INSERT\s+INTO\s+storage\.objects/i.test(sql), false);
  assert.equal(/UPDATE\s+storage\.objects/i.test(sql), false);
  assert.equal(/DELETE\s+FROM\s+storage\.objects/i.test(sql), false);
  assert.match(sql, /can_view_thing/);
  assert.match(sql, /20971520/);
  assert.match(sql, /attachment too large/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /FROM storage\.objects o/);
  assert.match(sql, /p_thing_id uuid/);
  assert.match(sql, /p_client_id uuid/);
  assert.match(sql, /p_staging_key text/);
});

test("unsafe unapplied attachment migration was replaced", () => {
  assert.equal(
    existsSync(new URL("../supabase/migrations/20260824114500_thing_attachments.sql", import.meta.url)),
    false,
  );
});

test("attachment saga: actual 21 MiB object is rejected before admin storage", async () => {
  let moves = 0;
  const { deps } = makeDeps({
    reserve: async () => {
      throw new Error("attachment too large");
    },
    storageMove: async () => {
      moves += 1;
      return { ok: true };
    },
  });
  const handler = createFinalizeAttachmentHandler(deps);
  const res = await handler(jsonRequest("https://x/finalize", payload));
  assert.equal(res.status, 400);
  assert.equal(moves, 0);
});

test("MB-015 remove handler deletes staging bytes and pending rows without attachmentId", async () => {
  const { deps, store } = makeDeps();
  store.objects.add(payload.stagingKey);
  store.rows.set("att-1", {
    id: "att-1",
    status: "pending",
    client_id: payload.clientId,
    staging_key: payload.stagingKey,
    thing_id: payload.thingId,
  });
  const handler = createRemoveAttachmentHandler(deps);
  const body = { thingId: payload.thingId, clientId: payload.clientId, stagingKey: payload.stagingKey };
  const res = await handler(jsonRequest("https://x/remove", body));
  assert.equal(res.status, 200);
  assert.equal(store.objects.has(payload.stagingKey), false);
  assert.equal(store.rows.has("att-1"), false);
  const again = await handler(jsonRequest("https://x/remove", body));
  assert.equal(again.status, 200);
});

test("stale pending cleanup removes staging bytes without logging identities", async () => {
  const removed = [];
  const result = await cleanupStalePendingAttachments({
    listStale: async () => [{ id: "att-old", staging_key: "staging/user-1/c1/brief.pdf" }],
    storageRemove: async (key) => {
      removed.push(key);
    },
    abandon: async () => undefined,
  });
  assert.equal(result.removed, 1);
  assert.equal(result.processed, 1);
  assert.equal(result.failed, 0);
  assert.deepEqual(removed, ["staging/user-1/c1/brief.pdf"]);
  assert.equal(JSON.stringify(result).includes("user-1"), false);
});

test("direct completion without destination object is rejected and row stays pending", async () => {
  const { deps, store } = makeDeps({
    storageMove: async () => ({ ok: true }),
  });
  store.objects.add(payload.stagingKey);
  const handler = createFinalizeAttachmentHandler(deps);
  const res = await handler(jsonRequest("https://x/finalize", payload));
  assert.equal(res.status, 400);
  assert.equal([...store.rows.values()][0].status, "pending");
});

test("repeated Retry of a pending finalize is idempotent once destination exists", async () => {
  const { deps, store } = makeDeps();
  store.objects.add(payload.stagingKey);
  const handler = createFinalizeAttachmentHandler(deps);
  const first = await handler(jsonRequest("https://x/finalize", payload));
  assert.equal(first.status, 200);
  const second = await handler(jsonRequest("https://x/finalize", payload));
  assert.equal(second.status, 200);
  const json = await second.json();
  assert.equal(json.attachmentId, "att-1");
});

test("five-file capacity is restored immediately after Remove", () => {
  const files = [1, 2, 3, 4, 5, 6].map((n) => fakeFile(`f${n}.pdf`, 10));
  const first = validateAttachmentBatch(files, 0);
  assert.equal(first.accepted.length, 5);
  const afterRemove = validateAttachmentBatch([files[5]], 4);
  assert.equal(afterRemove.accepted.length, 1);
  assert.equal(afterRemove.accepted[0].name, "f6.pdf");
});

test("SQL complete verifies the final storage object before ready", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20260824122123_magic_box_attachment_saga.sql", import.meta.url), "utf8");
  assert.match(sql, /bucket_id = 'thing-attachments'/);
  assert.match(sql, /RAISE EXCEPTION 'attachment missing'/);
  assert.equal(sql.includes("INSERT INTO storage.objects"), false);
});

test("attachment flag off returns 404 without storage work", async () => {
  let moves = 0;
  const { deps } = makeDeps({
    attachmentsEnabled: () => false,
    storageMove: async () => {
      moves += 1;
      return { ok: true };
    },
  });
  const handler = createFinalizeAttachmentHandler(deps);
  const res = await handler(jsonRequest("https://x/finalize", payload));
  assert.equal(res.status, 404);
  assert.equal(moves, 0);
});

test("cleanup authentication failure makes zero database/Storage calls", async () => {
  let listed = 0;
  const handler = createAttachmentCleanupHandler({
    secret: "cleanup-secret",
    deps: {
      listStale: async () => {
        listed += 1;
        return [];
      },
      storageRemove: async () => undefined,
      abandon: async () => undefined,
    },
  });
  const res = await handler(new Request("https://x/cleanup", { method: "POST" }));
  assert.equal(res.status, 401);
  assert.equal(listed, 0);
});

test("one cleanup failure does not stop remaining stale rows", async () => {
  const removed = [];
  const result = await cleanupStalePendingAttachments({
    listStale: async () => [
      { id: "a1", staging_key: "staging/u/c1/one.pdf" },
      { id: "a2", staging_key: "staging/u/c2/two.pdf" },
    ],
    storageRemove: async (key) => {
      if (key.endsWith("one.pdf")) throw new Error("storage");
      removed.push(key);
    },
    abandon: async () => undefined,
  });
  assert.equal(result.processed, 2);
  assert.equal(result.removed, 1);
  assert.equal(result.failed, 1);
  assert.deepEqual(removed, ["staging/u/c2/two.pdf"]);
});

test("attachment flag source: UI and server flags default off in env example", () => {
  const envExample = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
  const composer = readFileSync(new URL("../src/features/court/magic-box/MagicBoxComposer.tsx", import.meta.url), "utf8");
  const netlify = readFileSync(new URL("../netlify.toml", import.meta.url), "utf8");
  assert.match(envExample, /VITE_MAGIC_BOX_ATTACHMENTS_ENABLED=false/);
  assert.match(envExample, /MAGIC_BOX_ATTACHMENTS_ENABLED=false/);
  assert.match(composer, /attachmentsUiEnabled\(\)/);
  assert.match(netlify, /VITE_MAGIC_BOX_ATTACHMENTS_ENABLED = "false"/);
});
