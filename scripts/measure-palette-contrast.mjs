#!/usr/bin/env node
/**
 * D03/T08: measures WCAG contrast ratios for this app's OKLCH design
 * tokens (src/styles.css :root block) and writes a numeric report. Run
 * with `node scripts/measure-palette-contrast.mjs`. The same pairs are
 * asserted on in scripts/t08-palette-contrast.test.mjs so a future token
 * change that breaks contrast fails the suite instead of only this report
 * going stale.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { contrastRatio, WCAG_AA_NORMAL_TEXT, WCAG_AA_LARGE_TEXT, WCAG_AA_UI_COMPONENT } from "./lib/color-contrast.mjs";

export function extractTokens(cssText) {
  // :root { ... } is the first block in styles.css and holds the light
  // (only) theme values this app actually ships (the .dark block below it
  // duplicates the same values -- see the D03 note in the report below).
  const rootStart = cssText.indexOf(":root {");
  const rootBlock = cssText.slice(rootStart, cssText.indexOf("\n}\n", rootStart));
  const tokens = {};
  for (const m of rootBlock.matchAll(/--([a-z0-9-]+):\s*(oklch\([^;]+\));/g)) {
    tokens[m[1]] = m[2].trim();
  }
  return tokens;
}

const TEXT_PAIRS = [
  ["foreground", "background", "Body text on the page background"],
  ["muted-foreground", "background", "Secondary/metadata text on the page background"],
  ["card-foreground", "card", "Card body text"],
  ["popover-foreground", "popover", "Popover/menu body text"],
  ["primary-foreground", "primary", "Primary button label"],
  ["secondary-foreground", "secondary", "Secondary button label"],
  ["accent-foreground", "accent", "Accent surface label"],
  ["destructive-foreground", "destructive", "Destructive button label"],
  ["sidebar-foreground", "sidebar", "Sidebar body text"],
  ["sidebar-primary-foreground", "sidebar-primary", "Sidebar active item label"],
  ["sidebar-accent-foreground", "sidebar-accent", "Sidebar hover/accent item label"],
];

const STATUS_PAIRS = [
  ["status-now", "status-now-bg", "\"Now\" status label"],
  ["status-next", "status-next-bg", "\"Next\" status label"],
  ["status-later", "status-later-bg", "\"Later\" status label"],
  ["status-waiting", "status-waiting-bg", "\"Waiting\" status label"],
  ["status-caught", "status-caught-bg", "\"Caught\" status label"],
  ["status-neutral", "status-neutral-bg", "Neutral status label"],
];

/** Boundaries a user must be able to perceive the extent of (WCAG 1.4.11
 *  applies): form-control borders and any other explicitly meaningful
 *  control boundary. */
const UI_PAIRS = [
  ["input", "background", "Form control border (Input/Textarea/Select/outline Button/Toggle) against the page background"],
  ["control-border", "background", "Meaningful control/component boundary against the page background"],
];

/** Purely decorative dividers/panel outlines -- WCAG 1.4.11 does not apply
 *  (the boundary isn't the sole way to identify a component or its state),
 *  so these are reported for transparency but not held to the 3:1 bar. */
const DECORATIVE_PAIRS = [["border", "background", "Decorative card/panel divider against the page background"]];

function measure(tokens, pairs, requirement) {
  return pairs.map(([fg, bg, label]) => {
    const ratio = contrastRatio(tokens[fg], tokens[bg]);
    return { fg, bg, label, ratio, pass: ratio >= requirement };
  });
}

function row(r, requirement) {
  const verdict = r.pass ? "PASS" : "FAIL";
  return `| ${r.label} | \`--${r.fg}\` / \`--${r.bg}\` | ${r.ratio.toFixed(2)}:1 | ${requirement}:1 | ${verdict} |`;
}

