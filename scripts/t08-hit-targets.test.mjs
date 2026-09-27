import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * D01/T08: shared overlay close buttons and a few audited hand-built
 * controls had a clickable area equal to their icon's bounding box (as
 * small as 16x16px, or content-only ~18px), below the plan's 24x24px
 * absolute minimum (WCAG 2.5.8) and the preferred >=32px desktop minimum,
 * with icon artwork required to stay independent of hit-area size.
 */

const dialog = readFileSync(new URL("../src/components/ui/dialog.tsx", import.meta.url), "utf8");
const sheet = readFileSync(new URL("../src/components/ui/sheet.tsx", import.meta.url), "utf8");
const pdfViewer = readFileSync(new URL("../src/features/things/PDFViewer.tsx", import.meta.url), "utf8");
const courtWithOthers = readFileSync(new URL("../src/features/court/CourtWithOthersSidebar.tsx", import.meta.url), "utf8");
const button = readFileSync(new URL("../src/components/ui/button.tsx", import.meta.url), "utf8");

test("Dialog's close button has a real >=32px hit target, independent of its icon size", () => {
  assert.match(dialog, /DialogPrimitive\.Close className="[^"]*\bh-8 w-8\b/);
  assert.match(dialog, /<X className="h-4 w-4" \/>/, "icon artwork must stay unchanged");
});

test("Sheet's close button has a real >=32px hit target, independent of its icon size", () => {
  assert.match(sheet, /SheetPrimitive\.Close className="[^"]*\bh-8 w-8\b/);
  assert.match(sheet, /<X className="h-4 w-4" \/>/);
});

test("PDFViewer's page-navigation buttons have accessible names and a real >=32px hit target", () => {
  assert.match(pdfViewer, /aria-label="Previous page"/);
  assert.match(pdfViewer, /aria-label="Next page"/);
  const navButtonBlocks = pdfViewer.match(/className="h-8 w-8 flex items-center justify-center rounded hover:bg-\[#eceef5\]/g) ?? [];
  assert.equal(navButtonBlocks.length, 2, "both prev/next buttons must have the >=32px hit target");
});

test("CourtWithOthersSidebar's \"View all\" footer link has a real >=32px desktop hit target", () => {
  assert.match(courtWithOthers, /View all \{theirs\.length\}/);
  assert.match(courtWithOthers, /inline-flex min-h-8 items-center gap-1 text-\[12px\]/);
});

test("Button's touch-target variants exist at the required 44px size, with icon artwork unscaled", () => {
  assert.match(button, /touch:\s*"h-11 px-4 py-2"/);
  assert.match(button, /"icon-touch":\s*"h-11 w-11"/);
  assert.match(button, /\[&_svg\]:size-4/, "icon artwork sizing must be shared/unchanged across size variants");
});
