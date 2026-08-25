import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const dialog = await readFile(new URL("../src/features/lists/NewListDialog.tsx", import.meta.url), "utf8").catch(() => "");

test("List creation captures optional description, image, and People", () => {
  assert.match(dialog, /List details/);
  assert.match(dialog, /Description \(optional\)/);
  assert.match(dialog, /Cover image \(optional\)/);
  assert.match(dialog, /Add people/);
  assert.match(dialog, /Collaborator/);
  assert.match(dialog, /View only/);
});

test("creator is displayed as Owner and form guards duplicate submit", () => {
  assert.match(dialog, /You · Owner/);
  assert.match(dialog, /isPending/);
  assert.match(dialog, /Skip for now/);
});
