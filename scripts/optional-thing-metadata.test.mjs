import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";
import { setDemoActorForTests } from "@/features/demo/identities";
import { resetDemoLocalStateForTests, tossLocalThing } from "@/features/things/local-state";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

afterEach(() => {
  resetDemoLocalStateForTests();
  setDemoActorForTests(null);
});

test("an unlisted Toss keeps List identity null", () => {
  setDemoActorForTests("p-priya");
  const thing = tossLocalThing({ title: "Unlisted", context: "work" });
  assert.equal(thing.listId, null);
  assert.equal(thing.listName, null);
});

test("user-facing Thing surfaces do not fabricate Standalone or absent Due copy", () => {
  for (const path of [
    "src/features/things/ThingDetailSheet.tsx",
    "src/features/court/ThingCard.tsx",
    "src/features/court/CourtThingCard.tsx",
    "src/components/katalist/ThingRow.tsx",
    "src/routes/buckets.$bucketId.tsx",
  ]) {
    const source = read(path);
    assert.doesNotMatch(source, /Standalone|No due date/);
  }
  assert.match(read("src/features/things/map-thing-rows.ts"), /:\s*null/);
});
