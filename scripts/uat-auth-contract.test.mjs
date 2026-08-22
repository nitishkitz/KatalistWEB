import assert from "node:assert/strict";
import test from "node:test";

import { normalizePhone, validateRequiredProfile } from "@/lib/auth/profile-validation";
import { isUatClient } from "@/lib/auth/uat-contract";

test("normalizes a valid phone and rejects invalid values", () => {
  assert.equal(normalizePhone("+91 98765 43210"), "+919876543210");
  assert.equal(normalizePhone("12345"), null);
  assert.equal(normalizePhone(`+${"1".repeat(16)}`), null);
});

test("requires a complete normalized profile", () => {
  assert.deepEqual(validateRequiredProfile({ fullName: "  Naga   Reddy ", age: "29", occupation: " Designer " }), {
    ok: true,
    value: { fullName: "Naga Reddy", age: 29, occupation: "Designer" },
  });
  assert.equal(validateRequiredProfile({ fullName: "", age: "0", occupation: "" }).ok, false);
  assert.equal(validateRequiredProfile({ fullName: "A", age: "29.5", occupation: "B" }).ok, false);
});

test("client UAT mode requires the exact public flag", () => {
  assert.equal(isUatClient({ VITE_KATALIST_ENV: "uat" }), true);
  assert.equal(isUatClient({ VITE_KATALIST_ENV: "production" }), false);
});
