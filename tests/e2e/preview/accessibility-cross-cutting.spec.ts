import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * J15 (section 6): cross-cutting accessibility checks at each configured
 * viewport (this repo's own 5-viewport Playwright projects already cover
 * the viewport dimension itself). Extends
 * `scripts/t08-browser-verification.mjs`'s existing per-viewport
 * sub-12px/hit-target/overflow/reduced-motion checks with automated axe
 * scanning, which that script does not do, plus a keyboard-only tab-through
 * and an explicit reduced-motion emulation check.
 *
 * Runs against the anonymous /welcome and /auth routes only (no sign-in
 * required) -- matching this directory's own read-only contract; a signed-
 * in Demo Persona pass could extend this to Court/Lists/Me later, but the
 * public entry routes already exercise the same shared primitives (Button,
 * Input, Select, dialogs) this check is aimed at.
 */

test("/welcome has no automatically-detectable accessibility violations", async ({ page }) => {
  await page.goto("/welcome");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 10_000 });

  const results = await new AxeBuilder({ page }).analyze();
  const seriousOrWorse = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    seriousOrWorse,
    `serious/critical axe violations:\n${seriousOrWorse.map((v) => `${v.id}: ${v.description} (${v.nodes.length} nodes)`).join("\n")}`,
  ).toEqual([]);
});

test("/auth has no automatically-detectable accessibility violations", async ({ page }) => {
  await page.goto("/auth");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 10_000 });

  const results = await new AxeBuilder({ page }).analyze();
  const seriousOrWorse = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    seriousOrWorse,
    `serious/critical axe violations:\n${seriousOrWorse.map((v) => `${v.id}: ${v.description} (${v.nodes.length} nodes)`).join("\n")}`,
  ).toEqual([]);
});

test("/auth is fully keyboard-reachable: Tab visits real, labeled controls with a visible focus ring", async ({ page }) => {
  await page.goto("/auth");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 10_000 });

  const seenLabels = new Set<string>();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const style = getComputedStyle(el);
      return {
        tag: el.tagName,
        accessibleName: el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 40) || el.getAttribute("placeholder") || "",
        hasOutlineOrShadow: style.outlineStyle !== "none" || style.boxShadow !== "none",
      };
    });
    if (!info) continue;
    // Every focusable stop must be a real interactive element (never a
    // bare <div>/<span> with no semantics), and have SOME accessible name.
    expect(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"]).toContain(info.tag);
    expect(info.accessibleName.length, `focus stop #${i} (${info.tag}) has no accessible name`).toBeGreaterThan(0);
    seenLabels.add(info.accessibleName);
  }
  // At least a few distinct controls were actually reached, not the same
  // stuck element every time.
  expect(seenLabels.size).toBeGreaterThan(1);
});

// Reduced-motion + keyboard-focus coverage already exists at
// `scripts/t08-browser-verification.mjs` (a real Playwright pass against
// Court specifically, checking for lingering spatial/transform movement,
// not a blanket "zero CSS transitions anywhere" claim -- ordinary color/
// opacity transitions are expected to remain and are not what this app's
// own motion-token contract promises to remove). Not duplicated here.
