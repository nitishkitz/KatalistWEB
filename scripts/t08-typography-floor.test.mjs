import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * D01/T08: "metadata at least 12px" -- this repo had 191 exact
 * `text-[10px]`/`text-[11px]` occurrences plus ~130 more decimal sub-12px
 * sizes (`text-[9.5px]`, `text-[11.5px]`, etc.) scattered across 50+ files,
 * all fixed in the T08 typography pass. This test scans every .tsx source
 * file for ANY arbitrary Tailwind text-size utility below 12px, so a new
 * one can never be reintroduced silently -- source inspection, the same
 * mechanism that found the original violations.
 *
 * ALLOWLIST is for a specific, reviewed, intentional exception (there are
 * none as of this pass) -- entries need a file, exact size, and a reason;
 * this must never become a broad escape hatch.
 */
const ALLOWLIST = new Set([
  // "src/some/file.tsx:text-[11px]" -- reason it's not meaningful content.
]);

const SRC_DIR = new URL("../src", import.meta.url).pathname;
const SIZE_PATTERN = /text-\[([0-9.]+)px\]/g;

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, files);
    else if (entry.endsWith(".tsx")) files.push(full);
  }
  return files;
}

test("no .tsx source file contains an arbitrary Tailwind text size below the 12px metadata floor", () => {
  const violations = [];
  for (const file of walk(SRC_DIR)) {
    const relative = file.replace(SRC_DIR, "src");
    const content = readFileSync(file, "utf8");
    for (const match of content.matchAll(SIZE_PATTERN)) {
      const size = Number(match[1]);
      if (size >= 12) continue;
      const key = `${relative}:text-[${match[1]}px]`;
      if (ALLOWLIST.has(key)) continue;
      const line = content.slice(0, match.index).split("\n").length;
      violations.push(`${relative}:${line} -- text-[${match[1]}px]`);
    }
  }
  assert.deepEqual(
    violations,
    [],
    `found sub-12px arbitrary text sizes not in ALLOWLIST:\n${violations.join("\n")}`,
  );
});
