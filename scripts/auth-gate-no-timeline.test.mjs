import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const authGate = readFileSync(
  new URL("../src/features/auth/gate/AuthGate.tsx", import.meta.url),
  "utf8",
);
const gateSteps = readFileSync(
  new URL("../src/features/auth/gate/GateSteps.tsx", import.meta.url),
  "utf8",
);
const gateStyles = readFileSync(
  new URL("../src/features/auth/gate/auth-gate.css", import.meta.url),
  "utf8",
);

test("the auth gate does not render the Number / Code / Unlock progress timeline", () => {
  assert.doesNotMatch(authGate, /GatePath|pathIndex|contactLabel/);
  assert.doesNotMatch(gateSteps, /Sign-in progress|kg-path|kg-dot/);
  assert.doesNotMatch(gateStyles, /\.kg-path|\.kg-dot/);
});

test("browser autofill keeps the auth input visually consistent with its field", () => {
  assert.match(gateStyles, /\.kg-well input:-webkit-autofill/);
  assert.match(gateStyles, /-webkit-text-fill-color: var\(--kg-ink\)/);
  assert.match(gateStyles, /-webkit-box-shadow: 0 0 0 1000px #f0e2d5 inset/);
});
