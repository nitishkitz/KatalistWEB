import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("desktop List opens in Table without Mine/THEIRS and uses explicit filters", async () => {
  const [route, toolbar] = await Promise.all([
    read("src/routes/lists.$listId.tsx"),
    read("src/features/lists/ListThingsToolbar.tsx"),
  ]);
  assert.match(route, /useState<[^>]*ListView[^>]*>\("table"\)/);
  assert.doesNotMatch(toolbar, /MINE|THEIRS/);
  assert.match(toolbar, /All people/);
  assert.match(toolbar, /All statuses/);
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

test("compact Table has exactly the approved semantic columns and one Pace cell", async () => {
  const table = await read("src/features/lists/ListThingsTable.tsx");
  for (const header of ["Thing", "Assignee", "State", "Pace", "Due", "Updated", "Actions"]) {
    assert.match(table, new RegExp(`>${header}<`));
  }
  assert.doesNotMatch(table, />Owner Importance</);
  assert.doesNotMatch(table, />My Pace</);
  assert.doesNotMatch(table, /block text-\[10px\].*laneOf/s);
  assert.match(table, /laneOf\(thing\)\.toUpperCase\(\)/);
});

test("List chat renders avatar, author, and timestamp", async () => {
  const chat = await read("src/features/lists/ListChatPanel.tsx");
  assert.match(chat, /PersonAvatar/);
  assert.match(chat, /message\.author/);
  assert.match(chat, /message\.at/);
});

test("live List members retain actor IDs for scoped Magic Box ranking", async () => {
  const mapping = await read("src/features/lists/map-list-rows.ts");
  assert.match(mapping, /actorIds/);
  assert.match(mapping, /actorId:\s*actorIds\.get\(m\.profile_id\)/);
});

test("Court removes duplicate Owner/My Pace labels and offers people filters", async () => {
  const [desktop, card, row, detail] = await Promise.all([
    read("src/features/court/CourtDesktop.tsx"),
    read("src/features/court/CourtThingCard.tsx"),
    read("src/components/katalist/ThingRow.tsx"),
    read("src/features/things/ThingDetailContent.tsx"),
  ]);
  assert.match(desktop, /Show Things involving \$\{person\.name\}/);
  assert.doesNotMatch(desktop, /Owner importance|My pace/);
  assert.doesNotMatch(card, />Owner</);
  assert.doesNotMatch(card, />My Pace</);
  assert.doesNotMatch(row, />Owner Importance</);
  assert.doesNotMatch(row, />My Pace</);
  assert.match(detail, />Pace</);
});
