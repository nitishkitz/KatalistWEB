import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const panelSource = await readFile(new URL("../src/features/lists/ListChatPanel.tsx", import.meta.url), "utf8");
const hookSource = await readFile(new URL("../src/features/lists/use-list-messages.ts", import.meta.url), "utf8");

test("chat attachment chips never create a link without a verified URL", () => {
  const guardStart = panelSource.indexOf("if (!attachment.url)");
  const fallbackStart = panelSource.indexOf("return (", guardStart);
  const fallbackEnd = panelSource.indexOf("  return (", fallbackStart + 1);
  assert.ok(guardStart >= 0, "missing attachment URL guard");
  assert.ok(fallbackStart >= 0 && fallbackEnd > fallbackStart, "missing unavailable attachment chip");
  assert.equal(panelSource.slice(fallbackStart, fallbackEnd).includes("href={attachment.url}"), false);
});

test("composer exposes a named listbox combobox and does not advertise a dead Emoji action", () => {
  assert.match(panelSource, /role="combobox"[\s\S]{0,500}aria-label="Message"/);
  assert.match(panelSource, /aria-autocomplete="list"/);
  assert.match(panelSource, /aria-haspopup="listbox"/);
  assert.doesNotMatch(panelSource, /aria-label="Emoji"/);
});

test("mounted message query exposes explicit retry and retrying state", () => {
  assert.match(hookSource, /retryMessages:\s*\(\)\s*=>\s*query\.refetch\(\)/);
  assert.match(hookSource, /isRetrying:\s*query\.isRefetching/);
  assert.match(panelSource, /chat\.retryMessages\(\)/);
});
