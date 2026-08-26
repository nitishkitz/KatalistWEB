import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rpcSrc = readFileSync(path.join(root, "src/features/things/rpc.ts"), "utf8");
const sheetSrc = readFileSync(path.join(root, "src/features/things/ThingDetailSheet.tsx"), "utf8");
const detailSrc = `${sheetSrc}\n${readFileSync(path.join(root, "src/features/things/ThingDetailContent.tsx"), "utf8")}`;

function extractExport(name) {
  const start = rpcSrc.indexOf(`export async function ${name}`);
  assert.ok(start >= 0, `${name} is missing from rpc.ts`);
  const next = rpcSrc.indexOf("\nexport ", start + 10);
  return rpcSrc.slice(start, next === -1 ? rpcSrc.length : next);
}

test("LIVE Sort routes to sort_thing independently", () => {
  const body = extractExport("rpcSortThing");
  assert.match(body, /supabase\.rpc\(\s*"sort_thing"/);
  assert.match(body, /p_thing_id:\s*thingId/);
  assert.equal(body.includes("rpcSetWorkStatus"), false);
  assert.equal(body.includes("set_work_status"), false);
  assert.match(body, /setStatusLocal\(thingId,\s*"sorted"\)/);
});

test("LIVE Cancel routes to cancel_thing independently", () => {
  const body = extractExport("rpcCancelThing");
  assert.match(body, /supabase\.rpc\(\s*"cancel_thing"/);
  assert.match(body, /p_thing_id:\s*thingId/);
  assert.match(body, /p_reason:\s*reason/);
  assert.equal(body.includes("rpcSetWorkStatus"), false);
  assert.equal(body.includes("set_work_status"), false);
  assert.match(body, /setStatusLocal\(thingId,\s*"cancelled"\)/);
});

test("LIVE Work Status only uses set_work_status for active states", () => {
  const body = extractExport("rpcSetWorkStatus");
  assert.match(body, /status:\s*MutableWorkStatus/);
  assert.match(body, /supabase\.rpc\(\s*"set_work_status"/);
  assert.match(body, /p_work_status:\s*status/);
  assert.equal(body.includes("sort_thing"), false);
  assert.equal(body.includes("cancel_thing"), false);
  assert.match(rpcSrc, /export type MutableWorkStatus = Extract<WorkStatus, "not_started" \| "under_progress">/);
});

test("Thing Detail Sort/Cancel buttons do not send terminals through set_work_status", () => {
  assert.match(detailSrc, /await rpcSortThing\(thing\.id\)/);
  assert.match(detailSrc, /await rpcCancelThing\(thing\.id\)/);
  assert.equal(/rpcSetWorkStatus\([^)]*"sorted"/.test(detailSrc), false);
  assert.equal(/rpcSetWorkStatus\([^)]*"cancelled"/.test(detailSrc), false);
});
