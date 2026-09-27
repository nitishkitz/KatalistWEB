import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * H04: PDFViewer.tsx sent every DOCX/XLSX/other remote file's URL straight
 * to Office Online / Google Docs Viewer -- both public third-party
 * services -- with no check for whether that URL is a private Supabase
 * signed URL. H03: distinct PDF failure states/one-shot resign, and
 * per-file download pending/failure/retry state.
 *
 * PDFViewer.tsx statically imports PdfCanvas.tsx, which has the same
 * unmockable Vite `?url` worker import documented in
 * pdf-canvas-races.test.mjs -- this file uses source assertions for the
 * same reason and against the same established precedent.
 */
const src = readFileSync(new URL("../src/features/things/PDFViewer.tsx", import.meta.url), "utf8");

test("a private (signed) URL is never sent to the Office Online or Google Docs third-party embed", () => {
  assert.match(src, /function isPrivateFileUrl/);
  assert.match(src, /!url\.includes\("\/object\/public\/"\)/);
  assert.match(
    src,
    /\(isDoc \|\| isExcel\) && isRemoteUrl\(file\.url\) && !isPrivateFileUrl\(file\.url\)/,
    "the Office Online branch must require proof of public-ness, not just isRemoteUrl",
  );
  assert.match(
    src,
    /isRemoteUrl\(file\.url\) && !isImage && !isVideo && !isPrivateFileUrl\(file\.url\)/,
    "the Google Docs Viewer branch must require proof of public-ness, not just isRemoteUrl",
  );
});

test("downloadFile is awaited with per-file pending/failed/retry state, not fired-and-forgotten", () => {
  assert.match(src, /await downloadFile\(file\)/);
  assert.match(src, /setDownloadState\(\{ fileId: file\.id, status: "pending" \}\)/);
  assert.match(src, /setDownloadState\(\{ fileId: file\.id, status: "failed" \}\)/);
  assert.match(src, /const currentDownloadState = downloadState\?\.fileId === file\.id \? downloadState\.status : null/);
});

test("switching the previewed file clears stale download/PDF-error/resign state", () => {
  assert.match(src, /}, \[file\.id\]\);/);
  assert.match(src, /setDownloadState\(null\);\s*\n\s*setPdfError\(null\);\s*\n\s*setResignedUrl\(null\);/);
});

test("a PDF failure is classified into distinct denied/unsupported/network UI, and denied never gets a retry", () => {
  assert.match(src, /currentPdfError === "denied"/);
  assert.match(src, /currentPdfError === "unsupported"/);
  assert.match(src, /currentPdfError === "network"/);
  assert.match(src, /stays denied — a refreshed link won't change that/);
  // The denied branch's own JSX block must not contain a Retry button.
  const deniedBlockMatch = src.match(/currentPdfError === "denied" \? \(([\s\S]*?)\) : isPdf && file\.url && currentPdfError === "unsupported"/);
  assert.ok(deniedBlockMatch, "the denied branch must exist and be followed by the unsupported branch");
  assert.doesNotMatch(deniedBlockMatch[1], /Retry/i);
});

test("an expired/unsupported signed URL gets exactly one resign-and-retry through the authorized owner-aware lookup, gated by file.storageKey", () => {
  assert.match(src, /import \{ resignThingAttachmentUrl \} from "\.\/attachments"/);
  assert.match(src, /if \(kind === "unsupported" && file\.storageKey && !resignAttempted\)/);
  assert.match(src, /setResignAttempted\(true\)/);
  assert.match(src, /const fresh = await resignThingAttachmentUrl\(file\.storageKey\)/);
});
