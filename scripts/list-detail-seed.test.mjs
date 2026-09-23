import assert from "node:assert/strict";
import { test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { getListDetailSeed } from "@/features/lists/list-detail-seed";

test("shared List detail seeds only the current viewer's fields", () => {
  const qc = new QueryClient();
  try {
    qc.setQueryData(["lists", "A", "work"], [{ id: "shared", role: "owner", ownerLine: "Owned by you" }]);
    const expected = [{ id: "shared", role: "view_only", ownerLine: "Owned by A" }];
    qc.setQueryData(["lists", "B", "work"], expected);
    assert.deepEqual(getListDetailSeed(qc, "B", "work", "shared"), expected[0]);
    assert.equal(getListDetailSeed(qc, "C", "work", "shared"), undefined);
  } finally { qc.clear(); }
});

test("missing current-context data never falls back to another context", () => {
  const qc = new QueryClient();
  try {
    qc.setQueryData(["lists", "B", "home"], [{ id: "shared", role: "owner" }]);
    assert.equal(getListDetailSeed(qc, "B", "work", "shared"), undefined);
    assert.equal(getListDetailSeed(qc, "B", "home", "missing"), undefined);
  } finally { qc.clear(); }
});

test("unresolved identity or route cannot seed a List", () => {
  const qc = new QueryClient();
  try {
    qc.setQueryData(["lists", undefined, "work"], [{ id: "shared" }]);
    assert.equal(getListDetailSeed(qc, undefined, "work", "shared"), undefined);
    assert.equal(getListDetailSeed(qc, "B", "work", undefined), undefined);
  } finally { qc.clear(); }
});
