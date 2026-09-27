import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * T15/E-02: T08's browser verification found that at 200% zoom, Court's
 * NOW/NEXT/LATER lane headers clip mid-character ("NOW" -> "NO") instead
 * of reflowing or truncating with an ellipsis -- the lane section's own
 * ancestor has `overflow-hidden` (for the drag/scroll boundary), and the
 * header/descriptor text had no `truncate` of its own, so the ancestor's
 * hard overflow boundary cut it off instead. T08 named this and explicitly
 * assigned it to T09, which never revisited it (confirmed: T09's full
 * ledger section contains no mention of zoom/reflow at all).
 */
const src = readFileSync(new URL("../src/features/court/CourtLaneStack.tsx", import.meta.url), "utf8");

test("the lane heading (NOW/NEXT/LATER) truncates gracefully instead of being clipped by the section's overflow-hidden ancestor", () => {
  assert.match(
    src,
    /className="min-w-0 truncate text-\[20px\] font-medium uppercase leading-none tracking-tight/,
  );
});

test("the lane descriptor text also truncates, and the count badge is shrink-0 so it never gets squeezed out first", () => {
  assert.match(src, /className="mt-1 min-w-0 truncate text-\[12px\] font-normal leading-none text-black\/75"/);
  assert.match(src, /className="shrink-0 text-\[13px\] font-medium leading-none"/);
});
