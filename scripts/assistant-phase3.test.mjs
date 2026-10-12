import assert from "node:assert/strict";
import { test } from "node:test";
import { decideScope, extractRequestedScope } from "../server/lib/assistant-scope.ts";

const scope = (type, id, label, extra = {}) => ({ type, id, label, context: "work", archived: false, ...extra });
const scopes = [
  scope("list", "l1", "Payments"),
  scope("bucket", "b1", "Payments"),
  scope("list", "l2", "Website Launch"),
  scope("bucket", "b2", "Product Launch"),
  scope("bucket", "b3", "Design"),
  scope("list", "l3", "Next"),
  scope("list", "h1", "Garden", { context: "home" }),
  scope("list", "a1", "Old Roadmap", { archived: true }),
];

test("identical List and Bucket names require a selection", () => {
  const result = decideScope("What is happening in Payments?", scopes, "work");
  assert.equal(result.kind, "ambiguous");
  assert.deepEqual(result.candidates.map((c) => c.type).sort(), ["bucket", "list"]);
});

test("a type keyword disambiguates identical names", () => {
  const result = decideScope("What is happening in the Payments list?", scopes, "work");
  assert.equal(result.kind, "resolved");
  assert.equal(result.scope.id, "l1");
  assert.equal(decideScope("Who needs a nudge in the Payments bucket?", scopes, "work").scope.id, "b1");
});

test("exact, prefix and cued matches resolve; the longest phrase wins", () => {
  assert.equal(decideScope("How many overdue items are in Website Launch?", scopes, "work").scope.id, "l2");
  assert.equal(decideScope("What is happening in the Product bucket?", scopes, "work").scope.id, "b2");
});

test("minor misspellings are confirmed, never trusted", () => {
  const result = decideScope("what is happening in the Paymnets list", scopes, "work");
  assert.equal(result.kind, "ambiguous");
  assert.equal(result.candidates.length, 1);
});

test("everyday words do not select a scope without a cue", () => {
  assert.equal(decideScope("What should I do next?", scopes, "work").kind, "none");
  assert.equal(decideScope("Which items are overdue?", scopes, "work").kind, "none");
});

test("other-context, archived and unknown scopes are explained", () => {
  assert.equal(decideScope("What is happening in the Garden list?", scopes, "work").kind, "other_context");
  assert.equal(decideScope("Show the Old Roadmap list", scopes, "work").kind, "archived");
  const missing = decideScope("What is happening in the Nowhere list?", scopes, "work");
  assert.deepEqual(missing, { kind: "missing", name: "Nowhere", type: "list" });
  assert.equal(extractRequestedScope("What is in this list?"), null);
});
