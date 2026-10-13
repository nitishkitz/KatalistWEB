/** Largest 16:9 tile area that fits every participant without cropping or scrolling. */
export function fitCallGrid(width: number, height: number, count: number, gap = 12) {
  const safeCount = Math.max(1, count);
  let best = { columns: 1, width: 0 };
  let largestTile = 0;
  // Keep the familiar side-by-side conversation layout on desktop.
  const firstColumn = safeCount === 2 && width >= 600 ? 2 : 1;
  for (let columns = firstColumn; columns <= safeCount; columns++) {
    const rows = Math.ceil(safeCount / columns);
    const tileWidth = Math.max(0, Math.min(
      (width - gap * (columns - 1)) / columns,
      ((height - gap * (rows - 1)) / rows) * 16 / 9,
    ));
    if (tileWidth > largestTile) {
      largestTile = tileWidth;
      best = { columns, width: tileWidth * columns + gap * (columns - 1) };
    }
  }
  return best;
}
