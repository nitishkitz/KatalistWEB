import assert from "node:assert/strict";
import test from "node:test";
import { briefGenieRow, renderBriefGenie } from "@/features/catchup/brief-genie-renderer";
const anchor = { x: 900, y: 20, width: 292, height: 42 };
const panel = { x: 220, y: 100, width: 960, height: 500 };
test("scanlines start at the window and converge to the capsule center", () => {
  for (const row of [0, .25, .5, .75, 1]) {
    assert.deepEqual(briefGenieRow(panel, anchor, row, 0), {left:220, width:960, y:100+row*500});
    assert.deepEqual(briefGenieRow(panel, anchor, row, 1), {left:1046, width:0, y:41});
  }
});
test("the edge nearest the capsule bends first above and below, without invalid rows", () => {
  assert.ok(briefGenieRow(panel, anchor, 0, .5).width < briefGenieRow(panel, anchor, 1, .5).width);
  const below = {...anchor,y:700};
  assert.ok(briefGenieRow(panel, below, 1, .5).width < briefGenieRow(panel, below, 0, .5).width);
  for (const dock of [anchor,below]) for(let t=0;t<=1;t+=.05) for(let r=0;r<=1;r+=.05) {
    const row = briefGenieRow(panel,dock,r,t);
    assert.ok(Object.values(row).every(Number.isFinite));
    assert.ok(row.width >= 0);
  }
});
test("the renderer warps actual texture pixels, preserving every source row", () => {
  const draws=[];
  const texture={width:1920,height:1000};
  const ctx={clearRect(){},drawImage(...args){draws.push(args)}};
  renderBriefGenie(ctx,texture,panel,anchor,0,1440,900);
  assert.equal(draws.length,500);
  assert.ok(draws.every(d=>d[0]===texture && d[4]===2 && d[7]===960));
  assert.equal(draws.at(-1)[2],998);
});
