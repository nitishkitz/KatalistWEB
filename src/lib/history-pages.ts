/** Stable keyset pagination for histories ordered newest first. */
export const HISTORY_PAGE_SIZE = 50;

export type HistoryCursor = { at: string; id: string };
export type HistoryPage<T> = { rows: T[]; nextCursor: HistoryCursor | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/;

export function historyCursorFilter(cursor: HistoryCursor, column: "created_at" | "pinned_at" = "created_at"): string {
  // Values are inserted into PostgREST's filter grammar, not SQL parameters.
  // Accept only the exact shapes returned by Postgres before constructing it.
  if (!UUID.test(cursor.id) || !TIMESTAMP.test(cursor.at) || Number.isNaN(Date.parse(cursor.at))) {
    throw new Error("Invalid history cursor");
  }
  return `${column}.lt.${cursor.at},and(${column}.eq.${cursor.at},id.lt.${cursor.id})`;
}

export function historyPage<T extends { id: string; at: string }>(rows: T[]): HistoryPage<T> {
  const pageRows = rows.slice(0, HISTORY_PAGE_SIZE);
  const last = pageRows.at(-1);
  return {
    rows: pageRows,
    nextCursor: rows.length > HISTORY_PAGE_SIZE && last ? { at: last.at, id: last.id } : null,
  };
}

/** Pages arrive newest to oldest, while the conversation reads oldest to newest. */
export function flattenHistory<T extends { id: string }>(pages: Array<HistoryPage<T>> | undefined): T[] {
  const seen = new Set<string>();
  const items: T[] = [];
  for (const page of pages ?? []) {
    for (const row of page.rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      items.push(row);
    }
  }
  return items.reverse();
}