function buildReport(tokens) {
  const textResults = measure(tokens, TEXT_PAIRS, WCAG_AA_NORMAL_TEXT);
  const statusResults = measure(tokens, STATUS_PAIRS, WCAG_AA_LARGE_TEXT); // status labels are bold/badge-style, not body copy
  const uiResults = measure(tokens, UI_PAIRS, WCAG_AA_UI_COMPONENT);
  // Reported for transparency, not held to WCAG 1.4.11 (see the decorative
  // boundary scope note above) -- excluded from the pass/fail failure list.
  const decorativeResults = measure(tokens, DECORATIVE_PAIRS, 0);

  const lines = [];
  lines.push("# Palette contrast measurement — 2026-09-25 (T08/D03)");
  lines.push("");
  lines.push(
    "Computed directly from `src/styles.css`'s OKLCH token values (converted OKLCH -> linear sRGB -> WCAG relative " +
      "luminance -> contrast ratio; see `scripts/lib/color-contrast.mjs`), not inferred from a screenshot or from font " +
      "size. Re-run with `node scripts/measure-palette-contrast.mjs`; the same pairs are asserted in " +
      "`scripts/t08-palette-contrast.test.mjs`.",
  );
  lines.push("");
  lines.push(
    "**Scope note:** this app's `.dark {}` block in `styles.css` currently duplicates every `:root` value verbatim " +
      "(confirmed by direct comparison) — there is exactly one shipped palette today, so only `:root` is measured.",
  );
  lines.push("");
  lines.push(
    "**Boundary scope note:** `--border` (decorative dividers/panel outlines) is measured separately from " +
      "`--input`/`--control-border` (meaningful control boundaries WCAG 1.4.11 actually applies to) -- see " +
      "\"Decorative boundaries\" below. `--border` is intentionally left light; darkening it globally would affect " +
      "dozens of purely visual separators for no accessibility benefit.",
  );
  lines.push("");
  lines.push("## Text pairs (WCAG AA normal text, >=4.5:1)");
  lines.push("");
  lines.push("| Usage | Tokens | Ratio | Required | Verdict |");
  lines.push("|---|---|---|---|---|");
  for (const r of textResults) lines.push(row(r, WCAG_AA_NORMAL_TEXT));
  lines.push("");
  lines.push("## Status labels (bold/badge text, treated as large text, >=3:1)");
  lines.push("");
  lines.push("| Usage | Tokens | Ratio | Required | Verdict |");
  lines.push("|---|---|---|---|---|");
  for (const r of statusResults) lines.push(row(r, WCAG_AA_LARGE_TEXT));
  lines.push("");
  lines.push("## Non-text UI components (WCAG 1.4.11, >=3:1)");
  lines.push("");
  lines.push("| Usage | Tokens | Ratio | Required | Verdict |");
  lines.push("|---|---|---|---|---|");
  for (const r of uiResults) lines.push(row(r, WCAG_AA_UI_COMPONENT));
  lines.push("");
  lines.push("## Decorative boundaries (not held to WCAG 1.4.11 -- reported for transparency only)");
  lines.push("");
  lines.push("| Usage | Tokens | Ratio |");
  lines.push("|---|---|---|");
  for (const r of decorativeResults) lines.push(`| ${r.label} | \`--${r.fg}\` / \`--${r.bg}\` | ${r.ratio.toFixed(2)}:1 |`);
  lines.push("");

  const failures = [...textResults, ...statusResults, ...uiResults].filter((r) => !r.pass);
  if (failures.length) {
    lines.push("## Failures requiring a product decision");
    lines.push("");
    for (const f of failures) {
      lines.push(
        `- **${f.label}** (\`--${f.fg}\` on \`--${f.bg}\`): ${f.ratio.toFixed(2)}:1, below its ${
          textResults.includes(f) ? WCAG_AA_NORMAL_TEXT : WCAG_AA_LARGE_TEXT
        }:1 requirement.`,
      );
    }
    lines.push("");
    lines.push(
      "These are real, measured token failures, not implemented by this pass -- changing brand/status colors is a " +
        "design decision outside this package's scope. Recorded here so it is not silently missed.",
    );
  } else {
    lines.push("No measured pair fell below its required ratio.");
  }
  lines.push("");

  return { text: lines.join("\n") + "\n", all: [...textResults, ...statusResults, ...uiResults] };
}

// Only run the report generation (file write + console output) when
// invoked directly (`node scripts/measure-palette-contrast.mjs`), not when
// another module imports `extractTokens` from this file (e.g. the
// regression test) -- an import must be a pure, side-effect-free read.
const isMain = process.argv[1] && import.meta.url === new URL(process.argv[1], "file://").href;
if (isMain) {
  const stylesPath = new URL("../src/styles.css", import.meta.url);
  const css = readFileSync(stylesPath, "utf8");
  const tokens = extractTokens(css);
  const { text, all } = buildReport(tokens);
  const outPath = new URL("../docs/superpowers/plans/2026-09-25-t08-palette-contrast.md", import.meta.url);
  writeFileSync(outPath, text);
  console.log(`Wrote ${outPath.pathname}`);
  for (const r of all) {
    console.log(`${r.pass ? "PASS" : "FAIL"} ${r.label}: ${r.ratio.toFixed(2)}:1`);
  }
}
