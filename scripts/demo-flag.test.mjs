import assert from "node:assert/strict";
import test from "node:test";

import { demoModeFromEnv } from "@/lib/demo-flag";

test("demo mode stays off unless the environment explicitly enables it", () => {
  assert.equal(demoModeFromEnv(undefined), false);
  assert.equal(demoModeFromEnv("false"), false);
  assert.equal(demoModeFromEnv("true"), true);
});
