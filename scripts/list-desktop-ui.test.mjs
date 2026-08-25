import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("desktop List offers Board default, Mine/THEIRS, filters, and avatar people", async () => {
  const [route, toolbar] = await Promise.all([
    read("src/routes/lists.$listId.tsx"),
    read("src/features/lists/ListThingsToolbar.tsx"),
  ]);
  assert.match(route, /useState<[^>]*ListView[^>]*>\("board"\)/);
  assert.match(toolbar, /THEIRS/);
  assert.match(toolbar, /PersonAvatar/);
  assert.match(toolbar, /Due/);
});

test("Board has three Pace lanes and protected drag persistence", async () => {
  const board = await read("src/features/lists/ListThingsBoard.tsx");
  assert.match(board, /NOW/);
  assert.match(board, /NEXT/);
  assert.match(board, /LATER/);
  assert.match(board, /canDragListThing/);
  assert.match(board, /rpcSetPersonalPace/);
  assert.match(board, /onDragOver/);
});

test("compact Table has exactly the approved semantic columns", async () => {
  const table = await read("src/features/lists/ListThingsTable.tsx");
  for (const header of ["Thing", "Assignee", "State", "Due", "Updated", "Actions"]) {
    assert.match(table, new RegExp(`>${header}<`));
  }
  assert.doesNotMatch(table, />Owner Importance</);
  assert.doesNotMatch(table, />My Pace</);
});

test("List chat renders avatar, author, and timestamp", async () => {
  const chat = await read("src/features/lists/ListChatPanel.tsx");
  assert.match(chat, /PersonAvatar/);
  assert.match(chat, /message\.author/);
  assert.match(chat, /message\.at/);
});
