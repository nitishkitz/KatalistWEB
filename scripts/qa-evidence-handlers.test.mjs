import assert from "node:assert/strict";
import { mock, test, beforeEach } from "node:test";
import { pathToFileURL } from "node:url";
import path from "node:path";

/** Evidence endpoints with scripted collaborators: authorisation order, orphan cleanup and signing scope. */
const root = path.resolve(import.meta.dirname, "..");
const href = (p) => pathToFileURL(path.join(root, p)).href;
const ATT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EV1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EV2 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const KEY1 = "qa/list/att/" + EV1;
const KEY2 = "qa/other-list/att/" + EV2;

let world;
const reset = () => {
  world = { beginResult: { data: { id: EV1, storage_key: KEY1 }, error: null }, rpcs: [], visibleRows: [], pendingRow: null, listed: [], signed: [], removed: [], uploadSign: { data: { token: "t" }, error: null }, finalizeResult: { data: {}, error: null }, headers: {}, deletedIds: [] };
};

mock.module("h3", {
  namedExports: {
    defineEventHandler: (fn) => fn,
    readBody: async (e) => e.body,
    getHeader: (e, n) => e.headers?.[n],
    setResponseHeader: (_e, n, v) => (world.headers[n] = v),
    createError: (o) => Object.assign(new Error(o.message), o),
  },
});
mock.module(href("server/lib/require-user.ts"), {
  namedExports: {
    requireUser: async () => ({
      userId: "u",
      client: {
        rpc: async (name, args) => {
          world.rpcs.push([name, args]);
          if (name === "qa_begin_evidence") return world.beginResult;
          if (name === "qa_finalize_evidence") return world.finalizeResult;
          return { data: KEY1, error: null };
        },
        from: () => {
          const q = { _ids: null };
          q.select = () => q;
          q.eq = () => q;
          q.in = (_c, ids) => ((q._ids = ids), Promise.resolve({ data: world.visibleRows.filter((r) => ids.includes(r.id)), error: null }));
          q.maybeSingle = async () => ({ data: world.pendingRow, error: null });
          return q;
        },
      },
    }),
  },
});
mock.module(href("server/lib/supabase-admin.ts"), {
  namedExports: {
    getSupabaseAdmin: () => ({
      rpc: async (name, args) => {
        world.rpcs.push([name, args]);
        if (name === "qa_finalize_evidence") return world.finalizeResult;
        return { data: world.stale ?? [], error: null };
      },
      from: () => ({ delete: () => ({ in: (_column, ids) => ({ eq: async () => (world.deletedIds.push(...ids), { error: world.deleteError ?? null }) }) }) }),
      storage: {
        from: () => ({
          createSignedUploadUrl: async () => world.uploadSign,
          list: async () => ({ data: world.listed, error: null }),
          remove: async (keys) => (world.removed.push(...keys), { error: world.removeError ?? null }),
          createSignedUrls: async (keys) => ((world.signed = keys), { data: keys.map((k) => ({ path: k, signedUrl: `https://signed.example.test/${k}` })), error: null }),
        }),
      },
    }),
  },
});

const begin = (await import("../server/api/qa/evidence/begin.post.ts")).default;
const finalize = (await import("../server/api/qa/evidence/finalize.post.ts")).default;
const sign = (await import("../server/api/qa/evidence/sign.post.ts")).default;
const cleanup = (await import("../server/api/qa/evidence/cleanup.post.ts")).default;
const call = async (h, body, headers = {}) => { try { return { ok: await h({ body, headers }) }; } catch (e) { return { err: e }; } };
beforeEach(reset);

test("begin hands out a one-object upload token only after the database authorises the attempt", async () => {
  const r = await call(begin, { attemptId: ATT, fileName: "a.png", mimeType: "image/png", sizeBytes: 10 });
  assert.equal(r.ok.path, KEY1);
  assert.equal(r.ok.token, "t");
  assert.match(world.headers["Cache-Control"], /no-store/);
  assert.equal(world.rpcs[0][0], "qa_begin_evidence");
});

test("begin returns the database's denial and never signs anything for a viewer or another List", async () => {
  world.beginResult = { data: null, error: { code: "42501", message: "You don't have permission to manage QA in this List." } };
  const r = await call(begin, { attemptId: ATT, fileName: "a.png", mimeType: "image/png", sizeBytes: 10 });
  assert.equal(r.err.statusCode, 403);
  assert.equal(world.rpcs.length, 1);
});

