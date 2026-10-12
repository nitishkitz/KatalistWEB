import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const rpc = await readFile(new URL("../src/features/thing-references/rpc.ts", import.meta.url), "utf8");
const section = await readFile(new URL("../src/features/thing-references/ThingReferencesSection.tsx", import.meta.url), "utf8");
const workspace = await readFile(new URL("../src/features/things/InlineThingDetailWorkspace.tsx", import.meta.url), "utf8");

test("preview Thing references append through the shared merge helper and key by identity", () => {
  assert.match(rpc, /mergeThingReferences\(current, references\)/);
  assert.match(rpc, /previewReferences\.clear\(\)/);
  assert.match(rpc, /getStoredDemoSession\(\)\?\.user\?\.id/);
  assert.match(rpc, /queryKey: \[\"thing-references\", previewIdentity/);
});

test("Thing references expose loading and retryable error states", () => {
  assert.match(section, /isLoading/);
  assert.match(section, /isError/);
  assert.match(section, /refetch/);
  assert.match(section, /Try again/);
});

test("full-screen Thing detail makes covered content inert and modal", () => {
  assert.match(workspace, /aria-hidden=\"true\" inert/);
  assert.match(workspace, /role=\"dialog\"/);
  assert.match(workspace, /aria-modal=\"true\"/);
});
