import assert from "node:assert/strict";
import { test } from "node:test";
import { getClipboardFiles } from "@/lib/file-utils";

test("clipboard extraction prefers the canonical file list over duplicate item representations", () => {
  const image = { name: "image.png" };
  const duplicateImageRepresentation = { name: "image.png" };
  const clipboard = {
    files: [image],
    items: [
      { kind: "string", getAsFile: () => null },
      { kind: "file", getAsFile: () => duplicateImageRepresentation },
    ],
  };

  assert.deepEqual(getClipboardFiles(clipboard), [image]);
});

test("clipboard extraction supports file items when DataTransfer.files is empty", () => {
  const document = { name: "notes.docx" };
  assert.deepEqual(
    getClipboardFiles({ files: [], items: [{ kind: "file", getAsFile: () => document }] }),
    [document],
  );
});

test("ordinary text clipboard content does not become a file attachment", () => {
  assert.deepEqual(
    getClipboardFiles({ files: [], items: [{ kind: "string", getAsFile: () => null }] }),
    [],
  );
});
