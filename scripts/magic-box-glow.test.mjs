import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const composer = readFileSync(new URL("../src/features/court/magic-box/MagicBoxComposer.tsx", import.meta.url), "utf8");

test("Magic Box uses a state-driven border glow without layout motion", () => {
  assert.match(composer, /katalist-magic-box-frame/);
  assert.match(styles, /@keyframes magic-box-glow/);
  assert.match(styles, /data-magic-box-state="engaged"/);
  assert.match(styles, /data-magic-box-state="busy"/);
  assert.match(styles, /data-magic-box-state="recovery"/);
  const keyframes = styles.match(/@keyframes magic-box-glow\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(keyframes, /transform|width|position/);
});

test("reduced motion keeps a static glow", () => {
  assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.katalist-magic-box-frame[\s\S]*?animation:\s*none\s*!important/);
});
