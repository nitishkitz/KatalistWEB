import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * D01/T08: --elevation-card/-popover/-dialog tokens existed in styles.css
 * but were explicitly commented "not yet applied to any component, so this
 * is a no-op today" -- Dialog/Sheet/Popover/DropdownMenu still used raw
 * Tailwind shadow-lg/shadow-md classes, which the global
 * `* { --tw-shadow: 0 0 #0000 !important }` suppression zeroed at runtime,
 * so overlays rendered with no visible elevation at all. Each of the four
 * now uses a dedicated `katalist-elevation-*` utility (a plain box-shadow
 * property, not routed through --tw-shadow) so they get real elevation
 * without waiting on that global suppression's removal.
 */

const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const dialog = readFileSync(new URL("../src/components/ui/dialog.tsx", import.meta.url), "utf8");
const sheet = readFileSync(new URL("../src/components/ui/sheet.tsx", import.meta.url), "utf8");
const popover = readFileSync(new URL("../src/components/ui/popover.tsx", import.meta.url), "utf8");
const dropdownMenu = readFileSync(new URL("../src/components/ui/dropdown-menu.tsx", import.meta.url), "utf8");

test("styles.css defines katalist-elevation-{card,popover,dialog} utilities sourced from the --elevation-* tokens", () => {
  assert.match(styles, /@utility katalist-elevation-card\s*\{\s*box-shadow: var\(--elevation-card\);/);
  assert.match(styles, /@utility katalist-elevation-popover\s*\{\s*box-shadow: var\(--elevation-popover\);/);
  assert.match(styles, /@utility katalist-elevation-dialog\s*\{\s*box-shadow: var\(--elevation-dialog\);/);
});

test("Dialog content uses the dialog elevation utility, not a raw Tailwind shadow class the global suppression zeroes", () => {
  assert.match(dialog, /katalist-elevation-dialog/);
  assert.doesNotMatch(dialog, /shadow-lg/);
});

test("Sheet content uses the dialog elevation utility", () => {
  assert.match(sheet, /katalist-elevation-dialog/);
  assert.doesNotMatch(sheet, /shadow-lg/);
});

test("Popover content uses the popover elevation utility", () => {
  assert.match(popover, /katalist-elevation-popover/);
  assert.doesNotMatch(popover, /shadow-md/);
});

test("DropdownMenu sub-content and content both use the popover elevation utility", () => {
  const matches = dropdownMenu.match(/katalist-elevation-popover/g) ?? [];
  assert.equal(matches.length, 2, "both DropdownMenuSubContent and DropdownMenuContent must use it");
  assert.doesNotMatch(dropdownMenu, /shadow-lg|shadow-md/);
});
