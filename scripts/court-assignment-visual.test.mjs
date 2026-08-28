import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const card = readFileSync(new URL("../src/features/court/CourtThingCard.tsx", import.meta.url), "utf8");
const desktop = readFileSync(new URL("../src/features/court/CourtDesktop.tsx", import.meta.url), "utf8");

test("Court card keeps Catch outside the Thing title and shows assigner to assignee", () => {
  assert.match(card, /grid-cols-\[minmax\(0,1fr\)_auto\]/);
  assert.match(card, /Assigned by/);
  assert.match(card, /thing\.assignedBy/);
  assert.doesNotMatch(card, /pr-20/);
  assert.doesNotMatch(card, /absolute right-1\.5 top-2/);
});

test("Court Thing surfaces include optional creation timestamps", () => {
  assert.match(card, /formatThingCreatedAt\(thing\.createdAt\)/);
  assert.match(card, /Created/);
  assert.match(card, /createdAtExact/);
  const stack = readFileSync(new URL("../src/features/court/ThingStackCard.tsx", import.meta.url), "utf8");
  assert.match(stack, /formatThingCreatedAt\(thing\.createdAt\)/);
  assert.match(stack, /Created/);
});

test("Court person filters put the signed-in actor first", () => {
  assert.match(desktop, /courtPeople\(\{ now, next, later, theirs \}, myActorId\)/);
  assert.match(desktop, /myActorId: string \| null/);
});
