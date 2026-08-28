import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { countActionableNudges } from "@/features/nudges/nudge-badge";

const laneStack = readFileSync(
  new URL("../src/features/court/CourtLaneStack.tsx", import.meta.url),
  "utf8",
);
const sidebar = readFileSync(
  new URL("../src/components/layout/Sidebar.tsx", import.meta.url),
  "utf8",
);

test("stack previews render acknowledgement and work status with matching icons and tones", () => {
  assert.match(laneStack, /previewWorkIcon/);
  assert.match(laneStack, /previewWorkTone/);
  assert.match(laneStack, /KatalistIcon name=\{status\.icon\}/);
  assert.match(laneStack, /className=\{cn\("mt-1 flex items-center gap-1\.5 text-\[10px\]", status\.tone\)\}/);
});

test("the sidebar renders a live actionable Nudges count", () => {
  assert.match(sidebar, /useNudgeBadge/);
  assert.match(sidebar, /nudgeCount/);
  assert.match(sidebar, /aria-label=\{`\$\{nudgeCount\} nudges`\}/);
  assert.match(sidebar, /nudgeCount > 0/);
});

test("actionable nudge badge count ignores cooled-down rows", () => {
  assert.equal(countActionableNudges([{ canNudge: true }, { canNudge: false }, { canNudge: true }]), 2);
});
