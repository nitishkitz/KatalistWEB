import assert from "node:assert/strict";
import { test } from "node:test";
import { correctCommonTypos } from "../src/features/court/correct-common-typos.ts";

test("corrects document typos and retains case", () => {
  assert.equal(correctCommonTypos("Rohit get documnts and douncments"), "Rohit get documents and documents");
  assert.equal(correctCommonTypos("Documnets DOCUMENTS DOCUMNTS"), "Documents DOCUMENTS DOCUMENTS");
});
test("preserves people, technical identifiers and links", () => {
  const text = "roht @documnts #documnts documnts.pdf documnts_backup https://example.com?q=documnts documnts@example.com";
  assert.equal(correctCommonTypos(text), text);
});
