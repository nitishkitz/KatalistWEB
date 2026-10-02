import assert from "node:assert/strict";
import { test } from "node:test";
import { parseToss } from "@/features/court/parse-toss";

const morning = new Date(2026, 8, 30, 12, 0);

test("untimed today resolves to 10 PM local and removes the phrase from the title", () => {
  const result = parseToss("make katalist designs today at any cost", [], morning);
  assert.equal(result.title, "make katalist designs at any cost");
  assert.equal(new Date(result.dueAt).getHours(), 22);
  assert.equal(result.dueHasTime, true);
  assert.equal(result.importance, "next");
});

test("explicit time overrides the 10 PM default", () => {
  const result = parseToss("send mockups today at 5 PM", [], morning);
  assert.equal(new Date(result.dueAt).getHours(), 17);
  assert.equal(result.title, "send mockups");
});

test("urgent pace and due date are independent", () => {
  const result = parseToss("finish designs ASAP by Friday", [], morning);
  assert.equal(result.importance, "now");
  assert.equal(result.title, "finish designs");
  assert.equal(new Date(result.dueAt).getHours(), 22);
});

test("later and next phrases select their lanes", () => {
  assert.equal(parseToss("read this when there's time", [], morning).importance, "later");
  assert.equal(parseToss("review this up next", [], morning).importance, "next");
  assert.equal(parseToss("review the priority document", [], morning).importance, "next");
});
