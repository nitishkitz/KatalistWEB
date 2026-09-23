import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * G01: onboarding.tsx had two confirmed defects -- "Connect" did exactly
 * what "Maybe Later" did (both just navigated home, no actual contacts
 * request), and the "Product preview" panel was a literal empty dashed
 * placeholder box on every step.
 */
const onboarding = readFileSync(new URL("../src/routes/onboarding.tsx", import.meta.url), "utf8");
const team = readFileSync(new URL("../src/routes/team.tsx", import.meta.url), "utf8");

test("Connect opens the real Contacts flow for a signed-in visitor, and routes an unauthenticated one to sign in first", () => {
  assert.match(onboarding, /session\s*\?\s*navigate\(\{\s*to:\s*"\/team",\s*search:\s*\{\s*openContacts:\s*true/s);
  assert.match(onboarding, /:\s*navigate\(\{\s*to:\s*"\/auth"/s);
  // "Maybe Later" must remain a distinct, genuinely different action from "Connect".
  const connectIdx = onboarding.search(/>\s*Connect\s*</);
  const laterIdx = onboarding.search(/>\s*Maybe Later\s*</);
  assert.ok(connectIdx > 0 && laterIdx > connectIdx);
});

test("the product preview uses real existing badge/cell components with explicitly-illustrative data, not a blank placeholder", () => {
  assert.doesNotMatch(onboarding, /border-dashed/, "the old empty dashed placeholder box is gone");
  assert.match(onboarding, /illustrative example, not your real data/i);
  assert.match(onboarding, /<ImportanceBadge/);
  assert.match(onboarding, /<PersonCell/);
});

test("team.tsx accepts an openContacts search param so an external link can arrive with Contacts already open", () => {
  assert.match(team, /validateSearch/);
  assert.match(team, /openContacts/);
  assert.match(team, /useState\(Boolean\(openContactsOnArrival\)\)/);
});
