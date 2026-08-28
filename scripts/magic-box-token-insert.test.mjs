import assert from "node:assert/strict";
import test from "node:test";

import { insertMagicBoxToken } from "@/features/court/magic-box/token-insert";

test("@ token insertion opens at the current caret without joining the previous word", () => {
  assert.deepEqual(insertMagicBoxToken("Review launch", 6, 6, "@"), {
    text: "Review @ launch",
    caret: 8,
  });
});

test("# token insertion replaces the current selection and preserves surrounding text", () => {
  assert.deepEqual(insertMagicBoxToken("Move old list today", 5, 13, "#"), {
    text: "Move # today",
    caret: 6,
  });
});

test("token insertion does not add duplicate whitespace after existing whitespace", () => {
  assert.deepEqual(insertMagicBoxToken("Assign ", 7, 7, "@"), {
    text: "Assign @",
    caret: 8,
  });
});
