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
  assert.equal(result.title, "travel");
  assert.equal(new Date(result.dueAt).getFullYear(), 2027);
  assert.equal(new Date(result.dueAt).getMonth(), 10);
  assert.equal(new Date(result.dueAt).getDate(), 15);
});

test("EOD asks which time the user means, rather than inventing a deadline", () => {
  for (const phrase of ["by EOD", "by end of the day", "by the end of today"]) {
    const parsed = parseToss(`submit docs ${phrase}`, [], morning);
    assert.equal(parsed.dueAt, undefined, phrase);
    assert.equal(parsed.dueChoices.length, 3, phrase);
    assert.ok(parsed.chips.some((c) => c.value === "ambiguous"));
    assert.match(parsed.clarificationMessage, /what time/i);
  }
});

test("end of this, upcoming and next week ask for Friday or Sunday with actual dates", () => {
  const monday = new Date(2026, 9, 12, 15);
  for (const [phrase, dates] of [["end of this week", [16, 18]], ["end of next week", [23, 25]], ["end of upcoming week", [23, 25]]]) {
    const parsed = parseToss(`submit docs by ${phrase}`, [], monday);
    assert.equal(parsed.dueAt, undefined);
    assert.deepEqual(parsed.dueChoices.map((c) => new Date(c.dueAt).getDate()), dates, phrase);
    assert.match(parsed.clarificationMessage, /Friday.*Sunday/i);
    assert.equal(parsed.importance, "next", "date modifiers are not pace commands");
  }
});

test("by includes the named day; before excludes it when no explicit time is given", () => {
  const monday = new Date(2026, 9, 12, 15);
  assert.equal(new Date(parseToss("submit by Friday", [], monday).dueAt).getDate(), 16);
  assert.equal(new Date(parseToss("submit before Friday", [], monday).dueAt).getDate(), 15);
  assert.equal(new Date(parseToss("submit before October 16", [], monday).dueAt).getDate(), 15);
});

test("this weekday stays in the current calendar week and next weekday uses the following week", () => {
  const monday = new Date(2026, 9, 12, 15);
  assert.equal(new Date(parseToss("submit this Monday", [], monday).dueAt).getDate(), 12);
  assert.equal(new Date(parseToss("submit this Friday", [], monday).dueAt).getDate(), 16);
  const next = parseToss("submit next Friday", [], monday);
  assert.equal(new Date(next.dueAt).getDate(), 23);
  assert.equal(next.duePhrase, "next Friday");
  assert.equal(next.title, "submit");
});

test("invalid times are clarified instead of replaced by the default", () => {
  for (const time of ["25:00", "13 PM", "0 AM", "5:90 PM", "5:9 PM", "banana"]) {
    const parsed = parseToss(`submit today at ${time}`, [], morning);
    assert.equal(parsed.dueAt, undefined, time);
    assert.ok(parsed.chips.some((c) => c.value === "ambiguous"), time);
  }
});

test("multiple date instructions request a choice instead of using the first", () => {
  const parsed = parseToss("submit tomorrow or Friday", [], morning);
  assert.equal(parsed.dueAt, undefined);
  assert.match(parsed.clarificationMessage, /more than one|which date/i);
  assert.equal(parseToss("meet tomorrow then prepare docs Friday", [], morning).title, "meet then prepare docs", "task words between dates must survive clarification");
});

test("a date with an explicit time is not rolled to next year merely because its default time has passed", () => {
  const late = new Date(2026, 9, 12, 22, 30);
  const parsed = parseToss("submit October 12 at 11 PM", [], late);
  assert.equal(new Date(parsed.dueAt).getFullYear(), 2026);
  assert.equal(new Date(parsed.dueAt).getDate(), 12);
  assert.equal(new Date(parsed.dueAt).getHours(), 23);
});

test("explicit times remain respected in end-of-period phrases and relative durations", () => {
  const monday = new Date(2026, 9, 12, 15);
  assert.equal(new Date(parseToss("submit by EOD at 5 PM", [], monday).dueAt).getHours(), 17);
  assert.ok(parseToss("submit by end of this week at 5 PM", [], monday).dueChoices.every((c) => new Date(c.dueAt).getHours() === 17));
  assert.equal(new Date(parseToss("submit in 3 days", [], monday).dueAt).getDate(), 15);
  assert.equal(new Date(parseToss("submit in a week", [], monday).dueAt).getDate(), 19);
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
