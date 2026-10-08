import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COVER_MAX_BYTES,
  coverStorageKey,
  removeDesignCover,
  replaceDesignCover,
  validateCoverFile,
} from "@/features/designs/covers";
import { DesignOperationError } from "@/features/designs/design-queries";

const LIST = "10000000-0000-0000-0000-000000000001";
const RES = "30000000-0000-0000-0000-000000000001";
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const WEBP = Uint8Array.from([..."RIFF"].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [..."WEBP"].map((c) => c.charCodeAt(0))));
const GIF = Uint8Array.from([..."GIF89a"].map((c) => c.charCodeAt(0)));
const file = (name, type, size = 1000) => ({ name, type, size });

test("covers: PNG, JPEG and WebP pass only when type, size and real signature agree", () => {
  assert.deepEqual(validateCoverFile(file("a.png", "image/png"), PNG), { ok: true, ext: "png", mime: "image/png" });
  assert.deepEqual(validateCoverFile(file("a.jpg", "image/jpeg"), JPG), { ok: true, ext: "jpg", mime: "image/jpeg" });
  assert.deepEqual(validateCoverFile(file("a.webp", "image/webp"), WEBP), { ok: true, ext: "webp", mime: "image/webp" });
  const refused = (f, head) => { const r = validateCoverFile(f, head); assert.equal(r.ok, false); return r.message; };
  assert.match(refused(file("a.gif", "image/gif"), GIF), /PNG, JPEG or WebP/);
  assert.match(refused(file("a.svg", "image/svg+xml"), PNG), /PNG, JPEG or WebP/);
  assert.match(refused(file("a.png", "image/png"), GIF), /does not look like/);
  assert.match(refused(file("fake.png", "image/png"), JPG), /not really a PNG/);
  assert.match(refused(file("a.png", "image/png", 0), PNG), /empty/);
  assert.match(refused(file("big.png", "image/png", COVER_MAX_BYTES + 1), PNG), /larger than 5 MB/);
  assert.equal(validateCoverFile(file("edge.png", "image/png", COVER_MAX_BYTES), PNG).ok, true);
  assert.equal(validateCoverFile(file("", "", 10), PNG).ok, false);
});

test("covers: storage keys are scoped to the design and never reuse a name", () => {
  assert.equal(coverStorageKey(LIST, RES, "u-1", "png"), `${LIST}/${RES}/u-1.png`);
  assert.notEqual(coverStorageKey(LIST, RES, "u-1", "png"), coverStorageKey(LIST, RES, "u-2", "png"));
});

function deps(overrides = {}) {
  const calls = [];
  let n = 0;
  return {
    calls,
    upload: async (k, f, t) => { calls.push(["upload", k, t]); if (overrides.upload) throw overrides.upload; },
    remove: async (keys) => { calls.push(["remove", ...keys]); if (overrides.remove) throw overrides.remove; },
    setCover: async (id, k) => { calls.push(["setCover", id, k]); if (overrides.setCover) throw overrides.setCover; return overrides.previous ?? null; },
    clearCover: async (id) => { calls.push(["clearCover", id]); if (overrides.clear) throw overrides.clear; return overrides.previous ?? null; },
    newId: () => `id-${++n}`,
  };
}
const input = { listId: LIST, resourceId: RES, file: file("a.png", "image/png"), head: PNG };

test("covers: success uploads, associates, then deletes the replaced object", async () => {
  const d = deps({ previous: `${LIST}/${RES}/old.png` });
  const out = await replaceDesignCover(input, d);
  assert.deepEqual(out, { orphanedKey: null });
  assert.deepEqual(d.calls, [
    ["upload", `${LIST}/${RES}/id-1.png`, "image/png"],
    ["setCover", RES, `${LIST}/${RES}/id-1.png`],
    ["remove", `${LIST}/${RES}/old.png`],
  ]);
});

test("covers: an invalid file never reaches storage", async () => {
  const d = deps();
  await assert.rejects(replaceDesignCover({ ...input, head: GIF }, d), (e) => e instanceof DesignOperationError && e.code === "invalid_input");
  assert.deepEqual(d.calls, []);
});

test("covers: an upload failure changes nothing and is not reported as success", async () => {
  const d = deps({ upload: new DesignOperationError("unknown", "boom") });
  await assert.rejects(replaceDesignCover(input, d), /boom/);
  assert.deepEqual(d.calls.map((c) => c[0]), ["upload"], "no association and no deletion was attempted");
});

test("covers: if association fails the uploaded object is removed and the error surfaces", async () => {
  const d = deps({ setCover: new DesignOperationError("forbidden", "denied"), previous: "never-used" });
  await assert.rejects(replaceDesignCover(input, d), /denied/);
  assert.deepEqual(d.calls.map((c) => c[0]), ["upload", "setCover", "remove"]);
  assert.deepEqual(d.calls[2], ["remove", `${LIST}/${RES}/id-1.png`], "only the new object is cleaned up, never the previous cover");
});

test("covers: a failed cleanup after a failed association does not mask the original error", async () => {
  const d = deps({ setCover: new DesignOperationError("forbidden", "denied"), remove: new Error("cleanup failed") });
  await assert.rejects(replaceDesignCover(input, d), /denied/);
});

test("covers: failing to delete the replaced object keeps the new cover and reports the orphan", async () => {
  const d = deps({ previous: `${LIST}/${RES}/old.png`, remove: new Error("nope") });
  assert.deepEqual(await replaceDesignCover(input, d), { orphanedKey: `${LIST}/${RES}/old.png` });
});

test("covers: removal returns the previous key, cleans up, and reports an orphan if cleanup fails", async () => {
  const d = deps({ previous: `${LIST}/${RES}/old.png` });
  assert.deepEqual(await removeDesignCover(RES, d), { orphanedKey: null });
  assert.deepEqual(d.calls, [["clearCover", RES], ["remove", `${LIST}/${RES}/old.png`]]);
  const failing = deps({ previous: "k", remove: new Error("x") });
  assert.deepEqual(await removeDesignCover(RES, failing), { orphanedKey: "k" });
  const none = deps();
  assert.deepEqual(await removeDesignCover(RES, none), { orphanedKey: null });
  assert.deepEqual(none.calls, [["clearCover", RES]]);
  await assert.rejects(removeDesignCover(RES, deps({ clear: new DesignOperationError("forbidden", "denied") })), /denied/);
});
