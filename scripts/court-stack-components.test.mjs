import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const sheet = readFileSync(
  new URL("../src/features/things/ThingDetailSheet.tsx", import.meta.url),
  "utf8",
);
const content = readFileSync(
  new URL("../src/features/things/ThingDetailContent.tsx", import.meta.url),
  "utf8",
);

test("Thing detail sheet delegates to one shared content implementation", () => {
  assert.match(sheet, /<ThingDetailContent/);
  assert.match(sheet, /initialThing=\{thing\}/);
  assert.equal(sheet.includes("rpcSortThing"), false);
  assert.match(content, /await rpcSortThing\(thing\.id\)/);
  assert.match(content, /await rpcCancelThing\(thing\.id\)/);
  assert.match(content, /await rpcShred\(thing\.id\)/);
});

test("Thing detail Sheet retains an accessible dialog name without a Sheet dependency in shared content", () => {
  assert.match(sheet, /<SheetContent[\s\S]*aria-label="Thing details"/);
  assert.equal(content.includes("SheetContent"), false);
  assert.equal(content.includes("SheetTitle"), false);
});
