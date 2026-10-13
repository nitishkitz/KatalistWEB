import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fitCallGrid } from '../src/features/calls/call-grid-layout.ts';

test('two participants fill a wide stage side by side; narrow stages stack', () => {
  assert.equal(fitCallGrid(1000, 650, 2).columns, 2);
  assert.equal(fitCallGrid(300, 650, 2).columns, 1);
});

test('every tile fits the available stage when a dock opens or the viewport changes', () => {
  for (const [width, height] of [[1056, 526], [720, 526], [280, 500], [1600, 840], [640, 200]]) {
    for (let count = 1; count <= 24; count++) {
      const layout = fitCallGrid(width, height, count);
      const tileWidth = (layout.width - 12 * (layout.columns - 1)) / layout.columns;
      const rows = Math.ceil(count / layout.columns);
      assert.ok(layout.width <= width + 0.001);
      assert.ok(tileWidth * 9 / 16 * rows + 12 * (rows - 1) <= height + 0.001);
      assert.ok(tileWidth > 0);
      // Verify no other column count would give each participant a larger tile.
      for (let cols = count === 2 && width >= 600 ? 2 : 1; cols <= count; cols++) {
        const alternative = Math.min((width - 12 * (cols - 1)) / cols, (height - 12 * (Math.ceil(count / cols) - 1)) / Math.ceil(count / cols) * 16 / 9);
        assert.ok(tileWidth >= alternative - 0.001);
      }
    }
  }
});
