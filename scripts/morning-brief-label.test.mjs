import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * F03: internal names (CatchUpOverlay, CatchUpBanner, CatchUpStack,
 * CatchUpStackCard, useCatchup, catchup-logic.ts) stay -- only the
 * user-visible label changes from "Catch Up" to "Morning Brief".
 */
const overlay = readFileSync(new URL("../src/features/catchup/CatchUpOverlay.tsx", import.meta.url), "utf8");
const banner = readFileSync(new URL("../src/features/catchup/CatchUpBanner.tsx", import.meta.url), "utf8");

test("the overlay's dialog title reads Morning Brief, not Catch Up", () => {
  assert.match(overlay, />Morning Brief</);
  assert.doesNotMatch(overlay, />Catch Up</);
  // The component/file name itself is unchanged.
  assert.match(overlay, /export function CatchUpOverlay/);
});

test("the banner's visible label reads Morning Brief, not Catch Up", () => {
  assert.match(banner, />Morning Brief</);
  assert.doesNotMatch(banner, />Catch Up</);
  assert.match(banner, /export function CatchUpBanner/);
});
