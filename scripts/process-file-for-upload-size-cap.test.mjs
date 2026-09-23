import assert from "node:assert/strict";
import { test } from "node:test";
import { processFileForUpload, MAX_THING_ATTACHMENT_BYTES } from "@/lib/file-utils";

/**
 * H01: Thing attachments (Magic Box, the comment composer) had no
 * client-side size boundary at all, unlike Hub Files and List chat
 * attachments, which both already enforce a 50MB cap. processFileForUpload
 * is the shared helper both Thing-attachment call sites use.
 */

function makeFile(sizeBytes, name = "test.txt") {
  // A real File instance (Node has one globally) with a genuine `.size`,
  // not a plain object stand-in -- processFileForUpload reads file.size
  // directly.
  const bytes = new Uint8Array(sizeBytes);
  return new File([bytes], name, { type: "text/plain" });
}

test("a file at or under 50MB is accepted", async () => {
  const file = makeFile(MAX_THING_ATTACHMENT_BYTES, "ok.txt");
  const result = await processFileForUpload(file);
  assert.equal(result.name, "ok.txt");
});

test("a file over 50MB is rejected with a clear, specific message", async () => {
  const file = makeFile(MAX_THING_ATTACHMENT_BYTES + 1, "too-big.mp4");
  await assert.rejects(processFileForUpload(file), /too-big\.mp4 is larger than 50 MB\./);
});
