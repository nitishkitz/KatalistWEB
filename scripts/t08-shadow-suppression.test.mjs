import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * D01/T08: styles.css used to have `* { --tw-shadow: 0 0 #0000 !important }`,
 * a universal suppression that made every Tailwind `shadow-*` utility a
 * no-op app-wide (the four shared overlay primitives rendered with zero
 * visible elevation). It was removed only after every shadow-* consumer was
 * individually classified and migrated (dialogs/sheets -> katalist-
 * elevation-dialog, popovers/menus -> katalist-elevation-popover, floating
 * cards/toasts/docks -> katalist-elevation-card, base controls/cards/
 * selected-state indicators -> shadow removed outright). This test:
 * (1) guards against that universal suppression ever coming back, and
 * (2) guards against a NEW unclassified shadow-sm/md/lg/xl/2xl/xs/2xs
 *     creeping back into a .tsx file, since #1 alone would otherwise let
 *     such a class silently render again.
 */

const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
// Strip /* ... */ comments first -- this file's own explanatory prose
// legitimately quotes the removed rule by name, which must not itself
// trip the "must not be reintroduced" check below.
const stylesWithoutComments = styles.replace(/\/\*[\s\S]*?\*\//g, "");
const SRC_DIR = new URL("../src", import.meta.url).pathname;

test("styles.css no longer contains the universal --tw-shadow suppression", () => {
  assert.doesNotMatch(
    stylesWithoutComments,
    /--tw-shadow:\s*0 0 #0000\s*!important/,
    "the universal shadow suppression must not be reintroduced -- classify any new shadow-* consumer instead",
  );
  assert.doesNotMatch(stylesWithoutComments, /--tw-shadow-colored:\s*0 0 #0000\s*!important/);
});

test("the three katalist-elevation-* utilities are still defined and sourced from --elevation-* tokens", () => {
  assert.match(styles, /@utility katalist-elevation-card\s*\{\s*box-shadow: var\(--elevation-card\);/);
  assert.match(styles, /@utility katalist-elevation-popover\s*\{\s*box-shadow: var\(--elevation-popover\);/);
  assert.match(styles, /@utility katalist-elevation-dialog\s*\{\s*box-shadow: var\(--elevation-dialog\);/);
});

// Exactly the two intentional hero-artwork exceptions (welcome/auth login
// illustration) -- new entries here require the same explicit review the
// T08 pass gave every other shadow consumer, not a blanket allowance.
const ALLOWLIST = new Set(["src/routes/welcome.tsx", "src/routes/auth.tsx"]);

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, files);
    else if (entry.endsWith(".tsx")) files.push(full);
  }
  return files;
}

test("no unclassified Tailwind shadow-* utility exists outside the reviewed drop-shadow artwork exception", () => {
  const pattern = /\b(?:hover:)?shadow-(?:sm|md|lg|xl|2xl|xs|2xs)\b/;
  const violations = [];
  for (const file of walk(SRC_DIR)) {
    const relative = file.replace(SRC_DIR, "src");
    if (ALLOWLIST.has(relative)) continue;
    const content = readFileSync(file, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      // Skip comment lines -- this test is about actual class usage, not
      // prose (this file's own explanatory comments legitimately mention
      // the removed classes by name).
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
      if (pattern.test(line)) violations.push(`${relative}: ${trimmed.slice(0, 100)}`);
    }
  }
  assert.deepEqual(
    violations,
    [],
    `found unclassified shadow-* usage -- migrate to katalist-elevation-* or remove per the T08 rules:\n${violations.join("\n")}`,
  );
});
