import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [shell, magicBox, bucket, motion] = await Promise.all([
  readFile(new URL("../src/components/layout/AppShell.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/features/court/MagicBox.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/routes/buckets.$bucketId.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/features/court/magic-box-motion.css", import.meta.url), "utf8"),
]);

test("command-k navigates from every AppShell screen and focuses the visible Magic Box", () => {
  assert.match(shell, /event\.metaKey \|\| event\.ctrlKey/);
  assert.match(shell, /event\.key\.toLowerCase\(\) !== "k"/);
  assert.match(shell, /await navigate\(\{ to: "\/" \}\);[\s\S]*requestMagicBoxFocus\(\)/);
  assert.match(magicBox, /MAGIC_BOX_FOCUS_EVENT/);
  assert.match(magicBox, /input\.getClientRects\(\)\.length === 0/);
});

test("bucket reference picker exposes and locks a visible pending state", () => {
  assert.match(bucket, /role="status"[\s\S]*Adding reference…/);
  assert.match(bucket, /aria-busy=\{Boolean\(pendingReference\)\}/);
  assert.match(bucket, /if \(!pendingReference\) setAddOpen\(next\)/);
});

test("Magic Box processing state uses a stronger continuous border orbit", () => {
  assert.match(motion, /data-state="processing"[^}]*--magic-aura-opacity: 1; --magic-orbit: 1\.15s/);
  assert.match(motion, /data-state="processing"\] \.magic-box-frame[\s\S]*box-shadow:/);
  assert.match(motion, /prefers-reduced-motion: reduce[\s\S]*data-state="processing"/);
});
