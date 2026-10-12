import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getThingCapabilities } from "@/domain/capabilities";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rpcSrc = readFileSync(path.join(root, "src/features/things/rpc.ts"), "utf8");
const detailSrc = readFileSync(path.join(root, "src/features/things/ThingDetailContent.tsx"), "utf8");

function extractExport(name) {
  const start = rpcSrc.indexOf(`export async function ${name}`);
  assert.ok(start >= 0, `${name} is missing from rpc.ts`);
  const next = rpcSrc.indexOf("\nexport ", start + 10);
  return rpcSrc.slice(start, next === -1 ? rpcSrc.length : next);
}

test("rpcSetDue accepts a nullable date and forces the time flag false when clearing", () => {
  const body = extractExport("rpcSetDue");
  assert.match(body, /dueAt:\s*string \| null/);
  assert.match(body, /dueAt === null \? false : dueHasTime/);
  assert.match(body, /supabase\.rpc\("set_due",\s*\{\s*p_thing_id:\s*thingId,\s*p_due_at:\s*dueAt,\s*p_due_has_time:\s*hasTime\s*\}/);
  assert.match(body, /setDueLocal\(thingId,\s*dueAt,\s*hasTime\)/);
});

test("the shared action panel is built before the Court early return and passed to Court controls", () => {
  const panelAt = detailSrc.indexOf("const moreActionsPanel =");
  const courtAt = detailSrc.indexOf('if (variant === "court") {');
  assert.ok(panelAt > 0 && courtAt > 0 && panelAt < courtAt, "panel must be constructed before the Court branch");
  assert.match(detailSrc, /moreActionsButton=\{moreActionsButton\}\s*moreActionsPanel=\{moreActionsPanel\}\s*\/>\s*\{\/\* Description Section/);
  assert.match(detailSrc, /aria-controls=\{moreOpen \? actionsPanelId : undefined\}/);
  assert.match(detailSrc, /<div id=\{actionsPanelId\}/);
});

test("due-date UI: labels, validation message, remove only with a persisted date, no RPC on invalid input", () => {
  assert.match(detailSrc, /Due date and time/);
  assert.match(detailSrc, /hasPersistedDue \? "Update date" : "Add date"/);
  assert.match(detailSrc, /Choose a valid date and time\./);
  assert.match(detailSrc, /Due date added\./);
  assert.match(detailSrc, /Due date updated\./);
  assert.match(detailSrc, /Due date removed\./);
  assert.match(detailSrc, /\{hasPersistedDue \? \(\s*<button[^>]*onClick=\{handleRemoveDue\}/);
  assert.match(detailSrc, /await rpcSetDue\(targetThingId, null, false\)/);
  assert.match(detailSrc, /\{ dueAt: null, dueHasTime: false \}/);
  // Validation precedes toISOString(), so an invalid value never throws or calls the RPC.
  const save = detailSrc.slice(detailSrc.indexOf("const handleSaveDue"), detailSrc.indexOf("const handleRemoveDue"));
  assert.ok(save.indexOf("Number.isNaN(parsed.getTime())") < save.indexOf("toISOString()"));
});

test("cancellation keeps its confirmation and closes the detail only after the RPC succeeds", () => {
  const cancel = detailSrc.slice(detailSrc.indexOf("const handleCancelThing"), detailSrc.indexOf("const moreActionsButton"));
  assert.match(cancel, /window\.confirm\("Are you sure you want to cancel this thing\?"\)/);
  assert.ok(cancel.indexOf("window.confirm") < cancel.indexOf("run.mutate"));
  assert.ok(cancel.indexOf("await rpcCancelThing(thing.id)") < cancel.indexOf("onAfterTerminalAction?.()"));
});

test("due and cancel are owner-only on active Things; non-owners and terminal Things get neither", () => {
  const base = {
    id: "t", workStatus: "not_started", acknowledgement: "waiting_for_catch", cancelledAt: null,
    owner: { id: "o" }, assignee: { id: "a" },
  };
  const owner = getThingCapabilities(base, "o");
  assert.equal(owner.canSetDue && owner.canCancel, true);
  const other = getThingCapabilities(base, "x");
  assert.equal(other.canSetDue || other.canCancel, false);
  for (const workStatus of ["sorted", "cancelled"]) {
    const done = getThingCapabilities({ ...base, workStatus }, "o");
    assert.equal(done.canSetDue || done.canCancel, false);
  }
});