test("begin aborts the pending row when the storage token cannot be minted", async () => {
  world.uploadSign = { data: null, error: { message: "down" } };
  const r = await call(begin, { attemptId: ATT, fileName: "a.png", mimeType: "image/png", sizeBytes: 10 });
  assert.equal(r.err.statusCode, 502);
  assert.ok(world.rpcs.some(([n]) => n === "qa_abort_evidence"));
});

test("finalize aborts and removes the object when the stored size does not match the declared size", async () => {
  world.pendingRow = { id: EV1, storage_key: KEY1, size_bytes: 100, status: "pending", created_by: "u" };
  world.listed = [{ name: EV1, metadata: { size: 99 } }];
  const r = await call(finalize, { evidenceId: EV1 });
  assert.equal(r.err.statusCode, 422);
  assert.equal(r.err.data.code, "upload_incomplete");
  assert.ok(world.rpcs.some(([n]) => n === "qa_abort_evidence"));
  assert.deepEqual(world.removed, [KEY1]);
});

test("finalize aborts when nothing was uploaded, and finalizes when size matches", async () => {
  world.pendingRow = { id: EV1, storage_key: KEY1, size_bytes: 100, status: "pending", created_by: "u" };
  world.listed = [];
  assert.equal((await call(finalize, { evidenceId: EV1 })).err.statusCode, 422);
  reset();
  world.pendingRow = { id: EV1, storage_key: KEY1, size_bytes: 100, status: "pending", created_by: "u" };
  world.listed = [{ name: EV1, metadata: { size: 100 } }];
  assert.equal((await call(finalize, { evidenceId: EV1 })).ok.status, "ready");
});

test("sign only signs rows the caller's RLS-scoped read returns; unknown ids and paths are ignored", async () => {
  world.visibleRows = [{ id: EV1, storage_key: KEY1 }]; // EV2 belongs to a List the caller cannot see
  const r = await call(sign, { evidenceIds: [EV1, EV2, "../../etc/passwd", KEY2] });
  assert.deepEqual(world.signed, [KEY1]);
  assert.deepEqual(Object.keys(r.ok.urls), [EV1]);
  assert.match(world.headers["Cache-Control"], /no-store/);
  assert.deepEqual((await call(sign, { evidenceIds: [] })).ok, { urls: {} });
});

test("the orphan sweep needs the cron secret", async () => {
  process.env.CRON_SECRET = "cron-secret-for-test";
  assert.equal((await call(cleanup, {}, {})).err.statusCode, 401);
  assert.equal((await call(cleanup, {}, { authorization: "Bearer wrong" })).err.statusCode, 401);
  world.stale = [{ id: EV1, storage_key: KEY1 }];
  const r = await call(cleanup, {}, { authorization: "Bearer cron-secret-for-test" });
  assert.equal(r.ok.removed, 1);
  assert.deepEqual(world.removed, [KEY1]);
  delete process.env.CRON_SECRET;
});


test("finalization rejects another uploader before touching storage", async () => {
  world.pendingRow = { id: EV1, storage_key: KEY1, size_bytes: 100, status: "pending", created_by: "other" };
  assert.equal((await call(finalize, { evidenceId: EV1 })).err.statusCode, 403);
  assert.deepEqual(world.removed, []);
  assert.equal(world.rpcs.length, 0);
});

test("verified finalization passes the authenticated actor to the server-only RPC", async () => {
  world.pendingRow = { id: EV1, storage_key: KEY1, size_bytes: 100, status: "pending", created_by: "u" };
  world.listed = [{ name: EV1, metadata: { size: 100 } }];
  assert.equal((await call(finalize, { evidenceId: EV1 })).ok.status, "ready");
  assert.deepEqual(world.rpcs.find(([n]) => n === "qa_finalize_evidence"), ["qa_finalize_evidence", { p_evidence_id: EV1, p_actor_id: "u" }]);
});


test("cleanup retains pending references and reports failure when object removal fails", async () => {
  process.env.CRON_SECRET = "cron-secret-for-test";
  try {
    world.stale = [{ id: EV1, storage_key: KEY1 }];
    world.removeError = { message: "storage down" };
    const r = await call(cleanup, {}, { authorization: "Bearer cron-secret-for-test" });
    assert.equal(r.err.statusCode, 502);
    assert.deepEqual(world.deletedIds, []);
  } finally { delete process.env.CRON_SECRET; }
});
