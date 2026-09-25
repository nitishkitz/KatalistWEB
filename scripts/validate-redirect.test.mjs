import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeRedirectTarget } from "@/lib/validate-redirect";

test("a validated internal path is returned unchanged", () => {
  assert.equal(sanitizeRedirectTarget("/onboarding"), "/onboarding");
  assert.equal(sanitizeRedirectTarget("/team/abc-123"), "/team/abc-123");
});

test("missing, non-string, or empty input falls back to the default", () => {
  assert.equal(sanitizeRedirectTarget(undefined), "/");
  assert.equal(sanitizeRedirectTarget(null), "/");
  assert.equal(sanitizeRedirectTarget(42), "/");
  assert.equal(sanitizeRedirectTarget(""), "/");
  assert.equal(sanitizeRedirectTarget("/custom-fallback", "/custom-fallback"), "/custom-fallback");
});

test("a path not starting with a single leading slash is rejected", () => {
  assert.equal(sanitizeRedirectTarget("onboarding"), "/");
  assert.equal(sanitizeRedirectTarget("../onboarding"), "/");
});

test("a protocol-relative or absolute external URL is rejected", () => {
  assert.equal(sanitizeRedirectTarget("//evil.example/phish"), "/");
  assert.equal(sanitizeRedirectTarget("https://evil.example"), "/");
  assert.equal(sanitizeRedirectTarget("/redirect?to=https://evil.example"), "/");
});
