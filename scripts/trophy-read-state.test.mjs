import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveTrophyReadState } from "../src/features/me/use-trophy.ts";

test("Trophy does not present a failed or unresolved read as confirmed zero", () => {
  assert.equal(resolveTrophyReadState(false, false, false), "loading");
  assert.equal(resolveTrophyReadState(false, false, true), "error");
  assert.equal(resolveTrophyReadState(false, true, false), "ready");
  assert.equal(resolveTrophyReadState(false, true, true), "stale");
  assert.equal(resolveTrophyReadState(true, false, false), "ready");
});
