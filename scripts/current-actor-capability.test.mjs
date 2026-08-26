import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { getThingCapabilities } from "@/domain/capabilities";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFileSync(join(root, path), "utf8");

const me = { id: "actor-me", name: "Me", initials: "ME" };

function selfThing(overrides = {}) {
  return {
    id: "thing-self",
    title: "A self-assigned Thing",
    creator: me,
    owner: me,
    assignee: me,
    acknowledgement: "waiting_for_catch",
    workStatus: "not_started",
    ownerImportance: "next",
    personalPace: null,
    dueAt: null,
    dueHasTime: false,
    context: "work",
    listId: null,
    listName: null,
    cancelledAt: null,
    sortedAt: null,
    caughtAt: null,
    updatedAt: "2026-08-25T00:00:00.000Z",
    ...overrides,
  };
}

test("a waiting self-assigned Thing offers Catch and unlocks execution only after Catch", () => {
  const waiting = getThingCapabilities(selfThing(), me.id);
  assert.equal(waiting.canCatch, true);
  assert.equal(waiting.canSetPace, false);
  assert.equal(waiting.canSetStatus, false);

  const caught = getThingCapabilities(
    selfThing({ acknowledgement: "caught", personalPace: "next", caughtAt: "2026-08-25T00:01:00.000Z" }),
    me.id,
  );
  assert.equal(caught.canCatch, false);
  assert.equal(caught.canSetPace, true);
  assert.equal(caught.canSetStatus, true);
});

test("Thing actions do not obtain the current actor through the Court Things query", () => {
  for (const path of [
    "src/features/things/CatchActionButton.tsx",
    "src/features/things/ThingDetailContent.tsx",
    "src/components/katalist/ThingRow.tsx",
  ]) {
    const body = source(path);
    assert.match(body, /useCurrentActor/);
    assert.doesNotMatch(body, /useCourt\(\)/);
  }
});
