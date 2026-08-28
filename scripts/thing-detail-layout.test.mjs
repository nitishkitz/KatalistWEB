import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const detail = fs.readFileSync("src/features/things/ThingDetailContent.tsx", "utf8");
const court = fs.readFileSync("src/features/court/CourtDesktop.tsx", "utf8");
const stack = fs.readFileSync("src/features/court/CourtLaneStack.tsx", "utf8");

test("Thing Detail contains the compact organized regions", () => {
  assert.match(detail, /data-detail-layout=["']compact["']/);
  assert.match(detail, /data-detail-region=["']header["']/);
  assert.match(detail, /data-detail-region=["']people["']/);
  assert.match(detail, /data-detail-region=["']status["']/);
  assert.match(detail, /data-detail-region=["']conversation["']/);
  assert.match(detail, /People/);
  assert.match(detail, /Acknowledgement/);
  assert.match(detail, /Comments|Activity/);
});

test("Court and stack composition stay independent from detail layout", () => {
  assert.doesNotMatch(court, /ThingDetailHeader|ThingDetailPeople|ThingDetailConversation/);
  assert.doesNotMatch(stack, /ThingDetailHeader|ThingDetailPeople|ThingDetailConversation/);
});

test("detail does not render Standalone as a fallback label", () => {
  assert.doesNotMatch(detail, /thing\.listName \?\? ["']Standalone["']/);
  assert.match(detail, /thing\.listName \?/);
});

test("detail presents optional metadata and compact status colors", () => {
  assert.match(detail, /dueLabel \?/);
  assert.match(detail, /Updated \{format\(/);
  assert.match(detail, /bg-status-next\/10/);
  assert.match(detail, /bg-status-caught\/10/);
});

test("detail keeps existing action and capability wiring", () => {
  for (const token of [
    "CatchActionButton",
    "rpcSortThing",
    "rpcSetPersonalPace",
    "getThingCapabilities",
  ]) {
    assert.match(detail, new RegExp(token));
  }
});
