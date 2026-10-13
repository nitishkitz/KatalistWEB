import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const hook = readFileSync(new URL("../src/features/auth/use-otp-sign-in.ts", import.meta.url), "utf8");
const gate = readFileSync(new URL("../src/lib/fixed-otp.ts", import.meta.url), "utf8");

test("real phone sign-in sends through Supabase and verifies the SMS code server-side; the browser never compares it", () => {
  assert.match(gate, /VITE_KATALIST_PHONE_AUTH === "sms"/);
  assert.match(hook, /signInWithOtp\(\{ phone: destination, options: \{ shouldCreateUser: true \} \}\)/);
  assert.match(hook, /verifyOtp\(\{ phone: destination, token: code, type: "sms" \}\)/);
  const smsBranch = hook.slice(hook.indexOf("async function verifyPhone"), hook.indexOf("const fixedCode = localFixedOtp();"));
  assert.doesNotMatch(smsBranch, /code !==|code ===/, "no client-side code comparison in the SMS path");
});

test("the fixed test code stays confined to non-production test builds", () => {
  assert.match(gate, /if \(environment === "production" \|\| \(import\.meta\.env\.PROD && !testEnvironment\)\) return null;/);
});
