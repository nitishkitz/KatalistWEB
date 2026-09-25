import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * T09/E05: Magic Box previously had no top-level Escape handling (only its
 * three autocomplete popovers handled their own Escape) and its success
 * toast never identified the created Thing or offered a way to open it --
 * just a generic "Tossed." / "N things tossed". This verifies both fixes
 * at the source level (mocking MagicBox's full dependency graph -- session,
 * people, lists, buckets, React Query mutation lifecycle, sonner's toast
 * action API -- for a real DOM assertion is disproportionate to what these
 * two behavioral additions need; matching this codebase's existing
 * precedent for Court/composer components, see court-stack-components.
 * test.mjs).
 */

const magicBox = readFileSync(new URL("../src/features/court/MagicBox.tsx", import.meta.url), "utf8");
const courtDesktop = readFileSync(new URL("../src/features/court/CourtDesktop.tsx", import.meta.url), "utf8");
const indexRoute = readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");

test("Escape returns focus away from the composer without clearing the typed draft, only when no autocomplete popover is open", () => {
  assert.match(magicBox, /if \(e\.key === "Escape" && !trigger\) \{\s*\n\s*e\.currentTarget\.blur\(\);/);
  // Must not appear alongside a value/attachedFiles clear on the same path.
  const escapeBlockMatch = magicBox.match(/if \(e\.key === "Escape" && !trigger\) \{[\s\S]{0,120}\}/);
  assert.ok(escapeBlockMatch, "expected to find the top-level Escape block");
  assert.doesNotMatch(escapeBlockMatch[0], /setValue\(/);
  assert.doesNotMatch(escapeBlockMatch[0], /setAttachedFiles\(/);
});

test("a successful single-Thing capture identifies the Thing by title and offers an Open action when the caller supports it", () => {
  assert.match(magicBox, /onThingCreated\?:\s*\(thingId: string, title: string\) => void/);
  assert.match(magicBox, /toast\.success\(`"\$\{title\}" tossed/);
  assert.match(magicBox, /action: onThingCreated\s*\n\s*\? \{ label: "Open", onClick: \(\) => onThingCreated\(thingId, title\) \}/);
});

test("the mutation threads the used title back through both the single- and multi-toss result shapes, for the success toast to read", () => {
  assert.match(magicBox, /failedAssigneeIds: failed\.map\(\(r\) => r\.assigneeActorId\),\s*\n\s*title: titleToUse,/);
  assert.match(magicBox, /failedAssigneeIds: \[\],\s*\n\s*title: titleToUse,/);
});

test("CourtDesktop wires onThingCreated by looking the Thing up in its own current view state (not a stale capture-time snapshot), reusing the existing no-hero-animation open path", () => {
  assert.match(courtDesktop, /onThingCreated=\{\(thingId\) => \{/);
  assert.match(courtDesktop, /\[\.\.\.view\.now, \.\.\.view\.next, \.\.\.view\.later, \.\.\.view\.theirs\]\.find\(/);
  assert.match(courtDesktop, /if \(created\) openCatchUpThing\(created\);/);
});

test("the mobile Court route wires onThingCreated directly to its own ID-based selection", () => {
  assert.match(indexRoute, /onThingCreated=\{\(thingId\) => setSelectedId\(thingId\)\}/);
});
