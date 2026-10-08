import type { BriefRect } from "./brief-genie-geometry";

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeInOutCubic = (t: number) => t < .5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;

/** Adapted from UI Layouts' Mac Genie scanline renderer:
 * https://www.ui-layouts.com/components/mac-genie
 * Deform the captured content, rather than clipping an empty background.
 * Progress 0 is the full window; 1 is the capsule. Opening traverses the
 * same geometry backwards. The near edge narrows before the far edge.
 */
export function briefGenieRow(panel: BriefRect, anchor: BriefRect, row: number, progress: number) {
  const above = anchor.y + anchor.height / 2 < panel.y + panel.height / 2;
  const proximity = above ? 1 - row : row;
  const xStart = (1 - proximity) * .65;
  const yStart = (1 - proximity) * .2;
  const x = easeInOutCubic(clamp((progress - xStart) / (1 - xStart)));
  const y = clamp((progress - yStart) / (1 - yStart)) ** 2;
  const dockX = anchor.x + anchor.width / 2;
  const dockY = anchor.y + anchor.height / 2;
  return {
    left: lerp(panel.x, dockX, x),
    width: panel.width * (1 - x),
    y: lerp(panel.y + row * panel.height, dockY, y),
  };
}

export function renderBriefGenie(ctx: CanvasRenderingContext2D, texture: HTMLCanvasElement,
  panel: BriefRect, anchor: BriefRect, progress: number, viewportWidth: number, viewportHeight: number) {
  ctx.clearRect(0, 0, viewportWidth, viewportHeight);
  const rows = Math.ceil(panel.height);
  const sourceHeight = texture.height / rows;
  for (let i = 0; i < rows; i++) {
    const row = briefGenieRow(panel, anchor, i / rows, progress);
    if (row.width < .5) continue;
    const next = briefGenieRow(panel, anchor, (i + 1) / rows, progress);
    // Overlap a fraction of a pixel to avoid seams between compressed rows.
    const height = Math.max(.5, next.y - row.y + .3);
    ctx.drawImage(texture, 0, i * sourceHeight, texture.width, sourceHeight,
      row.left, row.y, row.width, height);
  }
}
