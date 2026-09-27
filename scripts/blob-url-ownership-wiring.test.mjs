import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * H04: `owned-file-resources.ts` (see owned-file-resources.test.mjs for its
 * own full behavioral coverage) is only useful once real consumers
 * actually call it. This confirms MagicBox.tsx and ThingDetailContent.tsx
 * -- the only two `processFileForUpload` callers in the app -- acquire on
 * attach and release on remove, matching the module's own contract (owner
 * key scoped to the draft slot, not component mount lifecycle, so a
 * retained draft's preview survives an unmount).
 */
const magicBox = readFileSync(new URL("../src/features/court/MagicBox.tsx", import.meta.url), "utf8");
const thingDetail = readFileSync(new URL("../src/features/things/ThingDetailContent.tsx", import.meta.url), "utf8");

test("MagicBox acquires a processed file's blob URL under its draft-slot owner key, scoped to the draft not the component instance", () => {
  assert.match(magicBox, /import \{ acquireBlobUrl, releaseBlobUrl, releaseAllBlobUrlsForOwner \} from "@\/lib\/owned-file-resources"/);
  assert.match(magicBox, /const fileOwnerKey = `magic-box:\$\{draftEntityId\}`/);
  assert.match(magicBox, /acquireBlobUrl\(processed\.url, fileOwnerKey\)/);
});

test("MagicBox releases a removed attachment's blob URL, and releases everything on a fully successful Toss", () => {
  assert.match(magicBox, /const removed = prev\.find\(\(f\) => f\.id === fileId\);\s*\n\s*if \(removed\) releaseBlobUrl\(removed\.url, fileOwnerKey\);/);
  assert.match(magicBox, /releaseAllBlobUrlsForOwner\(fileOwnerKey\)/);
});

test("MagicBox does NOT release on mere destination switch -- a retained draft's preview must survive it", () => {
  // The re-hydrate effect (keyed on draftEntityId) must reset local state
  // without calling any release function.
  const rehydrateEffect = magicBox.match(/const draft = getDraft[\s\S]*?\}, \[draftEntityId, qc\]\);/);
  assert.ok(rehydrateEffect, "the destination re-hydrate effect must exist");
  assert.doesNotMatch(rehydrateEffect[0], /releaseBlobUrl|releaseAllBlobUrlsForOwner/);
});

test("ThingDetailContent acquires processed comment-attachment blob URLs under a per-Thing owner key, on both the live-state and direct-draft-write branches", () => {
  assert.match(thingDetail, /import \{ acquireBlobUrl, releaseBlobUrl \} from "@\/lib\/owned-file-resources"/);
  assert.match(thingDetail, /for \(const f of newFiles\) acquireBlobUrl\(f\.url, `thing-comment:\$\{targetThingId\}`\)/);
});

test("ThingDetailContent releases a removed comment attachment's blob URL", () => {
  assert.match(
    thingDetail,
    /const removed = prev\.find\(\(f\) => f\.id === id\);\s*\n\s*if \(removed && thing\?\.id\) releaseBlobUrl\(removed\.url, `thing-comment:\$\{thing\.id\}`\);/,
  );
});
