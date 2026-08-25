import assert from "node:assert/strict";
import test from "node:test";
import { findActiveListToken, replaceListToken, resolveListToken } from "@/features/court/magic-box/list-token";
import { emptyMagicBoxState, reduceMagicBox, selectDraft } from "@/features/court/magic-box/reducer";

const lists = [{ id: "list-bali", name: "Bali Trip" }, { id: "list-launch", name: "Launch" }];

test("finds and replaces the active #List token without touching prose", () => {
  const token = findActiveListToken("Book flights #Bal tomorrow", 17);
  assert.deepEqual(token, { start: 13, end: 17, query: "Bal" });
  assert.deepEqual(replaceListToken("Book flights #Bal tomorrow", token, lists[0]), {
    text: "Book flights #Bali Trip tomorrow", caret: 23,
    binding: { listId: "list-bali", listName: "Bali Trip", start: 13, end: 23 },
  });
});

test("resolves exactly one accessible List and blocks unresolved List text", () => {
  assert.deepEqual(resolveListToken("Plan #Launch", lists), { status: "resolved", list: lists[1] });
  assert.deepEqual(resolveListToken("Plan #Missing", lists), { status: "unresolved", rawToken: "Missing" });
  assert.deepEqual(resolveListToken("Plan normally", lists), { status: "none" });
});

test("selected multi-word List is removed from the Thing title and supplies the List UUID", () => {
  const replaced = replaceListToken("Book flights #Bal", { start: 13, end: 17, query: "Bal" }, lists[0]);
  const ctx = { now: new Date("2026-08-25T10:00:00Z"), timeZone: "Asia/Kolkata", people: [], lists, context: "work" };
  const state = reduceMagicBox(emptyMagicBoxState(), { type: "LIST_SELECTED", listId: lists[0].id, listName: lists[0].name, ...replaced }, ctx);
  const draft = selectDraft(state, ctx);
  assert.equal(draft.derivedTitle, "Book flights");
  assert.equal(draft.listId, "list-bali");
  assert.equal(draft.listResolution, "resolved");
});
