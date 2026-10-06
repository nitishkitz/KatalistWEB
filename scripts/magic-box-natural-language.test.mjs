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

test("month and day phrases resolve to the next matching local calendar date", () => {
  const result = parseToss("i have to visit china this November 15", [], morning);
  assert.equal(result.title, "i have to visit china");
  assert.equal(result.duePhrase, "this November 15");
  assert.equal(new Date(result.dueAt).getFullYear(), 2026);
  assert.equal(new Date(result.dueAt).getMonth(), 10);
  assert.equal(new Date(result.dueAt).getDate(), 15);
  assert.equal(new Date(result.dueAt).getHours(), 22);
});

test("numeric day before month and explicit years are supported", () => {
  const result = parseToss("travel on 15 Nov 2027", [], morning);
  assert.equal(result.title, "travel on");
  assert.equal(new Date(result.dueAt).getFullYear(), 2027);
  assert.equal(new Date(result.dueAt).getMonth(), 10);
  assert.equal(new Date(result.dueAt).getDate(), 15);
});

test("by this month-and-day wording is fully removed from the title", () => {
  const result = parseToss("visit China by this November 15", [], morning);
  assert.equal(result.title, "visit China");
  assert.equal(result.duePhrase, "by this November 15");
  assert.equal(new Date(result.dueAt).getMonth(), 10);
  assert.equal(new Date(result.dueAt).getDate(), 15);
});

test("next month resolves to the end of the next calendar month", () => {
  const result = parseToss("visit China next month", [], morning);
  assert.equal(result.title, "visit China");
  assert.equal(result.duePhrase, "next month");
  assert.equal(new Date(result.dueAt).getFullYear(), 2026);
  assert.equal(new Date(result.dueAt).getMonth(), 9);
  assert.equal(new Date(result.dueAt).getDate(), 31);
});

test("next year and next yr resolve to the end of the following year", () => {
  for (const phrase of ["next year", "next yr"]) {
    const result = parseToss(`finish this ${phrase}`, [], morning);
    assert.equal(result.title, "finish this");
    assert.equal(new Date(result.dueAt).getFullYear(), 2027);
    assert.equal(new Date(result.dueAt).getMonth(), 11);
    assert.equal(new Date(result.dueAt).getDate(), 31);
  }
});

test("by this year resolves to the end of the current calendar year", () => {
  const result = parseToss("visit China by this year", [], morning);
  assert.equal(result.title, "visit China");
  assert.equal(new Date(result.dueAt).getFullYear(), 2026);
  assert.equal(new Date(result.dueAt).getMonth(), 11);
  assert.equal(new Date(result.dueAt).getDate(), 31);
});

test("invalid month dates are flagged instead of normalized", () => {
  const result = parseToss("travel on February 31", [], morning);
  assert.equal(result.dueAt, undefined);
  assert.ok(result.chips.some((chip) => chip.kind === "unresolved" && chip.label === "Check date"));
});

test("later and next phrases select their lanes", () => {
  assert.equal(parseToss("read this when there's time", [], morning).importance, "later");
  assert.equal(parseToss("review this up next", [], morning).importance, "next");
  assert.equal(parseToss("review the priority document", [], morning).importance, "next");
});

test("by this Friday removes the whole temporal phrase and stores Friday", () => {
  const result = parseToss("finish your web work by this Friday", [], morning);
  assert.equal(result.title, "finish your web work");
  assert.equal(result.duePhrase, "by this Friday");
  assert.equal(new Date(result.dueAt).getDay(), 5);
});

test("URLs are preserved verbatim and not split into buckets or dates", () => {
  const result = parseToss("check https://framer.com/ for the landing page", [], morning);
  assert.equal(result.title, "check https://framer.com/ for the landing page");
  assert.equal(result.chips.some((chip) => chip.kind === "bucket"), false);
});

test("URL paths, hashes and trailing punctuation survive parsing", () => {
  const result = parseToss("read https://example.com/docs/12/05#intro, then reply tomorrow", [], morning);
  assert.equal(result.title, "read https://example.com/docs/12/05#intro, then reply");
  assert.equal(result.chips.some((chip) => chip.kind === "list" || chip.kind === "bucket"), false);
  assert.equal(result.chips.some((chip) => chip.kind === "unresolved"), false);
  assert.ok(result.dueAt);
});
