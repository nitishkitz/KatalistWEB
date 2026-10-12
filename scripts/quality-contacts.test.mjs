import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = async (file) => readFile(new URL(`../src/${file}`, import.meta.url), "utf8");

test("Google Contacts handles synchronous OAuth failures", async () => {
  const text = await source("features/contacts/use-google-contacts.ts");
  assert.match(text, /try\s*\{\s*requestGoogleContactsCode/);
  assert.match(text, /Google Contacts authorization failed/);
});

test("team roster does not collapse distinct IDs by display name", async () => {
  const text = await source("features/people/use-team.ts");
  assert.doesNotMatch(text, /seenNames/);
  assert.match(text, /seenIds\.has\(p\.id\)/);
});

test("invite clipboard rejection exposes a manual fallback without success toast", async () => {
  const text = await source("features/hub/components/ContactsDialog.tsx");
  assert.match(text, /setClipboardFallback\(link\)/);
  assert.match(text, /Copy the invite link manually/);
  assert.match(text, /Couldn’t copy the invite link/);
  assert.doesNotMatch(text, /writeText\(link\)\.catch\(\(\) => \{\}\)/);
});

test("contact row actions can wrap on narrow widths", async () => {
  const text = await source("features/hub/components/ContactsDialog.tsx");
  assert.match(text, /flex flex-wrap items-center gap-3 rounded-\[10px\]/);
  assert.match(text, /max-\[420px\]:basis-full/);
});
