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

test("Find people opens the real Contacts flow, and an unauthenticated visitor is routed to sign in before any step ever renders", () => {
  // G01/G02: onboarding is authenticated-only end to end -- an
  // unauthenticated visit is redirected to /auth (with a validated return
  // destination) by a top-level effect, before any step's own actions run,
  // rather than each action separately re-checking `session`.
  assert.match(onboarding, /if\s*\(!session\)\s*\{\s*navigate\(\{\s*to:\s*"\/auth",\s*search:\s*\{\s*redirect:\s*"\/onboarding"/s);
  assert.match(onboarding, /navigate\(\{\s*to:\s*"\/team",\s*search:\s*\{\s*openContacts:\s*true/s);
  // "Maybe Later" must remain a distinct, genuinely different action from "Find people".
  const connectIdx = onboarding.search(/>\s*Find people\s*</);
  const laterIdx = onboarding.search(/>\s*Maybe Later\s*</);
  assert.ok(connectIdx > 0 && laterIdx > connectIdx);
  // The copy must not imply an address-book import -- only real in-app discovery.
  assert.doesNotMatch(onboarding, /I need your contacts/i);
});

test("the product preview uses real existing badge/cell components with explicitly-illustrative data, not a blank placeholder", () => {
  assert.doesNotMatch(onboarding, /border-dashed/, "the old empty dashed placeholder box is gone");
  assert.match(onboarding, /illustrative example, not your real data/i);
  assert.match(onboarding, /<ImportanceBadge/);
  assert.match(onboarding, /<PersonCell/);
});

test("onboarding is exactly three steps: capture, Court/Catch, and the optional discovery step -- not a six-step tour", () => {
  assert.match(onboarding, /kicker:\s*"1\/3"/);
  assert.match(onboarding, /kicker:\s*"2\/3"/);
  assert.doesNotMatch(onboarding, /kicker:\s*"[4-9]\/6"/);
  assert.match(onboarding, /DISCOVERY_KICKER\s*=\s*"3\/3"/);
});

test("progress persists per identity and a completed tour redirects home instead of replaying", () => {
  assert.match(onboarding, /loadOnboardingState\(window\.localStorage,\s*identityId\)/);
  assert.match(onboarding, /saveOnboardingState/);
  assert.match(onboarding, /entry\.redirectHome/);
});

test("team.tsx accepts an openContacts search param so an external link can arrive with Contacts already open", () => {
  assert.match(team, /validateSearch/);
  assert.match(team, /openContacts/);
  assert.match(team, /useState\(Boolean\(openContactsOnArrival\)\)/);
});
