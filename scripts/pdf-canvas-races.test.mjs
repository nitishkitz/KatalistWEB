import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * H02: `PdfCanvas.tsx` statically imports its pdf.js worker via a
 * Vite-only `?url` asset specifier (`pdfjs-dist/build/pdf.worker.min.mjs?url`).
 * Node's `--experimental-test-module-mocks` cannot intercept that specifier
 * through this repo's custom ESM loader chain (confirmed directly: even
 * mocking the exact query-bearing and query-stripped specifiers, the real
 * file still loads and throws `does not provide an export named 'default'`
 * before any test body runs) -- there is no way to mount this component in
 * this test runner today. `t08-hit-targets.test.mjs` and
 * `thing-stack-card-pdf-overview.test.mjs` hit the exact same obstacle for
 * this same file and already use source assertions instead; this follows
 * that established precedent rather than inventing a new one.
 *
 * These assertions verify the actual generation-guard/ownership-check
 * structure the audit's H02 finding required, not just that some code
 * exists -- each regex targets the specific line shape the fix depends on.
 */
const src = readFileSync(new URL("../src/features/things/PdfCanvas.tsx", import.meta.url), "utf8");

test("the loading task itself is retained and destroyed, not only the resolved document", () => {
  assert.match(src, /loadingTaskRef\.current\s*=\s*task/);
  assert.match(src, /loadingTaskRef\.current\?\.\s*destroy\?\.\(\)/);
  // Destroyed on cleanup AND on the "superseded before it resolved" branch,
  // not only one of the two.
  const destroyCalls = src.match(/\.destroy\?\.\(\)/g) ?? [];
  assert.ok(destroyCalls.length >= 3, "loadingTask + doc destroy calls must appear in both the stale-resolution branch and cleanup");
});

test("document load and page render use separate, independently-checked generations", () => {
  assert.match(src, /const docGenRef = useRef\(0\)/);
  assert.match(src, /const renderGenRef = useRef\(0\)/);
  assert.match(src, /const myDocGen = \+\+docGenRef\.current/);
  assert.match(src, /const myRenderGen = \+\+renderGenRef\.current/);
});

test("every await in the load effect rechecks its own generation before touching state/painting", () => {
  // After `await import("pdfjs-dist")`.
  assert.match(src, /await import\("pdfjs-dist"\);\s*\n\s*if \(docGenRef\.current !== myDocGen\) return;/);
  // After `await task.promise` (getDocument resolving).
  assert.match(src, /const doc = await task\.promise;\s*\n\s*if \(docGenRef\.current !== myDocGen\) \{/);
});

test("renderPage rechecks doc/render generation AND canvas/doc identity after its own await, both after getPage and after the render task settles", () => {
  assert.match(src, /const pdfPage = await doc\.getPage\(clamped\);/);
  assert.match(
    src,
    /if \(docGenRef\.current !== ownerDocGen \|\| renderGenRef\.current !== myRenderGen\) return;\s*\n\s*if \(docRef\.current !== doc \|\| canvasRef\.current !== canvas\) return;/,
  );
  assert.match(src, /await task\.promise;\s*\n\s*if \(docGenRef\.current !== ownerDocGen \|\| renderGenRef\.current !== myRenderGen\) return;/);
});

test("a page change that arrives while the document is still loading is honored via a live ref, not the load effect's stale closure value", () => {
  assert.match(src, /const pageRef = useRef\(page\)/);
  assert.match(src, /pageRef\.current = page/);
  assert.match(src, /renderPage\(pageRef\.current, myDocGen\)/);
});

test("cleanup bumps the generation before destroying, so an in-flight continuation cannot mistake itself for still-current", () => {
  assert.match(src, /return \(\) => \{\s*\n\s*docGenRef\.current \+= 1;/);
});

test("failures are classified (unsupported/denied/network), not one generic catch-all, and reported via onError", () => {
  assert.match(src, /export type PdfErrorKind = "unsupported" \| "denied" \| "network"/);
  assert.match(src, /function classifyPdfError/);
  assert.match(src, /"InvalidPDFException"|"MissingPDFException"/);
  assert.match(src, /status === 401 \|\| status === 403/);
  assert.match(src, /onError\?\.\(classifyPdfError\(err\)\)/);
});

test("a manual retry can force a reload of the exact same URL via retryNonce, not only via a changed URL", () => {
  assert.match(src, /retryNonce\?:\s*number/);
  assert.match(src, /\[url, retryNonce\]/);
});
