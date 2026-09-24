import assert from "node:assert/strict";
import { test } from "node:test";
import { HISTORY_PAGE_SIZE, flattenHistory, historyCursorFilter, historyPage } from "@/lib/history-pages";

test("keyset pages reach 1,001 rows sharing one timestamp exactly once", () => {
  const at = "2026-09-24T12:00:00.123456+00:00";
  const source = Array.from({ length: 1001 }, (_, i) => ({
    id: `00000000-0000-0000-0000-${i.toString(16).padStart(12, "0")}`,
    at,
  })).reverse();
  const pages = [];
  let cursor = null;
  do {
    const matching = cursor ? source.filter((row) => row.at < cursor.at || (row.at === cursor.at && row.id < cursor.id)) : source;
    const page = historyPage(matching.slice(0, HISTORY_PAGE_SIZE + 1));
    assert.ok(page.rows.length <= HISTORY_PAGE_SIZE);
    pages.push(page);
    cursor = page.nextCursor;
  } while (cursor);

  const flattened = flattenHistory(pages);
  assert.equal(flattened.length, 1001);
  assert.equal(new Set(flattened.map((row) => row.id)).size, 1001);
  assert.deepEqual(flattened.map((row) => row.id), [...source].reverse().map((row) => row.id));
  assert.equal(historyCursorFilter({ at, id: source[0].id }),
    `created_at.lt.${at},and(created_at.eq.${at},id.lt.${source[0].id})`);
});

test("untrusted cursor values cannot become PostgREST filter syntax", () => {
  assert.throws(() => historyCursorFilter({ at: "2026-09-24T00:00:00Z),id.eq.secret", id: crypto.randomUUID() }));
  assert.throws(() => historyCursorFilter({ at: "2026-09-24T00:00:00Z", id: "x),id.eq.secret" }));
});
