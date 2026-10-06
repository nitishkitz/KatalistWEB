import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const detail = readFileSync(
  new URL("../src/features/things/ThingDetailContent.tsx", import.meta.url),
  "utf8",
);
const attachments = readFileSync(
  new URL("../src/features/things/components/ThingAttachments.tsx", import.meta.url),
  "utf8",
);

test("Thing-detail uploads expose persistent progress without auto-opening the uploaded file", () => {
  assert.match(detail, /setThingUploadStatus\(\{/);
  assert.match(detail, /uploadStatus=\{/);
  assert.doesNotMatch(
    detail,
    /if \(isEpochCurrent\(qc, uploadEpoch\)\) \{\s*onFileSelect\?\.\(processed\)/,
  );
  assert.match(attachments, /role="status"/);
  assert.match(attachments, /Uploading \{uploadStatus\.fileName\}/);
  assert.match(attachments, /\{uploadStatus\.current\} of \{uploadStatus\.total\}/);
  assert.match(attachments, /disabled=\{Boolean\(uploadStatus\)\}/);
});
