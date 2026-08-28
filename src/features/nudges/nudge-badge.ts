export function countActionableNudges(rows: readonly { canNudge: boolean }[]) {
  return rows.reduce((count, row) => count + (row.canNudge ? 1 : 0), 0);
}
