import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { contrastRatio, oklchLuminance, WCAG_AA_NORMAL_TEXT, WCAG_AA_LARGE_TEXT, WCAG_AA_UI_COMPONENT } from "./lib/color-contrast.mjs";
import { extractTokens } from "./measure-palette-contrast.mjs";

/**
 * D03/T08: "measure palette/role contrast and store results" -- this
 * asserts the actual numeric ratios computed from src/styles.css's OKLCH
 * tokens (see scripts/measure-palette-contrast.mjs and
 * docs/superpowers/plans/2026-09-25-t08-palette-contrast.md), so a future
 * token edit that silently breaks contrast fails the suite instead of only
 * a report file going stale.
 *
 * All four previously-measured failures (destructive label, "Waiting"
 * status label, and the input/control boundary) were fixed by darkening
 * --destructive, --status-waiting, and introducing --control-border (with
 * --input pointed at the same passing value) -- see styles.css's own
 * comments at each token for the exact before/after ratios. --border
 * itself is deliberately unchanged: it is a decorative divider, not a
 * WCAG 1.4.11 component boundary, and is asserted separately below as
 * "reported, not required" rather than folded into the passing set.
 */

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const tokens = extractTokens(css);

test("the sRGB conversion is correct at its known extremes (white/black)", () => {
  assert.equal(oklchLuminance("oklch(1 0 0)"), 1);
  assert.equal(oklchLuminance("oklch(0 0 0)"), 0);
  assert.equal(contrastRatio("oklch(1 0 0)", "oklch(0 0 0)"), 21);
});

test("body text on the page background passes WCAG AA normal text", () => {
  const ratio = contrastRatio(tokens["foreground"], tokens["background"]);
  assert.ok(ratio >= WCAG_AA_NORMAL_TEXT, `expected >= ${WCAG_AA_NORMAL_TEXT}:1, got ${ratio.toFixed(2)}:1`);
});

test("secondary/metadata text on the page background passes WCAG AA normal text", () => {
  const ratio = contrastRatio(tokens["muted-foreground"], tokens["background"]);
  assert.ok(ratio >= WCAG_AA_NORMAL_TEXT, `expected >= ${WCAG_AA_NORMAL_TEXT}:1, got ${ratio.toFixed(2)}:1`);
});

test("primary button label passes WCAG AA normal text", () => {
  const ratio = contrastRatio(tokens["primary-foreground"], tokens["primary"]);
  assert.ok(ratio >= WCAG_AA_NORMAL_TEXT, `expected >= ${WCAG_AA_NORMAL_TEXT}:1, got ${ratio.toFixed(2)}:1`);
});

test("FIXED: destructive button label now passes WCAG AA normal text (was 3.89:1)", () => {
  const ratio = contrastRatio(tokens["destructive-foreground"], tokens["destructive"]);
  assert.ok(ratio >= WCAG_AA_NORMAL_TEXT, `expected >= ${WCAG_AA_NORMAL_TEXT}:1, got ${ratio.toFixed(2)}:1`);
});

test("FIXED: the \"Waiting\" status label now passes WCAG AA large text (was 2.99:1)", () => {
  const ratio = contrastRatio(tokens["status-waiting"], tokens["status-waiting-bg"]);
  assert.ok(ratio >= WCAG_AA_LARGE_TEXT, `expected >= ${WCAG_AA_LARGE_TEXT}:1, got ${ratio.toFixed(2)}:1`);
});

test("every other status label passes WCAG AA large text", () => {
  for (const [fg, bg] of [
    ["status-now", "status-now-bg"],
    ["status-next", "status-next-bg"],
    ["status-later", "status-later-bg"],
    ["status-caught", "status-caught-bg"],
    ["status-neutral", "status-neutral-bg"],
  ]) {
    const ratio = contrastRatio(tokens[fg], tokens[bg]);
    assert.ok(ratio >= WCAG_AA_LARGE_TEXT, `${fg}/${bg}: expected >= ${WCAG_AA_LARGE_TEXT}:1, got ${ratio.toFixed(2)}:1`);
  }
});

test("FIXED: the form-control boundary (--input) now passes WCAG 1.4.11 (was 1.44:1)", () => {
  const ratio = contrastRatio(tokens["input"], tokens["background"]);
  assert.ok(ratio >= WCAG_AA_UI_COMPONENT, `expected >= ${WCAG_AA_UI_COMPONENT}:1, got ${ratio.toFixed(2)}:1`);
});

test("the new --control-border token passes WCAG 1.4.11 for meaningful (non-form) control boundaries", () => {
  const ratio = contrastRatio(tokens["control-border"], tokens["background"]);
  assert.ok(ratio >= WCAG_AA_UI_COMPONENT, `expected >= ${WCAG_AA_UI_COMPONENT}:1, got ${ratio.toFixed(2)}:1`);
});

test("--border stays a deliberately light decorative divider, not silently promoted to a boundary token", () => {
  // Documents the design decision, not a WCAG requirement: --border is
  // used by dozens of purely visual card/panel dividers where 1.4.11
  // doesn't apply. If this ever climbs to 3:1 on its own that's fine, but
  // the decorative token must not regress by being confused with, or
  // silently merged into, --input/--control-border.
  assert.notEqual(tokens["border"], tokens["input"], "--border and --input must remain independently adjustable");
  assert.equal(tokens["input"], tokens["control-border"], "--input and --control-border are the same passing value by design");
});

test("the .dark {} block still duplicates :root verbatim (the report's scope note depends on this)", () => {
  const darkStart = css.indexOf(".dark {");
  const darkBlock = css.slice(darkStart, css.indexOf("\n}\n", darkStart));
  const darkTokens = {};
  for (const m of darkBlock.matchAll(/--([a-z0-9-]+):\s*(oklch\([^;]+\));/g)) darkTokens[m[1]] = m[2].trim();
  assert.ok(Object.keys(darkTokens).length > 0, "expected the .dark block to define oklch tokens");
  for (const [key, value] of Object.entries(darkTokens)) {
    assert.equal(tokens[key], value, `--${key} differs between :root and .dark -- the report's single-palette scope note is now stale`);
  }
});
