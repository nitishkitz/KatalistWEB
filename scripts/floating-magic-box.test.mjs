import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

test("AppShell owns exactly one floating Magic Box for authenticated pages", () => {
  const shell = read("src/components/layout/AppShell.tsx");
  const floating = read("src/features/court/FloatingMagicBox.tsx");
  assert.match(shell, /<FloatingMagicBox/);
  assert.match(shell, /magicBoxContext/);
  assert.match(floating, /fixed/);
  assert.match(floating, /z-40/);
  assert.match(floating, /bottom-16/);
  assert.match(floating, /editable/);
});

test("Court and List routes do not render duplicate route-level composers", () => {
  for (const path of [
    "src/routes/index.tsx",
    "src/features/court/CourtDesktop.tsx",
    "src/routes/lists.$listId.tsx",
  ]) {
    assert.doesNotMatch(read(path), /<MagicBox(?:\s|\/|>)/);
  }
  assert.match(read("src/routes/lists.$listId.tsx"), /magicBoxContext/);
});

test("floating composer has idle, engaged, busy, recovery, and reduced-motion states", () => {
  const composer = read("src/features/court/magic-box/MagicBoxComposer.tsx");
  assert.match(composer, /visualState/);
  assert.match(composer, /"engaged"/);
  assert.match(composer, /"busy"/);
  assert.match(composer, /"recovery"/);
  assert.match(composer, /motion-reduce:animate-none/);
  assert.match(composer, /onFocus/);
});

test("floating mention autocomplete opens upward", () => {
  const mention = read("src/features/court/magic-box/MentionAutocomplete.tsx");
  assert.match(mention, /floating/);
  assert.match(mention, /bottom-\[calc\(100%\+4px\)\]/);
});

test("floating chip editors open upward and invite acceptance omits the composer", () => {
  const chips = read("src/features/court/magic-box/ConfirmationChips.tsx");
  assert.match(chips, /side=\{floating \? "top" : "bottom"\}/);
  assert.match(read("src/components/layout/AppShell.tsx"), /showMagicBox/);
});
