import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * H06: ListCallPanel.tsx's only visibility gate was
 * `if (!call.joined && !call.connecting) return null;` -- a failed join
 * (permission denial, device unavailable, or generic failure) meant
 * `lifecycle` became "error" (joined=false, connecting=false), and the
 * WHOLE panel vanished with no retry, no instructions, no audio-only
 * option; "ended" vanished identically instead of showing a brief summary.
 *
 * ListCallPanel.tsx statically imports PdfCanvas.tsx, which has the same
 * unmockable Vite `?url` worker import documented in
 * pdf-canvas-races.test.mjs -- this file uses source assertions for the
 * same reason and against the same established precedent.
 */
const src = readFileSync(new URL("../src/features/calls/ListCallPanel.tsx", import.meta.url), "utf8");

test("an 'error' lifecycle renders a visible recovery panel instead of unmounting, with Retry, Dismiss, and a classified message", () => {
  assert.match(src, /if \(call\.lifecycle === "error"\) \{/);
  assert.match(src, /Couldn't join the call/);
  assert.match(src, /\{call\.lastError\}/);
  assert.match(src, /onClick=\{\(\) => void call\.join\(\)\}/);
  assert.match(src, /onClick=\{\(\) => call\.leave\(\)\}/);
});

test("permission denial and device-in-use both offer a 'Join with audio only' retry; a generic failure does not", () => {
  const errorBlock = src.match(/if \(call\.lifecycle === "error"\) \{([\s\S]*?)\n  \}\n\n  if \(call\.lifecycle === "ended"\)/);
  assert.ok(errorBlock, "the error lifecycle block must exist and precede the ended block");
  assert.match(errorBlock[1], /call\.lastErrorKind === "denied" \|\| call\.lastErrorKind === "device"/);
  assert.match(errorBlock[1], /call\.join\(\{ audioOnly: true \}\)/);
});

test("an 'ended' lifecycle renders a visible summary instead of unmounting, with a way to dismiss it", () => {
  assert.match(src, /if \(call\.lifecycle === "ended"\) \{/);
  assert.match(src, /Call ended/);
});

test("the pre-existing joined/connecting gate still applies after the new error/ended branches, for the ordinary idle case", () => {
  assert.match(src, /if \(!call\.joined && !call\.connecting\) return null;/);
  // The gate must come AFTER both new branches so error/ended are checked first.
  const errorIdx = src.indexOf('if (call.lifecycle === "error")');
  const endedIdx = src.indexOf('if (call.lifecycle === "ended")');
  const gateIdx = src.indexOf("if (!call.joined && !call.connecting) return null;");
  assert.ok(errorIdx > 0 && endedIdx > errorIdx && gateIdx > endedIdx, "error, then ended, then the ordinary gate, in that order");
});
