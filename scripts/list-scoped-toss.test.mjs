import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildFinalCreateThingInput } from "@/features/court/magic-box/payload";
import { emptyMagicBoxState, reduceMagicBox, selectDraft } from "@/features/court/magic-box/reducer";

const collaborator = { id: "actor-collaborator", name: "Arjun", initials: "AR" };
const ctx = { now: new Date("2026-08-25T10:00:00Z"), timeZone: "Asia/Kolkata", people: [collaborator], lists: [], listId: "list-current", listName: "Launch", context: "work" };

test("List-scoped plain Toss stays in the open List and assigns to self", () => {
  const state = reduceMagicBox(emptyMagicBoxState(), { type: "TEXT_CHANGED", text: "Prepare brief", caret: 13 }, ctx);
  const built = buildFinalCreateThingInput(selectDraft(state, ctx));
  assert.equal(built.listId, "list-current");
  assert.equal(built.assigneeActorId, undefined);
});

test("List-scoped delegated Toss keeps the same List UUID", () => {
  let state = reduceMagicBox(emptyMagicBoxState(), { type: "TEXT_CHANGED", text: "Prepare brief", caret: 13 }, ctx);
  state = reduceMagicBox(state, { type: "ASSIGNEE_SELECTED", person: collaborator, source: "manual" }, ctx);
  const built = buildFinalCreateThingInput(selectDraft(state, ctx));
  assert.equal(built.listId, "list-current");
  assert.equal(built.assigneeActorId, "actor-collaborator");
});

test("View-only List pages hide the scoped composer instead of falling back to global Toss", () => {
  const floating = readFileSync(new URL("../src/features/court/FloatingMagicBox.tsx", import.meta.url), "utf8");
  assert.match(floating, /if \(context && !context\.editable\) return null/);
});
